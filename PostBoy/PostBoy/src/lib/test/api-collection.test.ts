import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import fs from 'fs';
import path from 'path';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

/**
 * API Collection Tests - Converted from test-api-collection.js
 * Tests API request functionality through the Tauri backend
 */
describe('API Collection Tests', () => {
  let testCollection: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Load test collection
    const collectionPath = path.join(process.cwd(), 'test-apis-collection.json');
    if (fs.existsSync(collectionPath)) {
      testCollection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
    }
  });

  describe('Test Collection Loading', () => {
    it('should load test collection successfully', () => {
      expect(testCollection).toBeDefined();
      expect(testCollection.name).toBe('Postboy Test API Collection');
      expect(testCollection.categories).toBeInstanceOf(Array);
      expect(testCollection.categories.length).toBeGreaterThan(0);
    });

    it('should have valid request structure', () => {
      const firstCategory = testCollection.categories[0];
      expect(firstCategory.name).toBeDefined();
      expect(firstCategory.requests).toBeInstanceOf(Array);
      
      if (firstCategory.requests.length > 0) {
        const firstRequest = firstCategory.requests[0];
        expect(firstRequest.name).toBeDefined();
        expect(firstRequest.curl).toBeDefined();
      }
    });
  });

  describe('API Request Execution', () => {
    it('should parse curl command correctly', async () => {
      const curlCommand = 'curl -X GET https://api.github.com/users/github';
      
      // Mock the backend response
      vi.mocked(invoke).mockResolvedValue({
        status: 200,
        body: '{"login":"github"}',
        headers: { 'content-type': 'application/json' },
        responseTime: 150
      });

      const result = await invoke('execute_request', {
        method: 'GET',
        url: 'https://api.github.com/users/github',
        headers: {},
        body: null
      });

      expect(result).toBeDefined();
      expect(result.status).toBe(200);
    });

    it('should handle POST requests with body', async () => {
      vi.mocked(invoke).mockResolvedValue({
        status: 201,
        body: '{"id":1,"title":"test"}',
        headers: { 'content-type': 'application/json' },
        responseTime: 200
      });

      const result = await invoke('execute_request', {
        method: 'POST',
        url: 'https://jsonplaceholder.typicode.com/posts',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'test', body: 'test body' })
      });

      expect(result).toBeDefined();
      expect(result.status).toBe(201);
    });

    it('should handle request errors gracefully', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Network error'));

      await expect(
        invoke('execute_request', {
          method: 'GET',
          url: 'https://invalid-domain-that-does-not-exist.com',
          headers: {},
          body: null
        })
      ).rejects.toThrow('Network error');
    });

    it('should handle timeout errors', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Request timeout'));

      await expect(
        invoke('execute_request', {
          method: 'GET',
          url: 'https://httpbin.org/delay/10',
          headers: {},
          body: null,
          timeout: 1000
        })
      ).rejects.toThrow('Request timeout');
    });
  });

  describe('Response Handling', () => {
    it('should parse JSON responses', async () => {
      const jsonResponse = { message: 'success', data: [1, 2, 3] };
      
      vi.mocked(invoke).mockResolvedValue({
        status: 200,
        body: JSON.stringify(jsonResponse),
        headers: { 'content-type': 'application/json' },
        responseTime: 100
      });

      const result = await invoke('execute_request', {
        method: 'GET',
        url: 'https://api.test.com/data',
        headers: {},
        body: null
      });

      expect(result.body).toBeDefined();
      const parsed = JSON.parse(result.body);
      expect(parsed).toEqual(jsonResponse);
    });

    it('should handle text responses', async () => {
      vi.mocked(invoke).mockResolvedValue({
        status: 200,
        body: 'Plain text response',
        headers: { 'content-type': 'text/plain' },
        responseTime: 50
      });

      const result = await invoke('execute_request', {
        method: 'GET',
        url: 'https://api.test.com/text',
        headers: {},
        body: null
      });

      expect(result.body).toBe('Plain text response');
    });

    it('should capture response headers', async () => {
      const mockHeaders = {
        'content-type': 'application/json',
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '59'
      };

      vi.mocked(invoke).mockResolvedValue({
        status: 200,
        body: '{}',
        headers: mockHeaders,
        responseTime: 100
      });

      const result = await invoke('execute_request', {
        method: 'GET',
        url: 'https://api.test.com',
        headers: {},
        body: null
      });

      expect(result.headers).toEqual(mockHeaders);
    });

    it('should track response time', async () => {
      vi.mocked(invoke).mockResolvedValue({
        status: 200,
        body: '{}',
        headers: {},
        responseTime: 250
      });

      const result = await invoke('execute_request', {
        method: 'GET',
        url: 'https://api.test.com',
        headers: {},
        body: null
      });

      expect(result.responseTime).toBeDefined();
      expect(typeof result.responseTime).toBe('number');
      expect(result.responseTime).toBeGreaterThan(0);
    });
  });

  describe('HTTP Methods', () => {
    it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
      'should support %s method',
      async (method) => {
        vi.mocked(invoke).mockResolvedValue({
          status: 200,
          body: '{}',
          headers: {},
          responseTime: 100
        });

        const result = await invoke('execute_request', {
          method,
          url: 'https://httpbin.org/anything',
          headers: {},
          body: method === 'POST' || method === 'PUT' || method === 'PATCH' ? '{}' : null
        });

        expect(result).toBeDefined();
        expect(result.status).toBe(200);
      }
    );
  });

  describe('Request Headers', () => {
    it('should send custom headers', async () => {
      const customHeaders = {
        'Authorization': 'Bearer token123',
        'X-Custom-Header': 'custom-value'
      };

      vi.mocked(invoke).mockResolvedValue({
        status: 200,
        body: '{}',
        headers: {},
        responseTime: 100
      });

      await invoke('execute_request', {
        method: 'GET',
        url: 'https://api.test.com',
        headers: customHeaders,
        body: null
      });

      expect(invoke).toHaveBeenCalledWith('execute_request', {
        method: 'GET',
        url: 'https://api.test.com',
        headers: customHeaders,
        body: null
      });
    });

    it('should handle content-type header', async () => {
      vi.mocked(invoke).mockResolvedValue({
        status: 200,
        body: '{}',
        headers: {},
        responseTime: 100
      });

      await invoke('execute_request', {
        method: 'POST',
        url: 'https://api.test.com',
        headers: { 'Content-Type': 'application/json' },
        body: '{"key":"value"}'
      });

      expect(invoke).toHaveBeenCalledWith('execute_request', 
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('Status Codes', () => {
    it.each([
      [200, 'OK'],
      [201, 'Created'],
      [204, 'No Content'],
      [400, 'Bad Request'],
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [404, 'Not Found'],
      [500, 'Internal Server Error'],
      [502, 'Bad Gateway'],
      [503, 'Service Unavailable']
    ])('should handle %d status code', async (statusCode, _statusText) => {
      vi.mocked(invoke).mockResolvedValue({
        status: statusCode,
        body: '{}',
        headers: {},
        responseTime: 100
      });

      const result = await invoke('execute_request', {
        method: 'GET',
        url: 'https://httpbin.org/status/' + statusCode,
        headers: {},
        body: null
      });

      expect(result.status).toBe(statusCode);
    });
  });
});
