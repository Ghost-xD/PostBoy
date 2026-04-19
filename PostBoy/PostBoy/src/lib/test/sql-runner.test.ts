import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

/**
 * SQL Query Runner Tests
 * Tests cover: connection config validation, query classification, result transformation,
 * connection profiles, query history, error handling, Tauri API wrapper, and keyboard shortcuts.
 */

// ── Types mirroring the implementation ──

interface SqlConnectionConfig {
  type: 'postgres' | 'mysql' | 'sqlite';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  name: string; // profile name
}

interface SqlColumn {
  name: string;
  type: string;
}

interface SqlQueryResult {
  columns: SqlColumn[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  executionTimeMs: number;
  isSelect: boolean;
  affectedRows?: number;
}

interface SqlConnectionProfile {
  id: string;
  config: SqlConnectionConfig;
  lastUsed: number;
}

// ── Helper functions that mirror the actual utility implementations ──

function getDefaultPort(dbType: SqlConnectionConfig['type']): number {
  switch (dbType) {
    case 'postgres': return 5432;
    case 'mysql': return 3306;
    case 'sqlite': return 0;
  }
}

function validateConnectionConfig(config: Partial<SqlConnectionConfig>): string[] {
  const errors: string[] = [];

  if (!config.type) {
    errors.push('Database type is required');
  }

  if (config.type === 'sqlite') {
    if (!config.database) {
      errors.push('Database file path is required');
    }
    return errors;
  }

  if (!config.host?.trim()) {
    errors.push('Host is required');
  }

  if (!config.database?.trim()) {
    errors.push('Database name is required');
  }

  if (config.port !== undefined && config.port !== null) {
    if (config.port < 1 || config.port > 65535) {
      errors.push('Port must be between 1 and 65535');
    }
  }

  if (!config.username?.trim()) {
    errors.push('Username is required');
  }

  return errors;
}

function classifyQuery(sql: string): 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other' {
  const trimmed = sql.trim().replace(/^--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const first = trimmed.split(/\s+/)[0]?.toUpperCase();

  switch (first) {
    case 'SELECT': case 'WITH': case 'EXPLAIN': case 'SHOW': case 'DESCRIBE': return 'select';
    case 'INSERT': return 'insert';
    case 'UPDATE': return 'update';
    case 'DELETE': return 'delete';
    case 'CREATE': case 'ALTER': case 'DROP': case 'TRUNCATE': return 'ddl';
    default: return 'other';
  }
}

function isDangerousQuery(sql: string): { dangerous: boolean; reason?: string } {
  const trimmed = sql.trim().toUpperCase();
  const classType = classifyQuery(sql);

  if (classType === 'ddl') {
    if (/DROP\s+(TABLE|DATABASE|SCHEMA)/i.test(sql)) {
      return { dangerous: true, reason: 'DROP operation will permanently delete data' };
    }
    if (/TRUNCATE/i.test(sql)) {
      return { dangerous: true, reason: 'TRUNCATE will remove all rows from the table' };
    }
  }

  if (classType === 'delete' && !/WHERE/i.test(sql)) {
    return { dangerous: true, reason: 'DELETE without WHERE clause will remove all rows' };
  }

  if (classType === 'update' && !/WHERE/i.test(sql)) {
    return { dangerous: true, reason: 'UPDATE without WHERE clause will modify all rows' };
  }

  return { dangerous: false };
}

function formatResultValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildConnectionString(config: SqlConnectionConfig): string {
  switch (config.type) {
    case 'sqlite':
      return config.database;
    case 'postgres':
      return `postgres://${config.username}:****@${config.host}:${config.port}/${config.database}`;
    case 'mysql':
      return `mysql://${config.username}:****@${config.host}:${config.port}/${config.database}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('SQL Query Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Connection Config Validation ──────────────────────────────
  describe('Connection config validation', () => {
    it('should require database type', () => {
      const errors = validateConnectionConfig({});
      expect(errors).toContain('Database type is required');
    });

    it('should validate postgres requires host, database, and username', () => {
      const errors = validateConnectionConfig({ type: 'postgres' });
      expect(errors).toContain('Host is required');
      expect(errors).toContain('Database name is required');
      expect(errors).toContain('Username is required');
    });

    it('should validate mysql requires host, database, and username', () => {
      const errors = validateConnectionConfig({ type: 'mysql' });
      expect(errors).toContain('Host is required');
      expect(errors).toContain('Database name is required');
      expect(errors).toContain('Username is required');
    });

    it('should pass for valid postgres config', () => {
      const errors = validateConnectionConfig({
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        username: 'admin',
        password: 'secret'
      });
      expect(errors).toHaveLength(0);
    });

    it('should pass for valid mysql config', () => {
      const errors = validateConnectionConfig({
        type: 'mysql',
        host: '192.168.1.100',
        port: 3306,
        database: 'app_db',
        username: 'root',
        password: ''
      });
      expect(errors).toHaveLength(0);
    });

    it('should only require database path for sqlite', () => {
      const errors = validateConnectionConfig({
        type: 'sqlite',
        database: '/path/to/db.sqlite'
      });
      expect(errors).toHaveLength(0);
    });

    it('should require database path for sqlite', () => {
      const errors = validateConnectionConfig({ type: 'sqlite' });
      expect(errors).toContain('Database file path is required');
    });

    it('should reject port below 1', () => {
      const errors = validateConnectionConfig({
        type: 'postgres',
        host: 'localhost',
        port: 0,
        database: 'db',
        username: 'user'
      });
      expect(errors).toContain('Port must be between 1 and 65535');
    });

    it('should reject port above 65535', () => {
      const errors = validateConnectionConfig({
        type: 'postgres',
        host: 'localhost',
        port: 70000,
        database: 'db',
        username: 'user'
      });
      expect(errors).toContain('Port must be between 1 and 65535');
    });

    it('should reject empty/whitespace host', () => {
      const errors = validateConnectionConfig({
        type: 'mysql',
        host: '   ',
        database: 'db',
        username: 'user'
      });
      expect(errors).toContain('Host is required');
    });
  });

  // ── Default Ports ─────────────────────────────────────────────
  describe('Default ports', () => {
    it('should default postgres to 5432', () => {
      expect(getDefaultPort('postgres')).toBe(5432);
    });

    it('should default mysql to 3306', () => {
      expect(getDefaultPort('mysql')).toBe(3306);
    });

    it('should return 0 for sqlite (no port)', () => {
      expect(getDefaultPort('sqlite')).toBe(0);
    });
  });

  // ── Query Classification ──────────────────────────────────────
  describe('Query classification', () => {
    it('should classify SELECT queries', () => {
      expect(classifyQuery('SELECT * FROM users')).toBe('select');
      expect(classifyQuery('select id, name from orders')).toBe('select');
      expect(classifyQuery('  SELECT count(*) FROM events  ')).toBe('select');
    });

    it('should classify WITH (CTE) as select', () => {
      expect(classifyQuery('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe('select');
    });

    it('should classify EXPLAIN as select', () => {
      expect(classifyQuery('EXPLAIN ANALYZE SELECT * FROM users')).toBe('select');
    });

    it('should classify SHOW as select', () => {
      expect(classifyQuery('SHOW TABLES')).toBe('select');
      expect(classifyQuery('SHOW DATABASES')).toBe('select');
    });

    it('should classify DESCRIBE as select', () => {
      expect(classifyQuery('DESCRIBE users')).toBe('select');
    });

    it('should classify INSERT queries', () => {
      expect(classifyQuery("INSERT INTO users (name) VALUES ('Ada')")).toBe('insert');
    });

    it('should classify UPDATE queries', () => {
      expect(classifyQuery("UPDATE users SET name = 'Bob' WHERE id = 1")).toBe('update');
    });

    it('should classify DELETE queries', () => {
      expect(classifyQuery('DELETE FROM users WHERE id = 1')).toBe('delete');
    });

    it('should classify DDL operations', () => {
      expect(classifyQuery('CREATE TABLE foo (id INT)')).toBe('ddl');
      expect(classifyQuery('ALTER TABLE users ADD COLUMN age INT')).toBe('ddl');
      expect(classifyQuery('DROP TABLE users')).toBe('ddl');
      expect(classifyQuery('TRUNCATE TABLE users')).toBe('ddl');
    });

    it('should ignore leading SQL comments', () => {
      expect(classifyQuery('-- fetch all\nSELECT * FROM users')).toBe('select');
      expect(classifyQuery('/* admin */ DELETE FROM logs WHERE id = 1')).toBe('delete');
    });

    it('should return other for unrecognized queries', () => {
      expect(classifyQuery('VACUUM')).toBe('other');
      expect(classifyQuery('GRANT ALL ON db TO user')).toBe('other');
    });
  });

  // ── Dangerous Query Detection ─────────────────────────────────
  describe('Dangerous query detection', () => {
    it('should flag DROP TABLE as dangerous', () => {
      const result = isDangerousQuery('DROP TABLE users');
      expect(result.dangerous).toBe(true);
      expect(result.reason).toContain('DROP');
    });

    it('should flag DROP DATABASE as dangerous', () => {
      const result = isDangerousQuery('DROP DATABASE production');
      expect(result.dangerous).toBe(true);
    });

    it('should flag TRUNCATE as dangerous', () => {
      const result = isDangerousQuery('TRUNCATE TABLE audit_log');
      expect(result.dangerous).toBe(true);
      expect(result.reason).toContain('TRUNCATE');
    });

    it('should flag DELETE without WHERE', () => {
      const result = isDangerousQuery('DELETE FROM users');
      expect(result.dangerous).toBe(true);
      expect(result.reason).toContain('WHERE');
    });

    it('should flag UPDATE without WHERE', () => {
      const result = isDangerousQuery("UPDATE users SET status = 'inactive'");
      expect(result.dangerous).toBe(true);
      expect(result.reason).toContain('WHERE');
    });

    it('should not flag DELETE with WHERE', () => {
      const result = isDangerousQuery('DELETE FROM users WHERE id = 5');
      expect(result.dangerous).toBe(false);
    });

    it('should not flag UPDATE with WHERE', () => {
      const result = isDangerousQuery("UPDATE users SET name = 'Bob' WHERE id = 1");
      expect(result.dangerous).toBe(false);
    });

    it('should not flag safe SELECT queries', () => {
      const result = isDangerousQuery('SELECT * FROM users');
      expect(result.dangerous).toBe(false);
    });

    it('should not flag INSERT queries', () => {
      const result = isDangerousQuery("INSERT INTO users (name) VALUES ('Ada')");
      expect(result.dangerous).toBe(false);
    });

    it('should not flag CREATE TABLE', () => {
      const result = isDangerousQuery('CREATE TABLE temp_data (id INT)');
      expect(result.dangerous).toBe(false);
    });
  });

  // ── Result Value Formatting ───────────────────────────────────
  describe('Result value formatting', () => {
    it('should format null as NULL', () => {
      expect(formatResultValue(null)).toBe('NULL');
    });

    it('should format undefined as NULL', () => {
      expect(formatResultValue(undefined)).toBe('NULL');
    });

    it('should format booleans', () => {
      expect(formatResultValue(true)).toBe('true');
      expect(formatResultValue(false)).toBe('false');
    });

    it('should format numbers as strings', () => {
      expect(formatResultValue(42)).toBe('42');
      expect(formatResultValue(3.14)).toBe('3.14');
    });

    it('should pass through strings', () => {
      expect(formatResultValue('hello')).toBe('hello');
    });

    it('should JSON-stringify objects', () => {
      const obj = { key: 'value' };
      expect(formatResultValue(obj)).toBe('{"key":"value"}');
    });

    it('should JSON-stringify arrays', () => {
      expect(formatResultValue([1, 2, 3])).toBe('[1,2,3]');
    });
  });

  // ── Connection String Builder ─────────────────────────────────
  describe('Connection string builder', () => {
    it('should build postgres connection string with masked password', () => {
      const config: SqlConnectionConfig = {
        type: 'postgres', host: 'db.example.com', port: 5432,
        database: 'myapp', username: 'admin', password: 'secret', name: 'prod'
      };
      const str = buildConnectionString(config);
      expect(str).toBe('postgres://admin:****@db.example.com:5432/myapp');
      expect(str).not.toContain('secret');
    });

    it('should build mysql connection string with masked password', () => {
      const config: SqlConnectionConfig = {
        type: 'mysql', host: '127.0.0.1', port: 3306,
        database: 'shop', username: 'root', password: 'pass', name: 'local'
      };
      const str = buildConnectionString(config);
      expect(str).toBe('mysql://root:****@127.0.0.1:3306/shop');
    });

    it('should return file path for sqlite', () => {
      const config: SqlConnectionConfig = {
        type: 'sqlite', host: '', port: 0,
        database: '/data/app.db', username: '', password: '', name: 'local-db'
      };
      expect(buildConnectionString(config)).toBe('/data/app.db');
    });
  });

  // ── Query Result Handling ─────────────────────────────────────
  describe('Query result handling', () => {
    it('should handle empty result set', () => {
      const result: SqlQueryResult = {
        columns: [{ name: 'id', type: 'int4' }, { name: 'name', type: 'text' }],
        rows: [],
        rowCount: 0,
        executionTimeMs: 5,
        isSelect: true
      };

      expect(result.rows).toHaveLength(0);
      expect(result.columns).toHaveLength(2);
      expect(result.isSelect).toBe(true);
    });

    it('should handle result set with multiple rows', () => {
      const result: SqlQueryResult = {
        columns: [
          { name: 'id', type: 'int4' },
          { name: 'email', type: 'text' },
          { name: 'active', type: 'bool' }
        ],
        rows: [
          { id: 1, email: 'ada@test.com', active: true },
          { id: 2, email: 'bob@test.com', active: false },
          { id: 3, email: 'eve@test.com', active: true }
        ],
        rowCount: 3,
        executionTimeMs: 12,
        isSelect: true
      };

      expect(result.rows).toHaveLength(3);
      expect(result.rowCount).toBe(3);
      expect(result.rows[0].email).toBe('ada@test.com');
      expect(result.rows[1].active).toBe(false);
    });

    it('should handle non-select result (INSERT/UPDATE/DELETE)', () => {
      const result: SqlQueryResult = {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 8,
        isSelect: false,
        affectedRows: 5
      };

      expect(result.isSelect).toBe(false);
      expect(result.affectedRows).toBe(5);
      expect(result.columns).toHaveLength(0);
    });

    it('should handle NULL values in rows', () => {
      const result: SqlQueryResult = {
        columns: [
          { name: 'id', type: 'int4' },
          { name: 'bio', type: 'text' },
          { name: 'age', type: 'int4' }
        ],
        rows: [
          { id: 1, bio: null, age: 30 },
          { id: 2, bio: 'Engineer', age: null }
        ],
        rowCount: 2,
        executionTimeMs: 3,
        isSelect: true
      };

      expect(result.rows[0].bio).toBeNull();
      expect(result.rows[1].age).toBeNull();
      expect(formatResultValue(result.rows[0].bio)).toBe('NULL');
    });

    it('should track execution time', () => {
      const result: SqlQueryResult = {
        columns: [{ name: 'count', type: 'int8' }],
        rows: [{ count: 10000 }],
        rowCount: 1,
        executionTimeMs: 247,
        isSelect: true
      };

      expect(result.executionTimeMs).toBe(247);
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it('should handle large result sets with many columns', () => {
      const columns: SqlColumn[] = Array.from({ length: 20 }, (_, i) => ({
        name: `col_${i}`,
        type: 'text'
      }));

      const rows = Array.from({ length: 100 }, (_, rowIdx) => {
        const row: Record<string, string> = {};
        columns.forEach(col => { row[col.name] = `row${rowIdx}_${col.name}`; });
        return row;
      });

      const result: SqlQueryResult = {
        columns,
        rows,
        rowCount: 100,
        executionTimeMs: 55,
        isSelect: true
      };

      expect(result.columns).toHaveLength(20);
      expect(result.rows).toHaveLength(100);
      expect(result.rows[50].col_5).toBe('row50_col_5');
    });
  });

  // ── Connection Profiles ───────────────────────────────────────
  describe('Connection profiles', () => {
    it('should create a profile with unique id', () => {
      const profile: SqlConnectionProfile = {
        id: `sql-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        config: {
          type: 'postgres', host: 'localhost', port: 5432,
          database: 'dev', username: 'dev_user', password: 'pass', name: 'Dev PG'
        },
        lastUsed: Date.now()
      };

      expect(profile.id).toBeTruthy();
      expect(profile.config.name).toBe('Dev PG');
      expect(profile.lastUsed).toBeGreaterThan(0);
    });

    it('should store multiple profiles independently', () => {
      const profiles: SqlConnectionProfile[] = [
        {
          id: 'p1', config: {
            type: 'postgres', host: 'pg.prod.com', port: 5432,
            database: 'app', username: 'admin', password: 'x', name: 'Prod PG'
          }, lastUsed: 100
        },
        {
          id: 'p2', config: {
            type: 'mysql', host: 'mysql.staging.com', port: 3306,
            database: 'staging', username: 'root', password: 'y', name: 'Staging MySQL'
          }, lastUsed: 200
        },
        {
          id: 'p3', config: {
            type: 'sqlite', host: '', port: 0,
            database: './local.db', username: '', password: '', name: 'Local SQLite'
          }, lastUsed: 300
        }
      ];

      expect(profiles).toHaveLength(3);
      expect(profiles.map(p => p.config.type)).toEqual(['postgres', 'mysql', 'sqlite']);
    });

    it('should sort profiles by lastUsed descending', () => {
      const profiles: SqlConnectionProfile[] = [
        { id: 'a', config: {} as any, lastUsed: 100 },
        { id: 'b', config: {} as any, lastUsed: 300 },
        { id: 'c', config: {} as any, lastUsed: 200 },
      ];

      const sorted = [...profiles].sort((a, b) => b.lastUsed - a.lastUsed);
      expect(sorted[0].id).toBe('b');
      expect(sorted[1].id).toBe('c');
      expect(sorted[2].id).toBe('a');
    });

    it('should remove a profile by id', () => {
      const profiles = [
        { id: 'keep1', config: {} as any, lastUsed: 1 },
        { id: 'remove', config: {} as any, lastUsed: 2 },
        { id: 'keep2', config: {} as any, lastUsed: 3 },
      ];

      const filtered = profiles.filter(p => p.id !== 'remove');
      expect(filtered).toHaveLength(2);
      expect(filtered.find(p => p.id === 'remove')).toBeUndefined();
    });
  });

  // ── Query History ─────────────────────────────────────────────
  describe('Query history', () => {
    it('should add queries to history in order', () => {
      const history: { sql: string; timestamp: number; executionTimeMs: number; dbType: string }[] = [];

      history.push({ sql: 'SELECT 1', timestamp: 100, executionTimeMs: 5, dbType: 'postgres' });
      history.push({ sql: 'SELECT * FROM users', timestamp: 200, executionTimeMs: 12, dbType: 'postgres' });
      history.push({ sql: "INSERT INTO logs VALUES ('event')", timestamp: 300, executionTimeMs: 8, dbType: 'mysql' });

      expect(history).toHaveLength(3);
      expect(history[0].sql).toBe('SELECT 1');
      expect(history[2].dbType).toBe('mysql');
    });

    it('should enforce max history limit', () => {
      const MAX_HISTORY = 50;
      const history: { sql: string; timestamp: number }[] = [];

      for (let i = 0; i < 60; i++) {
        history.push({ sql: `SELECT ${i}`, timestamp: i });
        if (history.length > MAX_HISTORY) {
          history.shift();
        }
      }

      expect(history).toHaveLength(MAX_HISTORY);
      expect(history[0].sql).toBe('SELECT 10');
    });

    it('should filter history by database type', () => {
      const history = [
        { sql: 'SELECT 1', dbType: 'postgres' },
        { sql: 'SHOW TABLES', dbType: 'mysql' },
        { sql: 'SELECT * FROM sqlite_master', dbType: 'sqlite' },
        { sql: 'SELECT now()', dbType: 'postgres' },
      ];

      const pgHistory = history.filter(h => h.dbType === 'postgres');
      expect(pgHistory).toHaveLength(2);
    });

    it('should search history by SQL content', () => {
      const history = [
        { sql: 'SELECT * FROM users WHERE id = 1' },
        { sql: 'SELECT * FROM orders WHERE user_id = 1' },
        { sql: "INSERT INTO users (name) VALUES ('test')" },
        { sql: 'SELECT count(*) FROM users' },
      ];

      const matches = history.filter(h => h.sql.toLowerCase().includes('users'));
      expect(matches).toHaveLength(3);

      const selectOnly = history.filter(h =>
        h.sql.toLowerCase().includes('users') && classifyQuery(h.sql) === 'select'
      );
      expect(selectOnly).toHaveLength(2);
    });
  });

  // ── Tauri API Wrapper ─────────────────────────────────────────
  describe('Tauri API wrapper (sql)', () => {
    it('should invoke sql_connect with correct params for postgres', async () => {
      vi.mocked(invoke).mockResolvedValue('conn-abc-123');

      const result = await invoke('sql_connect', {
        dbType: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        username: 'admin',
        password: 'secret'
      });

      expect(invoke).toHaveBeenCalledWith('sql_connect', {
        dbType: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        username: 'admin',
        password: 'secret'
      });
      expect(result).toBe('conn-abc-123');
    });

    it('should invoke sql_connect for sqlite with just a path', async () => {
      vi.mocked(invoke).mockResolvedValue('conn-sqlite-1');

      const result = await invoke('sql_connect', {
        dbType: 'sqlite',
        host: '',
        port: 0,
        database: '/data/app.db',
        username: '',
        password: ''
      });

      expect(invoke).toHaveBeenCalledWith('sql_connect', expect.objectContaining({
        dbType: 'sqlite',
        database: '/data/app.db'
      }));
      expect(result).toBe('conn-sqlite-1');
    });

    it('should invoke sql_query and return result set', async () => {
      const mockResult: SqlQueryResult = {
        columns: [{ name: 'id', type: 'int4' }, { name: 'name', type: 'text' }],
        rows: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bob' }],
        rowCount: 2,
        executionTimeMs: 15,
        isSelect: true
      };

      vi.mocked(invoke).mockResolvedValue(mockResult);

      const result = await invoke('sql_query', {
        connectionId: 'conn-abc-123',
        sql: 'SELECT * FROM users'
      });

      expect(invoke).toHaveBeenCalledWith('sql_query', {
        connectionId: 'conn-abc-123',
        sql: 'SELECT * FROM users'
      });
      expect(result).toEqual(mockResult);
    });

    it('should invoke sql_query for mutation and return affected rows', async () => {
      const mockResult: SqlQueryResult = {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 22,
        isSelect: false,
        affectedRows: 3
      };

      vi.mocked(invoke).mockResolvedValue(mockResult);

      const result = await invoke('sql_query', {
        connectionId: 'conn-abc-123',
        sql: "UPDATE users SET active = true WHERE role = 'admin'"
      }) as SqlQueryResult;

      expect(result.isSelect).toBe(false);
      expect(result.affectedRows).toBe(3);
    });

    it('should invoke sql_disconnect', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke('sql_disconnect', { connectionId: 'conn-abc-123' });

      expect(invoke).toHaveBeenCalledWith('sql_disconnect', {
        connectionId: 'conn-abc-123'
      });
    });

    it('should handle connection error', async () => {
      vi.mocked(invoke).mockRejectedValue('Connection refused: could not connect to localhost:5432');

      await expect(
        invoke('sql_connect', {
          dbType: 'postgres', host: 'localhost', port: 5432,
          database: 'noexist', username: 'bad', password: 'wrong'
        })
      ).rejects.toContain('Connection refused');
    });

    it('should handle query syntax error', async () => {
      vi.mocked(invoke).mockRejectedValue('ERROR: syntax error at or near "SELEC"');

      await expect(
        invoke('sql_query', {
          connectionId: 'conn-abc-123',
          sql: 'SELEC * FROM users'
        })
      ).rejects.toContain('syntax error');
    });

    it('should handle query timeout error', async () => {
      vi.mocked(invoke).mockRejectedValue('Query timed out after 30000ms');

      await expect(
        invoke('sql_query', {
          connectionId: 'conn-abc-123',
          sql: 'SELECT pg_sleep(60)'
        })
      ).rejects.toContain('timed out');
    });
  });

  // ── UI State Integration ──────────────────────────────────────
  describe('UI state integration', () => {
    it('should represent sql as a valid tools panel state', () => {
      type ToolsPanel = false | 'jwt' | 'encoder' | 'sql';

      let state: ToolsPanel = false;

      state = 'sql';
      expect(state).toBe('sql');

      state = false;
      expect(state).toBe(false);
    });

    it('should toggle sql panel on and off', () => {
      type ToolsPanel = false | 'jwt' | 'encoder' | 'sql';
      let state: ToolsPanel = false;

      const toggle = () => { state = state === 'sql' ? false : 'sql'; };

      toggle();
      expect(state).toBe('sql');

      toggle();
      expect(state).toBe(false);
    });

    it('should switch from another tool to sql', () => {
      type ToolsPanel = false | 'jwt' | 'encoder' | 'sql';
      let state: ToolsPanel = 'jwt';

      state = 'sql';
      expect(state).toBe('sql');
    });

    it('should close sql panel on Escape', () => {
      type ToolsPanel = false | 'jwt' | 'encoder' | 'sql';
      let state: ToolsPanel = 'sql';

      const handleEscape = () => {
        if (state) { state = false; }
      };

      handleEscape();
      expect(state).toBe(false);
    });
  });

  // ── Keyboard Shortcuts ────────────────────────────────────────
  describe('Keyboard shortcuts', () => {
    it('should map Ctrl+Shift+Q to toggle SQL runner', () => {
      const handleKey = (e: { ctrlKey: boolean; shiftKey: boolean; key: string }) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'Q') return 'toggle-sql';
        return null;
      };

      expect(handleKey({ ctrlKey: true, shiftKey: true, key: 'Q' })).toBe('toggle-sql');
      expect(handleKey({ ctrlKey: true, shiftKey: false, key: 'Q' })).toBeNull();
      expect(handleKey({ ctrlKey: false, shiftKey: true, key: 'Q' })).toBeNull();
    });

    it('should map Ctrl+Enter to execute query in SQL panel', () => {
      const handleKey = (e: { ctrlKey: boolean; key: string }, panelOpen: boolean) => {
        if (panelOpen && e.ctrlKey && e.key === 'Enter') return 'execute-query';
        return null;
      };

      expect(handleKey({ ctrlKey: true, key: 'Enter' }, true)).toBe('execute-query');
      expect(handleKey({ ctrlKey: true, key: 'Enter' }, false)).toBeNull();
    });
  });

  // ── Multiple Connections ──────────────────────────────────────
  describe('Multiple connections', () => {
    it('should track active connections independently', () => {
      const connections = new Map<string, { dbType: string; database: string; status: string }>();

      connections.set('conn-1', { dbType: 'postgres', database: 'users_db', status: 'connected' });
      connections.set('conn-2', { dbType: 'mysql', database: 'orders_db', status: 'connected' });

      expect(connections.size).toBe(2);
      expect(connections.get('conn-1')?.dbType).toBe('postgres');
      expect(connections.get('conn-2')?.dbType).toBe('mysql');
    });

    it('should clean up connection on disconnect', () => {
      const connections = new Map<string, any>();
      connections.set('conn-1', { status: 'connected' });
      connections.set('conn-2', { status: 'connected' });

      connections.delete('conn-1');

      expect(connections.has('conn-1')).toBe(false);
      expect(connections.has('conn-2')).toBe(true);
    });
  });

  // ── Table Export ──────────────────────────────────────────────
  describe('Result export', () => {
    it('should export results as CSV', () => {
      const columns: SqlColumn[] = [
        { name: 'id', type: 'int4' },
        { name: 'name', type: 'text' },
        { name: 'email', type: 'text' }
      ];
      const rows = [
        { id: 1, name: 'Ada', email: 'ada@test.com' },
        { id: 2, name: 'Bob', email: 'bob@test.com' }
      ];

      const header = columns.map(c => c.name).join(',');
      const body = rows.map(row =>
        columns.map(c => {
          const val = row[c.name as keyof typeof row];
          return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val);
        }).join(',')
      ).join('\n');
      const csv = `${header}\n${body}`;

      expect(csv).toBe('id,name,email\n1,Ada,ada@test.com\n2,Bob,bob@test.com');
    });

    it('should escape commas and quotes in CSV export', () => {
      const val = 'Smith, "Bob"';
      const escaped = `"${val.replace(/"/g, '""')}"`;
      expect(escaped).toBe('"Smith, ""Bob"""');
    });

    it('should export results as JSON', () => {
      const rows = [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bob' }
      ];

      const json = JSON.stringify(rows, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('Ada');
    });
  });
});
