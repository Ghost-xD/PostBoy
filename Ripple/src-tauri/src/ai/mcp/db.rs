//! Persistence for MCP server configs.
//!
//! The schema (added in migration v10 of `database/mod.rs`) is intentionally
//! minimal: one row per server, with the transport-specific fields
//! denormalized so we don't need a join. Secrets are excluded by design —
//! they live in the OS keychain.

use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::PathBuf;

use super::config::{McpServerConfig, McpTransport, OAuthMetadata};
use tauri::{AppHandle, Manager};

/// Resolve the location of `ripple.db` for this app. Public so
/// `commands.rs` can reuse it for the tool-cap settings query without
/// re-implementing the same Tauri path lookup.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ripple.db"))
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(db_path(app)?).map_err(|e| e.to_string())
}

pub fn load_all(app: &AppHandle) -> Result<Vec<McpServerConfig>, String> {
    let conn = open(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, transport, command, args_json, env_json, cwd, url,
                    headers_json, enabled, tool_overrides_json, oauth_meta_json,
                    created_at, updated_at
             FROM mcp_servers ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_config)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn upsert(app: &AppHandle, cfg: &McpServerConfig) -> Result<(), String> {
    let conn = open(app)?;
    let (transport, command, args_json, env_json, cwd, url, headers_json) =
        match &cfg.transport {
            McpTransport::Stdio {
                command,
                args,
                env,
                cwd,
            } => (
                "stdio",
                Some(command.clone()),
                Some(serde_json::to_string(args).unwrap_or_default()),
                Some(serde_json::to_string(env).unwrap_or_default()),
                cwd.clone(),
                None,
                None,
            ),
            McpTransport::Remote { url, headers } => (
                "remote",
                None,
                None,
                None,
                None,
                Some(url.clone()),
                Some(serde_json::to_string(headers).unwrap_or_default()),
            ),
        };
    let tool_overrides_json =
        serde_json::to_string(&cfg.tool_overrides).unwrap_or_default();
    let oauth_meta_json = match &cfg.oauth {
        Some(o) => serde_json::to_string(o).ok(),
        None => None,
    };
    conn.execute(
        "INSERT INTO mcp_servers
            (id, name, transport, command, args_json, env_json, cwd, url, headers_json,
             enabled, tool_overrides_json, oauth_meta_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                 COALESCE((SELECT created_at FROM mcp_servers WHERE id = ?1), CURRENT_TIMESTAMP),
                 CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            transport = excluded.transport,
            command = excluded.command,
            args_json = excluded.args_json,
            env_json = excluded.env_json,
            cwd = excluded.cwd,
            url = excluded.url,
            headers_json = excluded.headers_json,
            enabled = excluded.enabled,
            tool_overrides_json = excluded.tool_overrides_json,
            oauth_meta_json = excluded.oauth_meta_json,
            updated_at = CURRENT_TIMESTAMP",
        params![
            cfg.id,
            cfg.name,
            transport,
            command,
            args_json,
            env_json,
            cwd,
            url,
            headers_json,
            cfg.enabled as i64,
            tool_overrides_json,
            oauth_meta_json,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    let conn = open(app)?;
    conn.execute("DELETE FROM mcp_servers WHERE id = ?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_config(row: &rusqlite::Row) -> rusqlite::Result<McpServerConfig> {
    let id: String = row.get(0)?;
    let name: String = row.get(1)?;
    let transport_kind: String = row.get(2)?;
    let command: Option<String> = row.get(3)?;
    let args_json: Option<String> = row.get(4)?;
    let env_json: Option<String> = row.get(5)?;
    let cwd: Option<String> = row.get(6)?;
    let url: Option<String> = row.get(7)?;
    let headers_json: Option<String> = row.get(8)?;
    let enabled: i64 = row.get(9)?;
    let tool_overrides_json: Option<String> = row.get(10)?;
    let oauth_meta_json: Option<String> = row.get(11)?;
    let created_at: Option<String> = row.get(12)?;
    let updated_at: Option<String> = row.get(13)?;

    let transport = match transport_kind.as_str() {
        "stdio" => McpTransport::Stdio {
            command: command.unwrap_or_default(),
            args: args_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default(),
            env: env_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default(),
            cwd,
        },
        _ => McpTransport::Remote {
            url: url.unwrap_or_default(),
            headers: headers_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default(),
        },
    };

    let tool_overrides: HashMap<String, bool> = tool_overrides_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let oauth: Option<OAuthMetadata> = oauth_meta_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    Ok(McpServerConfig {
        id,
        name,
        transport,
        enabled: enabled != 0,
        tool_overrides,
        oauth,
        created_at,
        updated_at,
    })
}
