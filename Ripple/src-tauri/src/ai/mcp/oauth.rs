//! OAuth 2.1 + PKCE flow for remote MCP servers.
//!
//! Driven by `rmcp`'s `OAuthState` state machine, which implements the full
//! MCP-spec'd discovery dance (RFC 9728 Protected Resource Metadata → RFC
//! 8414 Authorization Server Metadata → optional RFC 7591 Dynamic Client
//! Registration). All we add on top is:
//!
//!   1. An ephemeral localhost HTTP listener for the OAuth redirect_uri (we
//!      reuse the same `std::net::TcpListener` pattern that lib.rs uses for
//!      its update-server handshake).
//!   2. Browser launch via `tauri-plugin-opener` so the user authorizes the
//!      app in their actual logged-in browser, not a webview.
//!   3. Persistence of the resulting client_id + token response into the
//!      OS keychain so the server can reconnect on next launch without
//!      re-prompting.
//!
//! What this deliberately does NOT do:
//!   - Hand-roll PKCE, code-verifier hashing, or token refresh. rmcp does it.
//!   - Try to support every authorization server quirk in the wild. If a
//!     non-compliant server fails the standard flow, we surface the error
//!     verbatim and let the user fall back to the manual-header path.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use rmcp::transport::auth::OAuthState;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::secrets;

/// Wrap rmcp's credentials into a JSON-serializable blob we can stash in the
/// keychain. `OAuthTokenResponse` already implements serde, so this is just
/// a tagged container that survives a round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCredentials {
    pub client_id: String,
    /// Raw rmcp-side `OAuthTokenResponse`. We keep it as `serde_json::Value`
    /// instead of the typed struct to insulate ourselves from rmcp's
    /// `#[non_exhaustive]` upgrades (a new field added upstream wouldn't
    /// silently drop our cached refresh_token here).
    pub token: serde_json::Value,
}

pub fn load_credentials(server_id: &str) -> Result<Option<StoredCredentials>, String> {
    match secrets::get(server_id, secrets::keys::OAUTH_CREDENTIALS)? {
        None => Ok(None),
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("Stored credentials are corrupt: {e}")),
    }
}

pub fn save_credentials(
    server_id: &str,
    creds: &StoredCredentials,
) -> Result<(), String> {
    let raw = serde_json::to_string(creds)
        .map_err(|e| format!("Serialize credentials: {e}"))?;
    secrets::set(server_id, secrets::keys::OAUTH_CREDENTIALS, &raw)
}

/// The minimal "what the user sees in the UI" view of an OAuth flow result.
/// Returned to the frontend so the panel can flip the row from "Authorize…"
/// to "Signed in".
#[derive(Debug, Clone, Serialize)]
pub struct OAuthResult {
    pub authorization_server: Option<String>,
    pub scopes: Vec<String>,
}

/// Drive the entire OAuth flow synchronously: bind a localhost listener,
/// open the auth URL in the user's browser, wait for the redirect, exchange
/// the code, persist credentials, and return enough metadata to update the
/// server record.
///
/// The bound timeout (90s) is intentionally short — if the user hasn't
/// finished authorizing in 90s, something is wrong (popup blocked, tab
/// closed, server unreachable) and we'd rather fail fast than leave a
/// dangling listener.
pub async fn authorize(
    app: AppHandle,
    server_id: &str,
    server_url: &str,
    scopes: &[&str],
) -> Result<OAuthResult, String> {
    // Bind first so we know the redirect URI before kicking off the auth
    // request. Port 0 = OS-assigned ephemeral port; this avoids "port in
    // use" failures and works without any user-visible firewall prompt.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind localhost callback: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read callback port: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let mut state = OAuthState::new(server_url.to_string(), None)
        .await
        .map_err(|e| format!("OAuth discovery failed: {e}"))?;

    state
        .start_authorization(scopes, &redirect_uri, Some("Ripple"))
        .await
        .map_err(|e| format!("OAuth start failed: {e}"))?;

    let auth_url = state
        .get_authorization_url()
        .await
        .map_err(|e| format!("OAuth URL build failed: {e}"))?;

    // Hand the URL to the system browser. `OpenerExt::opener().open_url`
    // is a no-arg fire-and-forget; we don't get told whether it succeeded,
    // but the listener-timeout below covers the case where it didn't.
    let _ = app.opener().open_url(&auth_url, None::<&str>);

    // Block on the listener. We can't `await` `accept()` on a sync listener,
    // so we run the whole wait on a blocking task and re-await it. A 90s
    // timeout gives the user time to log in to a fresh OAuth provider but
    // bounds the worst-case "did we leak a listener?" outcome.
    let (code, csrf) = tokio::task::spawn_blocking(move || {
        listener
            .set_nonblocking(false)
            .map_err(|e| format!("Listener set_blocking: {e}"))?;
        wait_for_callback(&listener, Duration::from_secs(90))
    })
    .await
    .map_err(|e| format!("Listener task failed: {e}"))??;

    state
        .handle_callback(&code, &csrf)
        .await
        .map_err(|e| format!("OAuth callback exchange failed: {e}"))?;

    let (client_id, token_resp) = state
        .get_credentials()
        .await
        .map_err(|e| format!("Read credentials failed: {e}"))?;
    let token = token_resp.ok_or_else(|| "No token returned by server".to_string())?;

    let token_value = serde_json::to_value(&token)
        .map_err(|e| format!("Serialize token: {e}"))?;
    let scopes_granted = token_value
        .get("scope")
        .and_then(|v| v.as_str())
        .map(|s| s.split_whitespace().map(String::from).collect())
        .unwrap_or_else(Vec::new);

    save_credentials(
        server_id,
        &StoredCredentials {
            client_id,
            token: token_value,
        },
    )?;

    Ok(OAuthResult {
        authorization_server: Some(server_url.to_string()),
        scopes: scopes_granted,
    })
}

/// Block on the listener until we see a request that contains both `code`
/// and `state` query params, OR we time out. Once we have the values we
/// reply with a tiny human-readable HTML page so the browser tab doesn't
/// just sit on a "connection reset" error.
fn wait_for_callback(
    listener: &TcpListener,
    timeout: Duration,
) -> Result<(String, String), String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Listener nonblock: {e}"))?;
    let deadline = std::time::Instant::now() + timeout;

    loop {
        if std::time::Instant::now() >= deadline {
            return Err("Timed out waiting for OAuth callback".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).map_err(|e| format!("Read: {e}"))?;
                let req = String::from_utf8_lossy(&buf[..n]);
                let path_q = parse_request_path(&req);
                let body =
                    "<!doctype html><meta charset=utf-8><title>Ripple — Signed in</title>\
                     <style>body{font:16px system-ui;padding:48px;background:#111;color:#eee}\
                     h2{color:#4d8df6}</style>\
                     <h2>Signed in</h2><p>You can close this tab and return to Ripple.</p>";
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();

                if let Some((code, state)) = path_q.and_then(extract_code_state) {
                    return Ok((code, state));
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Accept: {e}")),
        }
    }
}

fn parse_request_path(req: &str) -> Option<String> {
    let first_line = req.split("\r\n").next()?;
    let mut parts = first_line.split_whitespace();
    let _method = parts.next()?;
    let path = parts.next()?;
    Some(path.to_string())
}

fn extract_code_state(path: String) -> Option<(String, String)> {
    let q_idx = path.find('?')?;
    let q = &path[q_idx + 1..];
    let mut code = None;
    let mut state = None;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        let v = it.next().unwrap_or("");
        let v_decoded = percent_decode(v);
        match k {
            "code" => code = Some(v_decoded),
            "state" => state = Some(v_decoded),
            _ => {}
        }
    }
    Some((code?, state?))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) =
                (hex_val(bytes[i + 1]), hex_val(bytes[i + 2]))
            {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
