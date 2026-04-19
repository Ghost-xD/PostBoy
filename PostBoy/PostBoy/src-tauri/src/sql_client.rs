use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
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

fn pg_value_to_json(
    row: &tokio_postgres::Row,
    idx: usize,
    pg_type: &tokio_postgres::types::Type,
) -> serde_json::Value {
    use tokio_postgres::types::Type;

    match *pg_type {
        Type::BOOL => row
            .try_get::<_, bool>(idx)
            .ok()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),
        Type::INT2 => row
            .try_get::<_, i16>(idx)
            .ok()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
        Type::INT4 => row
            .try_get::<_, i32>(idx)
            .ok()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
        Type::INT8 => row
            .try_get::<_, i64>(idx)
            .ok()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
        Type::FLOAT4 => row
            .try_get::<_, f32>(idx)
            .ok()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
        Type::FLOAT8 | Type::NUMERIC => row
            .try_get::<_, f64>(idx)
            .ok()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
        Type::JSON | Type::JSONB => row
            .try_get::<_, serde_json::Value>(idx)
            .ok()
            .unwrap_or(serde_json::Value::Null),
        _ => row
            .try_get::<_, String>(idx)
            .ok()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
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
