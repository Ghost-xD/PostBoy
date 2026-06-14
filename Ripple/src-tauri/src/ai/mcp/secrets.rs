//! OS-keychain wrapper for MCP secrets.
//!
//! Every secret (PAT, OAuth refresh/access token blob, header value the user
//! marked as "secret") is stored under
//! `service = "ripple-mcp:<server_id>"` / `account = "<key>"`. Two reasons we
//! key by `server_id` instead of by url/name:
//!   - server URLs and names are mutable; deleting a server should also
//!     delete its secrets, and a stable id makes that O(known keys).
//!   - the same OAuth provider (e.g. GitHub) may be configured twice with
//!     different scopes; name-based collisions would silently overwrite.
//!
//! All errors are flattened to `String` because we shuttle them straight to
//! the frontend Tauri layer.

use keyring::Entry;

const SERVICE_PREFIX: &str = "ripple-mcp";

/// Conventional keys we store. Other strings are also valid (e.g. arbitrary
/// header values), but using these constants for the standard ones keeps the
/// rest of the codebase free of stringly-typed magic.
pub mod keys {
    /// JSON blob containing `{client_id, OAuthTokenResponse}` produced by
    /// `OAuthState::get_credentials()`.
    pub const OAUTH_CREDENTIALS: &str = "oauth-credentials";
    /// Manual bearer token / PAT pasted by the user for header-auth remote
    /// servers. Stored under this key when the user supplies it via the UI.
    pub const MANUAL_TOKEN: &str = "manual-token";
}

fn entry(server_id: &str, key: &str) -> Result<Entry, String> {
    let service = format!("{SERVICE_PREFIX}:{server_id}");
    Entry::new(&service, key).map_err(|e| format!("Keyring open: {e}"))
}

pub fn set(server_id: &str, key: &str, value: &str) -> Result<(), String> {
    entry(server_id, key)?
        .set_password(value)
        .map_err(|e| format!("Keyring set: {e}"))
}

pub fn get(server_id: &str, key: &str) -> Result<Option<String>, String> {
    match entry(server_id, key)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring get: {e}")),
    }
}

pub fn delete(server_id: &str, key: &str) -> Result<(), String> {
    match entry(server_id, key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Keyring delete: {e}")),
    }
}

/// Best-effort cleanup when a server is deleted. Iterates the small set of
/// well-known keys; arbitrary user-set keys must be cleared by their callers.
pub fn purge_known(server_id: &str) {
    let _ = delete(server_id, keys::OAUTH_CREDENTIALS);
    let _ = delete(server_id, keys::MANUAL_TOKEN);
}
