use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlQueryResult {
    pub columns: Vec<SqlColumn>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    #[serde(rename = "rowCount")]
    pub row_count: usize,
    #[serde(rename = "executionTimeMs")]
    pub execution_time_ms: u128,
    #[serde(rename = "isSelect")]
    pub is_select: bool,
    #[serde(rename = "affectedRows")]
    pub affected_rows: Option<u64>,
}

enum SqlConnection {
    Postgres(tokio_postgres::Client),
    Mysql(mysql_async::Conn),
    Sqlite(rusqlite::Connection),
}

lazy_static::lazy_static! {
    static ref CONNECTIONS: Arc<Mutex<HashMap<String, SqlConnection>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

fn is_select_query(sql: &str) -> bool {
    let trimmed = sql.trim();
    let upper = trimmed.to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("WITH")
        || upper.starts_with("EXPLAIN")
        || upper.starts_with("SHOW")
        || upper.starts_with("DESCRIBE")
        || upper.starts_with("PRAGMA")
}

#[tauri::command]
pub async fn sql_connect(
    db_type: String,
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
) -> Result<String, String> {
    let conn_id = uuid::Uuid::new_v4().to_string();

    match db_type.as_str() {
        "postgres" => {
            let conn_str = format!(
                "host={} port={} dbname={} user={} password={}",
                host, port, database, username, password
            );
            let (client, connection) =
                tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)
                    .await
                    .map_err(|e| format!("Connection refused: {}", e))?;

            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    eprintln!("Postgres connection error: {}", e);
                }
            });

            let mut conns = CONNECTIONS.lock().await;
            conns.insert(conn_id.clone(), SqlConnection::Postgres(client));
        }
        "mysql" => {
            let opts = mysql_async::OptsBuilder::default()
                .ip_or_hostname(host)
                .tcp_port(port)
                .db_name(Some(database))
                .user(Some(username))
                .pass(Some(password));

            let pool = mysql_async::Pool::new(opts);
            let conn = pool
                .get_conn()
                .await
                .map_err(|e| format!("Connection refused: {}", e))?;

            let mut conns = CONNECTIONS.lock().await;
            conns.insert(conn_id.clone(), SqlConnection::Mysql(conn));
        }
        "sqlite" => {
            let conn = rusqlite::Connection::open(&database)
                .map_err(|e| format!("Failed to open SQLite database: {}", e))?;

            let mut conns = CONNECTIONS.lock().await;
            conns.insert(conn_id.clone(), SqlConnection::Sqlite(conn));
        }
        _ => return Err(format!("Unsupported database type: {}", db_type)),
    }

    Ok(conn_id)
}

#[tauri::command]
pub async fn sql_query(
    connection_id: String,
    sql: String,
) -> Result<SqlQueryResult, String> {
    let mut conns = CONNECTIONS.lock().await;
    let conn = conns
        .get_mut(&connection_id)
        .ok_or_else(|| format!("No active connection for id: {}", connection_id))?;

    let start = std::time::Instant::now();
    let is_select = is_select_query(&sql);

    match conn {
        SqlConnection::Postgres(client) => {
            if is_select {
                let rows = client
                    .query(&sql as &str, &[])
                    .await
                    .map_err(|e| format!("ERROR: {}", e))?;

                let columns: Vec<SqlColumn> = if let Some(first) = rows.first() {
                    first
                        .columns()
                        .iter()
                        .map(|c| SqlColumn {
                            name: c.name().to_string(),
                            col_type: c.type_().name().to_string(),
                        })
                        .collect()
                } else {
                    vec![]
                };

                let result_rows: Vec<HashMap<String, serde_json::Value>> = rows
                    .iter()
                    .map(|row| {
                        let mut map = HashMap::new();
                        for (i, col) in row.columns().iter().enumerate() {
                            let val = pg_value_to_json(row, i, col.type_());
                            map.insert(col.name().to_string(), val);
                        }
                        map
                    })
                    .collect();

                let row_count = result_rows.len();
                Ok(SqlQueryResult {
                    columns,
                    rows: result_rows,
                    row_count,
                    execution_time_ms: start.elapsed().as_millis(),
                    is_select: true,
                    affected_rows: None,
                })
            } else {
                let affected = client
                    .execute(&sql as &str, &[])
                    .await
                    .map_err(|e| format!("ERROR: {}", e))?;

                Ok(SqlQueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms: start.elapsed().as_millis(),
                    is_select: false,
                    affected_rows: Some(affected),
                })
            }
        }
        SqlConnection::Mysql(conn) => {
            use mysql_async::prelude::*;

            if is_select {
                let rows: Vec<mysql_async::Row> = conn
                    .query(&sql)
                    .await
                    .map_err(|e| format!("ERROR: {}", e))?;

                let columns: Vec<SqlColumn> = if let Some(first) = rows.first() {
                    first
                        .columns_ref()
                        .iter()
                        .map(|c| SqlColumn {
                            name: c.name_str().to_string(),
                            col_type: format!("{:?}", c.column_type()),
                        })
                        .collect()
                } else {
                    vec![]
                };

                let result_rows: Vec<HashMap<String, serde_json::Value>> = rows
                    .iter()
                    .map(|row| {
                        let mut map = HashMap::new();
                        for (i, col) in row.columns_ref().iter().enumerate() {
                            let val = mysql_value_to_json(row, i);
                            map.insert(col.name_str().to_string(), val);
                        }
                        map
                    })
                    .collect();

                let row_count = result_rows.len();
                Ok(SqlQueryResult {
                    columns,
                    rows: result_rows,
                    row_count,
                    execution_time_ms: start.elapsed().as_millis(),
                    is_select: true,
                    affected_rows: None,
                })
            } else {
                let result: Vec<mysql_async::Row> = conn
                    .query(&sql)
                    .await
                    .map_err(|e| format!("ERROR: {}", e))?;

                Ok(SqlQueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms: start.elapsed().as_millis(),
                    is_select: false,
                    affected_rows: Some(result.len() as u64),
                })
            }
        }
        SqlConnection::Sqlite(conn) => {
            if is_select {
                let mut stmt = conn.prepare(&sql).map_err(|e| format!("ERROR: {}", e))?;
                let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
                let columns: Vec<SqlColumn> = col_names
                    .iter()
                    .map(|name| SqlColumn {
                        name: name.clone(),
                        col_type: "text".to_string(),
                    })
                    .collect();

                let result_rows: Vec<HashMap<String, serde_json::Value>> = stmt
                    .query_map([], |row| {
                        let mut map = HashMap::new();
                        for (i, name) in col_names.iter().enumerate() {
                            let val: rusqlite::types::Value = row.get_unwrap(i);
                            let json_val = match val {
                                rusqlite::types::Value::Null => serde_json::Value::Null,
                                rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                                rusqlite::types::Value::Real(f) => serde_json::json!(f),
                                rusqlite::types::Value::Text(s) => serde_json::json!(s),
                                rusqlite::types::Value::Blob(b) => {
                                    serde_json::json!(format!("[blob {} bytes]", b.len()))
                                }
                            };
                            map.insert(name.clone(), json_val);
                        }
                        Ok(map)
                    })
                    .map_err(|e| format!("ERROR: {}", e))?
                    .filter_map(|r| r.ok())
                    .collect();

                let row_count = result_rows.len();
                Ok(SqlQueryResult {
                    columns,
                    rows: result_rows,
                    row_count,
                    execution_time_ms: start.elapsed().as_millis(),
                    is_select: true,
                    affected_rows: None,
                })
            } else {
                let affected = conn
                    .execute(&sql, [])
                    .map_err(|e| format!("ERROR: {}", e))?;

                Ok(SqlQueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms: start.elapsed().as_millis(),
                    is_select: false,
                    affected_rows: Some(affected as u64),
                })
            }
        }
    }
}

#[tauri::command]
pub async fn sql_disconnect(connection_id: String) -> Result<(), String> {
    let mut conns = CONNECTIONS.lock().await;
    conns
        .remove(&connection_id)
        .ok_or_else(|| format!("No active connection for id: {}", connection_id))?;
    Ok(())
}

/// Decode one Postgres column cell into JSON.
///
/// Three principles, learned the hard way:
///
/// 1. A genuine SQL NULL is the only thing that should become `null`. A
///    `try_get` *error* (wrong Rust target type for the column's pg type)
///    historically also became `null`, which silently lost data for
///    `numeric`, `timestamptz`, arrays, etc. We separate the two: SQL NULL
///    is checked explicitly via `try_get::<Option<_>>`, and decode failures
///    surface as a visible `[unsupported pg type: <name>]` string instead
///    of pretending the value was missing.
///
/// 2. `numeric` must be decoded via `rust_decimal::Decimal` and then
///    converted to a JSON number. The previous `try_get::<f64>` only works
///    with `tokio-postgres`'s `with-rust_decimal-*` feature implementing
///    that FromSql; without it every `AVG`/`SUM(bigint)`/`ROUND(numeric)`
///    column came back NULL.
///
/// 3. Anything we can't cleanly turn into a JSON primitive (arrays,
///    intervals, ranges, custom types) is stringified via `try_get::<String>`
///    if Postgres can text-cast it, otherwise the unsupported-type marker.
///    Better to show the user a string than silently drop the cell.
fn pg_value_to_json(
    row: &tokio_postgres::Row,
    idx: usize,
    pg_type: &tokio_postgres::types::Type,
) -> serde_json::Value {
    use tokio_postgres::types::Type;

    macro_rules! get_or_marker {
        ($T:ty, $map:expr) => {
            match row.try_get::<_, Option<$T>>(idx) {
                Ok(Some(v)) => $map(v),
                Ok(None) => serde_json::Value::Null,
                Err(_) => serde_json::Value::String(format!(
                    "[decode error: {} as {}]",
                    pg_type.name(),
                    stringify!($T)
                )),
            }
        };
    }

    match *pg_type {
        Type::BOOL => get_or_marker!(bool, |v| serde_json::Value::Bool(v)),
        Type::INT2 => get_or_marker!(i16, |v| serde_json::json!(v)),
        Type::INT4 => get_or_marker!(i32, |v| serde_json::json!(v)),
        Type::INT8 => get_or_marker!(i64, |v| serde_json::json!(v)),
        Type::FLOAT4 => get_or_marker!(f32, |v| serde_json::json!(v)),
        Type::FLOAT8 => get_or_marker!(f64, |v| serde_json::json!(v)),
        Type::NUMERIC => {
            // rust_decimal preserves arbitrary precision. Convert to f64 for
            // JSON because serde_json::Number doesn't accept Decimal directly,
            // and the frontend renders numbers anyway. If precision matters
            // beyond f64 the user can `::text` the column to get the exact
            // string representation.
            match row.try_get::<_, Option<rust_decimal::Decimal>>(idx) {
                Ok(Some(d)) => {
                    use std::str::FromStr;
                    serde_json::Number::from_str(&d.to_string())
                        .map(serde_json::Value::Number)
                        .unwrap_or_else(|_| serde_json::Value::String(d.to_string()))
                }
                Ok(None) => serde_json::Value::Null,
                Err(_) => serde_json::Value::String(format!(
                    "[decode error: {} as Decimal]",
                    pg_type.name()
                )),
            }
        }
        Type::JSON | Type::JSONB => match row.try_get::<_, Option<serde_json::Value>>(idx) {
            Ok(Some(v)) => v,
            Ok(None) => serde_json::Value::Null,
            Err(_) => serde_json::Value::String(format!(
                "[decode error: {}]",
                pg_type.name()
            )),
        },
        Type::UUID => get_or_marker!(uuid::Uuid, |v: uuid::Uuid| serde_json::json!(v.to_string())),
        Type::TIMESTAMP => get_or_marker!(chrono::NaiveDateTime, |v: chrono::NaiveDateTime| {
            serde_json::json!(v.format("%Y-%m-%d %H:%M:%S%.f").to_string())
        }),
        Type::TIMESTAMPTZ => {
            get_or_marker!(chrono::DateTime<chrono::Utc>, |v: chrono::DateTime<chrono::Utc>| {
                serde_json::json!(v.to_rfc3339())
            })
        }
        Type::DATE => get_or_marker!(chrono::NaiveDate, |v: chrono::NaiveDate| {
            serde_json::json!(v.format("%Y-%m-%d").to_string())
        }),
        Type::TIME => get_or_marker!(chrono::NaiveTime, |v: chrono::NaiveTime| {
            serde_json::json!(v.format("%H:%M:%S%.f").to_string())
        }),
        Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME => {
            get_or_marker!(String, |v| serde_json::Value::String(v))
        }
        Type::BYTEA => match row.try_get::<_, Option<Vec<u8>>>(idx) {
            Ok(Some(b)) => serde_json::Value::String(format!("[bytea {} bytes]", b.len())),
            Ok(None) => serde_json::Value::Null,
            Err(_) => serde_json::Value::String("[decode error: bytea]".to_string()),
        },
        _ => {
            // Catch-all: try a textual decode first (works for many types
            // Postgres can implicitly cast). If that fails, surface the
            // unsupported type by name so the user knows to add an arm —
            // never silently swallow it as NULL.
            match row.try_get::<_, Option<String>>(idx) {
                Ok(Some(s)) => serde_json::Value::String(s),
                Ok(None) => serde_json::Value::Null,
                Err(_) => serde_json::Value::String(format!(
                    "[unsupported pg type: {}]",
                    pg_type.name()
                )),
            }
        }
    }
}

fn mysql_value_to_json(row: &mysql_async::Row, idx: usize) -> serde_json::Value {
    use mysql_async::Value;

    match row.as_ref(idx) {
        Some(Value::NULL) | None => serde_json::Value::Null,
        Some(Value::Int(n)) => serde_json::json!(n),
        Some(Value::UInt(n)) => serde_json::json!(n),
        Some(Value::Float(f)) => serde_json::json!(f),
        Some(Value::Double(d)) => serde_json::json!(d),
        Some(Value::Bytes(b)) => {
            String::from_utf8(b.clone())
                .map(|s| serde_json::json!(s))
                .unwrap_or_else(|_| serde_json::json!(format!("[blob {} bytes]", b.len())))
        }
        Some(Value::Date(y, m, d, h, mi, s, _us)) => {
            serde_json::json!(format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, h, mi, s))
        }
        Some(Value::Time(neg, d, h, mi, s, _us)) => {
            let sign = if *neg { "-" } else { "" };
            let hours = d * 24 + (*h as u32);
            serde_json::json!(format!("{}{}:{:02}:{:02}", sign, hours, mi, s))
        }
    }
}

// ─────────────────────────── Query history ───────────────────────────
//
// History rows live in `ripple.db` (the app's local SQLite), in the
// `sql_query_history` table created by migration 8. Entries are bucketed
// by a `profile_key` so each saved SQL connection (db type + host + port +
// database + username) has its own list — switching connections in the
// UI gives the user the history of *that* connection, not a merged
// soup. An LRU cap (`HISTORY_CAP_PER_PROFILE`) keeps the table from
// growing unbounded for power users.

const HISTORY_CAP_PER_PROFILE: i64 = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlHistoryEntry {
    pub id: i64,
    pub sql: String,
    #[serde(rename = "executionTimeMs")]
    pub execution_time_ms: i64,
    #[serde(rename = "rowCount")]
    pub row_count: i64,
    pub error: Option<String>,
    #[serde(rename = "executedAt")]
    pub executed_at: i64,
}

fn ripple_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ripple.db"))
}

fn open_ripple_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(ripple_db_path(app)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sql_history_add(
    app: AppHandle,
    profile_key: String,
    db_type: String,
    sql: String,
    execution_time_ms: i64,
    row_count: i64,
    error: Option<String>,
) -> Result<i64, String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let conn = open_ripple_db(&app)?;
    conn.execute(
        "INSERT INTO sql_query_history
         (profile_key, db_type, sql, execution_time_ms, row_count, error, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![profile_key, db_type, sql, execution_time_ms, row_count, error, now_ms],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    // Trim oldest entries beyond the per-profile cap. SQLite has no
    // built-in capped sequence so we delete by id-not-in-top-N.
    conn.execute(
        "DELETE FROM sql_query_history
         WHERE profile_key = ?
           AND id NOT IN (
               SELECT id FROM sql_query_history
               WHERE profile_key = ?
               ORDER BY executed_at DESC
               LIMIT ?
           )",
        rusqlite::params![profile_key, profile_key, HISTORY_CAP_PER_PROFILE],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub async fn sql_history_list(
    app: AppHandle,
    profile_key: String,
    limit: Option<i64>,
) -> Result<Vec<SqlHistoryEntry>, String> {
    let conn = open_ripple_db(&app)?;
    let limit = limit.unwrap_or(HISTORY_CAP_PER_PROFILE).max(1);

    let mut stmt = conn
        .prepare(
            "SELECT id, sql, execution_time_ms, row_count, error, executed_at
             FROM sql_query_history
             WHERE profile_key = ?
             ORDER BY executed_at DESC
             LIMIT ?",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![profile_key, limit], |row| {
            Ok(SqlHistoryEntry {
                id: row.get(0)?,
                sql: row.get(1)?,
                execution_time_ms: row.get(2)?,
                row_count: row.get(3)?,
                error: row.get(4)?,
                executed_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn sql_history_clear(
    app: AppHandle,
    profile_key: String,
) -> Result<(), String> {
    let conn = open_ripple_db(&app)?;
    conn.execute(
        "DELETE FROM sql_query_history WHERE profile_key = ?",
        rusqlite::params![profile_key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn sql_history_delete(
    app: AppHandle,
    id: i64,
) -> Result<(), String> {
    let conn = open_ripple_db(&app)?;
    conn.execute(
        "DELETE FROM sql_query_history WHERE id = ?",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
