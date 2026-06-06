//! AI Chatbot module — gated entirely behind the `chatbot` Cargo feature.
//!
//! When the feature is disabled, this module compiles to nothing and the only
//! related Tauri command exposed to the frontend is the always-on
//! [`crate::ai_supported`] in `lib.rs`, which returns `false`.

#![cfg(feature = "chatbot")]

pub mod commands;
pub mod engine;
pub mod mcp;
pub mod model;
pub mod tool_parser;
pub mod tools;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Per-download control signal. Owned by the active download loop, set by
/// the pause/cancel/resume commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadControl {
    Run,
    Pause,
    Cancel,
}

/// Snapshot of a paused download so a future resume call knows where to pick up.
/// The `.gguf.part` file on disk holds the bytes already received.
#[derive(Debug, Clone)]
pub struct PausedDownload {
    pub source_index: usize,
    pub downloaded: u64,
}

/// State held in `tauri::State` for the lifetime of the app.
/// The engine is lazy-loaded — `None` until the user picks an active model
/// and invokes `ai_load_engine`.
pub struct AiState {
    pub engine: Mutex<Option<engine::Engine>>,
    pub action_log: Mutex<Vec<ActionLogEntry>>,
    /// Cancel flag for in-flight chat completions.
    pub chat_cancel: Mutex<bool>,
    /// Per-model download control. Keyed by `model_id`. The download loop
    /// polls this on every chunk; absent entry means "no signal" (== Run).
    pub download_controls: Mutex<HashMap<String, DownloadControl>>,
    /// Paused downloads waiting to be resumed.
    pub paused_downloads: Mutex<HashMap<String, PausedDownload>>,
    /// MCP server registry + live connection state. Held as `Arc` so
    /// background tasks (e.g. periodic refreshes) can share it without
    /// holding `tauri::State`.
    pub mcp: Arc<mcp::McpManager>,
}

impl AiState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            engine: Mutex::new(None),
            action_log: Mutex::new(Vec::new()),
            chat_cancel: Mutex::new(false),
            download_controls: Mutex::new(HashMap::new()),
            paused_downloads: Mutex::new(HashMap::new()),
            mcp: Arc::new(mcp::McpManager::new()),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionLogEntry {
    pub timestamp: String,
    pub tool: String,
    pub arguments: serde_json::Value,
    pub result: serde_json::Value,
    pub error: Option<String>,
}
