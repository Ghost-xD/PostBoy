use std::collections::HashMap;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

type WsSink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

static CONNECTIONS: std::sync::OnceLock<Arc<Mutex<HashMap<String, WsSink>>>> =
    std::sync::OnceLock::new();

fn get_connections() -> &'static Arc<Mutex<HashMap<String, WsSink>>> {
    CONNECTIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

#[derive(Clone, Serialize)]
struct WsConnectedEvent {
    id: String,
}

#[derive(Clone, Serialize)]
struct WsMessageEvent {
    id: String,
    data: String,
    binary: bool,
    timestamp: u64,
}

#[derive(Clone, Serialize)]
struct WsDisconnectedEvent {
    id: String,
    code: u16,
    reason: String,
}

#[derive(Clone, Serialize)]
struct WsErrorEvent {
    id: String,
    error: String,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub async fn ws_connect(
    app: AppHandle,
    id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    {
        let conns = get_connections().lock().await;
        if conns.contains_key(&id) {
            return Err(format!("Connection already exists for id: {}", id));
        }
    }

    let mut request = url
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket URL: {}", e))?;

    if let Some(hdrs) = headers {
        let req_headers = request.headers_mut();
        for (key, value) in hdrs {
            if let (Ok(name), Ok(val)) = (
                key.parse::<reqwest::header::HeaderName>(),
                value.parse::<reqwest::header::HeaderValue>(),
            ) {
                req_headers.insert(name, val);
            }
        }
    }

    let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (write, mut read) = ws_stream.split();

    {
        let mut conns = get_connections().lock().await;
        conns.insert(id.clone(), write);
    }

    let _ = app.emit("ws-connected", WsConnectedEvent { id: id.clone() });

    let app_clone = app.clone();
    let id_clone = id.clone();

    tokio::spawn(async move {
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(msg) => match msg {
                    Message::Text(text) => {
                        let data = text.to_string();
                        let _ = app_clone.emit(
                            "ws-message",
                            WsMessageEvent {
                                id: id_clone.clone(),
                                data,
                                binary: false,
                                timestamp: now_ms(),
                            },
                        );
                    }
                    Message::Binary(bin) => {
                        let _ = app_clone.emit(
                            "ws-message",
                            WsMessageEvent {
                                id: id_clone.clone(),
                                data: format!("[binary {} bytes]", bin.len()),
                                binary: true,
                                timestamp: now_ms(),
                            },
                        );
                    }
                    Message::Close(frame) => {
                        let (code, reason) = frame
                            .map(|f| (f.code.into(), f.reason.to_string()))
                            .unwrap_or((1000, "Normal closure".to_string()));
                        let _ = app_clone.emit(
                            "ws-disconnected",
                            WsDisconnectedEvent {
                                id: id_clone.clone(),
                                code,
                                reason,
                            },
                        );
                        break;
                    }
                    Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
                },
                Err(e) => {
                    let _ = app_clone.emit(
                        "ws-error",
                        WsErrorEvent {
                            id: id_clone.clone(),
                            error: e.to_string(),
                        },
                    );
                    break;
                }
            }
        }

        let mut conns = get_connections().lock().await;
        conns.remove(&id_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn ws_send(id: String, message: String) -> Result<(), String> {
    let mut conns = get_connections().lock().await;
    let sink = conns
        .get_mut(&id)
        .ok_or_else(|| format!("No active connection for id: {}", id))?;

    sink.send(Message::Text(message.into()))
        .await
        .map_err(|e| format!("Failed to send message: {}", e))
}

#[tauri::command]
pub async fn ws_disconnect(app: AppHandle, id: String) -> Result<(), String> {
    let mut conns = get_connections().lock().await;
    if let Some(mut sink) = conns.remove(&id) {
        let _ = sink.send(Message::Close(None)).await;
        let _ = app.emit(
            "ws-disconnected",
            WsDisconnectedEvent {
                id,
                code: 1000,
                reason: "Client disconnected".to_string(),
            },
        );
        Ok(())
    } else {
        Err(format!("No active connection for id: {}", id))
    }
}
