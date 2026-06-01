//! Tauri command surface for the chatbot.
//!
//! Every command here is `#[cfg(feature = "chatbot")]`. The always-on
//! `ai_supported()` lives in `lib.rs` so the frontend can detect builds
//! that excluded the feature.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{engine::Engine, model, tool_parser, tools, ActionLogEntry, AiState, DownloadControl};

const DEFAULT_SYSTEM_PROMPT: &str = "You are PostBoy's local AI assistant. You help the user inspect and run their saved HTTP API requests. Be concise, accurate, and use tools only when the user actually wants data or an action — for greetings or small talk, just reply directly. When summarizing a response, lead with the status code and the most relevant fields.";

// Effectively "use the rest of the context window for the reply". The engine
// clamps this to (ctx_size - prompt_tokens) so we never error on length, and
// generation stops naturally on EOS for short replies.
const DEFAULT_MAX_TOKENS: u32 = 32_000;
// Allow longer multi-step tool sequences (e.g. list collection → list requests
// → run request → summarize) without giving up early.
const MAX_TOOL_TURNS: usize = 12;

#[derive(Debug, Clone, Serialize)]
pub struct AiStatus {
    pub supported: bool,
    pub engine_loaded: bool,
    pub active_model_id: Option<String>,
    pub installed_model_ids: Vec<String>,
}

#[tauri::command]
pub async fn ai_get_status(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
) -> Result<AiStatus, String> {
    let installed: Vec<String> = model::list_installed(&app)?
        .into_iter()
        .map(|m| m.id)
        .collect();
    let engine = state.engine.lock().await;
    Ok(AiStatus {
        supported: true,
        engine_loaded: engine.is_some(),
        active_model_id: engine.as_ref().map(|e| e.model_id.clone()),
        installed_model_ids: installed,
    })
}

#[tauri::command]
pub fn ai_list_models() -> Result<serde_json::Value, String> {
    let reg = model::load_registry()?;
    Ok(serde_json::json!({
        "schemaVersion": reg.schema_version,
        "models": reg.models,
    }))
}

#[tauri::command]
pub fn ai_list_installed(app: AppHandle) -> Result<Vec<model::InstalledModel>, String> {
    model::list_installed(&app)
}

#[tauri::command]
pub async fn ai_download_model(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    model_id: String,
) -> Result<String, String> {
    let path = model::download_model(app.clone(), state.inner().clone(), model_id).await?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn ai_cancel_download(
    state: State<'_, Arc<AiState>>,
    model_id: String,
) -> Result<(), String> {
    state
        .download_controls
        .lock()
        .await
        .insert(model_id.clone(), DownloadControl::Cancel);
    // Drop any paused snapshot — cancel is final.
    state.paused_downloads.lock().await.remove(&model_id);
    Ok(())
}

#[tauri::command]
pub async fn ai_pause_download(
    state: State<'_, Arc<AiState>>,
    model_id: String,
) -> Result<(), String> {
    state
        .download_controls
        .lock()
        .await
        .insert(model_id, DownloadControl::Pause);
    Ok(())
}

#[tauri::command]
pub async fn ai_resume_download(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    model_id: String,
) -> Result<String, String> {
    let path = model::resume_download(app.clone(), state.inner().clone(), model_id).await?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn ai_delete_model(app: AppHandle, model_id: String) -> Result<(), String> {
    model::delete_installed(&app, &model_id)
}

#[tauri::command]
pub async fn ai_load_engine(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    model_id: String,
    threads: Option<u32>,
    ctx_size: Option<u32>,
) -> Result<(), String> {
    let registry = model::load_registry()?;
    let entry = registry
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Unknown model id: {model_id}"))?
        .clone();
    let path = model::model_path(&app, &entry)?;
    if !path.exists() {
        return Err("Model file not downloaded. Run ai_download_model first.".to_string());
    }

    let threads = threads.unwrap_or_else(|| {
        entry
            .recommended_threads
            .unwrap_or_else(|| num_cpus::get().saturating_sub(1).max(1) as u32)
    });
    let ctx_size = ctx_size.unwrap_or(entry.context_size);

    let model_id_for_task = entry.id.clone();
    let tool_style = entry.tool_call_style.clone();
    let engine = tokio::task::spawn_blocking(move || {
        Engine::load(path, threads, ctx_size, model_id_for_task, tool_style)
    })
    .await
    .map_err(|e| format!("Engine load task failed: {e}"))??;

    let mut slot = state.engine.lock().await;
    *slot = Some(engine);
    drop(slot);

    let _ = app.emit("ai-engine-loaded", entry.id.clone());
    Ok(())
}

#[tauri::command]
pub async fn ai_unload_engine(state: State<'_, Arc<AiState>>) -> Result<(), String> {
    let mut slot = state.engine.lock().await;
    *slot = None;
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_cancel(state: State<'_, Arc<AiState>>) -> Result<(), String> {
    let mut c = state.chat_cancel.lock().await;
    *c = true;
    Ok(())
}

#[tauri::command]
pub async fn ai_get_action_log(
    state: State<'_, Arc<AiState>>,
) -> Result<Vec<ActionLogEntry>, String> {
    Ok(state.action_log.lock().await.clone())
}

#[tauri::command]
pub async fn ai_clear_action_log(state: State<'_, Arc<AiState>>) -> Result<(), String> {
    state.action_log.lock().await.clear();
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_send(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    messages: Vec<tool_parser::ChatMessage>,
    system_prompt: Option<String>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    {
        let mut c = state.chat_cancel.lock().await;
        *c = false;
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    // Spawn a watcher that mirrors state.chat_cancel into our AtomicBool so
    // long-running blocking work can poll it cheaply.
    let watcher_state = state.inner().clone();
    let watcher_flag = cancel_flag.clone();
    let watcher = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let c = watcher_state.chat_cancel.lock().await;
            if *c {
                watcher_flag.store(true, Ordering::Relaxed);
                break;
            }
            if watcher_flag.load(Ordering::Relaxed) {
                break;
            }
        }
    });

    let result = chat_loop(
        app.clone(),
        state,
        messages,
        system_prompt.unwrap_or_else(|| DEFAULT_SYSTEM_PROMPT.to_string()),
        max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        cancel_flag.clone(),
    )
    .await;

    cancel_flag.store(true, Ordering::Relaxed);
    let _ = watcher.await;

    match &result {
        Ok(s) => {
            let _ = app.emit("ai-chat-done", s.clone());
        }
        Err(e) => {
            let _ = app.emit("ai-chat-error", e.clone());
        }
    }
    result
}

async fn chat_loop(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    mut messages: Vec<tool_parser::ChatMessage>,
    system_prompt: String,
    max_tokens: u32,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String, String> {
    let tools_json = tools::tools_schema_json();

    // ------------------------------------------------------------------
    // Deterministic intercept: explicit "VERB NAME" run-request commands
    // ------------------------------------------------------------------
    // The 1.5B model occasionally pattern-matches past tool-result output
    // and fabricates a fresh "200 OK" response without actually calling
    // run_request. That's catastrophic: the user thinks the API was hit,
    // but no network call ever happened (no action log entry, no real
    // status, fake body). When the user is unambiguously asking to run a
    // saved request, bypass the model entirely and dispatch the tool
    // ourselves. Guaranteed real network call, guaranteed action log.
    if let Some(last_user) = latest_user_request(&messages) {
        if let Some(req_name) = parse_run_request_intent(last_user) {
            let args = serde_json::json!({ "name": req_name });
            let result = tools::dispatch(app.clone(), "run_request", args.clone()).await;

            let entry = ActionLogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                tool: "run_request".to_string(),
                arguments: args.clone(),
                result: result.clone(),
                error: result
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            };
            state.action_log.lock().await.push(entry.clone());
            let _ = app.emit("ai-tool-call", entry);

            // If the name didn't resolve to a saved request, fall through
            // to the LLM so it can ask which one the user meant.
            if let Some(err) = result.get("error").and_then(|v| v.as_str()) {
                let msg = format!("The tool reported: \"{err}\"");
                let _ = app.emit("ai-chat-delta", msg.clone());
                return Ok(msg);
            }

            if let Some(formatted) = format_tool_result_for_user("run_request", &result) {
                let _ = app.emit("ai-chat-delta", formatted.clone());
                return Ok(formatted);
            }
        }
    }

    for _turn in 0..MAX_TOOL_TURNS {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Cancelled".to_string());
        }

        let engine = {
            let guard = state.engine.lock().await;
            guard
                .as_ref()
                .ok_or_else(|| "No model loaded. Call ai_load_engine first.".to_string())?
                .clone()
        };

        let prompt = tool_parser::build_prompt(&messages, &system_prompt, &tools_json);

        let app_for_thread = app.clone();
        let cancel_for_thread = cancel_flag.clone();
        let prompt_for_thread = prompt.clone();

        // Tracks how many bytes of the model's output we've already streamed to
        // the UI. The streaming closure holds back any tail bytes that could be
        // the start of a `<tool_call>` open tag (or a bare-JSON tool call) so
        // that markup never reaches the chat panel; after the turn finishes we
        // either flush leftovers (no tool call) or drop them (tool call found).
        let emitted = Arc::new(AtomicUsize::new(0));
        let emitted_for_thread = emitted.clone();

        let full = tokio::task::spawn_blocking(move || {
            const TAG: &str = "<tool_call>";
            let mut buffer = String::new();
            engine.complete(
                &prompt_for_thread,
                max_tokens,
                cancel_for_thread.clone(),
                |delta| {
                    buffer.push_str(delta);

                    // How many leading bytes of `buffer` are safe to show the
                    // user right now?
                    let visible_end = {
                        let trimmed = buffer.trim_start();
                        if trimmed.starts_with('{') {
                            // Looks like a bare-JSON tool call (small models
                            // sometimes emit one without `<tool_call>` tags).
                            // Hold back from the leading `{`; we'll flush at
                            // turn end if it turns out to be plain text.
                            buffer.len() - trimmed.len()
                        } else if let Some(idx) = buffer.find(TAG) {
                            idx
                        } else {
                            // Hold back any trailing bytes that could be a
                            // partial `<tool_call>` opening tag.
                            let max_n = buffer.len().min(TAG.len() - 1);
                            let mut hold = 0usize;
                            for n in (1..=max_n).rev() {
                                let start = buffer.len() - n;
                                if buffer.is_char_boundary(start)
                                    && buffer[start..] == TAG[..n]
                                {
                                    hold = n;
                                    break;
                                }
                            }
                            buffer.len() - hold
                        }
                    };

                    let prev = emitted_for_thread.load(Ordering::Relaxed);
                    if visible_end > prev {
                        let new_visible = buffer[prev..visible_end].to_string();
                        let _ = app_for_thread.emit("ai-chat-delta", new_visible);
                        emitted_for_thread.store(visible_end, Ordering::Relaxed);
                    }

                    if tool_parser::has_complete_tool_call(&buffer) {
                        return false;
                    }
                    !cancel_for_thread.load(Ordering::Relaxed)
                },
            )
        })
        .await
        .map_err(|e| format!("Engine task failed: {e}"))??;

        let call = tool_parser::try_extract_tool_call(&full);

        // If the turn produced no tool call, flush any text we held back as a
        // possible-tool-call prefix so the user sees the complete reply.
        if call.is_none() {
            let prev = emitted.load(Ordering::Relaxed);
            if prev < full.len() {
                let _ = app.emit("ai-chat-delta", full[prev..].to_string());
            }
        }

        match call {
            None => return Ok(full),
            Some(call) => {
                let arguments = call.arguments.clone();
                let tool_name = call.name.clone();
                let result = tools::dispatch(app.clone(), &tool_name, arguments.clone()).await;

                let entry = ActionLogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    tool: tool_name.clone(),
                    arguments,
                    result: result.clone(),
                    error: result.get("error").and_then(|v| v.as_str()).map(String::from),
                };
                state.action_log.lock().await.push(entry.clone());
                let _ = app.emit("ai-tool-call", entry);

                if let Some(user_request) = latest_user_request(&messages) {
                    if let Some(answer) = tool_parser::try_direct_single_field_answer(
                        user_request,
                        &tool_name,
                        &result,
                    ) {
                        let _ = app.emit("ai-chat-delta", answer.clone());
                        return Ok(answer);
                    }
                }

                // Short-circuit: when the tool *is* the answer the user wanted
                // (the live HTTP response, or the saved request definition),
                // we skip the second LLM turn and emit a structured markdown
                // payload directly. This avoids the slow, paraphrased prose
                // summary the model otherwise produces — the user gets the
                // raw result with proper formatting (status/headers/body)
                // exactly like the main response panel.
                if let Some(formatted) = format_tool_result_for_user(&tool_name, &result) {
                    let _ = app.emit("ai-chat-delta", formatted.clone());
                    return Ok(formatted);
                }

                // Append the assistant turn (preamble + the tool_call) and a
                // synthetic user turn carrying the tool response, then loop.
                let assistant_turn = format!(
                    "{}<tool_call>\n{{\"name\": \"{}\", \"arguments\": {}}}\n</tool_call>",
                    call.preamble,
                    tool_name,
                    serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".into())
                );
                messages.push(tool_parser::ChatMessage {
                    role: "assistant".to_string(),
                    content: assistant_turn,
                });
                messages.push(tool_parser::ChatMessage {
                    role: "user".to_string(),
                    content: tool_parser::format_tool_response(&tool_name, &result),
                });
            }
        }
    }

    Err(format!(
        "Tool-call loop exceeded {MAX_TOOL_TURNS} turns without a final answer"
    ))
}

fn latest_user_request(messages: &[tool_parser::ChatMessage]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|msg| {
            msg.role == "user" && !msg.content.trim_start().starts_with("<tool_response>")
        })
        .map(|msg| msg.content.as_str())
}

/// Parse a user message as an explicit run-a-saved-request command.
///
/// Recognized shape: `[politeness?] VERB <name>[ api|API|please|now|.?!]?`
/// where VERB ∈ {hit, run, call, execute, send, fire, invoke, trigger,
/// fetch, ping}. Returns the extracted request name (original casing).
/// Bias: false negatives over false positives — when in doubt we return
/// `None` and let the LLM handle it.
fn parse_run_request_intent(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 200 {
        return None;
    }

    // Strip a small set of polite/lead-in prefixes.
    let leadins: &[&str] = &[
        "can you ",
        "could you ",
        "please ",
        "pls ",
        "would you ",
        "i want to ",
        "i'd like to ",
        "lets ",
        "let's ",
    ];
    let lower = trimmed.to_lowercase();
    let mut rest = trimmed;
    let mut rest_lower = lower.as_str();
    for lead in leadins {
        if rest_lower.starts_with(lead) {
            rest = &rest[lead.len()..];
            rest_lower = &rest_lower[lead.len()..];
            break;
        }
    }

    let verbs: &[&str] = &[
        "hit ",
        "run ",
        "call ",
        "execute ",
        "send ",
        "fire ",
        "invoke ",
        "trigger ",
        "fetch ",
        "ping ",
    ];
    let mut name: Option<&str> = None;
    for verb in verbs {
        if rest_lower.starts_with(verb) {
            name = Some(&rest[verb.len()..]);
            break;
        }
    }
    let name = name?.trim();
    if name.is_empty() || name.len() < 2 {
        return None;
    }

    // Strip trailing punctuation + politeness + "api" suffix.
    let mut cleaned = name.trim_end_matches(|c: char| matches!(c, '.' | '!' | '?' | ','));
    let trailers: &[&str] = &[
        " please",
        " pls",
        " now",
        " for me",
        " api",
        " API",
        " endpoint",
        " request",
    ];
    loop {
        let mut changed = false;
        for t in trailers {
            if cleaned.to_lowercase().ends_with(&t.to_lowercase()) {
                cleaned = &cleaned[..cleaned.len() - t.len()];
                changed = true;
            }
        }
        cleaned = cleaned.trim_end_matches(|c: char| matches!(c, '.' | '!' | '?' | ','));
        if !changed {
            break;
        }
    }
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned.len() < 2 {
        return None;
    }
    Some(cleaned.to_string())
}

/// Render a tool result directly as the user-facing answer (markdown), when
/// the tool's payload IS the thing the user wanted — e.g. `run_request`
/// returns an HTTP response and `inspect_request` returns a saved request
/// definition. Returning `Some(...)` short-circuits the chat loop so the LLM
/// never gets a second turn to paraphrase the data into prose.
///
/// Returns `None` when the tool result is for the model's own consumption
/// (`list_collections`, `list_requests`, errors) and should flow back through
/// the LLM as usual.
fn format_tool_result_for_user(tool_name: &str, result: &serde_json::Value) -> Option<String> {
    if result.get("error").is_some() {
        return None;
    }

    match tool_name {
        "run_request" => Some(format_http_response_md(result)),
        "inspect_request" | "get_request" => Some(format_request_definition_md(result)),
        _ => None,
    }
}

fn format_http_response_md(v: &serde_json::Value) -> String {
    let status = v.get("status").and_then(|x| x.as_i64()).unwrap_or(0);
    let status_text = v.get("statusText").and_then(|x| x.as_str()).unwrap_or("");
    let elapsed = v
        .get("responseTime")
        .and_then(|x| x.as_i64())
        .unwrap_or(0);

    let status_emoji = if (200..300).contains(&status) {
        "✓"
    } else if (300..400).contains(&status) {
        "↪"
    } else if status >= 400 {
        "✗"
    } else {
        "·"
    };

    let mut out = String::new();
    out.push_str(&format!(
        "**{status_emoji} {status} {status_text}** · {elapsed}ms\n\n"
    ));

    // Headers — compact, one-per-line code block. The bot's main response
    // panel groups these the same way.
    if let Some(headers) = v.get("headers").and_then(|h| h.as_object()) {
        if !headers.is_empty() {
            out.push_str("**Headers**\n```http\n");
            let mut keys: Vec<&String> = headers.keys().collect();
            keys.sort();
            for k in keys {
                let val = headers
                    .get(k)
                    .map(|x| match x {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                out.push_str(&format!("{k}: {val}\n"));
            }
            out.push_str("```\n\n");
        }
    }

    // Body — pretty-print JSON when we can; otherwise dump as-is.
    if let Some(body) = v.get("body") {
        let (lang, pretty) = match body {
            serde_json::Value::String(s) => {
                let trimmed = s.trim_start();
                if trimmed.starts_with('{') || trimmed.starts_with('[') {
                    match serde_json::from_str::<serde_json::Value>(s) {
                        Ok(parsed) => (
                            "json",
                            serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| s.clone()),
                        ),
                        Err(_) => ("", s.clone()),
                    }
                } else {
                    ("", s.clone())
                }
            }
            other => (
                "json",
                serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
            ),
        };
        if !pretty.is_empty() {
            out.push_str("**Body**\n```");
            out.push_str(lang);
            out.push('\n');
            out.push_str(&pretty);
            if !pretty.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```");
        }
    }

    out
}

fn format_request_definition_md(v: &serde_json::Value) -> String {
    let def = v.get("request_definition").cloned().unwrap_or(v.clone());
    let name = def.get("name").and_then(|x| x.as_str()).unwrap_or("(unnamed)");
    let method = def.get("method").and_then(|x| x.as_str()).unwrap_or("?");
    let url = def.get("url").and_then(|x| x.as_str()).unwrap_or("");

    let mut out = String::new();
    out.push_str(&format!("**{method} {name}**\n\n"));
    out.push_str(&format!("```http\n{method} {url}\n"));

    if let Some(headers_str) = def.get("headers").and_then(|x| x.as_str()) {
        if let Ok(arr) = serde_json::from_str::<serde_json::Value>(headers_str) {
            if let Some(arr) = arr.as_array() {
                for h in arr {
                    let k = h.get("key").and_then(|x| x.as_str()).unwrap_or("");
                    let val = h.get("value").and_then(|x| x.as_str()).unwrap_or("");
                    if !k.is_empty() {
                        out.push_str(&format!("{k}: {val}\n"));
                    }
                }
            }
        }
    }
    out.push_str("```\n");

    let body_type = def
        .get("body_type")
        .and_then(|x| x.as_str())
        .unwrap_or("none");
    if body_type != "none" {
        if let Some(body) = def.get("body_content").and_then(|x| x.as_str()) {
            if !body.is_empty() {
                let trimmed = body.trim_start();
                let lang = if trimmed.starts_with('{') || trimmed.starts_with('[') {
                    "json"
                } else {
                    ""
                };
                let pretty = if lang == "json" {
                    serde_json::from_str::<serde_json::Value>(body)
                        .ok()
                        .and_then(|p| serde_json::to_string_pretty(&p).ok())
                        .unwrap_or_else(|| body.to_string())
                } else {
                    body.to_string()
                };
                out.push_str("\n**Body**\n```");
                out.push_str(lang);
                out.push('\n');
                out.push_str(&pretty);
                if !pretty.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("```");
            }
        }
    }

    out
}

// ----------------------------------------------------------------------------
// Chat history (saved conversations)
// ----------------------------------------------------------------------------
//
// All chat-history work goes through the same `postboy.db` SQLite database
// that the rest of the app uses. The schema (see `database/mod.rs` migration
// v7) is two tables — `chat_sessions` (id, title, timestamps) and
// `chat_messages` (session_id, role, content, ts) with cascade-on-delete.
// Persistence is fire-and-forget from the frontend: every assistant turn
// finalizes by upserting the whole session, so a crash never loses more
// than the in-flight reply.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionRow {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageRow {
    pub role: String,
    pub content: String,
    /// Epoch milliseconds when the message was added to the conversation.
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionDetail {
    pub id: i64,
    pub title: String,
    pub messages: Vec<ChatMessageRow>,
}

fn chat_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    rusqlite::Connection::open(dir.join("postboy.db")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_list_chats(app: AppHandle) -> Result<Vec<ChatSessionRow>, String> {
    let conn = chat_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.created_at, s.updated_at,
                    (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id)
             FROM chat_sessions s
             ORDER BY datetime(s.updated_at) DESC, s.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ChatSessionRow {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                message_count: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn ai_get_chat(app: AppHandle, session_id: i64) -> Result<ChatSessionDetail, String> {
    let conn = chat_db(&app)?;
    let title: String = conn
        .query_row(
            "SELECT title FROM chat_sessions WHERE id = ?",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Chat not found: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT role, content, ts FROM chat_messages
             WHERE session_id = ?
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(ChatMessageRow {
                role: row.get(0)?,
                content: row.get(1)?,
                timestamp: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let messages = rows.filter_map(|r| r.ok()).collect();
    Ok(ChatSessionDetail {
        id: session_id,
        title,
        messages,
    })
}

#[tauri::command]
pub fn ai_save_chat(
    app: AppHandle,
    session_id: Option<i64>,
    title: String,
    messages: Vec<ChatMessageRow>,
) -> Result<i64, String> {
    let mut conn = chat_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let id = match session_id {
        Some(id) => {
            tx.execute(
                "UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                rusqlite::params![title, id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM chat_messages WHERE session_id = ?",
                rusqlite::params![id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO chat_sessions (title) VALUES (?)",
                rusqlite::params![title],
            )
            .map_err(|e| e.to_string())?;
            tx.last_insert_rowid()
        }
    };

    for msg in &messages {
        tx.execute(
            "INSERT INTO chat_messages (session_id, role, content, ts) VALUES (?,?,?,?)",
            rusqlite::params![id, msg.role, msg.content, msg.timestamp],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn ai_delete_chat(app: AppHandle, session_id: i64) -> Result<(), String> {
    let conn = chat_db(&app)?;
    conn.execute(
        "DELETE FROM chat_sessions WHERE id = ?",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn ai_delete_all_chats(app: AppHandle) -> Result<(), String> {
    let conn = chat_db(&app)?;
    conn.execute("DELETE FROM chat_sessions", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Input autocomplete (suggestion corpus)
// ----------------------------------------------------------------------------
//
// The composer in the chat panel offers a dropdown of completions as the
// user types. The corpus comes from three places: past user messages (so
// frequently-used asks like "get me the access token from Get IRP Token"
// resurface in one tap), saved request names with their collection names
// (so "hit ", "run " etc. autocomplete to real saved requests), and the
// list of collection names. Built-in starter phrases are added on the
// frontend so they don't require a round-trip.
//
// The frontend caches this corpus and refreshes it after each saved
// conversation, so newly-typed asks become future suggestions.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionPhrase {
    pub text: String,
    pub frequency: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionRequest {
    pub name: String,
    pub collection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionCorpus {
    pub phrases: Vec<SuggestionPhrase>,
    pub requests: Vec<SuggestionRequest>,
    pub collections: Vec<String>,
}

#[tauri::command]
pub fn ai_get_suggestion_corpus(app: AppHandle) -> Result<SuggestionCorpus, String> {
    let conn = chat_db(&app)?;

    // Distinct user phrases — ranked by how often the user has sent that
    // exact string, then by recency (max(id) as a cheap proxy). Cap at a
    // few hundred so the frontend filter stays a microsecond linear scan.
    let mut phrases = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT content, COUNT(*) AS cnt
             FROM chat_messages
             WHERE role = 'user' AND length(trim(content)) > 0
             GROUP BY content
             ORDER BY cnt DESC, MAX(id) DESC
             LIMIT 300",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SuggestionPhrase {
                text: row.get::<_, String>(0)?,
                frequency: row.get::<_, i64>(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for r in rows {
        if let Ok(p) = r {
            phrases.push(p);
        }
    }

    let mut requests = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT r.name, c.name
             FROM requests r
             LEFT JOIN collections c ON c.id = r.collection_id
             WHERE length(trim(r.name)) > 0
             ORDER BY r.updated_at DESC
             LIMIT 500",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SuggestionRequest {
                name: row.get::<_, String>(0)?,
                collection: row.get::<_, Option<String>>(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for r in rows {
        if let Ok(req) = r {
            requests.push(req);
        }
    }

    let mut collections = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT name FROM collections
             WHERE length(trim(name)) > 0
             ORDER BY name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for r in rows {
        if let Ok(name) = r {
            collections.push(name);
        }
    }

    Ok(SuggestionCorpus {
        phrases,
        requests,
        collections,
    })
}

