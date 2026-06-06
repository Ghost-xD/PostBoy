//! Model Context Protocol (MCP) integration.
//!
//! This module is the bridge between rmcp (the official MCP Rust SDK) and
//! Ripple's chat loop. It owns:
//!   - The persistent server registry (`db.rs` reads/writes `mcp_servers`).
//!   - The runtime connection state (`McpManager` holds live `rmcp` clients).
//!   - The tool-list merge into the chat-loop schema (`merge_tools`).
//!   - Cursor-style namespacing: each MCP tool is exposed to the model as
//!     `mcp__<server_name>__<tool>` so it can't collide with one of the 9
//!     built-in tools and dispatch can route by prefix.
//!
//! Everything is gated behind `#[cfg(feature = "chatbot")]` via the parent
//! module — non-chatbot builds compile to nothing here.

pub mod client;
pub mod commands;
pub mod config;
pub mod db;
pub mod oauth;
pub mod secrets;

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::RwLock;

use self::client::ConnectedClient;
use self::config::McpServerConfig;

/// Cursor uses this exact prefix for namespaced MCP tools. Keeping the
/// convention identical means transcripts copy/paste cleanly between the
/// two products and the model has likely seen this exact pattern in
/// training data.
pub const TOOL_PREFIX: &str = "mcp__";
/// Separator between the server name and the tool name in a namespaced
/// tool identifier (`mcp__github__create_issue`).
const TOOL_SEP: &str = "__";

/// Hard ceiling on how many tools (built-in + MCP) we ever feed to the
/// model. Small local models start hallucinating tool names once the
/// schema gets too long; the cap is the main lever the plan calls out for
/// keeping the feature "bug-less" on smaller models.
pub const DEFAULT_TOOL_CAP: usize = 40;

/// Setting key that overrides `DEFAULT_TOOL_CAP` from the UI.
pub const TOOL_CAP_SETTING: &str = "mcp.tool_cap";

/// Runtime state for a server — what the UI shows on the "status dot".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed { error: String },
}

/// Public, frontend-facing snapshot of a server. Kept separate from
/// `McpServerConfig` so we can include runtime fields (status, last error,
/// list of discovered tools) without leaking those into the persisted
/// record.
#[derive(Debug, Clone, Serialize)]
pub struct McpServerView {
    pub config: McpServerConfig,
    pub status: ConnectionStatus,
    /// Names of tools advertised by the server, with `enabled` reflecting
    /// the per-tool override map.
    pub tools: Vec<McpToolView>,
    /// Optional snapshot of the server's `Implementation` block as returned
    /// during the MCP initialize handshake. Useful for "Connected to: …".
    pub server_info: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpToolView {
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    /// Pre-namespaced identifier the model sees (`mcp__github__list_repos`).
    pub namespaced_name: String,
}

struct ServerEntry {
    config: McpServerConfig,
    status: ConnectionStatus,
    client: Option<ConnectedClient>,
}

/// Process-wide MCP state. Held by `AiState` (one per app instance).
pub struct McpManager {
    inner: RwLock<HashMap<String, ServerEntry>>,
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    /// Replace the in-memory registry with the given list (typically the
    /// result of a DB read at startup or after an import). Existing live
    /// clients are NOT touched — call `connect_all_enabled` afterward to
    /// (re)establish connections. This split lets us refresh metadata
    /// without disrupting in-flight tool calls.
    pub async fn hydrate(&self, configs: Vec<McpServerConfig>) {
        let mut map = self.inner.write().await;
        let mut next: HashMap<String, ServerEntry> = HashMap::new();
        for cfg in configs {
            let id = cfg.id.clone();
            let prev = map.remove(&id);
            next.insert(
                id,
                ServerEntry {
                    config: cfg,
                    status: prev
                        .as_ref()
                        .map(|e| e.status.clone())
                        .unwrap_or(ConnectionStatus::Disconnected),
                    client: prev.and_then(|e| e.client),
                },
            );
        }
        *map = next;
    }

    pub async fn upsert(&self, cfg: McpServerConfig) {
        let mut map = self.inner.write().await;
        let id = cfg.id.clone();
        match map.get_mut(&id) {
            Some(entry) => {
                entry.config = cfg;
            }
            None => {
                map.insert(
                    id,
                    ServerEntry {
                        config: cfg,
                        status: ConnectionStatus::Disconnected,
                        client: None,
                    },
                );
            }
        }
    }

    pub async fn remove(&self, id: &str) {
        let entry = {
            let mut map = self.inner.write().await;
            map.remove(id)
        };
        if let Some(entry) = entry {
            if let Some(client) = entry.client {
                client.close().await;
            }
            secrets::purge_known(id);
        }
    }

    pub async fn list(&self) -> Vec<McpServerView> {
        let map = self.inner.read().await;
        map.values().map(|e| view_of(e)).collect()
    }

    pub async fn get_view(&self, id: &str) -> Option<McpServerView> {
        let map = self.inner.read().await;
        map.get(id).map(view_of)
    }

    pub async fn get_config(&self, id: &str) -> Option<McpServerConfig> {
        self.inner.read().await.get(id).map(|e| e.config.clone())
    }

    pub async fn set_status(&self, id: &str, status: ConnectionStatus) {
        if let Some(entry) = self.inner.write().await.get_mut(id) {
            entry.status = status;
        }
    }

    pub async fn set_tool_enabled(&self, id: &str, tool_name: &str, enabled: bool) -> Result<(), String> {
        let mut map = self.inner.write().await;
        let entry = map
            .get_mut(id)
            .ok_or_else(|| format!("No such server: {id}"))?;
        entry.config.tool_overrides.insert(tool_name.to_string(), enabled);
        Ok(())
    }

    /// Establish a connection (or replace the existing one) for `id`. The
    /// caller is responsible for first persisting the config so a restart
    /// rehydrates correctly. Errors are stored on the entry as
    /// `ConnectionStatus::Failed` AND returned to the caller so the UI can
    /// surface them inline.
    pub async fn connect(&self, id: &str) -> Result<McpServerView, String> {
        let cfg = self
            .get_config(id)
            .await
            .ok_or_else(|| format!("No such server: {id}"))?;

        if !cfg.enabled {
            return Err("Server is disabled".to_string());
        }

        // Drop any prior client BEFORE we attempt a new connect: leaving a
        // stale stdio child process running while we boot a new one is the
        // single most common "ghost subprocess" leak.
        self.disconnect(id).await;

        self.set_status(id, ConnectionStatus::Connecting).await;

        match ConnectedClient::connect(cfg.clone()).await {
            Ok(client) => {
                let mut map = self.inner.write().await;
                if let Some(entry) = map.get_mut(id) {
                    entry.client = Some(client);
                    entry.status = ConnectionStatus::Connected;
                    return Ok(view_of(entry));
                }
                Err("Server vanished mid-connect".to_string())
            }
            Err(e) => {
                self.set_status(
                    id,
                    ConnectionStatus::Failed {
                        error: e.clone(),
                    },
                )
                .await;
                Err(e)
            }
        }
    }

    /// Close the current connection if any. Safe to call repeatedly.
    pub async fn disconnect(&self, id: &str) {
        let client = {
            let mut map = self.inner.write().await;
            match map.get_mut(id) {
                Some(entry) => {
                    entry.status = ConnectionStatus::Disconnected;
                    entry.client.take()
                }
                None => None,
            }
        };
        if let Some(c) = client {
            c.close().await;
        }
    }

    /// Disconnect every server. Used at app shutdown so MCP child processes
    /// don't outlive the UI.
    pub async fn disconnect_all(&self) {
        let ids: Vec<String> = self.inner.read().await.keys().cloned().collect();
        for id in ids {
            self.disconnect(&id).await;
        }
    }

    /// Connect every enabled server in parallel. Errors per-server are
    /// recorded on the entry status; the function itself never errors.
    pub async fn connect_all_enabled(&self) {
        let ids: Vec<String> = {
            let map = self.inner.read().await;
            map.iter()
                .filter(|(_, e)| e.config.enabled)
                .map(|(id, _)| id.clone())
                .collect()
        };
        // We do the connects sequentially rather than via `join_all` so a
        // misconfigured server can't race against another server's
        // initialize handshake. On a few servers the overhead is negligible.
        for id in ids {
            let _ = self.connect(&id).await;
        }
    }

    /// Build the sub-list of MCP tool schemas to merge into the chat
    /// loop's tool prompt, plus the same tools' namespaced names so the
    /// grammar can reference them. `cap` is the maximum number of MCP tools
    /// to include (the chat loop adds the 8 built-ins on top of this list).
    pub async fn merged_tools(&self, cap: usize) -> MergedTools {
        let map = self.inner.read().await;
        let mut schemas: Vec<Value> = Vec::new();
        let mut names: Vec<String> = Vec::new();
        // We use a deterministic insertion order: alphabetical by server
        // name, then tool name. Without it, the model's prompt reorders
        // each turn (HashMap iteration is randomized) and KV-cache reuse
        // across consecutive turns is destroyed.
        let mut entries: Vec<&ServerEntry> = map.values().collect();
        entries.sort_by(|a, b| a.config.name.cmp(&b.config.name));
        'outer: for entry in entries {
            if !matches!(entry.status, ConnectionStatus::Connected) {
                continue;
            }
            if !entry.config.enabled {
                continue;
            }
            let Some(client) = entry.client.as_ref() else {
                continue;
            };
            let mut tools_sorted = client.tools.clone();
            tools_sorted.sort_by(|a, b| a.name.cmp(&b.name));
            for tool in &tools_sorted {
                if names.len() >= cap {
                    break 'outer;
                }
                if !entry.config.is_tool_enabled(tool.name.as_ref()) {
                    continue;
                }
                let namespaced = namespaced_name(&entry.config.name, tool.name.as_ref());
                schemas.push(json!({
                    "name": namespaced,
                    "description": tool.description.as_deref().unwrap_or(""),
                    "arguments": (*tool.input_schema).clone(),
                    "_mcp": { "server_id": entry.config.id, "raw_name": tool.name }
                }));
                names.push(namespaced);
            }
        }
        MergedTools { schemas, names }
    }

    /// Dispatch a `mcp__<server>__<tool>` invocation. Returns a
    /// JSON-serializable result (or an `{"error": ...}` envelope) so the
    /// chat loop can feed it back into the model uniformly with built-in
    /// tool results.
    pub async fn call_namespaced_tool(
        &self,
        namespaced_name: &str,
        arguments: Value,
    ) -> Value {
        let (server_name, tool_name) = match split_namespaced(namespaced_name) {
            Some(p) => p,
            None => {
                return json!({
                    "error": format!(
                        "Tool name '{namespaced_name}' is not a valid MCP namespaced identifier"
                    )
                })
            }
        };

        // Look the server up by display name. We use name (not id) on the
        // wire so the model never has to memorize random uuids; a slugified
        // version of the user's display name is what it sees.
        let id_opt = {
            let map = self.inner.read().await;
            map.values()
                .find(|e| slugify(&e.config.name) == server_name)
                .map(|e| e.config.id.clone())
        };
        let Some(id) = id_opt else {
            return json!({"error": format!("Unknown MCP server '{server_name}'")});
        };

        let arc_client = {
            let map = self.inner.read().await;
            match map.get(&id).and_then(|e| e.client.as_ref()) {
                Some(c) => Arc::clone(&c.service),
                None => {
                    return json!({"error": format!("MCP server '{server_name}' is not connected")})
                }
            }
        };

        let mut params = rmcp::model::CallToolRequestParams::new(tool_name.to_string());
        if let Value::Object(map) = arguments {
            params = params.with_arguments(map);
        }
        match arc_client.call_tool(params).await {
            Ok(result) => normalize_tool_result(result),
            Err(e) => json!({"error": format!("MCP call failed: {e}")}),
        }
    }
}

pub struct MergedTools {
    pub schemas: Vec<Value>,
    /// Namespaced names in the order they appear in `schemas`. Used to
    /// build the engine's runtime grammar.
    pub names: Vec<String>,
}

fn view_of(entry: &ServerEntry) -> McpServerView {
    let tools: Vec<McpToolView> = match entry.client.as_ref() {
        Some(c) => c
            .tools
            .iter()
            .map(|t| {
                let name = t.name.to_string();
                McpToolView {
                    namespaced_name: namespaced_name(&entry.config.name, &name),
                    enabled: entry.config.is_tool_enabled(&name),
                    description: t.description.as_ref().map(|d| d.to_string()),
                    name,
                }
            })
            .collect(),
        None => Vec::new(),
    };
    McpServerView {
        config: entry.config.clone(),
        status: entry.status.clone(),
        tools,
        server_info: entry
            .client
            .as_ref()
            .and_then(|c| c.server_info.clone()),
    }
}

/// Slugified server-name fragment used inside the namespaced identifier.
/// Lower-case, alphanum-only — anything else collapses to `_`. Two distinct
/// display names that slugify the same will collide; the panel UI rejects
/// this on save.
pub fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_underscore = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_underscore = false;
        } else if !last_underscore && !out.is_empty() {
            out.push('_');
            last_underscore = true;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    out
}

pub fn namespaced_name(server_name: &str, tool_name: &str) -> String {
    format!("{TOOL_PREFIX}{}{}{tool_name}", slugify(server_name), TOOL_SEP)
}

/// Inverse of [`namespaced_name`] — returns `(server_slug, tool_name)`.
fn split_namespaced(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix(TOOL_PREFIX)?;
    let sep = rest.find(TOOL_SEP)?;
    Some((&rest[..sep], &rest[sep + TOOL_SEP.len()..]))
}

/// Convert rmcp's `CallToolResult` into the same shape our existing tool
/// dispatcher returns. We surface `is_error` as an `error` field so the
/// model's existing error-handling rules trigger; `content` is reduced to
/// readable strings (with `structured_content` preferred when present).
fn normalize_tool_result(result: rmcp::model::CallToolResult) -> Value {
    if result.is_error.unwrap_or(false) {
        let msg = if let Some(structured) = result.structured_content {
            structured.to_string()
        } else {
            content_to_text(&result.content)
        };
        return json!({"error": msg, "kind": "mcp_tool_error"});
    }
    if let Some(structured) = result.structured_content {
        return json!({
            "kind": "mcp_tool_result",
            "structured": structured,
            "text": content_to_text(&result.content),
        });
    }
    json!({
        "kind": "mcp_tool_result",
        "text": content_to_text(&result.content),
    })
}

fn content_to_text(content: &[rmcp::model::Content]) -> String {
    let mut out = String::new();
    for c in content {
        let v = serde_json::to_value(c).unwrap_or(Value::Null);
        if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(text);
        } else {
            // Non-text content (image, embedded resource, …) — surface a
            // hint rather than dumping a binary blob into the prompt.
            let kind = v
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&format!("[{} content elided]", kind));
        }
    }
    out
}
