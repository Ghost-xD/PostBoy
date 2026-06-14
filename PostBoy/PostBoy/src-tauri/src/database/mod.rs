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
        Migration {
            version: 10,
            description: "create_mcp_servers",
            sql: "
                CREATE TABLE IF NOT EXISTS mcp_servers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    transport TEXT NOT NULL CHECK (transport IN ('stdio','remote')),
                    command TEXT,
                    args_json TEXT,
                    env_json TEXT,
                    cwd TEXT,
                    url TEXT,
                    headers_json TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    tool_overrides_json TEXT NOT NULL DEFAULT '{}',
                    oauth_meta_json TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled
                    ON mcp_servers(enabled);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "repair_null_request_fields_and_remove_test_fixtures",
            sql: "
                UPDATE requests SET headers = '[]' WHERE headers IS NULL;
                UPDATE requests SET params = '[]' WHERE params IS NULL;
                UPDATE requests SET body_type = 'none' WHERE body_type IS NULL;
                UPDATE requests SET body_content = '' WHERE body_content IS NULL;
                UPDATE requests SET auth_type = 'none' WHERE auth_type IS NULL;
                UPDATE requests SET auth_data = '{}' WHERE auth_data IS NULL;
                UPDATE requests SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
                UPDATE requests SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;
                DELETE FROM collections WHERE name IN (
                    'Test Collection',
                    'Read Test',
                    'Updated Name',
                    'Request Test Collection',
                    'Timestamp Test'
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "create_request_examples_table",
            sql: "
                CREATE TABLE IF NOT EXISTS request_examples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    status_code INTEGER,
                    response_time INTEGER,
                    response_headers TEXT,
                    response_body TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_request_examples_request
                    ON request_examples(request_id, created_at DESC);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "create_environments_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS environments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS environment_variables (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    environment_id INTEGER NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL DEFAULT '',
                    initial_value TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
                    UNIQUE(environment_id, key)
                );

                CREATE INDEX IF NOT EXISTS idx_environment_variables_env
                    ON environment_variables(environment_id, key);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "create_global_variables_table",
            sql: "
                CREATE TABLE IF NOT EXISTS global_variables (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add_secret_variable_support",
            sql: "
        ALTER TABLE environment_variables 
        ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
    ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add_secret_global_variable_support",
            sql: "
        ALTER TABLE global_variables 
        ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
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
        (10, "create_mcp_servers", "
            CREATE TABLE IF NOT EXISTS mcp_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                transport TEXT NOT NULL CHECK (transport IN ('stdio','remote')),
                command TEXT,
                args_json TEXT,
                env_json TEXT,
                cwd TEXT,
                url TEXT,
                headers_json TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                tool_overrides_json TEXT NOT NULL DEFAULT '{}',
                oauth_meta_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled
                ON mcp_servers(enabled);
        "),
        (11, "repair_null_request_fields_and_remove_test_fixtures", "
            UPDATE requests SET headers = '[]' WHERE headers IS NULL;
            UPDATE requests SET params = '[]' WHERE params IS NULL;
            UPDATE requests SET body_type = 'none' WHERE body_type IS NULL;
            UPDATE requests SET body_content = '' WHERE body_content IS NULL;
            UPDATE requests SET auth_type = 'none' WHERE auth_type IS NULL;
            UPDATE requests SET auth_data = '{}' WHERE auth_data IS NULL;
            UPDATE requests SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
            UPDATE requests SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;
            DELETE FROM collections WHERE name IN (
                'Test Collection',
                'Read Test',
                'Updated Name',
                'Request Test Collection',
                'Timestamp Test'
            );
        "),
        (12, "create_request_examples_table", "
            CREATE TABLE IF NOT EXISTS request_examples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                status_code INTEGER,
                response_time INTEGER,
                response_headers TEXT,
                response_body TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_request_examples_request
                ON request_examples(request_id, created_at DESC);
        "),
        (13, "create_environments_tables", "
            CREATE TABLE IF NOT EXISTS environments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS environment_variables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                environment_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL DEFAULT '',
                initial_value TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
                UNIQUE(environment_id, key)
            );

            CREATE INDEX IF NOT EXISTS idx_environment_variables_env
                ON environment_variables(environment_id, key);
        "),
        (14, "create_global_variables_table", "
            CREATE TABLE IF NOT EXISTS global_variables (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        "),
        (15, "add_secret_variable_support", "
            ALTER TABLE environment_variables 
            ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
        "),
        (16, "add_secret_global_variable_support", "
            ALTER TABLE global_variables 
            ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::Path;
    use tempfile::NamedTempFile;

    fn setup_database_at_version(db_path: &Path, target_version: i64) {
        let conn = Connection::open(db_path).expect("open database");
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _migrations (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .expect("create migrations table");

        for migration in get_migrations() {
            if migration.version > target_version {
                break;
            }
            conn.execute_batch(&migration.sql)
                .unwrap_or_else(|e| {
                    panic!(
                        "failed to apply migration {} ({}): {}",
                        migration.version, migration.description, e
                    )
                });
            conn.execute(
                "INSERT INTO _migrations (version, description) VALUES (?, ?)",
                rusqlite::params![migration.version, migration.description],
            )
            .expect("record migration");
        }
    }

    fn migration_version(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _migrations",
            [],
            |row| row.get(0),
        )
        .expect("query migration version")
    }

    fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
        let sql = format!("PRAGMA table_info({})", table);
        let mut stmt = conn.prepare(&sql).expect("prepare pragma");
        let column_names: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query columns")
            .filter_map(Result::ok)
            .collect();
        column_names.iter().any(|name| name == column)
    }

    #[test]
    fn get_migrations_includes_secret_variable_support() {
        let migrations = get_migrations();
        let secret_migration = migrations
            .iter()
            .find(|m| m.version == 15)
            .expect("migration version 15 should exist");

        assert_eq!(
            secret_migration.description, "add_secret_variable_support",
            "migration 15 should add secret variable support"
        );
        assert!(
            secret_migration.sql.contains("is_secret"),
            "migration 15 SQL should add is_secret column"
        );

        let versions: Vec<i64> = migrations.iter().map(|m| m.version).collect();
        for expected in 1..=15 {
            assert!(
                versions.contains(&expected),
                "missing migration version {}",
                expected
            );
        }
    }

    #[test]
    fn initialize_database_applies_full_migration_chain_on_fresh_db() {
        let db_file = NamedTempFile::new().expect("create temp db");
        let db_path = db_file.path().to_path_buf();

        initialize_database(db_path.clone()).expect("initialize fresh database");

        let conn = Connection::open(&db_path).expect("reopen database");
        assert_eq!(migration_version(&conn), 15);
        assert!(has_column(&conn, "environment_variables", "is_secret"));
    }

    #[test]
    fn initialize_database_upgrades_v14_db_and_defaults_is_secret_to_zero() {
        let db_file = NamedTempFile::new().expect("create temp db");
        let db_path = db_file.path();

        setup_database_at_version(db_path, 14);

        {
            let conn = Connection::open(db_path).expect("open v14 database");
            assert_eq!(migration_version(&conn), 14);
            assert!(!has_column(&conn, "environment_variables", "is_secret"));

            conn.execute(
                "INSERT INTO environments (name) VALUES ('Test Env')",
                [],
            )
            .expect("insert environment");
            let env_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO environment_variables (environment_id, key, value, initial_value, enabled)
                 VALUES (?, 'apiKey', 'secret-value', 'secret-value', 1)",
                rusqlite::params![env_id],
            )
            .expect("insert environment variable");
        }

        initialize_database(db_path.to_path_buf()).expect("upgrade database to v15");

        let conn = Connection::open(db_path).expect("reopen upgraded database");
        assert_eq!(migration_version(&conn), 15);
        assert!(has_column(&conn, "environment_variables", "is_secret"));

        let is_secret: i64 = conn
            .query_row(
                "SELECT is_secret FROM environment_variables WHERE key = 'apiKey'",
                [],
                |row| row.get(0),
            )
            .expect("query is_secret for existing row");
        assert_eq!(is_secret, 0, "existing rows should default is_secret to 0");
    }
}
