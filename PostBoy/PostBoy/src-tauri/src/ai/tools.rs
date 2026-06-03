//! Tool registry + dispatcher.
//!
//! Tools are the chatbot's bridge to the rest of Ripple. They mirror a
//! subset of the existing Tauri commands. The schemas here are emitted into
//! the model's system prompt (see [`tool_parser::build_prompt`]); the
//! dispatcher executes the tool and returns a JSON value the model can read.
//!
//! Most tools are thin wrappers around `rusqlite::Connection` queries against
//! the existing `ripple.db`, so we re-implement the read paths instead of
//! going back through Tauri's `invoke` layer.

use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::http_client;

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ripple.db"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(db_path(app)?).map_err(|e| e.to_string())
}

/// JSON schemas of every available tool. Embedded into the model's system
/// prompt by [`crate::ai::tool_parser::build_prompt`].
pub fn tools_schema_json() -> String {
    serde_json::to_string_pretty(&json!([
        {
            "name": "list_collections",
            "description": "List all request collections with their ids and names.",
            "arguments": {}
        },
        {
            "name": "list_requests",
            "description": "List saved requests. Pass `collection_id` to scope to one collection; OMIT it to list every saved request across ALL collections (each entry includes its `collection_id` and `collection_name`). Prefer omitting `collection_id` whenever the user says \"all requests\" / \"every request\" / \"what requests do I have\".",
            "arguments": {
                "collection_id": { "type": "integer", "description": "OPTIONAL — collection id from list_collections. Omit to list across all collections." }
            }
        },
        {
            "name": "inspect_request",
            "description": "READ-ONLY: returns the saved request DEFINITION (method, URL, headers, body) WITHOUT sending it. Use ONLY when the user asks to inspect/see/show what is saved. NEVER use this when the user asks to hit/call/run/execute/send/fire/test/fetch/get the request — use run_request for that.",
            "arguments": {
                "request_id": { "type": "integer", "description": "Exact id from list_requests (preferred when known)" },
                "name":       { "type": "string",  "description": "Substring of the saved request's name; resolved server-side" },
                "collection_id": { "type": "integer", "description": "OPTIONAL — only pass when the user explicitly named the collection. Omit if unsure; the name search will run globally." }
            }
        },
        {
            "name": "run_request",
            "description": "ACTUALLY SENDS the saved HTTP request over the network and returns the live response (status, headers, body). Use whenever the user wants the live result — phrasings like hit, call, run, execute, send, fire, test, invoke, fetch, get the X, give me the X, what does X return. This is the only tool that touches the network.",
            "arguments": {
                "request_id": { "type": "integer", "description": "Exact id from list_requests (preferred when known)" },
                "name":       { "type": "string",  "description": "Substring of the saved request's name; resolved server-side" },
                "collection_id": { "type": "integer", "description": "OPTIONAL — only pass when the user explicitly named the collection. Omit if unsure; the name search will run globally." }
            }
        },
        {
            "name": "get_variables",
            "description": "Read all collection-scoped variables.",
            "arguments": {
                "collection_id": { "type": "integer" }
            }
        },
        {
            "name": "set_variable",
            "description": "Set or update a single collection-scoped variable.",
            "arguments": {
                "collection_id": { "type": "integer" },
                "key": { "type": "string" },
                "value": { "type": "string" }
            }
        },
        {
            "name": "get_history",
            "description": "Return the N most recent request/response history entries (default 10).",
            "arguments": {
                "limit": { "type": "integer", "default": 10 }
            }
        },
        {
            "name": "get_last_response",
            "description": "Return the most recent history entry (status, headers, truncated body).",
            "arguments": {}
        }
    ]))
    .unwrap_or_else(|_| "[]".to_string())
}

// Bound the body size we feed back to the model so a 10 MB JSON response
// doesn't blow the context window. 32 KB comfortably fits any 8K+ context
// model and is large enough that most real responses pass through untouched.
const BODY_TRUNCATE_BYTES: usize = 32 * 1024;

fn truncate_body(s: &str) -> String {
    if s.len() <= BODY_TRUNCATE_BYTES {
        s.to_string()
    } else {
        format!(
            "{}\n…[truncated, total {} bytes]",
            &s[..BODY_TRUNCATE_BYTES],
            s.len()
        )
    }
}

/// Resolve a `{request_id?, name?, collection_id?}` arg bag into an exact
/// request id. If `name` is present we look it up server-side first — it
/// comes verbatim from the user's prompt and is the most trustworthy signal
/// available. `request_id` is used only when no usable name was provided
/// (small models cheerfully pair correct names with hallucinated ids, and
/// trusting the id wins us nothing). If a scoped name lookup finds nothing,
/// it transparently retries globally — small models also like to invent
/// `collection_id` values.
///
/// Returning a deterministic id from this layer means `run_request` and
/// `inspect_request` cannot be tricked into hitting the wrong row regardless
/// of how the model fills out its arguments.
fn resolve_request_id(app: &AppHandle, args: &Value) -> Result<i64, String> {
    let name_arg = args
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    if let Some(name) = name_arg {
        let collection_id = args.get("collection_id").and_then(|v| v.as_i64());
        let conn = open_db(app)?;
        let pattern = format!("%{}%", name.to_lowercase());

        let lookup_in_scope =
            |scope: Option<i64>| -> Result<Vec<(i64, String, Option<i64>)>, String> {
                if let Some(cid) = scope {
                    let mut stmt = conn
                        .prepare(
                            "SELECT id, name, collection_id FROM requests
                             WHERE collection_id = ? AND LOWER(name) LIKE ?
                             ORDER BY name",
                        )
                        .map_err(|e| e.to_string())?;
                    let rows = stmt
                        .query_map(rusqlite::params![cid, pattern], |row| {
                            Ok((
                                row.get::<_, i64>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, Option<i64>>(2)?,
                            ))
                        })
                        .map_err(|e| e.to_string())?;
                    Ok(rows.filter_map(|r| r.ok()).collect())
                } else {
                    let mut stmt = conn
                        .prepare(
                            "SELECT id, name, collection_id FROM requests
                             WHERE LOWER(name) LIKE ?
                             ORDER BY name",
                        )
                        .map_err(|e| e.to_string())?;
                    let rows = stmt
                        .query_map(rusqlite::params![pattern], |row| {
                            Ok((
                                row.get::<_, i64>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, Option<i64>>(2)?,
                            ))
                        })
                        .map_err(|e| e.to_string())?;
                    Ok(rows.filter_map(|r| r.ok()).collect())
                }
            };

        let mut matches = lookup_in_scope(collection_id)?;
        if matches.is_empty() && collection_id.is_some() {
            matches = lookup_in_scope(None)?;
        }

        match matches.len() {
            0 => {
                // Name didn't match anything. Only fall through to a
                // numeric id if the model also passed one — otherwise this
                // is a real "no such request" error.
                if let Some(id) = args.get("request_id").and_then(|v| v.as_i64()) {
                    return Ok(id);
                }
                return Err(format!("No saved request matches name '{name}'"));
            }
            1 => return Ok(matches[0].0),
            n => {
                let preview: Vec<String> = matches
                    .iter()
                    .take(5)
                    .map(|(id, nm, cid)| {
                        format!(
                            "[id={id} collection={}] {nm}",
                            cid.map(|c| c.to_string()).unwrap_or_else(|| "-".into())
                        )
                    })
                    .collect();
                return Err(format!(
                    "Ambiguous: {n} requests match '{name}': {}{}",
                    preview.join(", "),
                    if n > 5 { ", …" } else { "" }
                ));
            }
        }
    }

    if let Some(id) = args.get("request_id").and_then(|v| v.as_i64()) {
        return Ok(id);
    }
    Err("Either name or request_id is required".to_string())
}

/// Dispatch a parsed tool call. Always returns a JSON value (errors are
/// wrapped as `{"error": "..."}` rather than `Err` so the model can see them
/// and recover).
pub async fn dispatch(app: AppHandle, name: &str, args: Value) -> Value {
    let res: Result<Value, String> = match name {
        "list_collections" => list_collections(&app),
        "list_requests" => {
            let id = args.get("collection_id").and_then(|v| v.as_i64());
            match id {
                Some(id) => list_requests(&app, id),
                None => list_all_requests(&app),
            }
        }
        "inspect_request" | "get_request" => match resolve_request_id(&app, &args) {
            Ok(id) => get_request(&app, id),
            Err(e) => Err(e),
        },
        "run_request" => match resolve_request_id(&app, &args) {
            Ok(id) => run_request(&app, id).await,
            Err(e) => Err(e),
        },
        "get_variables" => {
            let id = args.get("collection_id").and_then(|v| v.as_i64());
            match id {
                Some(id) => get_variables(&app, id),
                None => Err("collection_id is required".into()),
            }
        }
        "set_variable" => {
            let cid = args.get("collection_id").and_then(|v| v.as_i64());
            let key = args.get("key").and_then(|v| v.as_str());
            let value = args.get("value").and_then(|v| v.as_str());
            match (cid, key, value) {
                (Some(c), Some(k), Some(v)) => set_variable(&app, c, k, v),
                _ => Err("collection_id, key, value are required".into()),
            }
        }
        "get_history" => {
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(10);
            get_history(&app, limit)
        }
        "get_last_response" => get_history(&app, 1),
        other => Err(format!("Unknown tool: {other}")),
    };

    match res {
        Ok(v) => v,
        Err(e) => json!({ "error": e }),
    }
}

fn list_collections(app: &AppHandle) -> Result<Value, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare("SELECT id, name, COALESCE(description, '') FROM collections ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "collections": out }))
}

fn list_requests(app: &AppHandle, collection_id: i64) -> Result<Value, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, method, url FROM requests
             WHERE collection_id = ? ORDER BY sort_order ASC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([collection_id], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "method": row.get::<_, String>(2)?,
                "url": row.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "requests": out }))
}

/// List every saved request across every collection in one shot. Used when
/// the caller invokes `list_requests` without a `collection_id`. Each entry
/// carries its `collection_id` and `collection_name` so the model (or the
/// frontend) can group/format without a second round-trip.
///
/// `collection_id` is read as `Option<i64>` because the legacy schema
/// allowed NULL there for orphaned requests; we surface that as JSON
/// `null` and the formatter buckets those under "(uncategorized)".
fn list_all_requests(app: &AppHandle) -> Result<Value, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT r.id, r.name, r.method, r.url, r.collection_id,
                    COALESCE(c.name, '') AS collection_name
             FROM requests r
             LEFT JOIN collections c ON c.id = r.collection_id
             ORDER BY collection_name COLLATE NOCASE ASC,
                      r.sort_order ASC, r.created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "method": row.get::<_, String>(2)?,
                "url": row.get::<_, String>(3)?,
                "collection_id": row.get::<_, Option<i64>>(4)?,
                "collection_name": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "requests": out }))
}

fn get_request(app: &AppHandle, request_id: i64) -> Result<Value, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, collection_id, name, method, url, headers, params, body_type,
                    body_content, auth_type, auth_data, COALESCE(description, '')
             FROM requests WHERE id = ?",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([request_id]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(json!({
            "kind": "saved_request_definition",
            "note": "This is the SAVED REQUEST DEFINITION (not a response). It has NOT been sent. Call run_request to actually invoke it over the network.",
            "request_definition": {
                "id": row.get::<_, i64>(0).map_err(|e| e.to_string())?,
                "collection_id": row.get::<_, Option<i64>>(1).map_err(|e| e.to_string())?,
                "name": row.get::<_, String>(2).map_err(|e| e.to_string())?,
                "method": row.get::<_, String>(3).map_err(|e| e.to_string())?,
                "url": row.get::<_, String>(4).map_err(|e| e.to_string())?,
                "headers": row.get::<_, String>(5).map_err(|e| e.to_string())?,
                "params": row.get::<_, String>(6).map_err(|e| e.to_string())?,
                "body_type": row.get::<_, String>(7).map_err(|e| e.to_string())?,
                "body_content": row.get::<_, String>(8).map_err(|e| e.to_string())?,
                "auth_type": row.get::<_, String>(9).map_err(|e| e.to_string())?,
                "auth_data": row.get::<_, String>(10).map_err(|e| e.to_string())?,
                "description": row.get::<_, String>(11).map_err(|e| e.to_string())?,
            }
        }))
    } else {
        Err(format!("No request with id {request_id}"))
    }
}

async fn run_request(app: &AppHandle, request_id: i64) -> Result<Value, String> {
    let req_envelope = get_request(app, request_id)?;
    let req = &req_envelope["request_definition"];
    let method = req["method"].as_str().unwrap_or("GET").to_string();
    let url = req["url"].as_str().unwrap_or("").to_string();

    let mut header_map: HashMap<String, String> = HashMap::new();
    if let Ok(arr) = serde_json::from_str::<Vec<Value>>(req["headers"].as_str().unwrap_or("[]")) {
        for h in arr {
            if let (Some(k), Some(v)) = (
                h.get("key").and_then(|v| v.as_str()),
                h.get("value").and_then(|v| v.as_str()),
            ) {
                if !k.is_empty() {
                    header_map.insert(k.to_string(), v.to_string());
                }
            }
        }
    }

    let body = req["body_content"].as_str().map(|s| s.to_string());

    let http_req = http_client::HttpRequest {
        method,
        url,
        headers: if header_map.is_empty() {
            None
        } else {
            Some(header_map)
        },
        body,
    };

    let resp = http_client::execute_request(http_req, Some(30), None, Some(false), Some(true), Some(10))
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    Ok(json!({
        "kind": "http_response",
        "status": resp.status,
        "statusText": resp.status_text,
        "headers": resp.headers,
        "body": truncate_body(&resp.body),
        "responseTime": resp.response_time,
    }))
}

fn get_variables(app: &AppHandle, collection_id: i64) -> Result<Value, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM collection_variables WHERE collection_id = ? ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([collection_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut map = serde_json::Map::new();
    for r in rows {
        let (k, v) = r.map_err(|e| e.to_string())?;
        map.insert(k, Value::String(v));
    }
    Ok(Value::Object(map))
}

fn set_variable(app: &AppHandle, collection_id: i64, key: &str, value: &str) -> Result<Value, String> {
    let conn = open_db(app)?;
    conn.execute(
        "INSERT OR REPLACE INTO collection_variables (collection_id, key, value, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
        rusqlite::params![collection_id, key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

fn get_history(app: &AppHandle, limit: i64) -> Result<Value, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT method, url, status_code, response_time, response_headers, response_body, executed_at
             FROM history ORDER BY executed_at DESC LIMIT ?",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |row| {
            let headers_str: Option<String> = row.get(4)?;
            let body: Option<String> = row.get(5)?;
            let headers = headers_str
                .as_deref()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .unwrap_or_else(|| json!({}));
            Ok(json!({
                "method": row.get::<_, String>(0)?,
                "url": row.get::<_, String>(1)?,
                "status": row.get::<_, Option<i64>>(2)?,
                "responseTime": row.get::<_, Option<i64>>(3)?,
                "headers": headers,
                "body": body.map(|b| truncate_body(&b)),
                "executedAt": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "history": out }))
}
