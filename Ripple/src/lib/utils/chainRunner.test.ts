import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

import {
  resolveRequest,
  executeStep,
  executeChain,
  extractValues,
  loadChains,
  saveChains,
  suggestVariableName,
  getAvailableVarsForStep,
  type Chain,
  type ChainExtraction,
  type ChainCallbacks,
} from '$lib/utils/chainRunner';

import { variables, interpolate, persistExtractedVariable } from '$lib/stores/variableStore';
import { activeEnvironmentId, envVariables } from '$lib/stores/environmentStore';

function mockDbCalls(overrides: {
  getVariables?: any;
  getRequest?: any;
  executeHttp?: any;
  setVariable?: any;
  getSetting?: any;
  setSetting?: any;
} = {}) {
  const handlers: Record<string, any> = {
    db_get_variables: overrides.getVariables ?? [],
    db_get_request: overrides.getRequest ?? null,
    execute_http_request: overrides.executeHttp ?? { status: 200, statusText: 'OK', body: '{}', responseTime: 50 },
    db_set_variable: overrides.setVariable ?? undefined,
    db_get_setting: overrides.getSetting ?? '[]',
    db_set_setting: overrides.setSetting ?? undefined,
  };

  mockInvoke.mockImplementation((cmd: string, args?: any) => {
    if (cmd in handlers) {
      const val = handlers[cmd];
      return typeof val === 'function' ? val(args) : Promise.resolve(val);
    }
    return Promise.resolve(undefined);
  });
}

describe('resolveRequest', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('resolves a simple GET request with no headers/params/auth', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      { method: 'GET', url: 'https://api.com/users', headers: '[]', params: '[]' },
      1
    );

    expect(result.method).toBe('GET');
    expect(result.url).toBe('https://api.com/users');
    expect(result.headers).toEqual({});
    expect(result.body).toBeUndefined();
  });

  it('appends query params to URL', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com/search',
        headers: '[]',
        params: JSON.stringify([{ key: 'q', value: 'test' }, { key: 'page', value: '1' }])
      },
      1
    );

    expect(result.url).toContain('q=test');
    expect(result.url).toContain('page=1');
    expect(result.url).toMatch(/\?q=test&page=1$/);
  });

  it('replaces existing query string when params array is provided (params is source of truth)', async () => {
    // The request builder auto-mirrors the URL's query string into the params
    // tab, so when params has entries it represents the full intended query.
    // To avoid duplicate params (e.g. ?limit=10&limit=10), the URL's existing
    // query string is dropped and rebuilt from the params array.
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com/search?existing=yes',
        params: JSON.stringify([{ key: 'extra', value: '1' }]),
        headers: '[]'
      },
      1
    );

    expect(result.url).toBe('https://api.com/search?extra=1');
    expect(result.url).not.toContain('existing=yes');
  });

  it('filters out params with empty key or value', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com',
        params: JSON.stringify([{ key: '', value: 'skip' }, { key: 'keep', value: 'yes' }]),
        headers: '[]'
      },
      1
    );

    expect(result.url).not.toContain('skip');
    expect(result.url).toContain('keep=yes');
  });

  it('resolves headers from JSON string', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com',
        headers: JSON.stringify([{ key: 'Accept', value: 'application/json' }]),
        params: '[]'
      },
      1
    );

    expect(result.headers['Accept']).toBe('application/json');
  });

  it('handles invalid JSON in headers gracefully', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      { method: 'GET', url: 'https://api.com', headers: 'not-json', params: '[]' },
      1
    );

    expect(result.headers).toEqual({});
  });

  it('handles invalid JSON in params gracefully', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      { method: 'GET', url: 'https://api.com', headers: '[]', params: 'not-json' },
      1
    );

    expect(result.url).toBe('https://api.com');
  });

  it('adds Bearer auth header', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        auth_type: 'bearer',
        auth_data: JSON.stringify({ token: 'my-token' })
      },
      1
    );

    expect(result.headers['Authorization']).toBe('Bearer my-token');
  });

  it('adds Basic auth header', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        auth_type: 'basic',
        auth_data: JSON.stringify({ username: 'user', password: 'pass' })
      },
      1
    );

    expect(result.headers['Authorization']).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('adds API key as custom header', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        auth_type: 'api-key',
        auth_data: JSON.stringify({ key: 'X-API-Key', value: 'secret' })
      },
      1
    );

    expect(result.headers['X-API-Key']).toBe('secret');
  });

  it('handles invalid auth_data JSON gracefully', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        auth_type: 'bearer',
        auth_data: 'not-json'
      },
      1
    );

    expect(result.headers['Authorization']).toBeUndefined();
  });

  it('resolves JSON body for POST', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'json',
        body_content: '{"name":"test"}'
      },
      1
    );

    expect(result.body).toBe('{"name":"test"}');
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('resolves XML body for POST', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'xml',
        body_content: '<root><name>test</name></root>'
      },
      1
    );

    expect(result.body).toBe('<root><name>test</name></root>');
    expect(result.headers['Content-Type']).toBe('application/xml');
  });

  it('does not set body for GET requests', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'GET',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'json',
        body_content: '{"should":"not appear"}'
      },
      1
    );

    expect(result.body).toBeUndefined();
  });

  it('does not set body for HEAD requests', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'HEAD',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'json',
        body_content: '{"should":"not appear"}'
      },
      1
    );

    expect(result.body).toBeUndefined();
  });

  it('does not set body when body_type is none', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'none',
        body_content: 'ignored'
      },
      1
    );

    expect(result.body).toBeUndefined();
  });

  it('resolves form-urlencoded body', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'form-urlencoded',
        body_content: JSON.stringify([{ key: 'username', value: 'admin' }, { key: 'password', value: 'secret' }])
      },
      1
    );

    expect(result.body).toContain('username=admin');
    expect(result.body).toContain('password=secret');
    expect(result.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('falls back to raw interpolation for non-array form-urlencoded content', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'form-urlencoded',
        body_content: 'raw-body'
      },
      1
    );

    expect(result.body).toBe('raw-body');
    expect(result.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('resolves form-data body with text pairs', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'form-data',
        body_content: JSON.stringify([
          { type: 'text', key: 'field1', value: 'value1' },
          { type: 'text', key: 'field2', value: 'value2' }
        ])
      },
      1
    );

    expect(result.body).toContain('field1');
    expect(result.body).toContain('value1');
    expect(result.headers['Content-Type']).toContain('multipart/form-data');
  });

  it('handles form-data with invalid JSON gracefully', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: '[]',
        params: '[]',
        body_type: 'form-data',
        body_content: 'not-json'
      },
      1
    );

    expect(result.body).toBeUndefined();
  });

  it('resolves graphql body', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const graphqlBody = '{"query":"{ users { id name } }"}';
    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com/graphql',
        headers: '[]',
        params: '[]',
        body_type: 'graphql',
        body_content: graphqlBody
      },
      1
    );

    expect(result.body).toBe(graphqlBody);
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('resolves binary body (file read)', async () => {
    mockDbCalls({
      getVariables: [],
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'read_file_base64') return Promise.resolve({ name: 'file.bin', size: 100, base64: 'YmluYXJ5' });
      return Promise.resolve(undefined);
    });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com/upload',
        headers: '[]',
        params: '[]',
        body_type: 'binary',
        body_content: '/path/to/file.bin'
      },
      1
    );

    expect(result.body).toBe('YmluYXJ5');
    expect(result.headers['Content-Type']).toBe('application/octet-stream');
    expect(result.headers['Content-Transfer-Encoding']).toBe('base64');
  });

  it('handles binary body with failed file read', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'read_file_base64') return Promise.reject(new Error('file not found'));
      return Promise.resolve(undefined);
    });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com/upload',
        headers: '[]',
        params: '[]',
        body_type: 'binary',
        body_content: '/missing/file.bin'
      },
      1
    );

    expect(result.body).toBeUndefined();
  });

  it('does not override existing Content-Type header', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com',
        headers: JSON.stringify([{ key: 'Content-Type', value: 'text/plain' }]),
        params: '[]',
        body_type: 'json',
        body_content: '{"a":1}'
      },
      1
    );

    expect(result.headers['Content-Type']).toBe('text/plain');
  });

  it('interpolates variables in URL, headers, and body', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([
        { key: 'host', value: 'api.example.com' },
        { key: 'token', value: 'xyz123' },
        { key: 'name', value: 'Alice' }
      ]);
      return Promise.resolve(undefined);
    });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://{{host}}/users',
        headers: JSON.stringify([{ key: 'Authorization', value: 'Bearer {{token}}' }]),
        params: '[]',
        body_type: 'json',
        body_content: '{"name":"{{name}}"}'
      },
      1
    );

    expect(result.url).toBe('https://api.example.com/users');
    expect(result.headers['Authorization']).toBe('Bearer xyz123');
    expect(result.body).toBe('{"name":"Alice"}');
  });

  it('uses defaults when auth_type/body_type/headers/params are missing', async () => {
    mockDbCalls({ getVariables: [] });
    await variables.load(1);

    const result = await resolveRequest(
      { method: 'GET', url: 'https://api.com' },
      1
    );

    expect(result.method).toBe('GET');
    expect(result.url).toBe('https://api.com');
    expect(result.headers).toEqual({});
    expect(result.body).toBeUndefined();
  });

  it('handles binary_file_path alternative field name', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'read_file_base64') return Promise.resolve({ name: 'file.bin', size: 50, base64: 'AAAA' });
      return Promise.resolve(undefined);
    });
    await variables.load(1);

    const result = await resolveRequest(
      {
        method: 'POST',
        url: 'https://api.com/upload',
        headers: '[]',
        params: '[]',
        body_type: 'binary',
        binary_file_path: '/alt/path.bin'
      },
      1
    );

    expect(result.body).toBe('AAAA');
  });
});

describe('executeStep', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('executes a request and returns success result', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.resolve({
        name: 'Get Users', method: 'GET', url: 'https://api.com/users',
        headers: '[]', params: '[]'
      });
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 200, statusText: 'OK', body: '{"id":1}', responseTime: 100
      });
      if (cmd === 'db_set_variable') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await variables.load(1);
    const result = await executeStep(1, 1, [{ jsonPath: 'id', variableName: 'userId' }]);

    expect(result.status).toBe('success');
    expect(result.requestName).toBe('Get Users');
    expect(result.requestMethod).toBe('GET');
    expect(result.response?.status).toBe(200);
    expect(result.extractedValues).toHaveLength(1);
    expect(result.extractedValues[0].value).toBe('1');
  });

  it('returns error when request is not found', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_request') return Promise.resolve(null);
      return Promise.resolve([]);
    });

    const result = await executeStep(999, 1, []);

    expect(result.status).toBe('error');
    expect(result.error).toContain('999');
    expect(result.requestName).toBe('Unknown');
  });

  it('returns error status for 4xx/5xx responses', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.resolve({
        name: 'Bad Req', method: 'GET', url: 'https://api.com/404',
        headers: '[]', params: '[]'
      });
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 404, statusText: 'Not Found', body: '', responseTime: 10
      });
      return Promise.resolve(undefined);
    });

    await variables.load(1);
    const result = await executeStep(1, 1, []);

    expect(result.status).toBe('error');
    expect(result.error).toContain('404');
  });

  it('stores extracted values as variables', async () => {
    const setVariableCalls: any[] = [];
    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.resolve({
        name: 'Login', method: 'POST', url: 'https://api.com/login',
        headers: '[]', params: '[]', body_type: 'json', body_content: '{}'
      });
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 200, statusText: 'OK', body: JSON.stringify({ token: 'abc', userId: 42 }), responseTime: 50
      });
      if (cmd === 'db_set_variable') {
        setVariableCalls.push(args);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    await variables.load(1);
    await executeStep(1, 1, [
      { jsonPath: 'token', variableName: 'authToken' },
      { jsonPath: 'userId', variableName: 'uid' }
    ]);

    expect(setVariableCalls).toHaveLength(2);
    expect(setVariableCalls[0]).toEqual({ collectionId: 1, key: 'authToken', value: 'abc' });
    expect(setVariableCalls[1]).toEqual({ collectionId: 1, key: 'uid', value: '42' });
  });

  it('uses defaults for request with missing name/method', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.resolve({
        url: 'https://api.com', headers: '[]', params: '[]'
      });
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 200, body: '', responseTime: 0
      });
      return Promise.resolve(undefined);
    });

    await variables.load(1);
    const result = await executeStep(1, 1, []);

    expect(result.requestName).toBe('Untitled');
    expect(result.requestMethod).toBe('GET');
  });
});

describe('executeChain', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('executes all steps in order and returns results', async () => {
    let callCount = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') {
        callCount++;
        return Promise.resolve({
          name: `Step ${callCount}`, method: 'GET',
          url: `https://api.com/step${callCount}`,
          headers: '[]', params: '[]'
        });
      }
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 200, statusText: 'OK', body: '{}', responseTime: 10
      });
      return Promise.resolve(undefined);
    });

    const chain: Chain = {
      id: 'c1', name: 'Test',
      steps: [
        { id: 's1', requestId: 1, extractions: [] },
        { id: 's2', requestId: 2, extractions: [] }
      ]
    };

    const results = await executeChain(chain, 1);

    expect(results).toHaveLength(2);
    expect(results[0].stepIndex).toBe(0);
    expect(results[0].status).toBe('success');
    expect(results[1].stepIndex).toBe(1);
    expect(results[1].status).toBe('success');
  });

  it('skips remaining steps after a step error', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.resolve({
        name: 'Fail', method: 'GET', url: 'https://api.com/fail',
        headers: '[]', params: '[]'
      });
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 500, statusText: 'Error', body: '', responseTime: 5
      });
      return Promise.resolve(undefined);
    });

    const chain: Chain = {
      id: 'c1', name: 'Test',
      steps: [
        { id: 's1', requestId: 1, extractions: [] },
        { id: 's2', requestId: 2, extractions: [] },
        { id: 's3', requestId: 3, extractions: [] }
      ]
    };

    const results = await executeChain(chain, 1);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('error');
    expect(results[1].status).toBe('skipped');
    expect(results[1].stepIndex).toBe(1);
    expect(results[2].status).toBe('skipped');
    expect(results[2].stepIndex).toBe(2);
  });

  it('skips remaining steps after a step throws', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.reject(new Error('network failure'));
      return Promise.resolve(undefined);
    });

    const chain: Chain = {
      id: 'c1', name: 'Test',
      steps: [
        { id: 's1', requestId: 1, extractions: [] },
        { id: 's2', requestId: 2, extractions: [] }
      ]
    };

    const results = await executeChain(chain, 1);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('network failure');
    expect(results[1].status).toBe('skipped');
  });

  it('invokes all callbacks correctly', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.resolve({
        name: 'Step', method: 'GET', url: 'https://api.com',
        headers: '[]', params: '[]'
      });
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 200, statusText: 'OK', body: '{"key":"val"}', responseTime: 20
      });
      if (cmd === 'db_set_variable') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const callbacks: ChainCallbacks = {
      onStepStart: vi.fn(),
      onStepComplete: vi.fn(),
      onLog: vi.fn(),
    };

    const chain: Chain = {
      id: 'c1', name: 'Test',
      steps: [{
        id: 's1', requestId: 1,
        extractions: [{ jsonPath: 'key', variableName: 'myVar' }]
      }]
    };

    await executeChain(chain, 1, callbacks);

    expect(callbacks.onStepStart).toHaveBeenCalledWith(0);
    expect(callbacks.onStepComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onLog).toHaveBeenCalled();

    const logCalls = (callbacks.onLog as any).mock.calls;
    const extractionLog = logCalls.find((c: any) => c[0].includes('Extracted'));
    expect(extractionLog).toBeDefined();
    expect(extractionLog[1]).toBe('system');
  });

  it('masks long extracted values in log output', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.resolve({
        name: 'Step', method: 'GET', url: 'https://api.com',
        headers: '[]', params: '[]'
      });
      if (cmd === 'execute_http_request') return Promise.resolve({
        status: 200, statusText: 'OK',
        body: JSON.stringify({ longToken: 'abcdefghijklmnop' }),
        responseTime: 10
      });
      if (cmd === 'db_set_variable') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const callbacks: ChainCallbacks = {
      onLog: vi.fn(),
    };

    const chain: Chain = {
      id: 'c1', name: 'Test',
      steps: [{
        id: 's1', requestId: 1,
        extractions: [{ jsonPath: 'longToken', variableName: 'tok' }]
      }]
    };

    await executeChain(chain, 1, callbacks);

    const logCalls = (callbacks.onLog as any).mock.calls;
    const extractionLog = logCalls.find((c: any) => c[0].includes('Extracted'));
    expect(extractionLog[0]).toContain('abcd...');
    expect(extractionLog[0]).toContain('...mnop');
    expect(extractionLog[0]).not.toContain('abcdefghijklmnop');
  });

  it('calls error log callback when step throws', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_get_request') return Promise.reject(new Error('crash'));
      return Promise.resolve(undefined);
    });

    const callbacks: ChainCallbacks = {
      onStepStart: vi.fn(),
      onStepComplete: vi.fn(),
      onLog: vi.fn(),
    };

    const chain: Chain = {
      id: 'c1', name: 'Test',
      steps: [{ id: 's1', requestId: 1, extractions: [] }]
    };

    await executeChain(chain, 1, callbacks);

    expect(callbacks.onStepStart).toHaveBeenCalledWith(0);
    expect(callbacks.onStepComplete).toHaveBeenCalledTimes(1);
    const errorLog = (callbacks.onLog as any).mock.calls.find(
      (c: any) => c[1] === 'error' && c[0].includes('Failed')
    );
    expect(errorLog).toBeDefined();
  });

  it('handles empty chain with no steps', async () => {
    mockDbCalls({ getVariables: [] });

    const chain: Chain = { id: 'c1', name: 'Empty', steps: [] };
    const results = await executeChain(chain, 1);

    expect(results).toEqual([]);
  });

  it('step 2 uses accessToken extracted in step 1 when the same key exists in the active environment', async () => {
    const STALE = 'stale-expired-token';
    const FRESH = 'fresh-token-from-step-1';
    const ENV_ID = 10;
    let httpCalls = 0;
    let step2Authorization: string | undefined;

    activeEnvironmentId.set(ENV_ID);

    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'db_get_variables') {
        return Promise.resolve([{ key: 'accessToken', value: STALE }]);
      }
      if (cmd === 'db_get_environment_variables') {
        return Promise.resolve([
          { key: 'accessToken', value: STALE, initial_value: STALE, enabled: true },
        ]);
      }
      if (cmd === 'db_set_variable' || cmd === 'db_set_environment_variable') {
        return Promise.resolve(undefined);
      }
      if (cmd === 'db_get_request') {
        const id = args?.id;
        if (id === 1) {
          return Promise.resolve({
            name: 'Login',
            method: 'POST',
            url: 'https://api.com/login',
            headers: '[]',
            params: '[]',
          });
        }
        if (id === 2) {
          return Promise.resolve({
            name: 'Get License',
            method: 'GET',
            url: 'https://api.com/license',
            headers: JSON.stringify([{ key: 'Authorization', value: 'Bearer {{accessToken}}' }]),
            params: '[]',
            auth_type: 'none',
          });
        }
      }
      if (cmd === 'execute_http_request') {
        httpCalls++;
        if (httpCalls === 1) {
          return Promise.resolve({
            status: 200,
            statusText: 'OK',
            body: JSON.stringify({ accessToken: FRESH }),
            responseTime: 100,
          });
        }
        step2Authorization = args?.headers?.Authorization;
        return Promise.resolve({
          status: 200,
          statusText: 'OK',
          body: '{}',
          responseTime: 50,
        });
      }
      return Promise.resolve(undefined);
    });

    await variables.load(1);
    await envVariables.load(ENV_ID);

    // After chain extraction, both collection and active environment must be updated.
    await persistExtractedVariable(1, 'accessToken', FRESH);
    expect(interpolate('Bearer {{accessToken}}', 1)).toBe(`Bearer ${FRESH}`);

    const chain: Chain = {
      id: 'c1',
      name: 'GetLicense',
      steps: [
        {
          id: 's1',
          requestId: 1,
          extractions: [{ jsonPath: 'accessToken', variableName: 'accessToken' }],
        },
        { id: 's2', requestId: 2, extractions: [] },
      ],
    };

    const results = await executeChain(chain, 1);

    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('success');
    expect(step2Authorization).toBe(`Bearer ${FRESH}`);
    expect(envVariables.getForEnvironment(ENV_ID).find((v) => v.key === 'accessToken')?.value).toBe(FRESH);

    activeEnvironmentId.set(null);
  });

  it('step 2 uses extracted token when bearer auth tab stores a stale literal JWT', async () => {
    const STALE = 'stale-expired-token';
    const FRESH = 'fresh-token-from-step-1';
    let httpCalls = 0;
    let step2Authorization: string | undefined;

    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'db_get_variables') {
        return Promise.resolve([{ key: 'accessToken', value: STALE }]);
      }
      if (cmd === 'db_get_environment_variables') {
        return Promise.resolve([]);
      }
      if (cmd === 'db_set_variable' || cmd === 'db_set_environment_variable') {
        return Promise.resolve(undefined);
      }
      if (cmd === 'db_get_request') {
        const id = args?.id;
        if (id === 1) {
          return Promise.resolve({
            name: 'Login',
            method: 'POST',
            url: 'https://api.com/login',
            headers: '[]',
            params: '[]',
          });
        }
        if (id === 2) {
          return Promise.resolve({
            name: 'Get License',
            method: 'GET',
            url: 'https://api.com/license',
            headers: JSON.stringify([{ key: 'Authorization', value: 'Bearer {{accessToken}}' }]),
            params: '[]',
            auth_type: 'bearer',
            auth_data: JSON.stringify({ token: STALE }),
          });
        }
      }
      if (cmd === 'execute_http_request') {
        httpCalls++;
        if (httpCalls === 1) {
          return Promise.resolve({
            status: 200,
            statusText: 'OK',
            body: JSON.stringify({ accessToken: FRESH }),
            responseTime: 100,
          });
        }
        step2Authorization = args?.headers?.Authorization;
        return Promise.resolve({
          status: 200,
          statusText: 'OK',
          body: '{}',
          responseTime: 50,
        });
      }
      return Promise.resolve(undefined);
    });

    await variables.load(1);

    const chain: Chain = {
      id: 'c1',
      name: 'GetLicense',
      steps: [
        {
          id: 's1',
          requestId: 1,
          extractions: [{ jsonPath: 'accessToken', variableName: 'accessToken' }],
        },
        { id: 's2', requestId: 2, extractions: [] },
      ],
    };

    const results = await executeChain(chain, 1);

    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('success');
    expect(step2Authorization).toBe(`Bearer ${FRESH}`);
  });

  it('step 2 uses chain token when only bearer auth tab has a stale literal JWT', async () => {
    const STALE = 'stale-expired-token';
    const FRESH = 'fresh-token-from-step-1';
    let httpCalls = 0;
    let step2Authorization: string | undefined;

    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'db_get_variables') {
        return Promise.resolve([{ key: 'accessToken', value: STALE }]);
      }
      if (cmd === 'db_set_variable') {
        return Promise.resolve(undefined);
      }
      if (cmd === 'db_get_request') {
        const id = args?.id;
        if (id === 1) {
          return Promise.resolve({
            name: 'Login',
            method: 'POST',
            url: 'https://api.com/login',
            headers: '[]',
            params: '[]',
          });
        }
        if (id === 2) {
          return Promise.resolve({
            name: 'Get License',
            method: 'GET',
            url: 'https://api.com/license',
            headers: '[]',
            params: '[]',
            auth_type: 'bearer',
            auth_data: JSON.stringify({ token: STALE }),
          });
        }
      }
      if (cmd === 'execute_http_request') {
        httpCalls++;
        if (httpCalls === 1) {
          return Promise.resolve({
            status: 200,
            statusText: 'OK',
            body: JSON.stringify({ accessToken: FRESH }),
            responseTime: 100,
          });
        }
        step2Authorization = args?.headers?.Authorization;
        return Promise.resolve({
          status: 200,
          statusText: 'OK',
          body: '{}',
          responseTime: 50,
        });
      }
      return Promise.resolve(undefined);
    });

    await variables.load(1);

    const chain: Chain = {
      id: 'c1',
      name: 'GetLicense',
      steps: [
        {
          id: 's1',
          requestId: 1,
          extractions: [{ jsonPath: 'accessToken', variableName: 'accessToken' }],
        },
        { id: 's2', requestId: 2, extractions: [] },
      ],
    };

    const results = await executeChain(chain, 1);

    expect(results[1].status).toBe('success');
    expect(step2Authorization).toBe(`Bearer ${FRESH}`);
  });

  it('step 2 resolves {{apiToken}} from chain-extracted accessToken', async () => {
    const STALE = 'stale-api-token';
    const FRESH = 'fresh-token-from-step-1';
    let httpCalls = 0;
    let step2Authorization: string | undefined;

    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'db_get_variables') {
        return Promise.resolve([]);
      }
      if (cmd === 'db_get_environment_variables') {
        return Promise.resolve([
          { key: 'apiToken', value: STALE, initial_value: STALE, enabled: true },
        ]);
      }
      if (cmd === 'db_set_variable' || cmd === 'db_set_environment_variable') {
        return Promise.resolve(undefined);
      }
      if (cmd === 'db_get_request') {
        const id = args?.id;
        if (id === 1) {
          return Promise.resolve({
            name: 'Login',
            method: 'POST',
            url: 'https://api.com/login',
            headers: '[]',
            params: '[]',
          });
        }
        if (id === 2) {
          return Promise.resolve({
            name: 'Get License',
            method: 'GET',
            url: 'https://api.com/license',
            headers: JSON.stringify([{ key: 'Authorization', value: 'Bearer {{apiToken}}' }]),
            params: '[]',
            auth_type: 'none',
          });
        }
      }
      if (cmd === 'execute_http_request') {
        httpCalls++;
        if (httpCalls === 1) {
          return Promise.resolve({
            status: 200,
            statusText: 'OK',
            body: JSON.stringify({ accessToken: FRESH }),
            responseTime: 100,
          });
        }
        step2Authorization = args?.headers?.Authorization;
        return Promise.resolve({
          status: 401,
          statusText: 'Unauthorized',
          body: '',
          responseTime: 50,
        });
      }
      return Promise.resolve(undefined);
    });

    await variables.load(1);
    await envVariables.load(10);
    activeEnvironmentId.set(10);

    const chain: Chain = {
      id: 'c1',
      name: 'GetLicense',
      steps: [
        {
          id: 's1',
          requestId: 1,
          extractions: [{ jsonPath: 'accessToken', variableName: 'accessToken' }],
        },
        { id: 's2', requestId: 2, extractions: [] },
      ],
    };

    await executeChain(chain, 1);

    expect(step2Authorization).toBe(`Bearer ${FRESH}`);

    activeEnvironmentId.set(null);
  });
});

describe('loadChains', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('parses chains from JSON string', async () => {
    const chains = [{ id: 'c1', name: 'Flow', steps: [] }];
    mockInvoke.mockResolvedValueOnce(JSON.stringify(chains));

    const result = await loadChains(10);

    expect(result).toEqual(chains);
  });

  it('handles already-parsed object from db', async () => {
    const chains = [{ id: 'c1', name: 'Flow', steps: [] }];
    mockInvoke.mockResolvedValueOnce(chains);

    const result = await loadChains(10);

    expect(result).toEqual(chains);
  });

  it('returns empty array for non-array result', async () => {
    mockInvoke.mockResolvedValueOnce('"not-an-array"');

    const result = await loadChains(10);

    expect(result).toEqual([]);
  });

  it('returns empty array on error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('fail'));

    const result = await loadChains(10);

    expect(result).toEqual([]);
  });
});

describe('saveChains', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('persists chains as JSON string', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const chains: Chain[] = [{ id: 'c1', name: 'Flow', steps: [] }];

    await saveChains(10, chains);

    expect(mockInvoke).toHaveBeenCalledWith('db_set_setting', {
      key: 'chains_10',
      value: JSON.stringify(chains),
    });
  });
});

describe('suggestVariableName', () => {
  it('extracts last segment of dot path', () => {
    expect(suggestVariableName('data.user.token')).toBe('token');
  });

  it('strips array brackets', () => {
    expect(suggestVariableName('items[0].name')).toBe('name');
  });

  it('handles single-segment path', () => {
    expect(suggestVariableName('token')).toBe('token');
  });

  it('strips non-alphanumeric characters', () => {
    expect(suggestVariableName('data.user-name')).toBe('username');
  });

  it('falls back to second-to-last part when last is empty', () => {
    expect(suggestVariableName('data.items.')).toBe('items');
  });

  it('returns "value" when all parts are empty', () => {
    expect(suggestVariableName('')).toBe('value');
  });
});

describe('getAvailableVarsForStep', () => {
  const chain: Chain = {
    id: 'c1', name: 'Test Chain',
    steps: [
      { id: 's1', requestId: 1, extractions: [{ jsonPath: 'token', variableName: 'authToken' }] },
      { id: 's2', requestId: 2, extractions: [{ jsonPath: 'email', variableName: 'userEmail' }] },
      { id: 's3', requestId: 3, extractions: [] },
    ],
  };

  it('returns empty for step 0', () => {
    expect(getAvailableVarsForStep(chain, 0)).toEqual([]);
  });

  it('returns step 0 vars for step 1', () => {
    expect(getAvailableVarsForStep(chain, 1)).toEqual(['authToken']);
  });

  it('accumulates vars from all prior steps', () => {
    expect(getAvailableVarsForStep(chain, 2)).toEqual(['authToken', 'userEmail']);
  });

  it('returns all vars for step beyond chain length', () => {
    expect(getAvailableVarsForStep(chain, 3)).toEqual(['authToken', 'userEmail']);
  });
});

describe('extractValues', () => {
  it('extracts values from valid JSON', () => {
    const body = JSON.stringify({ token: 'abc', userId: 42 });
    const result = extractValues(body, [
      { jsonPath: 'token', variableName: 'authToken' },
      { jsonPath: 'userId', variableName: 'uid' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('abc');
    expect(result[1].value).toBe('42');
  });

  it('returns empty for invalid JSON', () => {
    expect(extractValues('not-json', [{ jsonPath: 'x', variableName: 'y' }])).toEqual([]);
  });

  it('returns empty for empty body', () => {
    expect(extractValues('', [{ jsonPath: 'x', variableName: 'y' }])).toEqual([]);
  });

  it('returns empty for no extractions', () => {
    expect(extractValues('{"a":1}', [])).toEqual([]);
  });

  it('skips extractions with empty jsonPath or variableName', () => {
    const body = JSON.stringify({ a: 1, b: 2 });
    const result = extractValues(body, [
      { jsonPath: '', variableName: 'x' },
      { jsonPath: 'a', variableName: '' },
      { jsonPath: 'b', variableName: 'valid' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].variableName).toBe('valid');
  });

  it('skips missing paths', () => {
    const body = JSON.stringify({ token: 'abc' });
    const result = extractValues(body, [
      { jsonPath: 'token', variableName: 'found' },
      { jsonPath: 'missing', variableName: 'notfound' },
    ]);
    expect(result).toHaveLength(1);
  });
});
