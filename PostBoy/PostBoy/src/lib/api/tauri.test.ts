import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, fileOps, app, http, sql, ws } from './tauri';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

describe('Tauri API Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Database Operations', () => {
    it('should get collections', async () => {
      const mockCollections = [
        { id: 1, name: 'Test Collection', description: 'Test' }
      ];
      vi.mocked(invoke).mockResolvedValue(mockCollections);

      const result = await db.getCollections();
      
      expect(invoke).toHaveBeenCalledWith('db_get_collections');
      expect(result).toEqual(mockCollections);
    });

    it('should create collection', async () => {
      const mockId = 123;
      vi.mocked(invoke).mockResolvedValue(mockId);

      const result = await db.createCollection('New Collection', 'Description');
      
      expect(invoke).toHaveBeenCalledWith('db_create_collection', {
        name: 'New Collection',
        description: 'Description'
      });
      expect(result).toBe(mockId);
    });

    it('should update collection', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.updateCollection(1, 'Updated', 'New description');
      
      expect(invoke).toHaveBeenCalledWith('db_update_collection', {
        id: 1,
        name: 'Updated',
        description: 'New description'
      });
    });

    it('should delete collection', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.deleteCollection(1);
      
      expect(invoke).toHaveBeenCalledWith('db_delete_collection', { id: 1 });
    });

    it('should get requests for collection', async () => {
      const mockRequests = [
        { id: 1, name: 'GET Request', method: 'GET', url: 'https://api.test.com' }
      ];
      vi.mocked(invoke).mockResolvedValue(mockRequests);

      const result = await db.getRequests(1);
      
      expect(invoke).toHaveBeenCalledWith('db_get_requests', { collectionId: 1 });
      expect(result).toEqual(mockRequests);
    });

    it('should save request', async () => {
      const mockId = 456;
      const requestData = {
        name: 'Test Request',
        method: 'POST',
        url: 'https://api.test.com/users',
        headers: { 'Content-Type': 'application/json' },
        bodyType: 'json',
        bodyContent: '{"name":"test"}'
      };
      vi.mocked(invoke).mockResolvedValue(mockId);

      const result = await db.createRequest(1, requestData);
      
      expect(invoke).toHaveBeenCalledWith('db_create_request', { collectionId: 1, requestData });
      expect(result).toBe(mockId);
    });

    it('should delete request', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.deleteRequest(1);
      
      expect(invoke).toHaveBeenCalledWith('db_delete_request', { id: 1 });
    });

    it('should add to history', async () => {
      const requestData = {
        method: 'GET',
        url: 'https://api.test.com',
        headers: {},
        params: [],
        bodyType: 'none',
        bodyContent: '',
        authType: 'none',
        authData: {}
      };
      const responseData = {
        status: 200,
        responseTime: 150,
        headers: {},
        body: ''
      };
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.addHistory(requestData, responseData);
      
      expect(invoke).toHaveBeenCalledWith('db_add_history', { requestData, responseData });
    });

    it('should get history', async () => {
      const mockHistory = [
        { id: 1, method: 'GET', url: 'https://api.test.com', status: 200 }
      ];
      vi.mocked(invoke).mockResolvedValue(mockHistory);

      const result = await db.getHistory(10);
      
      expect(invoke).toHaveBeenCalledWith('db_get_history', { limit: 10 });
      expect(result).toEqual(mockHistory);
    });

    it('should clear history', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.clearHistory();
      
      expect(invoke).toHaveBeenCalledWith('db_clear_history');
    });

    it('should get setting', async () => {
      vi.mocked(invoke).mockResolvedValue('dark');

      const result = await db.getSetting('theme');
      
      expect(invoke).toHaveBeenCalledWith('db_get_setting', { key: 'theme' });
      expect(result).toBe('dark');
    });

    it('should set setting', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.setSetting('theme', 'light');
      
      expect(invoke).toHaveBeenCalledWith('db_set_setting', {
        key: 'theme',
        value: 'light'
      });
    });

    it('should export collections', async () => {
      const mockExport = {
        version: '1.0',
        collections: []
      };
      vi.mocked(invoke).mockResolvedValue(mockExport);

      const result = await db.exportCollections(null, 'json');
      
      expect(invoke).toHaveBeenCalledWith('db_export_collections', { collectionIds: null, format: 'json' });
      expect(result).toEqual(mockExport);
    });

    it('should import collections', async () => {
      const importData = {
        version: '1.0',
        collections: []
      };
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.importCollections(importData as any, false);
      
      expect(invoke).toHaveBeenCalledWith('db_import_collections', {
        importData,
        overwrite: false
      });
    });
  });

  describe('File Operations', () => {
    it('should show save dialog', async () => {
      const mockPath = '/path/to/file.json';
      vi.mocked(invoke).mockResolvedValue(mockPath);

      const options = { title: 'Save File', defaultPath: 'file.json' };
      const result = await fileOps.showSaveDialog(options);
      
      expect(invoke).toHaveBeenCalledWith('show_save_dialog', { options });
      expect(result).toBe(mockPath);
    });

    it('should show open dialog', async () => {
      const mockPath = '/path/to/file.json';
      vi.mocked(invoke).mockResolvedValue(mockPath);

      const options = { title: 'Open File', filters: ['.json'] };
      const result = await fileOps.showOpenDialog(options);
      
      expect(invoke).toHaveBeenCalledWith('show_open_dialog', { options });
      expect(result).toBe(mockPath);
    });

    it('should write file', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await fileOps.writeFile('/path/to/file.txt', 'content');
      
      expect(invoke).toHaveBeenCalledWith('write_file', {
        filePath: '/path/to/file.txt',
        data: 'content'
      });
    });

    it('should read file', async () => {
      vi.mocked(invoke).mockResolvedValue('file contents');

      const result = await fileOps.readFile('/path/to/file.txt');
      
      expect(invoke).toHaveBeenCalledWith('read_file', {
        filePath: '/path/to/file.txt'
      });
      expect(result).toBe('file contents');
    });
  });

  describe('Database Operations - Extended', () => {
    it('should get single collection', async () => {
      const mockCollection = { id: 1, name: 'API Tests', description: 'Tests' };
      vi.mocked(invoke).mockResolvedValue(mockCollection);

      const result = await db.getCollection(1);

      expect(invoke).toHaveBeenCalledWith('db_get_collection', { id: 1 });
      expect(result).toEqual(mockCollection);
    });

    it('should get single request', async () => {
      const mockRequest = { id: 5, name: 'GET Users', method: 'GET', url: '/users' };
      vi.mocked(invoke).mockResolvedValue(mockRequest);

      const result = await db.getRequest(5);

      expect(invoke).toHaveBeenCalledWith('db_get_request', { id: 5 });
      expect(result).toEqual(mockRequest);
    });

    it('should update request', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      const data = { name: 'Updated', method: 'PUT', url: '/users/1' };

      await db.updateRequest(5, data);

      expect(invoke).toHaveBeenCalledWith('db_update_request', { id: 5, requestData: data });
    });

    it('should delete history item', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.deleteHistory(42);

      expect(invoke).toHaveBeenCalledWith('db_delete_history', { id: 42 });
    });

    it('should get all settings', async () => {
      const mockSettings = { theme: 'dark', fontSize: 14 };
      vi.mocked(invoke).mockResolvedValue(mockSettings);

      const result = await db.getAllSettings();

      expect(invoke).toHaveBeenCalledWith('db_get_all_settings');
      expect(result).toEqual(mockSettings);
    });

    it('should get variables for collection', async () => {
      const mockVars = [{ key: 'token', value: 'abc123' }];
      vi.mocked(invoke).mockResolvedValue(mockVars);

      const result = await db.getVariables(1);

      expect(invoke).toHaveBeenCalledWith('db_get_variables', { collectionId: 1 });
      expect(result).toEqual(mockVars);
    });

    it('should set variable', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.setVariable(1, 'token', 'xyz789');

      expect(invoke).toHaveBeenCalledWith('db_set_variable', { collectionId: 1, key: 'token', value: 'xyz789' });
    });

    it('should delete variable', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.deleteVariable(1, 'token');

      expect(invoke).toHaveBeenCalledWith('db_delete_variable', { collectionId: 1, key: 'token' });
    });

    it('should clear variables', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.clearVariables(1);

      expect(invoke).toHaveBeenCalledWith('db_clear_variables', { collectionId: 1 });
    });

    it('should rename collection', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.renameCollection(1, 'New Name');

      expect(invoke).toHaveBeenCalledWith('db_rename_collection', { id: 1, name: 'New Name' });
    });

    it('should rename request', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.renameRequest(5, 'Updated Request');

      expect(invoke).toHaveBeenCalledWith('db_rename_request', { id: 5, name: 'Updated Request' });
    });

    it('should reorder requests', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.reorderRequests([3, 1, 2]);

      expect(invoke).toHaveBeenCalledWith('db_reorder_requests', { requestIds: [3, 1, 2] });
    });

    it('should move request to another collection', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.moveRequest(5, 2);

      expect(invoke).toHaveBeenCalledWith('db_move_request', { requestId: 5, targetCollectionId: 2 });
    });

    it('should export single collection', async () => {
      vi.mocked(invoke).mockResolvedValue('{"name":"API","requests":[]}');

      const result = await db.exportSingleCollection(1);

      expect(invoke).toHaveBeenCalledWith('db_export_single_collection', { collectionId: 1 });
      expect(result).toContain('API');
    });

    it('should import single collection', async () => {
      vi.mocked(invoke).mockResolvedValue(42);

      const result = await db.importSingleCollection('{"name":"Imported"}');

      expect(invoke).toHaveBeenCalledWith('db_import_single_collection', { jsonData: '{"name":"Imported"}' });
      expect(result).toBe(42);
    });

    it('should create folder', async () => {
      vi.mocked(invoke).mockResolvedValue(10);

      const result = await db.createFolder('New Folder', null);

      expect(invoke).toHaveBeenCalledWith('db_create_folder', { name: 'New Folder', parentId: null });
      expect(result).toBe(10);
    });

    it('should create nested folder', async () => {
      vi.mocked(invoke).mockResolvedValue(11);

      const result = await db.createFolder('Sub Folder', 10);

      expect(invoke).toHaveBeenCalledWith('db_create_folder', { name: 'Sub Folder', parentId: 10 });
      expect(result).toBe(11);
    });

    it('should move collection', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.moveCollection(5, 10);

      expect(invoke).toHaveBeenCalledWith('db_move_collection', { id: 5, parentId: 10 });
    });

    it('should move collection to root', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await db.moveCollection(5, null);

      expect(invoke).toHaveBeenCalledWith('db_move_collection', { id: 5, parentId: null });
    });
  });

  describe('App Operations', () => {
    it('should get version', async () => {
      vi.mocked(invoke).mockResolvedValue('0.0.24');

      const result = await app.getVersion();
      
      expect(invoke).toHaveBeenCalledWith('get_version');
      expect(result).toBe('0.0.24');
    });
  });

  describe('HTTP Client', () => {
    it('should execute GET request', async () => {
      const mockResponse = { status: 200, body: '{"ok":true}', headers: {} };
      vi.mocked(invoke).mockResolvedValue(mockResponse);

      const result = await http.executeRequest('GET', 'https://api.example.com/users');

      expect(invoke).toHaveBeenCalledWith('execute_http_request', {
        method: 'GET', url: 'https://api.example.com/users', headers: undefined, body: undefined
      });
      expect(result).toEqual(mockResponse);
    });

    it('should execute POST request with body and headers', async () => {
      vi.mocked(invoke).mockResolvedValue({ status: 201 });

      await http.executeRequest(
        'POST',
        'https://api.example.com/users',
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' },
        '{"name":"Ada"}'
      );

      expect(invoke).toHaveBeenCalledWith('execute_http_request', {
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' },
        body: '{"name":"Ada"}'
      });
    });
  });

  describe('SQL Client', () => {
    it('should connect to postgres', async () => {
      vi.mocked(invoke).mockResolvedValue('conn-123');

      const result = await sql.connect('postgres', 'localhost', 5432, 'mydb', 'admin', 'secret');

      expect(invoke).toHaveBeenCalledWith('sql_connect', {
        dbType: 'postgres', host: 'localhost', port: 5432,
        database: 'mydb', username: 'admin', password: 'secret'
      });
      expect(result).toBe('conn-123');
    });

    it('should execute SQL query', async () => {
      const mockResult = { columns: [{ name: 'id', type: 'int4' }], rows: [{ id: 1 }], rowCount: 1, executionTimeMs: 5, isSelect: true };
      vi.mocked(invoke).mockResolvedValue(mockResult);

      const result = await sql.query('conn-123', 'SELECT * FROM users');

      expect(invoke).toHaveBeenCalledWith('sql_query', { connectionId: 'conn-123', sql: 'SELECT * FROM users' });
      expect(result).toEqual(mockResult);
    });

    it('should disconnect', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await sql.disconnect('conn-123');

      expect(invoke).toHaveBeenCalledWith('sql_disconnect', { connectionId: 'conn-123' });
    });
  });

  describe('WebSocket Client', () => {
    it('should connect with headers', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await ws.connect('tab-1', 'ws://localhost:8080', { Authorization: 'Bearer tok' });

      expect(invoke).toHaveBeenCalledWith('ws_connect', {
        id: 'tab-1', url: 'ws://localhost:8080', headers: { Authorization: 'Bearer tok' }
      });
    });

    it('should send message', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await ws.send('tab-1', '{"action":"ping"}');

      expect(invoke).toHaveBeenCalledWith('ws_send', { id: 'tab-1', message: '{"action":"ping"}' });
    });

    it('should disconnect', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await ws.disconnect('tab-1');

      expect(invoke).toHaveBeenCalledWith('ws_disconnect', { id: 'tab-1' });
    });
  });

  describe('fileOps.readFileBase64', () => {
    it('should read a file and return base64 data', async () => {
      vi.mocked(invoke).mockResolvedValue({ name: 'test.xlsx', size: 1024, base64: 'dGVzdA==' });

      const result = await fileOps.readFileBase64('/path/to/test.xlsx');

      expect(invoke).toHaveBeenCalledWith('read_file_base64', { filePath: '/path/to/test.xlsx' });
      expect(result.name).toBe('test.xlsx');
      expect(result.size).toBe(1024);
      expect(result.base64).toBe('dGVzdA==');
    });
  });

  describe('http.executeRequest with settings', () => {
    it('should pass timeout and proxy options to invoke', async () => {
      vi.mocked(invoke).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '{}', responseTime: 50 });

      await http.executeRequest('GET', 'https://api.com', undefined, undefined, {
        timeout: 60,
        proxyUrl: 'http://proxy:8080',
        sslVerification: true,
        followRedirects: true,
        maxRedirects: 5,
      });

      expect(invoke).toHaveBeenCalledWith('execute_http_request', {
        method: 'GET',
        url: 'https://api.com',
        headers: undefined,
        body: undefined,
        timeoutSecs: 60,
        proxyUrl: 'http://proxy:8080',
        sslVerify: true,
        followRedirects: true,
        maxRedirects: 5,
      });
    });

    it('should send undefined options when no settings provided', async () => {
      vi.mocked(invoke).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '', responseTime: 10 });

      await http.executeRequest('POST', 'https://api.com', { 'Content-Type': 'application/json' }, '{}');

      expect(invoke).toHaveBeenCalledWith('execute_http_request', {
        method: 'POST',
        url: 'https://api.com',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        timeoutSecs: undefined,
        proxyUrl: undefined,
        sslVerify: undefined,
        followRedirects: undefined,
        maxRedirects: undefined,
      });
    });
  });
});
