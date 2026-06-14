//! Tauri-side command surface for MCP server management.
//!
//! All commands are async because rmcp's client API is async; even the
//! "list servers" path goes through the manager's `RwLock`. None of these
//! commands return rmcp types directly — only our own `McpServerView` /
//! plain JSON — so the frontend bindings stay decoupled from rmcp version
//! bumps.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::config::{McpJsonImport, McpServerConfig, McpTransport, OAuthMetadata};
use super::db;
use super::oauth;
use super::secrets;
use super::{McpManager, McpServerView, DEFAULT_TOOL_CAP};
use crate::ai::AiState;

/// Args used by `mcp_add_server` / `mcp_update_server`. We keep transport
/// fields flat (matching the frontend form) and let the command code build
/// the typed `McpTransport`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct McpServerInput {
    pub id: Option<String>,
    pub name: String,
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub tool_overrides: HashMap<String, bool>,
    /// Optional bearer token / PAT pasted by the user. Stored in the
    /// keychain on save and surfaced via `${secret:manual-token}` so it
    /// doesn't leak into the `mcp_servers` table.
    #[serde(default)]
    pub manual_token: Option<String>,
}

fn default_true() -> bool {
    true
}

impl McpServerInput {
    fn into_config(self, existing_id: Option<String>) -> Result<McpServerConfig, String> {
        let id = existing_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let transport = match self.transport.as_str() {
            "stdio" => McpTransport::Stdio {
                command: self.command.ok_or_else(|| {
                    "stdio transport requires a `command`".to_string()
                })?,
                args: self.args,
                env: self.env,
                cwd: self.cwd,
            },
            "remote" => McpTransport::Remote {
                url: self.url.ok_or_else(|| {
                    "remote transport requires a `url`".to_string()
                })?,
                headers: self.headers,
            },
            other => {
                return Err(format!(
                    "Unknown transport '{other}' (expected 'stdio' or 'remote')"
                ))
            }
        };
        Ok(McpServerConfig {
            id,
            name: self.name,
            transport,
            enabled: self.enabled,
            tool_overrides: self.tool_overrides,
            oauth: None, // populated by `mcp_authorize`
            created_at: None,
            updated_at: None,
        })
    }
}

fn manager(state: &State<'_, Arc<AiState>>) -> Arc<McpManager> {
    state.mcp.clone()
}

#[tauri::command]
pub async fn mcp_list_servers(
    state: State<'_, Arc<AiState>>,
) -> Result<Vec<McpServerView>, String> {
    Ok(manager(&state).list().await)
}

#[tauri::command]
pub async fn mcp_get_server(
    state: State<'_, Arc<AiState>>,
    id: String,
) -> Result<Option<McpServerView>, String> {
    Ok(manager(&state).get_view(&id).await)
}

#[tauri::command]
pub async fn mcp_add_server(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    input: McpServerInput,
) -> Result<McpServerView, String> {
    let manual_token = input.manual_token.clone();
    let mut cfg = input.into_config(None)?;
    if let Some(token) = manual_token.filter(|s| !s.is_empty()) {
        secrets::set(&cfg.id, secrets::keys::MANUAL_TOKEN, &token)?;
        // Inject a `${secret:manual-token}` placeholder into Authorization
        // so the headers map round-trips through the DB without ever
        // touching the bearer string.
        if let McpTransport::Remote { headers, .. } = &mut cfg.transport {
            headers
                .entry("Authorization".to_string())
                .or_insert_with(|| "Bearer ${secret:manual-token}".to_string());
        }
    }
    db::upsert(&app, &cfg)?;
    let mgr = manager(&state);
    mgr.upsert(cfg.clone()).await;
    Ok(mgr
        .get_view(&cfg.id)
        .await
        .ok_or_else(|| "Server vanished after upsert".to_string())?)
}

#[tauri::command]
pub async fn mcp_update_server(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    input: McpServerInput,
) -> Result<McpServerView, String> {
    let id = input.id.clone().ok_or_else(|| "id is required".to_string())?;
    let manual_token = input.manual_token.clone();
    let mut cfg = input.into_config(Some(id.clone()))?;

    // Preserve existing OAuth bookkeeping; the user updating headers/url
    // shouldn't blow away an active sign-in.
    if let Some(prev) = manager(&state).get_config(&id).await {
        cfg.oauth = prev.oauth;
    }

    if let Some(token) = manual_token.filter(|s| !s.is_empty()) {
        secrets::set(&id, secrets::keys::MANUAL_TOKEN, &token)?;
        if let McpTransport::Remote { headers, .. } = &mut cfg.transport {
            headers
                .entry("Authorization".to_string())
                .or_insert_with(|| "Bearer ${secret:manual-token}".to_string());
        }
    }

    db::upsert(&app, &cfg)?;
    let mgr = manager(&state);
    mgr.upsert(cfg.clone()).await;
    // Disconnect — caller can reconnect explicitly. This avoids surprises
    // where edits to a connected server silently break in-flight calls.
    mgr.disconnect(&id).await;
    Ok(mgr
        .get_view(&id)
        .await
        .ok_or_else(|| "Server vanished after update".to_string())?)
}

#[tauri::command]
pub async fn mcp_delete_server(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    id: String,
) -> Result<(), String> {
    db::delete(&app, &id)?;
    manager(&state).remove(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn mcp_set_enabled(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mgr = manager(&state);
    let mut cfg = mgr
        .get_config(&id)
        .await
        .ok_or_else(|| format!("No such server: {id}"))?;
    cfg.enabled = enabled;
    db::upsert(&app, &cfg)?;
    mgr.upsert(cfg).await;
    if !enabled {
        mgr.disconnect(&id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_set_tool_enabled(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    id: String,
    tool_name: String,
    enabled: bool,
) -> Result<(), String> {
    let mgr = manager(&state);
    mgr.set_tool_enabled(&id, &tool_name, enabled).await?;
    if let Some(cfg) = mgr.get_config(&id).await {
        db::upsert(&app, &cfg)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_connect(
    state: State<'_, Arc<AiState>>,
    app: AppHandle,
    id: String,
) -> Result<McpServerView, String> {
    let view = manager(&state).connect(&id).await?;
    let _ = app.emit("mcp-status", &view);
    Ok(view)
}

#[tauri::command]
pub async fn mcp_disconnect(
    state: State<'_, Arc<AiState>>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    manager(&state).disconnect(&id).await;
    if let Some(view) = manager(&state).get_view(&id).await {
        let _ = app.emit("mcp-status", &view);
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_test_connection(
    state: State<'_, Arc<AiState>>,
    id: String,
) -> Result<McpServerView, String> {
    // "Test connection" is just connect-then-disconnect-if-the-user-asks.
    // We deliberately leave the connection up on success so the next chat
    // turn can call tools without waiting for another handshake.
    manager(&state).connect(&id).await
}

#[tauri::command]
pub async fn mcp_authorize(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    id: String,
    scopes: Option<Vec<String>>,
) -> Result<McpServerView, String> {
    let cfg = manager(&state)
        .get_config(&id)
        .await
        .ok_or_else(|| format!("No such server: {id}"))?;
    let url = match &cfg.transport {
        McpTransport::Remote { url, .. } => url.clone(),
        _ => return Err("OAuth is only valid for remote servers".to_string()),
    };

    let scopes_owned: Vec<String> = scopes.unwrap_or_default();
    let scope_refs: Vec<&str> = scopes_owned.iter().map(|s| s.as_str()).collect();
    let result = oauth::authorize(app.clone(), &id, &url, &scope_refs).await?;

    // Persist the OAuth metadata (server URL, granted scopes) on the config
    // so subsequent `connect`s pull the cached token out of the keyring.
    let mut updated = cfg.clone();
    updated.oauth = Some(OAuthMetadata {
        authorization_server: result.authorization_server.unwrap_or(url),
        scopes: result.scopes,
        last_refreshed_at: Some(chrono::Utc::now().to_rfc3339()),
    });
    db::upsert(&app, &updated)?;
    manager(&state).upsert(updated).await;

    // Re-establish the connection now that we have a token.
    manager(&state).connect(&id).await
}

#[tauri::command]
pub async fn mcp_clear_oauth(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    id: String,
) -> Result<(), String> {
    secrets::delete(&id, secrets::keys::OAUTH_CREDENTIALS)?;
    let mut cfg = manager(&state)
        .get_config(&id)
        .await
        .ok_or_else(|| format!("No such server: {id}"))?;
    cfg.oauth = None;
    db::upsert(&app, &cfg)?;
    manager(&state).upsert(cfg).await;
    manager(&state).disconnect(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn mcp_import_json(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    json: String,
) -> Result<Vec<McpServerView>, String> {
    let parsed: McpJsonImport = serde_json::from_str(&json)
        .map_err(|e| format!("Not valid mcp.json: {e}"))?;
    let configs = parsed.into_configs()?;
    let mut out = Vec::with_capacity(configs.len());
    for cfg in configs {
        db::upsert(&app, &cfg)?;
        manager(&state).upsert(cfg.clone()).await;
        if let Some(v) = manager(&state).get_view(&cfg.id).await {
            out.push(v);
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct ToolCapInfo {
    pub cap: usize,
    pub default_cap: usize,
}

#[tauri::command]
pub async fn mcp_get_tool_cap(app: AppHandle) -> Result<ToolCapInfo, String> {
    let cap = read_tool_cap(&app).unwrap_or(DEFAULT_TOOL_CAP);
    Ok(ToolCapInfo {
        cap,
        default_cap: DEFAULT_TOOL_CAP,
    })
}

#[tauri::command]
pub async fn mcp_set_tool_cap(app: AppHandle, cap: usize) -> Result<(), String> {
    let conn = rusqlite::Connection::open(super::db::db_path(&app)?)
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![super::TOOL_CAP_SETTING, cap.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Internal sync read used by the chat loop. Falls back to
/// `DEFAULT_TOOL_CAP` on any error so a corrupted setting can't accidentally
/// disable the chatbot — the cap is a soft guardrail, not a security boundary.
pub fn read_tool_cap(app: &AppHandle) -> Result<usize, String> {
    let conn = rusqlite::Connection::open(super::db::db_path(app)?)
        .map_err(|e| e.to_string())?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            rusqlite::params![super::TOOL_CAP_SETTING],
            |row| row.get(0),
        )
        .ok();
    Ok(raw.and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_TOOL_CAP))
}
