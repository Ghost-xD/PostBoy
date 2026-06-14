use std::collections::HashMap;
use std::sync::Arc;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

struct SseConnection {
    cancel: CancellationToken,
}

static CONNECTIONS: std::sync::OnceLock<Arc<Mutex<HashMap<String, SseConnection>>>> =
    std::sync::OnceLock::new();

fn get_connections() -> &'static Arc<Mutex<HashMap<String, SseConnection>>> {
    CONNECTIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

#[derive(Clone, Serialize)]
struct SseConnectedEvent {
    id: String,
}

#[derive(Clone, Serialize)]
struct SseMessageEvent {
    id: String,
    data: String,
    #[serde(rename = "eventType")]
    event_type: String,
    #[serde(rename = "lastEventId")]
    last_event_id: String,
    timestamp: u64,
}

#[derive(Clone, Serialize)]
struct SseDisconnectedEvent {
    id: String,
    reason: String,
}

#[derive(Clone, Serialize)]
struct SseErrorEvent {
    id: String,
    error: String,
}

#[derive(Clone, Serialize)]
struct SseReconnectingEvent {
    id: String,
    attempt: u32,
    #[serde(rename = "delayMs")]
    delay_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub async fn sse_connect(
    app: AppHandle,
    id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    auto_reconnect: Option<bool>,
) -> Result<(), String> {
    {
        let conns = get_connections().lock().await;
        if conns.contains_key(&id) {
            return Err(format!("SSE connection already exists for id: {}", id));
        }
    }

    let cancel = CancellationToken::new();

    {
        let mut conns = get_connections().lock().await;
        conns.insert(id.clone(), SseConnection { cancel: cancel.clone() });
    }

    let reconnect = auto_reconnect.unwrap_or(true);
    let app_clone = app.clone();
    let id_clone = id.clone();

    tokio::spawn(async move {
        let mut retry_ms: u64 = 3000;
        let mut last_event_id = String::new();
        let mut attempt: u32 = 0;
        let max_retries: u32 = if reconnect { 10 } else { 0 };

        loop {
            if cancel.is_cancelled() {
                break;
            }

            let result = do_sse_stream(
                &app_clone,
                &id_clone,
                &url,
                &headers,
                &mut retry_ms,
                &mut last_event_id,
                &cancel,
            )
            .await;

            if cancel.is_cancelled() {
                break;
            }

            match result {
                Ok(()) => {
                    // Stream ended cleanly (server closed)
                }
                Err(e) => {
                    let _ = app_clone.emit("sse-error", SseErrorEvent {
                        id: id_clone.clone(),
                        error: e,
                    });
                }
            }

            if !reconnect || attempt >= max_retries || cancel.is_cancelled() {
                break;
            }

            attempt += 1;
            let _ = app_clone.emit("sse-reconnecting", SseReconnectingEvent {
                id: id_clone.clone(),
                attempt,
                delay_ms: retry_ms,
            });

            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_millis(retry_ms)) => {}
                _ = cancel.cancelled() => { break; }
            }
        }

        let _ = app_clone.emit("sse-disconnected", SseDisconnectedEvent {
            id: id_clone.clone(),
            reason: if cancel.is_cancelled() { "Client disconnected".into() } else { "Connection ended".into() },
        });

        let mut conns = get_connections().lock().await;
        conns.remove(&id_clone);
    });

    Ok(())
}

async fn do_sse_stream(
    app: &AppHandle,
    id: &str,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    retry_ms: &mut u64,
    last_event_id: &mut String,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(0)) // no timeout for streaming
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(url).header("Accept", "text/event-stream");

    if !last_event_id.is_empty() {
        req = req.header("Last-Event-ID", last_event_id.as_str());
    }

    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    let response = req.send().await.map_err(|e| format!("SSE connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("SSE server returned status {}", response.status()));
    }

    let _ = app.emit("sse-connected", SseConnectedEvent { id: id.to_string() });

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut event_type = String::new();
    let mut data_lines: Vec<String> = Vec::new();
    let mut event_id = String::new();

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(ref bytes)) => {
                        let text = String::from_utf8_lossy(bytes);
                        buffer.push_str(&text);

                        while let Some(line_end) = buffer.find('\n') {
                            let line = buffer[..line_end].trim_end_matches('\r').to_string();
                            buffer = buffer[line_end + 1..].to_string();

                            if line.is_empty() {
                                // Dispatch event
                                if !data_lines.is_empty() {
                                    let data = data_lines.join("\n");
                                    if !event_id.is_empty() {
                                        *last_event_id = event_id.clone();
                                    }

                                    let _ = app.emit("sse-message", SseMessageEvent {
                                        id: id.to_string(),
                                        data,
                                        event_type: if event_type.is_empty() { "message".into() } else { event_type.clone() },
                                        last_event_id: last_event_id.clone(),
                                        timestamp: now_ms(),
                                    });
                                }
                                event_type.clear();
                                data_lines.clear();
                                event_id.clear();
                            } else if line.starts_with(':') {
                                // Comment, ignore
                            } else if let Some(value) = line.strip_prefix("data:") {
                                data_lines.push(value.strip_prefix(' ').unwrap_or(value).to_string());
                            } else if let Some(value) = line.strip_prefix("event:") {
                                event_type = value.strip_prefix(' ').unwrap_or(value).to_string();
                            } else if let Some(value) = line.strip_prefix("id:") {
                                let id_val = value.strip_prefix(' ').unwrap_or(value);
                                if !id_val.contains('\0') {
                                    event_id = id_val.to_string();
                                }
                            } else if let Some(value) = line.strip_prefix("retry:") {
                                let val = value.strip_prefix(' ').unwrap_or(value);
                                if let Ok(ms) = val.parse::<u64>() {
                                    *retry_ms = ms;
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        return Err(format!("Stream error: {}", e));
                    }
                    None => {
                        return Ok(());
                    }
                }
            }
            _ = cancel.cancelled() => {
                return Ok(());
            }
        }
    }
}

#[tauri::command]
pub async fn sse_disconnect(id: String) -> Result<(), String> {
    let mut conns = get_connections().lock().await;
    if let Some(conn) = conns.remove(&id) {
        conn.cancel.cancel();
        Ok(())
    } else {
        Err(format!("No active SSE connection for id: {}", id))
    }
}
