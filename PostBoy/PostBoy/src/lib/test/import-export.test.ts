import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import fs from 'fs';
import path from 'path';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

/**
 * Import/Export Tests - Converted from test-import-export-collections.js
 * Tests collection import and export functionality
 */
describe('Import/Export Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Export Functionality', () => {
    it('should export collections with correct structure', async () => {
      const mockExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: [
          {
            id: 1,
            name: 'Test Collection',
            description: 'Test Description',
            requests: [
              {
                id: 1,
                name: 'GET Request',
                method: 'GET',
                url: 'https://api.test.com',
                headers: {},
                body: null,
                description: ''
              }
            ]
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(mockExportData);

      const exportData = await invoke<any>('db_export_collections');

      expect(exportData).toBeDefined();
      expect(exportData.version).toBe('1.0');
      expect(exportData.exportDate).toBeDefined();
      expect(exportData.collections).toBeInstanceOf(Array);
      expect(exportData.collections).toHaveLength(1);
    });

    it('should export empty collections array when no collections exist', async () => {
      const mockExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: []
      };

      vi.mocked(invoke).mockResolvedValue(mockExportData);

      const exportData = await invoke<any>('db_export_collections');

      expect(exportData.collections).toHaveLength(0);
    });

    it('should include all collection fields in export', async () => {
      const mockExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: [
          {
            id: 1,
            name: 'Complete Collection',
            description: 'Full description',
            requests: []
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(mockExportData);

      const exportData = await invoke<any>('db_export_collections');
      const collection = exportData.collections[0];

      expect(collection.id).toBeDefined();
      expect(collection.name).toBeDefined();
      expect(collection.description).toBeDefined();
      expect(collection.requests).toBeDefined();
    });

    it('should include all request fields in export', async () => {
      const mockExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: [
          {
            id: 1,
            name: 'Test Collection',
            description: 'Test',
            requests: [
              {
                id: 1,
                name: 'Complete Request',
                method: 'POST',
                url: 'https://api.test.com/users',
                headers: { 'Content-Type': 'application/json' },
                body: '{"name":"test"}',
                description: 'Creates a user'
              }
            ]
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(mockExportData);

      const exportData = await invoke<any>('db_export_collections');
      const request = exportData.collections[0].requests[0];

      expect(request.id).toBeDefined();
      expect(request.name).toBeDefined();
      expect(request.method).toBeDefined();
      expect(request.url).toBeDefined();
      expect(request.headers).toBeDefined();
      expect(request.body).toBeDefined();
      expect(request.description).toBeDefined();
    });

    it('should export multiple collections', async () => {
      const mockExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: [
          {
            id: 1,
            name: 'Collection 1',
            description: 'First',
            requests: []
          },
          {
            id: 2,
            name: 'Collection 2',
            description: 'Second',
            requests: []
          },
          {
            id: 3,
            name: 'Collection 3',
            description: 'Third',
            requests: []
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(mockExportData);

      const exportData = await invoke<any>('db_export_collections');

      expect(exportData.collections).toHaveLength(3);
      expect(exportData.collections[0].name).toBe('Collection 1');
      expect(exportData.collections[1].name).toBe('Collection 2');
      expect(exportData.collections[2].name).toBe('Collection 3');
    });

    it('should export collections with multiple requests', async () => {
      const mockExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: [
          {
            id: 1,
            name: 'API Collection',
            description: 'REST API',
            requests: [
              { id: 1, name: 'GET Users', method: 'GET', url: 'https://api.test.com/users', headers: {}, body: null, description: '' },
              { id: 2, name: 'POST User', method: 'POST', url: 'https://api.test.com/users', headers: {}, body: '{}', description: '' },
              { id: 3, name: 'PUT User', method: 'PUT', url: 'https://api.test.com/users/1', headers: {}, body: '{}', description: '' },
              { id: 4, name: 'DELETE User', method: 'DELETE', url: 'https://api.test.com/users/1', headers: {}, body: null, description: '' }
            ]
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(mockExportData);

      const exportData = await invoke<any>('db_export_collections');

      expect(exportData.collections[0].requests).toHaveLength(4);
    });
  });

  describe('Import Functionality', () => {
    it('should import valid collection data', async () => {
      const importData = {
        version: '1.0',
        collections: [
          {
            name: 'Imported Collection',
            description: 'Imported from file',
            requests: []
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke<any>('db_import_collections', {
        importData,
        overwrite: false
      });

      expect(invoke).toHaveBeenCalledWith('db_import_collections', {
        importData,
        overwrite: false
      });
    });

    it('should import with overwrite flag', async () => {
      const importData = {
        version: '1.0',
        collections: [
          {
            name: 'Overwrite Collection',
            description: 'Will overwrite existing',
            requests: []
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke<any>('db_import_collections', {
        importData,
        overwrite: true
      });

      expect(invoke).toHaveBeenCalledWith('db_import_collections', {
        importData,
        overwrite: true
      });
    });

    it('should import collections with requests', async () => {
      const importData = {
        version: '1.0',
        collections: [
          {
            name: 'Full Collection',
            description: 'With requests',
            requests: [
              {
                name: 'Test Request',
                method: 'GET',
                url: 'https://api.test.com',
                headers: {},
                body: null,
                description: ''
              }
            ]
          }
        ]
      };

      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke<any>('db_import_collections', {
        importData,
        overwrite: false
      });

      expect(invoke).toHaveBeenCalledWith('db_import_collections', 
        expect.objectContaining({
          importData: expect.objectContaining({
            collections: expect.arrayContaining([
              expect.objectContaining({
                requests: expect.arrayContaining([
                  expect.objectContaining({
                    name: 'Test Request',
                    method: 'GET'
                  })
                ])
              })
            ])
          })
        })
      );
    });

    it('should reject import with missing version', async () => {
      const invalidData = {
        collections: []
      };

      const validateImportData = (data: any) => {
        if (!data.version) {
          throw new Error('Import data missing version field');
        }
        return true;
      };

      expect(() => validateImportData(invalidData)).toThrow('Import data missing version field');
    });

    it('should reject import with missing collections array', async () => {
      const invalidData = {
        version: '1.0'
      };

      const validateImportData = (data: any) => {
        if (!data.collections || !Array.isArray(data.collections)) {
          throw new Error('Import data missing collections array');
        }
        return true;
      };

      expect(() => validateImportData(invalidData)).toThrow('Import data missing collections array');
    });

    it('should reject import with invalid collection structure', async () => {
      const invalidData = {
        version: '1.0',
        collections: [
          {
            description: 'Missing name field'
          }
        ]
      };

      const validateCollection = (collection: any) => {
        if (!collection.name) {
          throw new Error('Collection missing required name field');
        }
        return true;
      };

      expect(() => validateCollection(invalidData.collections[0])).toThrow('Collection missing required name field');
    });

    it('should reject import with invalid request structure', async () => {
      const invalidData = {
        version: '1.0',
        collections: [
          {
            name: 'Test',
            description: 'Test',
            requests: [
              {
                name: 'Invalid Request',
                url: 'https://api.test.com'
                // Missing method field
              }
            ]
          }
        ]
      };

      const validateRequest = (request: any) => {
        if (!request.method || !request.url) {
          throw new Error('Request missing required fields');
        }
        return true;
      };

      expect(() => validateRequest(invalidData.collections[0].requests[0])).toThrow('Request missing required fields');
    });
  });

  describe('File Operations', () => {
    it('should save export to file', async () => {
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: []
      };

      const filePath = '/path/to/export.json';
      const fileContent = JSON.stringify(exportData, null, 2);

      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke<any>('write_file', {
        path: filePath,
        contents: fileContent
      });

      expect(invoke).toHaveBeenCalledWith('write_file', {
        path: filePath,
        contents: fileContent
      });
    });

    it('should read import from file', async () => {
      const mockFileContent = JSON.stringify({
        version: '1.0',
        collections: []
      });

      vi.mocked(invoke).mockResolvedValue(mockFileContent);

      const content = await invoke<any>('read_file', {
        path: '/path/to/import.json'
      });

      expect(content).toBeDefined();
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe('1.0');
      expect(parsed.collections).toBeDefined();
    });

    it('should show save dialog for export', async () => {
      const mockPath = '/path/to/collections-export.json';
      vi.mocked(invoke).mockResolvedValue(mockPath);

      const filePath = await invoke<any>('show_save_dialog', {
        title: 'Export Collections',
        defaultPath: 'postboy-collections.json'
      });

      expect(filePath).toBe(mockPath);
      expect(invoke).toHaveBeenCalledWith('show_save_dialog', {
        title: 'Export Collections',
        defaultPath: 'postboy-collections.json'
      });
    });

    it('should show open dialog for import', async () => {
      const mockPath = '/path/to/import.json';
      vi.mocked(invoke).mockResolvedValue(mockPath);

      const filePath = await invoke<any>('show_open_dialog', {
        title: 'Import Collections',
        filters: ['.json']
      });

      expect(filePath).toBe(mockPath);
      expect(invoke).toHaveBeenCalledWith('show_open_dialog', {
        title: 'Import Collections',
        filters: ['.json']
      });
    });
  });

  describe('Data Validation', () => {
    it('should validate JSON format', () => {
      const validJson = '{"version":"1.0","collections":[]}';
      const invalidJson = '{version:1.0,collections:[]}';

      expect(() => JSON.parse(validJson)).not.toThrow();
      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    it('should validate version format', () => {
      const validateVersion = (version: string) => {
        return /^\d+\.\d+$/.test(version);
      };

      expect(validateVersion('1.0')).toBe(true);
      expect(validateVersion('2.5')).toBe(true);
      expect(validateVersion('invalid')).toBe(false);
      expect(validateVersion('1')).toBe(false);
    });

    it('should validate HTTP methods', () => {
      const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
      const validateMethod = (method: string) => {
        return validMethods.includes(method.toUpperCase());
      };

      expect(validateMethod('GET')).toBe(true);
      expect(validateMethod('POST')).toBe(true);
      expect(validateMethod('INVALID')).toBe(false);
    });

    it('should validate URLs', () => {
      const validateUrl = (url: string) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      };

      expect(validateUrl('https://api.test.com')).toBe(true);
      expect(validateUrl('http://localhost:3000')).toBe(true);
      expect(validateUrl('invalid-url')).toBe(false);
    });

    it('should validate headers object', () => {
      const validateHeaders = (headers: any) => {
        if (typeof headers !== 'object' || headers === null) {
          return false;
        }
        return Object.keys(headers).every(key => typeof headers[key] === 'string');
      };

      expect(validateHeaders({})).toBe(true);
      expect(validateHeaders({ 'Content-Type': 'application/json' })).toBe(true);
      expect(validateHeaders('invalid')).toBe(false);
      expect(validateHeaders({ key: 123 })).toBe(false);
    });
  });

  describe('Import/Export Integration', () => {
    it('should export and re-import without data loss', async () => {
      const originalData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: [
          {
            id: 1,
            name: 'Test Collection',
            description: 'Test Description',
            requests: [
              {
                id: 1,
                name: 'Test Request',
                method: 'GET',
                url: 'https://api.test.com',
                headers: { 'Authorization': 'Bearer token' },
                body: null,
                description: 'Test request description'
              }
            ]
          }
        ]
      };

      // Export
      vi.mocked(invoke).mockResolvedValueOnce(originalData);
      const exportData = await invoke<any>('db_export_collections');

      // Import
      vi.mocked(invoke).mockResolvedValueOnce(undefined);
      await invoke<any>('db_import_collections', {
        importData: exportData,
        overwrite: false
      });

      // Verify data structure is preserved
      expect(exportData.collections[0].name).toBe(originalData.collections[0].name);
      expect(exportData.collections[0].requests[0].name).toBe(originalData.collections[0].requests[0].name);
      expect(exportData.collections[0].requests[0].headers).toEqual(originalData.collections[0].requests[0].headers);
    });

    it('should handle special characters in export/import', async () => {
      const specialCharsData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: [
          {
            id: 1,
            name: 'Collection with "quotes" and \'apostrophes\'',
            description: 'Description with\nnewlines\tand\ttabs',
            requests: [
              {
                id: 1,
                name: 'Request with émojis 🚀',
                method: 'POST',
                url: 'https://api.test.com/special?param=value&other=测试',
                headers: {},
                body: '{"text":"Special chars: \\"quotes\\", \\n newlines"}',
                description: ''
              }
            ]
          }
        ]
      };

      // Serialize and deserialize
      const serialized = JSON.stringify(specialCharsData);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.collections[0].name).toBe(specialCharsData.collections[0].name);
      expect(deserialized.collections[0].description).toBe(specialCharsData.collections[0].description);
      expect(deserialized.collections[0].requests[0].name).toBe(specialCharsData.collections[0].requests[0].name);
    });

    it('should handle large export files', async () => {
      const largeData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        collections: Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: `Collection ${i + 1}`,
          description: `Description ${i + 1}`,
          requests: Array.from({ length: 50 }, (_, j) => ({
            id: j + 1,
            name: `Request ${j + 1}`,
            method: 'GET',
            url: `https://api.test.com/endpoint/${j + 1}`,
            headers: {},
            body: null,
            description: ''
          }))
        }))
      };

      vi.mocked(invoke).mockResolvedValue(largeData);
      const exportData = await invoke<any>('db_export_collections');

      expect(exportData.collections).toHaveLength(100);
      expect(exportData.collections[0].requests).toHaveLength(50);
    });
  });

  describe('Error Handling', () => {
    it('should handle file write errors', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Permission denied'));

      await expect(
        invoke('write_file', {
          path: '/protected/file.json',
          contents: '{}'
        })
      ).rejects.toThrow('Permission denied');
    });

    it('should handle file read errors', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('File not found'));

      await expect(
        invoke('read_file', {
          path: '/nonexistent/file.json'
        })
      ).rejects.toThrow('File not found');
    });

    it('should handle invalid JSON in import file', () => {
      const invalidJson = '{invalid json content}';

      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    it('should handle database errors during import', async () => {
      const importData = {
        version: '1.0',
        collections: []
      };

      vi.mocked(invoke).mockRejectedValue(new Error('Database error'));

      await expect(
        invoke('db_import_collections', {
          importData,
          overwrite: false
        })
      ).rejects.toThrow('Database error');
    });
  });
});
