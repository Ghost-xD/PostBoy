import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/tauri', () => ({
  db: {
    getCollection: vi.fn(),
    getRequests: vi.fn(),
    getVariables: vi.fn(),
    getSetting: vi.fn(),
    createCollection: vi.fn(),
    createRequest: vi.fn(),
    setVariable: vi.fn(),
    setSetting: vi.fn(),
  },
}));

vi.mock('$lib/utils/chainRunner', () => ({
  loadChains: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Login flow', steps: [] }]),
}));

import { db } from '$lib/api/tauri';
import { exportRippleCollection, exportPostmanCollection, importRippleCollection } from './collectionExporter';

describe('collectionExporter', () => {
  beforeEach(() => {
    vi.mocked(db.getCollection).mockResolvedValue({ name: 'API', description: 'Test API' });
    vi.mocked(db.getRequests).mockResolvedValue([
      {
        name: 'Auth/Login',
        method: 'POST',
        url: '{{baseUrl}}/oauth/token',
        headers: JSON.stringify([{ key: 'Content-Type', value: 'application/json' }]),
        params: '[]',
        body_type: 'json',
        body_content: '{}',
        auth_type: 'none',
        auth_data: '{}',
        sort_order: 0,
        description: 'Get token',
      },
    ]);
    vi.mocked(db.getVariables).mockResolvedValue([{ key: 'baseUrl', value: 'https://dev.example.com' }]);
    vi.mocked(db.getSetting).mockResolvedValue(
      JSON.stringify({ requestId: 1, mappings: [{ jsonPath: 'accessToken', variableName: 'accessToken' }] })
    );
  });

  it('exports ripple v2 with variables, chains, and token refresh', async () => {
    const json = await exportRippleCollection(1);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('ripple-collection');
    expect(parsed.version).toBe('2.0');
    expect(parsed.collection.variables).toHaveLength(1);
    expect(parsed.collection.chains).toHaveLength(1);
    expect(parsed.collection.tokenRefresh?.mappings[0].variableName).toBe('accessToken');
  });

  it('exports postman v2.1 with collection variables and folder items', async () => {
    const json = await exportPostmanCollection(1);
    const parsed = JSON.parse(json);
    expect(parsed.info.schema).toContain('postman.com/json/collection/v2');
    expect(parsed.variable).toEqual([{ key: 'baseUrl', value: 'https://dev.example.com', type: 'string' }]);
    expect(parsed.item[0].name).toBe('Auth');
    expect(parsed.item[0].item[0].name).toBe('Login');
    expect(parsed.item[0].item[0].request.method).toBe('POST');
  });

  it('imports ripple v2 including chains and token refresh settings', async () => {
    vi.mocked(db.createCollection).mockResolvedValue(42);
    const payload = JSON.stringify({
      format: 'ripple-collection',
      version: '2.0',
      collection: {
        name: 'Imported',
        description: '',
        variables: [{ key: 'baseUrl', value: 'https://x.com' }],
        requests: [
          {
            name: 'Ping',
            method: 'GET',
            url: '{{baseUrl}}/ping',
            headers: '[]',
            params: '[]',
            body_type: 'none',
            body_content: '',
            auth_type: 'none',
            auth_data: '{}',
          },
        ],
        chains: [{ id: 'x', name: 'Chain', steps: [] }],
        tokenRefresh: { requestId: 1, mappings: [] },
      },
    });

    const id = await importRippleCollection(payload);
    expect(id).toBe(42);
    expect(db.setSetting).toHaveBeenCalledWith('chains_42', expect.any(String));
    expect(db.setSetting).toHaveBeenCalledWith('token_refresh_42', expect.any(String));
  });
});
