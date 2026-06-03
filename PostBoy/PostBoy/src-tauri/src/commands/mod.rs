use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use std::path::PathBuf;

// Helper function to get database path and ensure directory exists
fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    
    // Ensure directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    
    Ok(app_data_dir.join("ripple.db"))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub parent_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Request {
    pub id: i64,
    pub collection_id: Option<i64>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: String,
    pub params: String,
    pub body_type: Option<String>,
    pub body_content: Option<String>,
    pub auth_type: Option<String>,
    pub auth_data: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestData {
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Option<Vec<KeyValue>>,
    pub params: Option<Vec<KeyValue>>,
    #[serde(rename = "bodyType")]
    pub body_type: Option<String>,
    #[serde(rename = "bodyContent")]
    pub body_content: Option<String>,
    #[serde(rename = "authType")]
    pub auth_type: Option<String>,
    #[serde(rename = "authData")]
    pub auth_data: Option<serde_json::Value>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: i64,
    pub method: String,
    pub url: String,
    pub status_code: Option<i64>,
    pub response_time: Option<i64>,
    pub headers: String,
    pub params: String,
    pub body_type: Option<String>,
    pub body_content: Option<String>,
    pub auth_type: Option<String>,
    pub auth_data: String,
    pub response_headers: Option<String>,
    pub response_body: Option<String>,
    pub executed_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    #[serde(rename = "collectionsImported")]
    pub collections_imported: i32,
    #[serde(rename = "requestsImported")]
    pub requests_imported: i32,
    pub errors: Vec<String>,
}

// Get app version
#[tauri::command]
pub fn get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_update_token() -> Option<String> {
    option_env!("UPDATE_TOKEN")
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
}

// Collections commands
#[tauri::command]
pub async fn db_create_collection(
    app: AppHandle,
    name: String,
    description: String,
) -> Result<i64, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO collections (name, description) VALUES (?, ?)",
        rusqlite::params![name, description],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn db_get_collections(app: AppHandle) -> Result<Vec<Collection>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT id, name, description, created_at, updated_at, parent_id FROM collections ORDER BY sort_order ASC, created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let collections_iter = stmt.query_map([], |row| {
        Ok(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            parent_id: row.get(5)?,
        })
    })
    .map_err(|e| e.to_string())?;
    
    let collections = collections_iter.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    Ok(collections)
}

#[tauri::command]
pub async fn db_get_collection(app: AppHandle, id: i64) -> Result<Option<Collection>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT id, name, description, created_at, updated_at, parent_id FROM collections WHERE id = ?")
        .map_err(|e| e.to_string())?;
    
    let mut rows = stmt.query([id])
        .map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(Collection {
            id: row.get(0).map_err(|e| e.to_string())?,
            name: row.get(1).map_err(|e| e.to_string())?,
            description: row.get(2).map_err(|e| e.to_string())?,
            created_at: row.get(3).map_err(|e| e.to_string())?,
            updated_at: row.get(4).map_err(|e| e.to_string())?,
            parent_id: row.get(5).map_err(|e| e.to_string())?,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn db_update_collection(
    app: AppHandle,
    id: i64,
    name: String,
    description: String,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE collections SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        rusqlite::params![name, description, id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_delete_collection(app: AppHandle, id: i64) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM collections WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;
    
    Ok(true)
}

// Requests commands
#[tauri::command]
pub async fn db_create_request(
    app: AppHandle,
    collection_id: Option<i64>,
    request_data: RequestData,
) -> Result<i64, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let headers = serde_json::to_string(&request_data.headers.unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let params = serde_json::to_string(&request_data.params.unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let auth_data = serde_json::to_string(&request_data.auth_data.unwrap_or(serde_json::json!({})))
        .map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO requests (collection_id, name, method, url, headers, params, body_type, body_content, auth_type, auth_data, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            collection_id,
            request_data.name,
            request_data.method,
            request_data.url,
            headers,
            params,
            request_data.body_type.unwrap_or_else(|| "json".to_string()),
            request_data.body_content.unwrap_or_default(),
            request_data.auth_type.unwrap_or_else(|| "none".to_string()),
            auth_data,
            request_data.description.unwrap_or_default(),
        ],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn db_get_requests(app: AppHandle, collection_id: i64) -> Result<Vec<Request>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT id, collection_id, name, method, url, headers, params, body_type, body_content, auth_type, auth_data, description, created_at, updated_at FROM requests WHERE collection_id = ? ORDER BY sort_order ASC, created_at DESC")
        .map_err(|e| e.to_string())?;

    let requests = stmt.query_map([collection_id], |row| {
        Ok(Request {
            id: row.get(0)?,
            collection_id: row.get(1)?,
            name: row.get(2)?,
            method: row.get(3)?,
            url: row.get(4)?,
            headers: row.get(5)?,
            params: row.get(6)?,
            body_type: row.get(7)?,
            body_content: row.get(8)?,
            auth_type: row.get(9)?,
            auth_data: row.get(10)?,
            description: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    
    Ok(requests)
}

#[tauri::command]
pub async fn db_get_request(app: AppHandle, id: i64) -> Result<Option<Request>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT id, collection_id, name, method, url, headers, params, body_type, body_content, auth_type, auth_data, description, created_at, updated_at FROM requests WHERE id = ?")
        .map_err(|e| e.to_string())?;
    
    let mut rows = stmt.query([id])
        .map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(Request {
            id: row.get(0).map_err(|e| e.to_string())?,
            collection_id: row.get(1).map_err(|e| e.to_string())?,
            name: row.get(2).map_err(|e| e.to_string())?,
            method: row.get(3).map_err(|e| e.to_string())?,
            url: row.get(4).map_err(|e| e.to_string())?,
            headers: row.get(5).map_err(|e| e.to_string())?,
            params: row.get(6).map_err(|e| e.to_string())?,
            body_type: row.get(7).map_err(|e| e.to_string())?,
            body_content: row.get(8).map_err(|e| e.to_string())?,
            auth_type: row.get(9).map_err(|e| e.to_string())?,
            auth_data: row.get(10).map_err(|e| e.to_string())?,
            description: row.get::<_, Option<String>>(11).unwrap_or(None),
            created_at: row.get(12).map_err(|e| e.to_string())?,
            updated_at: row.get(13).map_err(|e| e.to_string())?,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn db_update_request(
    app: AppHandle,
    id: i64,
    request_data: RequestData,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let headers = serde_json::to_string(&request_data.headers.unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let params = serde_json::to_string(&request_data.params.unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let auth_data = serde_json::to_string(&request_data.auth_data.unwrap_or(serde_json::json!({})))
        .map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE requests SET name = ?, method = ?, url = ?, headers = ?, params = ?, body_type = ?, body_content = ?, auth_type = ?, auth_data = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        rusqlite::params![
            request_data.name,
            request_data.method,
            request_data.url,
            headers,
            params,
            request_data.body_type.unwrap_or_else(|| "json".to_string()),
            request_data.body_content.unwrap_or_default(),
            request_data.auth_type.unwrap_or_else(|| "none".to_string()),
            auth_data,
            request_data.description.unwrap_or_default(),
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_delete_request(app: AppHandle, id: i64) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM requests WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_rename_collection(app: AppHandle, id: i64, name: String) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        rusqlite::params![name, id],
    ).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn db_rename_request(app: AppHandle, id: i64, name: String) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE requests SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        rusqlite::params![name, id],
    ).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn db_reorder_requests(app: AppHandle, request_ids: Vec<i64>) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    for (idx, id) in request_ids.iter().enumerate() {
        conn.execute(
            "UPDATE requests SET sort_order = ? WHERE id = ?",
            rusqlite::params![idx as i64, id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn db_move_request(app: AppHandle, request_id: i64, target_collection_id: i64) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE requests SET collection_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        rusqlite::params![target_collection_id, request_id],
    ).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn db_export_single_collection(app: AppHandle, collection_id: i64) -> Result<String, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    let collection: (String, String) = conn.query_row(
        "SELECT name, COALESCE(description, '') FROM collections WHERE id = ?",
        [collection_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT name, method, url, headers, params, body_type, body_content, auth_type, auth_data, sort_order, description FROM requests WHERE collection_id = ? ORDER BY sort_order ASC, created_at DESC"
    ).map_err(|e| e.to_string())?;

    let requests: Vec<serde_json::Value> = stmt.query_map([collection_id], |row| {
        let name: String = row.get(0)?;
        let method: String = row.get(1)?;
        let url: String = row.get(2)?;
        let headers: String = row.get(3)?;
        let params: String = row.get(4)?;
        let body_type: String = row.get(5)?;
        let body_content: String = row.get(6)?;
        let auth_type: String = row.get(7)?;
        let auth_data: String = row.get(8)?;
        let sort_order: i64 = row.get(9)?;
        let description: String = row.get::<_, String>(10).unwrap_or_default();
        Ok(serde_json::json!({
            "name": name, "method": method, "url": url,
            "headers": headers, "params": params,
            "body_type": body_type, "body_content": body_content,
            "auth_type": auth_type, "auth_data": auth_data,
            "sort_order": sort_order, "description": description,
        }))
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    // Also export variables
    let mut var_stmt = conn.prepare(
        "SELECT key, value FROM collection_variables WHERE collection_id = ?"
    ).map_err(|e| e.to_string())?;

    let vars: Vec<serde_json::Value> = var_stmt.query_map([collection_id], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok(serde_json::json!({"key": key, "value": value}))
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    let export = serde_json::json!({
        "format": "ripple-collection",
        "version": "1.0",
        "collection": {
            "name": collection.0,
            "description": collection.1,
            "variables": vars,
            "requests": requests,
        }
    });

    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_import_single_collection(app: AppHandle, json_data: String) -> Result<i64, String> {
    let data: serde_json::Value = serde_json::from_str(&json_data).map_err(|e| e.to_string())?;

    let collection = data.get("collection").ok_or("Missing 'collection' field")?;
    let name = collection["name"].as_str().ok_or("Missing collection name")?;
    let description = collection["description"].as_str().unwrap_or("");

    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO collections (name, description) VALUES (?, ?)",
        rusqlite::params![name, description],
    ).map_err(|e| e.to_string())?;
    let collection_id = conn.last_insert_rowid();

    if let Some(requests) = collection["requests"].as_array() {
        for req in requests {
            let sort_order = req["sort_order"].as_i64().unwrap_or(0);
            conn.execute(
                "INSERT INTO requests (collection_id, name, method, url, headers, params, body_type, body_content, auth_type, auth_data, sort_order, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rusqlite::params![
                    collection_id,
                    req["name"].as_str().unwrap_or("Untitled"),
                    req["method"].as_str().unwrap_or("GET"),
                    req["url"].as_str().unwrap_or(""),
                    req["headers"].as_str().unwrap_or("[]"),
                    req["params"].as_str().unwrap_or("[]"),
                    req["body_type"].as_str().unwrap_or("json"),
                    req["body_content"].as_str().unwrap_or(""),
                    req["auth_type"].as_str().unwrap_or("none"),
                    req["auth_data"].as_str().unwrap_or("{}"),
                    sort_order,
                    req["description"].as_str().unwrap_or(""),
                ],
            ).map_err(|e| e.to_string())?;
        }
    }

    if let Some(variables) = collection["variables"].as_array() {
        for var in variables {
            let key = var["key"].as_str().unwrap_or("");
            let value = var["value"].as_str().unwrap_or("");
            if !key.is_empty() {
                conn.execute(
                    "INSERT OR REPLACE INTO collection_variables (collection_id, key, value) VALUES (?, ?, ?)",
                    rusqlite::params![collection_id, key, value],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(collection_id)
}

#[tauri::command]
pub async fn db_create_folder(app: AppHandle, name: String, parent_id: Option<i64>) -> Result<i64, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO collections (name, description, parent_id) VALUES (?, '', ?)",
        rusqlite::params![name, parent_id],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn db_move_collection(app: AppHandle, id: i64, parent_id: Option<i64>) -> Result<bool, String> {
    if parent_id == Some(id) {
        return Err("Cannot move a collection into itself".to_string());
    }
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        rusqlite::params![parent_id, id],
    ).map_err(|e| e.to_string())?;
    Ok(true)
}

// History commands
#[tauri::command]
pub async fn db_add_history(
    app: AppHandle,
    request_data: serde_json::Value,
    response_data: serde_json::Value,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let method = request_data["method"].as_str().unwrap_or("GET");
    let url = request_data["url"].as_str().unwrap_or("");
    let status_code = response_data["status"].as_i64();
    let response_time = response_data["responseTime"].as_i64();
    
    let headers = serde_json::to_string(&request_data["headers"]).unwrap_or_else(|_| "[]".to_string());
    let params = serde_json::to_string(&request_data["params"]).unwrap_or_else(|_| "[]".to_string());
    let body_type = request_data["bodyType"].as_str().or(request_data["body_type"].as_str()).unwrap_or("json");
    let body_content = request_data["bodyContent"].as_str().or(request_data["body_content"].as_str()).unwrap_or("");
    let auth_type = request_data["authType"].as_str().or(request_data["auth_type"].as_str()).unwrap_or("none");
    let auth_data = serde_json::to_string(&request_data["authData"]).unwrap_or_else(|_| "{}".to_string());
    let response_headers = serde_json::to_string(&response_data["headers"]).unwrap_or_else(|_| "{}".to_string());
    let response_body = serde_json::to_string(&response_data["body"]).unwrap_or_else(|_| "\"\"".to_string());
    
    conn.execute(
        "INSERT INTO history (method, url, status_code, response_time, headers, params, body_type, body_content, auth_type, auth_data, response_headers, response_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            method,
            url,
            status_code,
            response_time,
            headers,
            params,
            body_type,
            body_content,
            auth_type,
            auth_data,
            response_headers,
            response_body,
        ],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_get_history(app: AppHandle, limit: Option<i64>) -> Result<Vec<HistoryItem>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let limit_val = limit.unwrap_or(100);
    let mut stmt = conn.prepare("SELECT * FROM history ORDER BY executed_at DESC LIMIT ?")
        .map_err(|e| e.to_string())?;
    
    let history = stmt.query_map([limit_val], |row| {
        Ok(HistoryItem {
            id: row.get(0)?,
            method: row.get(1)?,
            url: row.get(2)?,
            status_code: row.get(3)?,
            response_time: row.get(4)?,
            headers: row.get(5)?,
            params: row.get(6)?,
            body_type: row.get(7)?,
            body_content: row.get(8)?,
            auth_type: row.get(9)?,
            auth_data: row.get(10)?,
            response_headers: row.get(11)?,
            response_body: row.get(12)?,
            executed_at: row.get(13)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    
    Ok(history)
}

#[tauri::command]
pub async fn db_delete_history(app: AppHandle, id: i64) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM history WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_clear_history(app: AppHandle) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM history", [])
        .map_err(|e| e.to_string())?;
    
    Ok(true)
}

// Settings commands
#[tauri::command]
pub async fn db_set_setting(
    app: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let value_str = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        rusqlite::params![key, value_str],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_get_setting(
    app: AppHandle,
    key: String,
    default_value: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let db_path = get_db_path(&app)?;
    
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?")
        .map_err(|e| e.to_string())?;
    
    let mut rows = stmt.query([&key])
        .map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let value_str: String = row.get(0).map_err(|e| e.to_string())?;
        serde_json::from_str(&value_str).map_err(|e| e.to_string())
    } else {
        Ok(default_value.unwrap_or(serde_json::Value::Null))
    }
}

#[tauri::command]
pub async fn db_get_all_settings(app: AppHandle) -> Result<HashMap<String, serde_json::Value>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    
    let settings = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|e| e.to_string())?;
    
    let mut result = HashMap::new();
    for setting in settings {
        let (key, value_str) = setting.map_err(|e| e.to_string())?;
        if let Ok(value) = serde_json::from_str(&value_str) {
            result.insert(key, value);
        }
    }
    
    Ok(result)
}

// Import/Export commands (simplified for now)
#[tauri::command]
pub async fn db_export_collections(
    app: AppHandle,
    collection_ids: Option<Vec<i64>>,
    format: String,
) -> Result<String, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let collections = if let Some(ids) = collection_ids {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!("SELECT * FROM collections WHERE id IN ({})", placeholders);
        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let collections_iter = stmt.query_map(params.as_slice(), |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                parent_id: row.get(5).ok(),
            })
        })
        .map_err(|e| e.to_string())?;
        
        collections_iter.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        let mut stmt = conn.prepare("SELECT * FROM collections").map_err(|e| e.to_string())?;
        let collections_iter = stmt.query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                parent_id: row.get(5).ok(),
            })
        })
        .map_err(|e| e.to_string())?;
        
        collections_iter.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    
    let export_data = serde_json::json!({
        "version": "1.0",
        "format": format,
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "collections": collections
    });
    
    serde_json::to_string_pretty(&export_data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_import_collections(
    _app: AppHandle,
    _import_data: String,
    _overwrite: bool,
) -> Result<ImportResult, String> {
    Ok(ImportResult {
        collections_imported: 0,
        requests_imported: 0,
        errors: vec!["Import functionality to be implemented".to_string()],
    })
}

// File operations
#[tauri::command]
pub async fn show_save_dialog(app: AppHandle, options: serde_json::Value) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    
    let mut dialog = app.dialog().file();
    
    if let Some(default_path) = options["defaultPath"].as_str() {
        let p = std::path::Path::new(default_path);
        if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            dialog = dialog.set_file_name(name);
        }
        if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            dialog = dialog.add_filter(
                match ext {
                    "html" => "HTML Files",
                    "json" => "JSON Files",
                    "csv" => "CSV Files",
                    _ => "Files",
                },
                &[ext],
            );
        }
    }
    
    let path = dialog.blocking_save_file();
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn show_open_dialog(app: AppHandle, _options: serde_json::Value) -> Result<Option<Vec<String>>, String> {
    use tauri_plugin_dialog::DialogExt;
    
    let dialog = app.dialog().file();
    
    let paths = dialog.blocking_pick_files();
    Ok(paths.map(|ps| ps.iter().map(|p| p.to_string()).collect()))
}

#[tauri::command]
pub async fn write_file(file_path: String, data: String) -> Result<serde_json::Value, String> {
    use std::fs;
    fs::write(&file_path, data).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"success": true}))
}

#[tauri::command]
pub async fn read_file(file_path: String) -> Result<serde_json::Value, String> {
    use std::fs;
    let data = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"success": true, "data": data}))
}

#[tauri::command]
pub async fn read_file_base64(file_path: String) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::fs;

    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let size = bytes.len();
    let encoded = STANDARD.encode(&bytes);
    let name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    Ok(serde_json::json!({
        "name": name,
        "size": size,
        "base64": encoded,
    }))
}

// Collection Variables commands
#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionVariable {
    pub id: i64,
    pub collection_id: i64,
    pub key: String,
    pub value: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn db_get_variables(app: AppHandle, collection_id: i64) -> Result<Vec<KeyValue>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT key, value FROM collection_variables WHERE collection_id = ? ORDER BY key ASC")
        .map_err(|e| e.to_string())?;
    
    let variables = stmt.query_map([collection_id], |row| {
        Ok(KeyValue {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    
    Ok(variables)
}

#[tauri::command]
pub async fn db_set_variable(
    app: AppHandle,
    collection_id: i64,
    key: String,
    value: String,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT OR REPLACE INTO collection_variables (collection_id, key, value, updated_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
        rusqlite::params![collection_id, key, value],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_delete_variable(
    app: AppHandle,
    collection_id: i64,
    key: String,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute(
        "DELETE FROM collection_variables WHERE collection_id = ? AND key = ?",
        rusqlite::params![collection_id, key],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[tauri::command]
pub async fn db_clear_variables(app: AppHandle, collection_id: i64) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;
    
    conn.execute(
        "DELETE FROM collection_variables WHERE collection_id = ?",
        [collection_id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(true)
}

// --- Cookie Jar Commands ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieRow {
    pub id: i64,
    pub collection_id: i64,
    pub domain: String,
    pub path: String,
    pub name: String,
    pub value: String,
    pub expires: Option<String>,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn db_get_cookies(
    app: AppHandle,
    collection_id: i64,
) -> Result<Vec<CookieRow>, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, collection_id, domain, path, name, value, expires, secure, http_only, same_site, created_at, updated_at
             FROM cookies WHERE collection_id = ? ORDER BY domain, path, name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([collection_id], |row| {
            Ok(CookieRow {
                id: row.get(0)?,
                collection_id: row.get(1)?,
                domain: row.get(2)?,
                path: row.get(3)?,
                name: row.get(4)?,
                value: row.get(5)?,
                expires: row.get(6)?,
                secure: row.get::<_, i32>(7)? != 0,
                http_only: row.get::<_, i32>(8)? != 0,
                same_site: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut cookies = Vec::new();
    for row in rows {
        cookies.push(row.map_err(|e| e.to_string())?);
    }
    Ok(cookies)
}

#[tauri::command]
pub async fn db_get_cookies_for_url(
    app: AppHandle,
    collection_id: i64,
    url: String,
) -> Result<Vec<CookieRow>, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let req_path = parsed.path();
    let is_secure = parsed.scheme() == "https";

    let all = db_get_cookies(app, collection_id).await?;

    let matching: Vec<CookieRow> = all
        .into_iter()
        .filter(|c| {
            let domain = c.domain.to_lowercase();
            let domain_match = if domain.starts_with('.') {
                host.ends_with(&domain) || host == domain.trim_start_matches('.')
            } else {
                host == domain
            };

            let path_match = req_path.starts_with(&c.path);
            let secure_ok = !c.secure || is_secure;

            if let Some(ref exp) = c.expires {
                if let Ok(exp_date) = chrono::DateTime::parse_from_rfc3339(exp) {
                    if exp_date < chrono::Utc::now() {
                        return false;
                    }
                }
            }

            domain_match && path_match && secure_ok
        })
        .collect();

    Ok(matching)
}

#[tauri::command]
pub async fn db_set_cookie(
    app: AppHandle,
    collection_id: i64,
    domain: String,
    path: String,
    name: String,
    value: String,
    expires: Option<String>,
    secure: bool,
    http_only: bool,
    same_site: Option<String>,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO cookies (collection_id, domain, path, name, value, expires, secure, http_only, same_site, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(collection_id, domain, path, name) DO UPDATE SET
           value = excluded.value,
           expires = excluded.expires,
           secure = excluded.secure,
           http_only = excluded.http_only,
           same_site = excluded.same_site,
           updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![
            collection_id,
            domain,
            path,
            name,
            value,
            expires,
            secure as i32,
            http_only as i32,
            same_site.unwrap_or_else(|| "Lax".to_string()),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn db_delete_cookie(
    app: AppHandle,
    collection_id: i64,
    cookie_id: i64,
) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM cookies WHERE id = ? AND collection_id = ?",
        rusqlite::params![cookie_id, collection_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn db_clear_cookies(app: AppHandle, collection_id: i64) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM cookies WHERE collection_id = ?", [collection_id])
        .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn db_clear_all_cookies(app: AppHandle) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM cookies", [])
        .map_err(|e| e.to_string())?;

    Ok(true)
}
