//! MCP server configuration types.
//!
//! These mirror the shape of Cursor's `mcp.json` so the import/export path is
//! a 1:1 copy and users can paste configs from Cursor directly. The config
//! objects here capture *non-secret* settings only: anything that looks like
//! a bearer token or password is stored separately in the OS keychain and
//! referenced by an opaque `secret_ref`. That separation is the entire reason
//! we don't just dump the JSON into `ripple.db`.
//!
//! Variable interpolation (`${env:VAR}`) is intentionally evaluated lazily
//! at connect time, so a user can edit a server's config while it's running
//! without leaking the resolved-secret into the persisted record.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single MCP server registered in the app. Carries every piece of
/// configuration EXCEPT secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// Stable id used as the keyring service-name suffix and for namespacing
    /// tools (`mcp__<id>__<tool>`). Generated server-side; clients never need
    /// to construct these.
    pub id: String,
    /// User-visible display name (matches Cursor's "name" field in mcp.json).
    pub name: String,
    pub transport: McpTransport,
    /// Master kill-switch. When false, the server is never connected and its
    /// tools are excluded from the model's tool list — same UX as Cursor's
    /// per-server toggle.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Per-tool enable map. Missing entries default to enabled, so adding a
    /// new server "just works" without ticking 30 checkboxes.
    #[serde(default)]
    pub tool_overrides: HashMap<String, bool>,
    /// Optional auth metadata. Only set for remote servers that completed
    /// an OAuth flow; the actual tokens live in the keychain.
    #[serde(default)]
    pub oauth: Option<OAuthMetadata>,
    /// ISO-8601 timestamps; populated by the DB layer.
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum McpTransport {
    /// Local subprocess speaking JSON-RPC over stdin/stdout. Identical to
    /// Cursor's stdio entry: `command + args + env + cwd`.
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: HashMap<String, String>,
        #[serde(default)]
        cwd: Option<String>,
    },
    /// Remote MCP endpoint (Streamable HTTP / SSE). Auth is either:
    ///   - `Headers`: caller supplies arbitrary `Authorization`-style headers
    ///     (the value may use `${env:VAR}` interpolation, OR may reference a
    ///     secret stored in the keychain via `${secret:NAME}`).
    ///   - `OAuth`: rmcp's auth state machine drives a PKCE flow at first
    ///     connect; the resulting token is kept in the keychain.
    Remote {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
}

/// Bookkeeping for an OAuth-authorized remote server. The actual tokens live
/// in the keychain — this struct only holds the non-secret cache (issuer,
/// scopes granted, last refresh time) so the UI can show "signed in as …"
/// without round-tripping through the keychain on every render.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthMetadata {
    pub authorization_server: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub last_refreshed_at: Option<String>,
}

impl McpServerConfig {
    /// True iff this server is configured for an OAuth-driven remote
    /// transport. Used by the frontend to surface the "Sign in" button vs
    /// the "Paste headers" form.
    pub fn requires_oauth(&self) -> bool {
        self.oauth.is_some()
    }

    /// Tools the user has explicitly disabled. Used to filter the merged
    /// schema fed to the model.
    pub fn is_tool_enabled(&self, tool_name: &str) -> bool {
        self.enabled
            && self
                .tool_overrides
                .get(tool_name)
                .copied()
                .unwrap_or(true)
    }
}

/// Shape used by the `mcp_import_json` Tauri command. Matches Cursor's
/// top-level `mcp.json` format so users can copy/paste between the two
/// apps. Each server object is tagged with stdio (`command`) or remote
/// (`url`) by inspecting which fields are present.
#[derive(Debug, Deserialize)]
pub struct McpJsonImport {
    #[serde(default)]
    #[serde(rename = "mcpServers")]
    pub mcp_servers: HashMap<String, McpJsonServer>,
}

#[derive(Debug, Deserialize)]
pub struct McpJsonServer {
    // stdio fields
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cwd: Option<String>,
    // remote fields
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

impl McpJsonImport {
    /// Convert each entry into a `McpServerConfig`, generating fresh ids.
    /// Validates that exactly one of `command` or `url` is set per server —
    /// rejecting ambiguous entries up-front avoids a silent "this server
    /// won't connect and we'll never tell you why" failure mode.
    pub fn into_configs(self) -> Result<Vec<McpServerConfig>, String> {
        let mut out = Vec::with_capacity(self.mcp_servers.len());
        for (name, srv) in self.mcp_servers {
            let transport = match (srv.command, srv.url) {
                (Some(_), Some(_)) => {
                    return Err(format!(
                        "Server '{name}' has both `command` and `url`; pick one"
                    ));
                }
                (None, None) => {
                    return Err(format!(
                        "Server '{name}' is missing both `command` and `url`"
                    ));
                }
                (Some(command), None) => McpTransport::Stdio {
                    command,
                    args: srv.args,
                    env: srv.env,
                    cwd: srv.cwd,
                },
                (None, Some(url)) => McpTransport::Remote {
                    url,
                    headers: srv.headers,
                },
            };
            out.push(McpServerConfig {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                transport,
                enabled: true,
                tool_overrides: HashMap::new(),
                oauth: None,
                created_at: None,
                updated_at: None,
            });
        }
        Ok(out)
    }
}
