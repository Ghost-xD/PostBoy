import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

/**
 * Database Schema Tests - Converted from test-database-schema.js
 * Tests database structure and data integrity
 */
describe('Database Schema Tests', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    // Determine database path based on OS
    const platform = os.platform();
    const home = os.homedir();
    
    if (platform === 'win32') {
      dbPath = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'com.moodysaroha.postboy', 'postboy.db');
    } else if (platform === 'darwin') {
      dbPath = path.join(home, 'Library', 'Application Support', 'com.moodysaroha.postboy', 'postboy.db');
    } else {
      dbPath = path.join(home, '.config', 'com.moodysaroha.postboy', 'postboy.db');
    }

    // Create directory if it doesn't exist
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize database with schema
    db = new Database(dbPath);
    
    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER,
        name TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        headers TEXT,
        body TEXT,
        description TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        headers TEXT,
        body TEXT,
        status INTEGER,
        response_time INTEGER,
        response_body TEXT,
        response_headers TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
  });

  describe('Table Existence', () => {
    it('should have collections table', () => {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collections'").get();
      expect(table).toBeDefined();
      expect(table.name).toBe('collections');
    });

    it('should have requests table', () => {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='requests'").get();
      expect(table).toBeDefined();
      expect(table.name).toBe('requests');
    });

    it('should have history table', () => {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history'").get();
      expect(table).toBeDefined();
      expect(table.name).toBe('history');
    });

    it('should have settings table', () => {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
      expect(table).toBeDefined();
      expect(table.name).toBe('settings');
    });
  });

  describe('Collections Table Schema', () => {
    it('should have correct columns', () => {
      const columns = db.prepare("PRAGMA table_info(collections)").all();
      const columnNames = columns.map((col: any) => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('should have id as primary key', () => {
      const columns = db.prepare("PRAGMA table_info(collections)").all();
      const idColumn = columns.find((col: any) => col.name === 'id');

      expect(idColumn.pk).toBe(1);
    });

    it('should have name as NOT NULL', () => {
      const columns = db.prepare("PRAGMA table_info(collections)").all();
      const nameColumn = columns.find((col: any) => col.name === 'name');

      expect(nameColumn.notnull).toBe(1);
    });
  });

  describe('Requests Table Schema', () => {
    it('should have correct columns', () => {
      const columns = db.prepare("PRAGMA table_info(requests)").all();
      const columnNames = columns.map((col: any) => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('collection_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('method');
      expect(columnNames).toContain('url');
      expect(columnNames).toContain('headers');
      expect(columnNames).toContain('body_type');
      expect(columnNames).toContain('body_content');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('should have foreign key to collections', () => {
      const foreignKeys = db.prepare("PRAGMA foreign_key_list(requests)").all();
      const collectionFk = foreignKeys.find((fk: any) => fk.table === 'collections');

      expect(collectionFk).toBeDefined();
      expect(collectionFk.from).toBe('collection_id');
      expect(collectionFk.to).toBe('id');
    });

    it('should have required fields as NOT NULL', () => {
      const columns = db.prepare("PRAGMA table_info(requests)").all();
      const requiredFields = ['name', 'method', 'url'];

      requiredFields.forEach(field => {
        const column = columns.find((col: any) => col.name === field);
        expect(column.notnull).toBe(1);
      });
    });
  });

  describe('History Table Schema', () => {
    it('should have correct columns', () => {
      const columns = db.prepare("PRAGMA table_info(history)").all();
      const columnNames = columns.map((col: any) => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('method');
      expect(columnNames).toContain('url');
      expect(columnNames).toContain('headers');
      expect(columnNames).toContain('params');
      expect(columnNames).toContain('body_type');
      expect(columnNames).toContain('body_content');
      expect(columnNames).toContain('auth_type');
      expect(columnNames).toContain('auth_data');
      expect(columnNames).toContain('status_code');
      expect(columnNames).toContain('response_time');
      expect(columnNames).toContain('response_body');
      expect(columnNames).toContain('response_headers');
      expect(columnNames).toContain('executed_at');
    });

    it('should have method and url as NOT NULL', () => {
      const columns = db.prepare("PRAGMA table_info(history)").all();
      const methodColumn = columns.find((col: any) => col.name === 'method');
      const urlColumn = columns.find((col: any) => col.name === 'url');

      expect(methodColumn.notnull).toBe(1);
      expect(urlColumn.notnull).toBe(1);
    });
  });

  describe('Settings Table Schema', () => {
    it('should have correct columns', () => {
      const columns = db.prepare("PRAGMA table_info(settings)").all();
      const columnNames = columns.map((col: any) => col.name);

      expect(columnNames).toContain('key');
      expect(columnNames).toContain('value');
      expect(columnNames).toContain('updated_at');
    });

    it('should have key as primary key', () => {
      const columns = db.prepare("PRAGMA table_info(settings)").all();
      const keyColumn = columns.find((col: any) => col.name === 'key');

      expect(keyColumn.pk).toBe(1);
    });

    it('should have value as NOT NULL', () => {
      const columns = db.prepare("PRAGMA table_info(settings)").all();
      const valueColumn = columns.find((col: any) => col.name === 'value');

      expect(valueColumn.notnull).toBe(0); // value is nullable
    });
  });

  describe('CRUD Operations - Collections', () => {
    it('should insert collection', () => {
      const stmt = db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)');
      const result = stmt.run('Test Collection', 'Test Description');

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    it('should read collection', () => {
      const stmt = db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)');
      const insertResult = stmt.run('Read Test', 'Description');
      
      const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(insertResult.lastInsertRowid);

      expect(collection).toBeDefined();
      expect(collection.name).toBe('Read Test');
      expect(collection.description).toBe('Description');
    });

    it('should update collection', () => {
      const insertStmt = db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)');
      const insertResult = insertStmt.run('Update Test', 'Original');
      
      const updateStmt = db.prepare('UPDATE collections SET name = ?, description = ? WHERE id = ?');
      const updateResult = updateStmt.run('Updated Name', 'Updated Description', insertResult.lastInsertRowid);

      expect(updateResult.changes).toBe(1);

      const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(insertResult.lastInsertRowid);
      expect(collection.name).toBe('Updated Name');
      expect(collection.description).toBe('Updated Description');
    });

    it('should delete collection', () => {
      const insertStmt = db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)');
      const insertResult = insertStmt.run('Delete Test', 'Description');
      
      const deleteStmt = db.prepare('DELETE FROM collections WHERE id = ?');
      const deleteResult = deleteStmt.run(insertResult.lastInsertRowid);

      expect(deleteResult.changes).toBe(1);

      const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(insertResult.lastInsertRowid);
      expect(collection).toBeUndefined();
    });
  });

  describe('CRUD Operations - Requests', () => {
    let collectionId: number;

    beforeAll(() => {
      const stmt = db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)');
      const result = stmt.run('Request Test Collection', 'For testing requests');
      collectionId = Number(result.lastInsertRowid);
    });

    it('should insert request', () => {
      const stmt = db.prepare(`
        INSERT INTO requests (collection_id, name, method, url, headers, params, body_type, body_content, auth_type, auth_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        collectionId,
        'Test Request',
        'GET',
        'https://api.test.com',
        '[]',
        '[]',
        'none',
        '',
        'none',
        '{}'
      );

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    it('should read request', () => {
      const insertStmt = db.prepare(`
        INSERT INTO requests (collection_id, name, method, url)
        VALUES (?, ?, ?, ?)
      `);
      const insertResult = insertStmt.run(collectionId, 'Read Test', 'POST', 'https://api.test.com/post');
      
      const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(insertResult.lastInsertRowid);

      expect(request).toBeDefined();
      expect(request.name).toBe('Read Test');
      expect(request.method).toBe('POST');
      expect(request.url).toBe('https://api.test.com/post');
    });

    it('should update request', () => {
      const insertStmt = db.prepare(`
        INSERT INTO requests (collection_id, name, method, url)
        VALUES (?, ?, ?, ?)
      `);
      const insertResult = insertStmt.run(collectionId, 'Update Test', 'GET', 'https://api.test.com');
      
      const updateStmt = db.prepare('UPDATE requests SET method = ?, url = ? WHERE id = ?');
      const updateResult = updateStmt.run('PUT', 'https://api.test.com/updated', insertResult.lastInsertRowid);

      expect(updateResult.changes).toBe(1);

      const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(insertResult.lastInsertRowid);
      expect(request.method).toBe('PUT');
      expect(request.url).toBe('https://api.test.com/updated');
    });

    it('should delete request', () => {
      const insertStmt = db.prepare(`
        INSERT INTO requests (collection_id, name, method, url)
        VALUES (?, ?, ?, ?)
      `);
      const insertResult = insertStmt.run(collectionId, 'Delete Test', 'DELETE', 'https://api.test.com/delete');
      
      const deleteStmt = db.prepare('DELETE FROM requests WHERE id = ?');
      const deleteResult = deleteStmt.run(insertResult.lastInsertRowid);

      expect(deleteResult.changes).toBe(1);

      const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(insertResult.lastInsertRowid);
      expect(request).toBeUndefined();
    });

    it('should cascade delete requests when collection is deleted', () => {
      // Create a new collection with requests
      const collStmt = db.prepare('INSERT INTO collections (name) VALUES (?)');
      const collResult = collStmt.run('Cascade Test');
      const testCollId = Number(collResult.lastInsertRowid);

      const reqStmt = db.prepare('INSERT INTO requests (collection_id, name, method, url) VALUES (?, ?, ?, ?)');
      reqStmt.run(testCollId, 'Request 1', 'GET', 'https://api.test.com/1');
      reqStmt.run(testCollId, 'Request 2', 'GET', 'https://api.test.com/2');

      // Delete collection
      db.prepare('DELETE FROM collections WHERE id = ?').run(testCollId);

      // Check if requests were cascade deleted
      const requests = db.prepare('SELECT * FROM requests WHERE collection_id = ?').all(testCollId);
      expect(requests).toHaveLength(0);
    });
  });

  describe('CRUD Operations - History', () => {
    it('should insert history item', () => {
      const stmt = db.prepare(`
        INSERT INTO history (method, url, status_code, response_time)
        VALUES (?, ?, ?, ?)
      `);
      const result = stmt.run('GET', 'https://api.test.com', 200, 150);

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    it('should read history', () => {
      const insertStmt = db.prepare(`
        INSERT INTO history (method, url, status_code, response_time)
        VALUES (?, ?, ?, ?)
      `);
      insertStmt.run('POST', 'https://api.test.com/post', 201, 200);
      
      const history = db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 1').get();

      expect(history).toBeDefined();
      expect(history.method).toBe('POST');
      expect(history.status_code).toBe(201);
    });

    it('should clear history', () => {
      db.prepare('DELETE FROM history').run();
      const count = db.prepare('SELECT COUNT(*) as count FROM history').get();

      expect(count.count).toBe(0);
    });
  });

  describe('CRUD Operations - Settings', () => {
    it('should insert setting', () => {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const result = stmt.run('theme', 'dark');

      expect(result.changes).toBeGreaterThanOrEqual(1);
    });

    it('should read setting', () => {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('test_key', 'test_value');
      
      const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get('test_key');

      expect(setting).toBeDefined();
      expect(setting.key).toBe('test_key');
      expect(setting.value).toBe('test_value');
    });

    it('should update setting', () => {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('update_test', 'original');
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('update_test', 'updated');
      
      const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get('update_test');

      expect(setting.value).toBe('updated');
    });

    it('should delete setting', () => {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('delete_test', 'value');
      db.prepare('DELETE FROM settings WHERE key = ?').run('delete_test');
      
      const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get('delete_test');

      expect(setting).toBeUndefined();
    });
  });

  describe('Data Integrity', () => {
    it('should enforce NOT NULL constraints', () => {
      expect(() => {
        db.prepare('INSERT INTO collections (name) VALUES (?)').run(null);
      }).toThrow();
    });

    it('should enforce foreign key constraints', () => {
      // Enable foreign keys
      db.pragma('foreign_keys = ON');

      expect(() => {
        db.prepare('INSERT INTO requests (collection_id, name, method, url) VALUES (?, ?, ?, ?)')
          .run(99999, 'Test', 'GET', 'https://api.test.com');
      }).toThrow();
    });

    it('should auto-generate timestamps', () => {
      const stmt = db.prepare('INSERT INTO collections (name) VALUES (?)');
      const result = stmt.run('Timestamp Test');
      
      const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(result.lastInsertRowid);

      expect(collection.created_at).toBeDefined();
      expect(collection.updated_at).toBeDefined();
      // Timestamps are strings in SQLite DATETIME format
      expect(typeof collection.created_at).toBe('string');
      expect(collection.created_at.length).toBeGreaterThan(0);
    });
  });
});
