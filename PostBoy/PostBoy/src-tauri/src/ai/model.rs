//! Model registry + downloader.
//!
//! - Loads the static registry shipped at `resources/models.json`.
//! - Downloads GGUF files to `<app_data>/ai/models/` with progress events.
//! - Tries `downloads[]` URLs in order: Hugging Face primary, Kaggle fallback.
//! - Supports pause / resume / cancel via HTTP Range requests. Pausing keeps
//!   the partial `.gguf.part` file on disk; cancel deletes it.
//! - Verifies sha256 when provided.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use super::{AiState, DownloadControl, PausedDownload};

const MODELS_JSON: &str = include_str!("../../resources/models.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRegistry {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub models: Vec<ModelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub filename: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(rename = "contextSize")]
    pub context_size: u32,
    #[serde(rename = "recommendedThreads", default)]
    pub recommended_threads: Option<u32>,
    #[serde(rename = "supportsTools", default)]
    pub supports_tools: bool,
    #[serde(rename = "toolCallStyle", default = "default_tool_call_style")]
    pub tool_call_style: String,
    pub downloads: Vec<DownloadSource>,
}

fn default_tool_call_style() -> String {
    "qwen".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadSource {
    pub source: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstalledModel {
    pub id: String,
    pub path: PathBuf,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub source: String,
}

pub fn load_registry() -> Result<ModelRegistry, String> {
    serde_json::from_str(MODELS_JSON).map_err(|e| format!("Failed to parse models.json: {e}"))
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai")
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {e}"))?;
    Ok(dir)
}

pub fn model_path(app: &AppHandle, entry: &ModelEntry) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(&entry.filename))
}

pub fn list_installed(app: &AppHandle) -> Result<Vec<InstalledModel>, String> {
    let registry = load_registry()?;
    let dir = models_dir(app)?;
    let mut installed = Vec::new();
    for entry in &registry.models {
        let p = dir.join(&entry.filename);
        if let Ok(meta) = std::fs::metadata(&p) {
            installed.push(InstalledModel {
                id: entry.id.clone(),
                path: p,
                size_bytes: meta.len(),
            });
        }
    }
    Ok(installed)
}

pub fn delete_installed(app: &AppHandle, model_id: &str) -> Result<(), String> {
    let registry = load_registry()?;
    let entry = registry
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Unknown model id: {model_id}"))?;
    let p = model_path(app, entry)?;
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| format!("Failed to delete model: {e}"))?;
    }
    Ok(())
}

/// Outcome of running the download loop for one source URL.
enum LoopOutcome {
    /// All bytes received; ready for sha256 verification + rename.
    Complete,
    /// User paused — `.gguf.part` left on disk, snapshot already stored in state.
    Paused,
    /// User cancelled — `.gguf.part` already removed by the caller path.
    Cancelled,
    /// Source failed (HTTP error, network, etc.); caller should try next source.
    SourceFailed(String),
}

/// Start a download from scratch. Tries each source URL in order until one
/// succeeds, is paused, or is cancelled.
pub async fn download_model(
    app: AppHandle,
    state: Arc<AiState>,
    model_id: String,
) -> Result<PathBuf, String> {
    let registry = load_registry()?;
    let entry = registry
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Unknown model id: {model_id}"))?
        .clone();

    let target = model_path(&app, &entry)?;
    if target.exists() {
        return Ok(target);
    }

    // Reset control state for this model.
    state
        .download_controls
        .lock()
        .await
        .insert(entry.id.clone(), DownloadControl::Run);
    state.paused_downloads.lock().await.remove(&entry.id);

    run_sources_from(&app, &state, &entry, 0, 0).await
}

/// Resume a previously paused download. Picks up from the recorded byte
/// offset on the same source URL; falls back to later sources if that one
/// fails.
pub async fn resume_download(
    app: AppHandle,
    state: Arc<AiState>,
    model_id: String,
) -> Result<PathBuf, String> {
    let snapshot = {
        let mut paused = state.paused_downloads.lock().await;
        paused
            .remove(&model_id)
            .ok_or_else(|| format!("No paused download for model: {model_id}"))?
    };

    let registry = load_registry()?;
    let entry = registry
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Unknown model id: {model_id}"))?
        .clone();

    state
        .download_controls
        .lock()
        .await
        .insert(entry.id.clone(), DownloadControl::Run);

    run_sources_from(
        &app,
        &state,
        &entry,
        snapshot.source_index,
        snapshot.downloaded,
    )
    .await
}

async fn run_sources_from(
    app: &AppHandle,
    state: &Arc<AiState>,
    entry: &ModelEntry,
    start_source_index: usize,
    start_offset: u64,
) -> Result<PathBuf, String> {
    let target = model_path(app, entry)?;
    let tmp = target.with_extension("gguf.part");
    let mut last_err: Option<String> = None;
    let mut offset = start_offset;

    for (idx, source) in entry.downloads.iter().enumerate().skip(start_source_index) {
        if source.url.is_empty() {
            continue;
        }

        let _ = app.emit(
            "ai-download-source",
            serde_json::json!({ "modelId": entry.id, "source": source.source }),
        );

        match try_download(app, state, entry, source, idx, &tmp, offset).await {
            LoopOutcome::Complete => {
                if let Some(expected) = &entry.sha256 {
                    if !expected.is_empty() {
                        let actual = sha256_file(&tmp)?;
                        if !actual.eq_ignore_ascii_case(expected) {
                            let _ = std::fs::remove_file(&tmp);
                            last_err = Some(format!(
                                "sha256 mismatch from {}: expected {expected}, got {actual}",
                                source.source
                            ));
                            offset = 0;
                            continue;
                        }
                    }
                }
                std::fs::rename(&tmp, &target)
                    .map_err(|e| format!("Failed to finalize download: {e}"))?;
                state.download_controls.lock().await.remove(&entry.id);
                return Ok(target);
            }
            LoopOutcome::Paused => {
                // Snapshot already stored by the inner loop. Leave .part on disk.
                return Err("Paused".to_string());
            }
            LoopOutcome::Cancelled => {
                let _ = std::fs::remove_file(&tmp);
                state.download_controls.lock().await.remove(&entry.id);
                return Err("Cancelled".to_string());
            }
            LoopOutcome::SourceFailed(e) => {
                // Source may have written a partial file with stale bytes
                // (e.g. server ignored Range header). Reset for the next source.
                let _ = std::fs::remove_file(&tmp);
                last_err = Some(format!("{}: {e}", source.source));
                offset = 0;
                continue;
            }
        }
    }

    state.download_controls.lock().await.remove(&entry.id);
    Err(last_err.unwrap_or_else(|| "No download sources available".to_string()))
}

/// Run one source's HTTP request. Honors a starting byte offset (Range
/// request) and polls per-model `DownloadControl` between chunks.
async fn try_download(
    app: &AppHandle,
    state: &Arc<AiState>,
    entry: &ModelEntry,
    source: &DownloadSource,
    source_index: usize,
    tmp_path: &Path,
    start_offset: u64,
) -> LoopOutcome {
    let client = match reqwest::Client::builder()
        .user_agent("Ripple/0.0 (AI model download)")
        .build()
    {
        Ok(c) => c,
        Err(e) => return LoopOutcome::SourceFailed(e.to_string()),
    };

    let mut req = client.get(&source.url);
    if start_offset > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={start_offset}-"));
    }

    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => return LoopOutcome::SourceFailed(format!("HTTP error: {e}")),
    };

    if !response.status().is_success() {
        return LoopOutcome::SourceFailed(format!("HTTP {}", response.status()));
    }

    // If we requested a range but the server returned 200 OK instead of 206,
    // the server doesn't support resume — start over from byte 0.
    let server_supports_range = response.status().as_u16() == 206;
    let (mut downloaded, append) = if start_offset > 0 && server_supports_range {
        (start_offset, true)
    } else {
        (0u64, false)
    };

    // Total size: prefer Content-Length from the range response (= remaining
    // bytes) plus our offset, falling back to the registry size.
    let remaining = response.content_length();
    let total = match (remaining, append) {
        (Some(r), true) => start_offset + r,
        (Some(r), false) => r,
        (None, _) => entry.size_bytes,
    };

    let mut file = match if append {
        tokio::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(tmp_path)
            .await
    } else {
        tokio::fs::File::create(tmp_path).await
    } {
        Ok(f) => f,
        Err(e) => return LoopOutcome::SourceFailed(format!("Failed to open temp file: {e}")),
    };

    let mut response = response;
    let mut last_emit = std::time::Instant::now();

    loop {
        // Check control signal before each chunk.
        let signal = {
            let map = state.download_controls.lock().await;
            map.get(&entry.id).copied().unwrap_or(DownloadControl::Run)
        };
        match signal {
            DownloadControl::Cancel => {
                let _ = file.flush().await;
                return LoopOutcome::Cancelled;
            }
            DownloadControl::Pause => {
                let _ = file.flush().await;
                state.paused_downloads.lock().await.insert(
                    entry.id.clone(),
                    PausedDownload {
                        source_index,
                        downloaded,
                    },
                );
                let _ = app.emit(
                    "ai-download-paused",
                    serde_json::json!({
                        "modelId": entry.id,
                        "downloaded": downloaded,
                        "total": total,
                    }),
                );
                return LoopOutcome::Paused;
            }
            DownloadControl::Run => {}
        }

        let chunk = match response.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return LoopOutcome::SourceFailed(e.to_string()),
        };

        if let Err(e) = file.write_all(&chunk).await {
            return LoopOutcome::SourceFailed(format!("Write error: {e}"));
        }
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 250 {
            let _ = app.emit(
                "ai-download-progress",
                DownloadProgress {
                    model_id: entry.id.clone(),
                    downloaded,
                    total,
                    source: source.source.clone(),
                },
            );
            last_emit = std::time::Instant::now();
        }
    }

    if let Err(e) = file.flush().await {
        return LoopOutcome::SourceFailed(e.to_string());
    }

    let _ = app.emit(
        "ai-download-progress",
        DownloadProgress {
            model_id: entry.id.clone(),
            downloaded,
            total,
            source: source.source.clone(),
        },
    );

    LoopOutcome::Complete
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}
