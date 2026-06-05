use tauri_plugin_sql::{Migration, MigrationKind};
use rusqlite::Connection;
use std::path::PathBuf;

pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS collections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    collection_id INTEGER,
                    name TEXT NOT NULL,
                    method TEXT NOT NULL,
                    url TEXT NOT NULL,
                    headers TEXT,
                    params TEXT,
                    body_type TEXT,
                    body_content TEXT,
                    auth_type TEXT,
                    auth_data TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    method TEXT NOT NULL,
                    url TEXT NOT NULL,
                    status_code INTEGER,
                    response_time INTEGER,
                    headers TEXT,
                    params TEXT,
                    body_type TEXT,
                    body_content TEXT,
                    auth_type TEXT,
                    auth_data TEXT,
                    response_headers TEXT,
                    response_body TEXT,
                    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_default_values_to_text_columns",
            sql: "
                -- Update existing NULL values to empty defaults
                UPDATE collections SET description = '' WHERE description IS NULL;
                UPDATE requests SET headers = '[]' WHERE headers IS NULL;
                UPDATE requests SET params = '[]' WHERE params IS NULL;
                UPDATE requests SET body_type = 'none' WHERE body_type IS NULL;
                UPDATE requests SET body_content = '' WHERE body_content IS NULL;
                UPDATE requests SET auth_type = 'none' WHERE auth_type IS NULL;
                UPDATE requests SET auth_data = '{}' WHERE auth_data IS NULL;
                UPDATE history SET headers = '{}' WHERE headers IS NULL;
                UPDATE history SET params = '[]' WHERE params IS NULL;
                UPDATE history SET body_type = 'none' WHERE body_type IS NULL;
                UPDATE history SET body_content = '' WHERE body_content IS NULL;
                UPDATE history SET auth_type = 'none' WHERE auth_type IS NULL;
                UPDATE history SET auth_data = '{}' WHERE auth_data IS NULL;
                UPDATE history SET response_headers = '{}' WHERE response_headers IS NULL;
                UPDATE history SET response_body = '' WHERE response_body IS NULL;
                UPDATE settings SET value = '' WHERE value IS NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_collection_variables_table",
            sql: "
                CREATE TABLE IF NOT EXISTS collection_variables (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    collection_id INTEGER NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                    UNIQUE(collection_id, key)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_sort_order_and_parent_id",
            sql: "
                ALTER TABLE requests ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE collections ADD COLUMN parent_id INTEGER REFERENCES collections(id) ON DELETE CASCADE;
                ALTER TABLE collections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_request_description",
            sql: "ALTER TABLE requests ADD COLUMN description TEXT DEFAULT '';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_cookies_table",
            sql: "
                CREATE TABLE IF NOT EXISTS cookies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    collection_id INTEGER NOT NULL,
                    domain TEXT NOT NULL,
                    path TEXT NOT NULL DEFAULT '/',
                    name TEXT NOT NULL,
                    value TEXT NOT NULL DEFAULT '',
                    expires TEXT,
                    secure INTEGER NOT NULL DEFAULT 0,
                    http_only INTEGER NOT NULL DEFAULT 0,
                    same_site TEXT DEFAULT 'Lax',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                    UNIQUE(collection_id, domain, path, name)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_chat_history",
            sql: "
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL DEFAULT 'New chat',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    ts INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "create_sql_query_history",
            sql: "
                CREATE TABLE IF NOT EXISTS sql_query_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_key TEXT NOT NULL,
                    db_type TEXT NOT NULL,
                    sql TEXT NOT NULL,
                    execution_time_ms INTEGER NOT NULL DEFAULT 0,
                    row_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    executed_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_sql_history_profile_time
                    ON sql_query_history(profile_key, executed_at DESC);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_response_columns_to_requests",
            sql: "
                ALTER TABLE requests ADD COLUMN status_code INTEGER;
                ALTER TABLE requests ADD COLUMN response_time INTEGER;
                ALTER TABLE requests ADD COLUMN response_headers TEXT;
                ALTER TABLE requests ADD COLUMN response_body TEXT;
            ",
            kind: MigrationKind::Up,
        },
    ]
}

/// Initialize database with migrations using rusqlite directly
pub fn initialize_database(db_path: PathBuf) -> Result<(), String> {
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    // Create migrations table if it doesn't exist
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| format!("Failed to create migrations table: {}", e))?;

    // Get current migration version
    let current_version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM _migrations", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    println!("Current database version: {}", current_version);

    // Run migrations
    let migrations = vec![
        (1, "create_initial_tables", "
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER,
                name TEXT NOT NULL,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                headers TEXT,
                params TEXT,
                body_type TEXT,
                body_content TEXT,
                auth_type TEXT,
                auth_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                status_code INTEGER,
                response_time INTEGER,
                headers TEXT,
                params TEXT,
                body_type TEXT,
                body_content TEXT,
                auth_type TEXT,
                auth_data TEXT,
                response_headers TEXT,
                response_body TEXT,
                executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        "),
        (2, "add_default_values_to_text_columns", "
            UPDATE collections SET description = '' WHERE description IS NULL;
            UPDATE requests SET headers = '[]' WHERE headers IS NULL;
            UPDATE requests SET params = '[]' WHERE params IS NULL;
            UPDATE requests SET body_type = 'none' WHERE body_type IS NULL;
            UPDATE requests SET body_content = '' WHERE body_content IS NULL;
            UPDATE requests SET auth_type = 'none' WHERE auth_type IS NULL;
            UPDATE requests SET auth_data = '{}' WHERE auth_data IS NULL;
            UPDATE history SET headers = '{}' WHERE headers IS NULL;
            UPDATE history SET params = '[]' WHERE params IS NULL;
            UPDATE history SET body_type = 'none' WHERE body_type IS NULL;
            UPDATE history SET body_content = '' WHERE body_content IS NULL;
            UPDATE history SET auth_type = 'none' WHERE auth_type IS NULL;
            UPDATE history SET auth_data = '{}' WHERE auth_data IS NULL;
            UPDATE history SET response_headers = '{}' WHERE response_headers IS NULL;
            UPDATE history SET response_body = '' WHERE response_body IS NULL;
            UPDATE settings SET value = '' WHERE value IS NULL;
        "),
        (3, "create_collection_variables_table", "
            CREATE TABLE IF NOT EXISTS collection_variables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                UNIQUE(collection_id, key)
            );
        "),
        (4, "add_sort_order_and_parent_id", "
            ALTER TABLE requests ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE collections ADD COLUMN parent_id INTEGER REFERENCES collections(id) ON DELETE CASCADE;
            ALTER TABLE collections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        "),
        (5, "add_request_description", "
            ALTER TABLE requests ADD COLUMN description TEXT DEFAULT '';
        "),
        (6, "create_cookies_table", "
            CREATE TABLE IF NOT EXISTS cookies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                domain TEXT NOT NULL,
                path TEXT NOT NULL DEFAULT '/',
                name TEXT NOT NULL,
                value TEXT NOT NULL DEFAULT '',
                expires TEXT,
                secure INTEGER NOT NULL DEFAULT 0,
                http_only INTEGER NOT NULL DEFAULT 0,
                same_site TEXT DEFAULT 'Lax',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                UNIQUE(collection_id, domain, path, name)
            );
        "),
        (7, "create_chat_history", "
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT 'New chat',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                ts INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
        "),
        (8, "create_sql_query_history", "
            CREATE TABLE IF NOT EXISTS sql_query_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_key TEXT NOT NULL,
                db_type TEXT NOT NULL,
                sql TEXT NOT NULL,
                execution_time_ms INTEGER NOT NULL DEFAULT 0,
                row_count INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                executed_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sql_history_profile_time
                ON sql_query_history(profile_key, executed_at DESC);
        "),
        (9, "add_response_columns_to_requests", "
            ALTER TABLE requests ADD COLUMN status_code INTEGER;
            ALTER TABLE requests ADD COLUMN response_time INTEGER;
            ALTER TABLE requests ADD COLUMN response_headers TEXT;
            ALTER TABLE requests ADD COLUMN response_body TEXT;
        "),
    ];

    for (version, description, sql) in migrations {
        if version > current_version {
            println!("Running migration {}: {}", version, description);
            
            conn.execute_batch(sql)
                .map_err(|e| format!("Failed to run migration {}: {}", version, e))?;

            conn.execute(
                "INSERT INTO _migrations (version, description) VALUES (?, ?)",
                rusqlite::params![version, description],
            )
            .map_err(|e| format!("Failed to record migration {}: {}", version, e))?;

            println!("Migration {} completed successfully", version);
        }
    }

    println!("Database initialization complete");
    Ok(())
}
