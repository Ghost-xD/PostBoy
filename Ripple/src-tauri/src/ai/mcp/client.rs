//! Thin wrapper around `rmcp::RunningService<RoleClient, ...>`.
//!
//! All MCP-protocol details — initialize handshake, JSON-RPC framing,
//! capability negotiation, transport multiplexing — live inside `rmcp`.
//! This module exists to:
//!   1. Build the right transport (stdio child process vs streamable HTTP)
//!      from a `McpServerConfig`.
//!   2. Apply our `${env:VAR}` and `${secret:KEY}` interpolation pass over
//!      command args, env, headers, and URLs before handing them to rmcp.
//!   3. Expose a small ergonomic API (`list_tools`, `call_tool`, `close`)
//!      that the rest of the app can use without dragging the rmcp type
//!      universe through every call site.

use std::collections::HashMap;
use std::sync::Arc;

use rmcp::ServiceExt;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ClientCapabilities, ClientInfo, Implementation, Tool,
};
use rmcp::service::{RoleClient, RunningService};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{ConfigureCommandExt, StreamableHttpClientTransport, TokioChildProcess};
use serde_json::Map;
use tokio::process::Command;

use super::config::{McpServerConfig, McpTransport};
use super::secrets;

/// A live MCP client + the cached metadata we need to render UI without a
/// round-trip. The `Arc<RunningService>` keeps the client cheap to clone for
/// concurrent `call_tool` invocations.
pub struct ConnectedClient {
    pub config: McpServerConfig,
    pub service: Arc<RunningService<RoleClient, ClientInfo>>,
    pub tools: Vec<Tool>,
    pub server_info: Option<serde_json::Value>,
}

impl ConnectedClient {
    /// Connect to a configured MCP server. Returns Err with a human-readable
    /// reason on any failure (transport spawn, MCP initialize, list_tools).
    pub async fn connect(config: McpServerConfig) -> Result<Self, String> {
        let service = match &config.transport {
            McpTransport::Stdio {
                command,
                args,
                env,
                cwd,
            } => connect_stdio(command, args, env, cwd.as_deref()).await?,
            McpTransport::Remote { url, headers } => {
                connect_remote(&config, url, headers).await?
            }
        };

        // Pull tool list once at connect time. Re-listing on demand is
        // possible but most servers' tool schemas are static; the MCP spec
        // requires `notifications/tools/list_changed` for any server that
        // rotates tools, and we can wire that in later if a server needs it.
        let tools = service
            .list_all_tools()
            .await
            .map_err(|e| format!("list_tools failed: {e}"))?;

        let server_info = service
            .peer_info()
            .map(|info| serde_json::to_value(info).unwrap_or(serde_json::Value::Null));

        Ok(Self {
            config,
            service: Arc::new(service),
            tools,
            server_info,
        })
    }

    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<CallToolResult, String> {
        let mut params = CallToolRequestParams::new(tool_name.to_string());
        if let serde_json::Value::Object(map) = arguments {
            params = params.with_arguments(map);
        } else if !arguments.is_null() {
            // The spec requires `arguments` be an object. If the model
            // produced a scalar/array we wrap it under "input" so the server
            // sees something well-formed instead of a JSON-RPC error.
            let mut wrapped = Map::new();
            wrapped.insert("input".to_string(), arguments);
            params = params.with_arguments(wrapped);
        }
        self.service
            .call_tool(params)
            .await
            .map_err(|e| format!("call_tool: {e}"))
    }

    /// Best-effort graceful shutdown. We don't propagate the error because
    /// the caller is usually disconnecting/replacing the client and there's
    /// nothing useful to do with a "couldn't kill subprocess cleanly" report.
    pub async fn close(self) {
        // `Arc::try_unwrap` succeeds when no other handle is alive — the
        // common case after `dispatch` releases its clone. If a call is
        // still in-flight, drop the Arc and let `RunningService::Drop` kill
        // the worker on the next scheduling boundary.
        if let Ok(service) = Arc::try_unwrap(self.service) {
            let _ = service.cancel().await;
        }
    }
}

async fn connect_stdio(
    command: &str,
    args: &[String],
    env: &HashMap<String, String>,
    cwd: Option<&str>,
) -> Result<RunningService<RoleClient, ClientInfo>, String> {
    let resolved_command = interpolate(command);
    let resolved_args: Vec<String> = args.iter().map(|a| interpolate(a)).collect();
    let resolved_env: HashMap<String, String> = env
        .iter()
        .map(|(k, v)| (k.clone(), interpolate(v)))
        .collect();

    let cmd = Command::new(&resolved_command).configure(|c| {
        for arg in &resolved_args {
            c.arg(arg);
        }
        for (k, v) in &resolved_env {
            c.env(k, v);
        }
        if let Some(cwd) = cwd {
            c.current_dir(cwd);
        }
        // Inherit stderr to the parent so users see "command not found"
        // and other early failures in their devtools/console.
        c.stderr(std::process::Stdio::inherit());
    });

    let transport = TokioChildProcess::new(cmd)
        .map_err(|e| format!("Failed to spawn '{}': {e}", resolved_command))?;

    let info = client_info();
    info.serve(transport)
        .await
        .map_err(|e| format!("MCP handshake (stdio) failed: {e}"))
}

async fn connect_remote(
    config: &McpServerConfig,
    url: &str,
    headers: &HashMap<String, String>,
) -> Result<RunningService<RoleClient, ClientInfo>, String> {
    let resolved_url = interpolate(url);

    // Resolve every header value (env + secret interpolation), then split
    // out any Authorization: Bearer entry so we can hand the bare token to
    // rmcp's `auth_header` slot — rmcp rejects authorization headers in
    // `custom_headers` because it manages that one itself.
    use http::{HeaderName, HeaderValue};
    let mut auth_token: Option<String> = None;
    let mut custom_headers: HashMap<HeaderName, HeaderValue> = HashMap::new();
    for (raw_name, raw_value) in headers {
        let value = maybe_resolve_secret(&config.id, raw_value);
        if value.is_empty() {
            continue;
        }
        if raw_name.eq_ignore_ascii_case("authorization") {
            // `auth_header` expects the token without the `Bearer ` prefix.
            let trimmed = value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
                .unwrap_or(&value)
                .to_string();
            auth_token = Some(trimmed);
            continue;
        }
        let name = HeaderName::from_bytes(raw_name.as_bytes())
            .map_err(|e| format!("Invalid header name '{raw_name}': {e}"))?;
        let val = HeaderValue::from_str(&value)
            .map_err(|e| format!("Invalid header value for '{raw_name}': {e}"))?;
        custom_headers.insert(name, val);
    }

    // Auto-attach an OAuth-stored access token when one is on file. Only
    // override the user-supplied auth header if the user didn't already set
    // one explicitly — supporting "I want to test with a paste-token even
    // though OAuth is configured" as a debugging escape hatch.
    if auth_token.is_none() && config.oauth.is_some() {
        if let Some(creds) = super::oauth::load_credentials(&config.id)? {
            if let Some(access) = creds.token.get("access_token").and_then(|v| v.as_str()) {
                auth_token = Some(access.to_string());
            }
        }
    }

    let mut cfg = StreamableHttpClientTransportConfig::with_uri(resolved_url.clone());
    if let Some(token) = auth_token {
        cfg = cfg.auth_header(token);
    }
    if !custom_headers.is_empty() {
        cfg = cfg.custom_headers(custom_headers);
    }
    let transport = StreamableHttpClientTransport::from_config(cfg);

    let info = client_info();
    info.serve(transport)
        .await
        .map_err(|e| format!("MCP handshake (remote) failed: {e}"))
}

fn client_info() -> ClientInfo {
    // `ClientInfo` (alias for `InitializeRequestParams`) is `#[non_exhaustive]`,
    // so it must be built via its constructor rather than a struct literal.
    ClientInfo::new(
        ClientCapabilities::default(),
        Implementation::new("Ripple", env!("CARGO_PKG_VERSION")).with_title("Ripple"),
    )
}

/// Resolve `${env:NAME}` references against the parent process environment.
/// Mirrors Cursor's mcp.json behavior. Unknown variables expand to empty
/// strings (rather than panicking) because the user gets a clearer failure
/// later — "MCP server returned 401" — than a Rust-level resolution error.
fn interpolate(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'$' && bytes[i + 1] == b'{' {
            if let Some(end_rel) = input[i + 2..].find('}') {
                let inner = &input[i + 2..i + 2 + end_rel];
                if let Some(rest) = inner.strip_prefix("env:") {
                    out.push_str(&std::env::var(rest).unwrap_or_default());
                    i += 2 + end_rel + 1;
                    continue;
                }
                // `${secret:...}` and `${workspaceFolder}` are intentionally
                // left as-is here — they're either resolved later
                // (`maybe_resolve_secret` for headers) or unsupported
                // (workspace folders don't make sense in this app).
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// `${secret:KEY}` → keychain lookup under this server's namespace. We do
/// the keychain probe lazily-per-header rather than resolving everything
/// up-front so an absent secret yields a clean error instead of corrupting
/// every other header.
fn maybe_resolve_secret(server_id: &str, value: &str) -> String {
    if let Some(rest) = value.strip_prefix("${secret:") {
        if let Some(key) = rest.strip_suffix('}') {
            return secrets::get(server_id, key)
                .ok()
                .flatten()
                .unwrap_or_default();
        }
    }
    interpolate(value)
}
