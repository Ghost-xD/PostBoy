import { describe, it, expect, vi } from 'vitest';
import { importCollection, detectFormat } from './collectionImporter';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// ── Postman v2.1 Fixtures ──────────────────────────────────────

const POSTMAN_BASIC: any = {
  info: {
    _postman_id: 'abc-123',
    name: 'My API',
    description: 'Sample Postman collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'Get Users',
      request: {
        method: 'GET',
        header: [{ key: 'Accept', value: 'application/json' }],
        url: {
          raw: 'https://api.example.com/users?page=1',
          protocol: 'https',
          host: ['api', 'example', 'com'],
          path: ['users'],
          query: [{ key: 'page', value: '1' }],
        },
        description: 'Fetch all users',
      },
    },
    {
      name: 'Create User',
      request: {
        method: 'POST',
        header: [{ key: 'Content-Type', value: 'application/json' }],
        url: { raw: 'https://api.example.com/users' },
        body: {
          mode: 'raw',
          raw: '{"name":"John","email":"john@example.com"}',
          options: { raw: { language: 'json' } },
        },
      },
    },
  ],
  variable: [
    { key: 'baseUrl', value: 'https://api.example.com' },
    { key: 'apiKey', value: 'secret123' },
  ],
};

const POSTMAN_WITH_FOLDERS: any = {
  info: {
    name: 'Nested Collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login',
          request: { method: 'POST', url: 'https://api.example.com/login' },
        },
        {
          name: 'Token',
          item: [
            {
              name: 'Refresh Token',
              request: { method: 'POST', url: 'https://api.example.com/refresh' },
            },
          ],
        },
      ],
    },
    {
      name: 'Health Check',
      request: { method: 'GET', url: 'https://api.example.com/health' },
    },
  ],
};

const POSTMAN_WITH_AUTH: any = {
  info: {
    name: 'Auth Collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: 'collection-level-token' }],
  },
  item: [
    {
      name: 'Bearer Request',
      request: {
        method: 'GET',
        url: 'https://api.example.com/protected',
      },
    },
    {
      name: 'Basic Auth Request',
      request: {
        method: 'GET',
        url: 'https://api.example.com/admin',
        auth: {
          type: 'basic',
          basic: [
            { key: 'username', value: 'admin' },
            { key: 'password', value: 'secret' },
          ],
        },
      },
    },
    {
      name: 'API Key Request',
      request: {
        method: 'GET',
        url: 'https://api.example.com/data',
        auth: {
          type: 'apikey',
          apikey: [
            { key: 'key', value: 'X-Api-Key' },
            { key: 'value', value: 'mykey123' },
            { key: 'in', value: 'header' },
          ],
        },
      },
    },
    {
      name: 'No Auth Request',
      request: {
        method: 'GET',
        url: 'https://api.example.com/public',
        auth: { type: 'noauth' },
      },
    },
  ],
};

const POSTMAN_BODY_TYPES: any = {
  info: {
    name: 'Body Types',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'Form URL Encoded',
      request: {
        method: 'POST',
        url: 'https://api.example.com/form',
        body: {
          mode: 'urlencoded',
          urlencoded: [
            { key: 'grant_type', value: 'password' },
            { key: 'username', value: 'admin' },
            { key: 'disabled_field', value: 'skip', disabled: true },
          ],
        },
      },
    },
    {
      name: 'Form Data',
      request: {
        method: 'POST',
        url: 'https://api.example.com/upload',
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'file', value: '', type: 'file' },
            { key: 'name', value: 'test.txt', type: 'text' },
          ],
        },
      },
    },
    {
      name: 'GraphQL',
      request: {
        method: 'POST',
        url: 'https://api.example.com/graphql',
        body: {
          mode: 'graphql',
          graphql: { query: '{ users { id name } }', variables: '{"limit": 10}' },
        },
      },
    },
    {
      name: 'XML Body',
      request: {
        method: 'POST',
        url: 'https://api.example.com/xml',
        body: { mode: 'raw', raw: '<root><item>1</item></root>', options: { raw: { language: 'xml' } } },
      },
    },
    {
      name: 'Plain Text',
      request: {
        method: 'POST',
        url: 'https://api.example.com/text',
        body: { mode: 'raw', raw: 'hello world' },
      },
    },
    {
      name: 'No Body Mode',
      request: {
        method: 'GET',
        url: 'https://api.example.com/empty',
        body: { mode: 'unknown' },
      },
    },
  ],
};

// ── Insomnia v4 Fixtures ───────────────────────────────────────

const INSOMNIA_BASIC: any = {
  _type: 'export',
  __export_format: 4,
  __export_date: '2024-01-01T00:00:00Z',
  __export_source: 'insomnia.desktop.app:v2024.1.0',
  resources: [
    {
      _id: 'wrk_1',
      _type: 'workspace',
      name: 'My Workspace',
      description: 'Test workspace',
      parentId: null,
    },
    {
      _id: 'req_1',
      _type: 'request',
      name: 'Get Users',
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: [{ name: 'Accept', value: 'application/json' }],
      parameters: [{ name: 'page', value: '1' }],
      body: {},
      authentication: {},
      parentId: 'wrk_1',
    },
    {
      _id: 'req_2',
      _type: 'request',
      name: 'Create User',
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      parameters: [],
      body: { mimeType: 'application/json', text: '{"name":"John"}' },
      authentication: { type: 'bearer', token: 'abc123' },
      parentId: 'wrk_1',
    },
    {
      _id: 'env_1',
      _type: 'environment',
      name: 'Base Environment',
      data: { baseUrl: 'https://api.example.com', apiKey: 'secret' },
      parentId: 'wrk_1',
    },
  ],
};

const INSOMNIA_WITH_FOLDERS: any = {
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_1', _type: 'workspace', name: 'API', parentId: null },
    { _id: 'fld_1', _type: 'request_group', name: 'Auth', parentId: 'wrk_1' },
    { _id: 'fld_2', _type: 'request_group', name: 'Token', parentId: 'fld_1' },
    {
      _id: 'req_1', _type: 'request', name: 'Login',
      method: 'POST', url: 'https://api.example.com/login',
      headers: [], parameters: [], body: {}, authentication: {},
      parentId: 'fld_1',
    },
    {
      _id: 'req_2', _type: 'request', name: 'Refresh',
      method: 'POST', url: 'https://api.example.com/refresh',
      headers: [], parameters: [], body: {}, authentication: {},
      parentId: 'fld_2',
    },
    {
      _id: 'req_3', _type: 'request', name: 'Health',
      method: 'GET', url: 'https://api.example.com/health',
      headers: [], parameters: [], body: {}, authentication: {},
      parentId: 'wrk_1',
    },
  ],
};

const INSOMNIA_BODY_TYPES: any = {
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_1', _type: 'workspace', name: 'Bodies', parentId: null },
    {
      _id: 'req_1', _type: 'request', name: 'JSON',
      method: 'POST', url: 'https://x.com/json',
      headers: [], parameters: [],
      body: { mimeType: 'application/json', text: '{"a":1}' },
      authentication: {}, parentId: 'wrk_1',
    },
    {
      _id: 'req_2', _type: 'request', name: 'XML',
      method: 'POST', url: 'https://x.com/xml',
      headers: [], parameters: [],
      body: { mimeType: 'application/xml', text: '<root/>' },
      authentication: {}, parentId: 'wrk_1',
    },
    {
      _id: 'req_3', _type: 'request', name: 'URL Encoded',
      method: 'POST', url: 'https://x.com/form',
      headers: [], parameters: [],
      body: {
        mimeType: 'application/x-www-form-urlencoded',
        params: [{ name: 'key', value: 'val' }],
      },
      authentication: {}, parentId: 'wrk_1',
    },
    {
      _id: 'req_4', _type: 'request', name: 'Multipart',
      method: 'POST', url: 'https://x.com/upload',
      headers: [], parameters: [],
      body: {
        mimeType: 'multipart/form-data',
        params: [{ name: 'file', value: '', type: 'file' }],
      },
      authentication: {}, parentId: 'wrk_1',
    },
    {
      _id: 'req_5', _type: 'request', name: 'GraphQL',
      method: 'POST', url: 'https://x.com/graphql',
      headers: [], parameters: [],
      body: { mimeType: 'application/graphql', text: '{"query":"{ users }"}' },
      authentication: {}, parentId: 'wrk_1',
    },
    {
      _id: 'req_6', _type: 'request', name: 'Plain Text',
      method: 'POST', url: 'https://x.com/text',
      headers: [], parameters: [],
      body: { mimeType: 'text/plain', text: 'hello' },
      authentication: {}, parentId: 'wrk_1',
    },
    {
      _id: 'req_7', _type: 'request', name: 'YAML',
      method: 'POST', url: 'https://x.com/yaml',
      headers: [], parameters: [],
      body: { mimeType: 'application/yaml', text: 'key: value' },
      authentication: {}, parentId: 'wrk_1',
    },
    {
      _id: 'req_8', _type: 'request', name: 'HTML',
      method: 'POST', url: 'https://x.com/html',
      headers: [], parameters: [],
      body: { mimeType: 'text/html', text: '<p>Hi</p>' },
      authentication: {}, parentId: 'wrk_1',
    },
  ],
};

const INSOMNIA_AUTH_TYPES: any = {
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_1', _type: 'workspace', name: 'Auth', parentId: null },
    {
      _id: 'req_1', _type: 'request', name: 'Bearer',
      method: 'GET', url: 'https://x.com/a',
      headers: [], parameters: [], body: {},
      authentication: { type: 'bearer', token: 'tok123' },
      parentId: 'wrk_1',
    },
    {
      _id: 'req_2', _type: 'request', name: 'Basic',
      method: 'GET', url: 'https://x.com/b',
      headers: [], parameters: [], body: {},
      authentication: { type: 'basic', username: 'user', password: 'pass' },
      parentId: 'wrk_1',
    },
    {
      _id: 'req_3', _type: 'request', name: 'API Key',
      method: 'GET', url: 'https://x.com/c',
      headers: [], parameters: [], body: {},
      authentication: { type: 'apikey', key: 'X-Key', value: 'val' },
      parentId: 'wrk_1',
    },
    {
      _id: 'req_4', _type: 'request', name: 'None',
      method: 'GET', url: 'https://x.com/d',
      headers: [], parameters: [], body: {},
      authentication: { type: 'none' },
      parentId: 'wrk_1',
    },
  ],
};

// ── PostBoy Fixture ────────────────────────────────────────────

const POSTBOY_COLLECTION: any = {
  format: 'postboy-collection',
  version: '1.0',
  collection: {
    name: 'My PostBoy Collection',
    description: 'Test',
    variables: [{ key: 'host', value: 'localhost' }],
    requests: [
      {
        name: 'Get Data',
        method: 'GET',
        url: 'http://localhost/data',
        headers: '[{"key":"Accept","value":"*/*"}]',
        params: '[]',
        body_type: 'none',
        body_content: '',
        auth_type: 'bearer',
        auth_data: '{"token":"xyz"}',
        description: 'Fetch data',
      },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('detectFormat', () => {
  it('detects Postman v2.1', () => {
    expect(detectFormat(POSTMAN_BASIC)).toBe('postman-v2.1');
  });

  it('detects Insomnia v4', () => {
    expect(detectFormat(INSOMNIA_BASIC)).toBe('insomnia-v4');
  });

  it('detects PostBoy', () => {
    expect(detectFormat(POSTBOY_COLLECTION)).toBe('postboy');
  });

  it('returns null for unknown format', () => {
    expect(detectFormat({ random: true })).toBeNull();
  });

  it('returns null for non-object', () => {
    expect(detectFormat(null)).toBeNull();
    expect(detectFormat('string')).toBeNull();
    expect(detectFormat(42)).toBeNull();
  });

  it('detects Postman v2.0 schema url variant', () => {
    const v2 = { info: { schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' }, item: [] };
    expect(detectFormat(v2)).toBe('postman-v2.1');
  });
});

describe('importCollection — invalid input', () => {
  it('returns error for invalid JSON', () => {
    const result = importCollection('not json at all');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.collections).toHaveLength(0);
  });

  it('returns error for unrecognised format', () => {
    const result = importCollection(JSON.stringify({ foo: 'bar' }));
    expect(result.errors[0]).toContain('Unrecognised file format');
    expect(result.collections).toHaveLength(0);
  });
});

// ── Postman v2.1 ───────────────────────────────────────────────

describe('importCollection — Postman v2.1', () => {
  it('parses basic collection with requests and variables', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BASIC));
    expect(result.format).toBe('postman-v2.1');
    expect(result.collections).toHaveLength(1);

    const col = result.collections[0];
    expect(col.name).toBe('My API');
    expect(col.description).toBe('Sample Postman collection');
    expect(col.requests).toHaveLength(2);
    expect(col.variables).toHaveLength(2);
    expect(col.variables[0]).toEqual({ key: 'baseUrl', value: 'https://api.example.com' });
  });

  it('parses GET request correctly', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BASIC));
    const req = result.collections[0].requests[0];
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com/users?page=1');
    expect(req.headers).toEqual([{ key: 'Accept', value: 'application/json' }]);
    expect(req.params).toEqual([{ key: 'page', value: '1' }]);
  });

  it('parses POST request with JSON body', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BASIC));
    const req = result.collections[0].requests[1];
    expect(req.method).toBe('POST');
    expect(req.bodyType).toBe('json');
    expect(req.bodyContent).toBe('{"name":"John","email":"john@example.com"}');
  });

  it('flattens nested folders into prefixed names', () => {
    const result = importCollection(JSON.stringify(POSTMAN_WITH_FOLDERS));
    expect(result.collections).toHaveLength(1);
    const names = result.collections[0].requests.map(r => r.name);
    expect(names).toContain('Auth/Login');
    expect(names).toContain('Auth/Token/Refresh Token');
    expect(names).toContain('Health Check');
  });

  it('handles collection-level auth inheritance', () => {
    const result = importCollection(JSON.stringify(POSTMAN_WITH_AUTH));
    const bearerReq = result.collections[0].requests.find(r => r.name === 'Bearer Request')!;
    expect(bearerReq.authType).toBe('bearer');
    expect(bearerReq.authData).toEqual({ token: 'collection-level-token' });
  });

  it('handles request-level auth overriding collection auth', () => {
    const result = importCollection(JSON.stringify(POSTMAN_WITH_AUTH));
    const basicReq = result.collections[0].requests.find(r => r.name === 'Basic Auth Request')!;
    expect(basicReq.authType).toBe('basic');
    expect(basicReq.authData).toEqual({ username: 'admin', password: 'secret' });
  });

  it('handles apikey auth', () => {
    const result = importCollection(JSON.stringify(POSTMAN_WITH_AUTH));
    const apikeyReq = result.collections[0].requests.find(r => r.name === 'API Key Request')!;
    expect(apikeyReq.authType).toBe('apikey');
    expect(apikeyReq.authData).toEqual({ key: 'X-Api-Key', value: 'mykey123', addTo: 'header' });
  });

  it('handles noauth type', () => {
    const result = importCollection(JSON.stringify(POSTMAN_WITH_AUTH));
    const noAuthReq = result.collections[0].requests.find(r => r.name === 'No Auth Request')!;
    expect(noAuthReq.authType).toBe('none');
  });

  it('parses form-urlencoded body and skips disabled fields', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BODY_TYPES));
    const req = result.collections[0].requests.find(r => r.name === 'Form URL Encoded')!;
    expect(req.bodyType).toBe('form-urlencoded');
    expect(req.bodyContent).toBe('grant_type=password&username=admin');
    expect(req.bodyContent).not.toContain('skip');
  });

  it('parses form-data body', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BODY_TYPES));
    const req = result.collections[0].requests.find(r => r.name === 'Form Data')!;
    expect(req.bodyType).toBe('form-data');
    const parsed = JSON.parse(req.bodyContent);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].key).toBe('file');
    expect(parsed[0].type).toBe('file');
  });

  it('parses GraphQL body', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BODY_TYPES));
    const req = result.collections[0].requests.find(r => r.name === 'GraphQL')!;
    expect(req.bodyType).toBe('graphql');
    const parsed = JSON.parse(req.bodyContent);
    expect(parsed.query).toBe('{ users { id name } }');
  });

  it('parses XML body', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BODY_TYPES));
    const req = result.collections[0].requests.find(r => r.name === 'XML Body')!;
    expect(req.bodyType).toBe('xml');
    expect(req.bodyContent).toBe('<root><item>1</item></root>');
  });

  it('parses plain text body (no language specified)', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BODY_TYPES));
    const req = result.collections[0].requests.find(r => r.name === 'Plain Text')!;
    expect(req.bodyType).toBe('text');
    expect(req.bodyContent).toBe('hello world');
  });

  it('handles unknown body mode gracefully', () => {
    const result = importCollection(JSON.stringify(POSTMAN_BODY_TYPES));
    const req = result.collections[0].requests.find(r => r.name === 'No Body Mode')!;
    expect(req.bodyType).toBe('none');
  });

  it('handles string URL format', () => {
    const data = {
      info: { name: 'StringUrl', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'Simple', request: { method: 'GET', url: 'https://example.com/api' } }],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].url).toBe('https://example.com/api');
  });

  it('constructs URL from parts when raw is missing', () => {
    const data = {
      info: { name: 'Parts', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'Built',
        request: {
          method: 'GET',
          url: { protocol: 'https', host: ['api', 'test', 'com'], path: ['v1', 'items'] },
        },
      }],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].url).toBe('https://api.test.com/v1/items');
  });

  it('skips disabled headers', () => {
    const data = {
      info: { name: 'H', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'Req',
        request: {
          method: 'GET', url: 'https://x.com',
          header: [
            { key: 'Active', value: 'yes' },
            { key: 'Inactive', value: 'no', disabled: true },
          ],
        },
      }],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].headers).toHaveLength(1);
    expect(result.collections[0].requests[0].headers[0].key).toBe('Active');
  });

  it('handles empty item array', () => {
    const data = {
      info: { name: 'Empty', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].requests).toHaveLength(0);
  });

  it('filters out variables without keys', () => {
    const data = {
      info: { name: 'Vars', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [],
      variable: [
        { key: 'valid', value: 'yes' },
        { key: '', value: 'no' },
        { value: 'also_no' },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].variables).toHaveLength(1);
    expect(result.collections[0].variables[0].key).toBe('valid');
  });

  it('handles missing info fields gracefully', () => {
    const data = {
      info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].name).toBe('Imported Postman Collection');
    expect(result.collections[0].description).toBe('');
  });
});

// ── Insomnia v4 ────────────────────────────────────────────────

describe('importCollection — Insomnia v4', () => {
  it('parses basic workspace with requests and variables', () => {
    const result = importCollection(JSON.stringify(INSOMNIA_BASIC));
    expect(result.format).toBe('insomnia-v4');
    expect(result.collections).toHaveLength(1);

    const col = result.collections[0];
    expect(col.name).toBe('My Workspace');
    expect(col.description).toBe('Test workspace');
    expect(col.requests).toHaveLength(2);
    expect(col.variables).toHaveLength(2);
    expect(col.variables).toContainEqual({ key: 'baseUrl', value: 'https://api.example.com' });
  });

  it('parses GET request correctly', () => {
    const result = importCollection(JSON.stringify(INSOMNIA_BASIC));
    const req = result.collections[0].requests.find(r => r.name === 'Get Users')!;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com/users');
    expect(req.headers).toEqual([{ key: 'Accept', value: 'application/json' }]);
    expect(req.params).toEqual([{ key: 'page', value: '1' }]);
  });

  it('parses POST request with body and auth', () => {
    const result = importCollection(JSON.stringify(INSOMNIA_BASIC));
    const req = result.collections[0].requests.find(r => r.name === 'Create User')!;
    expect(req.method).toBe('POST');
    expect(req.bodyType).toBe('json');
    expect(req.bodyContent).toBe('{"name":"John"}');
    expect(req.authType).toBe('bearer');
    expect(req.authData).toEqual({ token: 'abc123' });
  });

  it('builds folder paths for nested request groups', () => {
    const result = importCollection(JSON.stringify(INSOMNIA_WITH_FOLDERS));
    const names = result.collections[0].requests.map(r => r.name);
    expect(names).toContain('Auth/Login');
    expect(names).toContain('Auth/Token/Refresh');
    expect(names).toContain('Health');
  });

  it('parses all body types', () => {
    const result = importCollection(JSON.stringify(INSOMNIA_BODY_TYPES));
    const reqs = result.collections[0].requests;

    expect(reqs.find(r => r.name === 'JSON')!.bodyType).toBe('json');
    expect(reqs.find(r => r.name === 'XML')!.bodyType).toBe('xml');
    expect(reqs.find(r => r.name === 'URL Encoded')!.bodyType).toBe('form-urlencoded');
    expect(reqs.find(r => r.name === 'Multipart')!.bodyType).toBe('form-data');
    expect(reqs.find(r => r.name === 'GraphQL')!.bodyType).toBe('graphql');
    expect(reqs.find(r => r.name === 'Plain Text')!.bodyType).toBe('text');
    expect(reqs.find(r => r.name === 'YAML')!.bodyType).toBe('yaml');
    expect(reqs.find(r => r.name === 'HTML')!.bodyType).toBe('html');
  });

  it('parses all auth types', () => {
    const result = importCollection(JSON.stringify(INSOMNIA_AUTH_TYPES));
    const reqs = result.collections[0].requests;

    const bearer = reqs.find(r => r.name === 'Bearer')!;
    expect(bearer.authType).toBe('bearer');
    expect(bearer.authData).toEqual({ token: 'tok123' });

    const basic = reqs.find(r => r.name === 'Basic')!;
    expect(basic.authType).toBe('basic');
    expect(basic.authData).toEqual({ username: 'user', password: 'pass' });

    const apikey = reqs.find(r => r.name === 'API Key')!;
    expect(apikey.authType).toBe('apikey');

    const none = reqs.find(r => r.name === 'None')!;
    expect(none.authType).toBe('none');
  });

  it('handles export with no workspaces by creating a default', () => {
    const data = {
      _type: 'export', __export_format: 4,
      resources: [
        { _id: 'req_1', _type: 'request', name: 'Orphan', method: 'GET', url: 'https://x.com', headers: [], parameters: [], body: {}, authentication: {}, parentId: 'wrk_missing' },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].name).toBe('Imported Insomnia Collection');
  });

  it('handles empty resources', () => {
    const data = { _type: 'export', __export_format: 4, resources: [] };
    const result = importCollection(JSON.stringify(data));
    expect(result.format).toBe('insomnia-v4');
  });

  it('handles request with missing body', () => {
    const data = {
      _type: 'export', __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'W', parentId: null },
        { _id: 'req_1', _type: 'request', name: 'NoBody', method: 'GET', url: 'https://x.com', headers: [], parameters: [], authentication: {}, parentId: 'wrk_1' },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].bodyType).toBe('none');
  });

  it('handles request with missing auth', () => {
    const data = {
      _type: 'export', __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'W', parentId: null },
        { _id: 'req_1', _type: 'request', name: 'NoAuth', method: 'GET', url: 'https://x.com', headers: [], parameters: [], body: {}, parentId: 'wrk_1' },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].authType).toBe('none');
  });

  it('handles disabled headers and params', () => {
    const data = {
      _type: 'export', __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'W', parentId: null },
        {
          _id: 'req_1', _type: 'request', name: 'Filtered', method: 'GET', url: 'https://x.com',
          headers: [{ name: 'Active', value: 'yes' }, { name: 'Off', value: 'no', disabled: true }],
          parameters: [{ name: 'a', value: '1' }, { name: 'b', value: '2', disabled: true }],
          body: {}, authentication: {}, parentId: 'wrk_1',
        },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    const req = result.collections[0].requests[0];
    expect(req.headers).toHaveLength(1);
    expect(req.params).toHaveLength(1);
  });

  it('handles multiple workspaces as separate collections', () => {
    const data = {
      _type: 'export', __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'WS1', parentId: null },
        { _id: 'wrk_2', _type: 'workspace', name: 'WS2', parentId: null },
        { _id: 'req_1', _type: 'request', name: 'R1', method: 'GET', url: 'https://a.com', headers: [], parameters: [], body: {}, authentication: {}, parentId: 'wrk_1' },
        { _id: 'req_2', _type: 'request', name: 'R2', method: 'GET', url: 'https://b.com', headers: [], parameters: [], body: {}, authentication: {}, parentId: 'wrk_2' },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections).toHaveLength(2);
    expect(result.collections[0].name).toBe('WS1');
    expect(result.collections[0].requests).toHaveLength(1);
    expect(result.collections[1].name).toBe('WS2');
    expect(result.collections[1].requests).toHaveLength(1);
  });
});

// ── PostBoy format ─────────────────────────────────────────────

describe('importCollection — PostBoy format', () => {
  it('parses PostBoy collection', () => {
    const result = importCollection(JSON.stringify(POSTBOY_COLLECTION));
    expect(result.format).toBe('postboy');
    expect(result.collections).toHaveLength(1);

    const col = result.collections[0];
    expect(col.name).toBe('My PostBoy Collection');
    expect(col.requests).toHaveLength(1);
    expect(col.variables).toHaveLength(1);
    expect(col.variables[0]).toEqual({ key: 'host', value: 'localhost' });
  });

  it('parses request with string-encoded headers/params/authData', () => {
    const result = importCollection(JSON.stringify(POSTBOY_COLLECTION));
    const req = result.collections[0].requests[0];
    expect(req.headers).toEqual([{ key: 'Accept', value: '*/*' }]);
    expect(req.params).toEqual([]);
    expect(req.authType).toBe('bearer');
    expect(req.authData).toEqual({ token: 'xyz' });
  });

  it('handles missing collection field', () => {
    const data = { format: 'postboy-collection', version: '1.0' };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections).toHaveLength(0);
    expect(result.errors[0]).toContain('Missing');
  });

  it('handles malformed headers/params strings gracefully', () => {
    const data = {
      format: 'postboy-collection', version: '1.0',
      collection: {
        name: 'Bad', description: '',
        requests: [{
          name: 'Broken',
          method: 'GET',
          url: 'http://x.com',
          headers: 'not-json',
          params: 'also-bad',
          auth_data: '{broken',
        }],
        variables: [],
      },
    };
    const result = importCollection(JSON.stringify(data));
    const req = result.collections[0].requests[0];
    expect(req.headers).toEqual([]);
    expect(req.params).toEqual([]);
    expect(req.authData).toEqual({});
  });
});

// ── Edge cases ─────────────────────────────────────────────────

describe('importCollection — edge cases', () => {
  it('handles Postman item without request field', () => {
    const data = {
      info: { name: 'E', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'No Request' }],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests).toHaveLength(0);
  });

  it('handles Postman empty URL object', () => {
    const data = {
      info: { name: 'E', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'Empty URL', request: { method: 'GET', url: {} } }],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].url).toBe('http://');
  });

  it('handles Insomnia form-urlencoded with disabled params', () => {
    const data = {
      _type: 'export', __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'W', parentId: null },
        {
          _id: 'req_1', _type: 'request', name: 'FormDisabled', method: 'POST', url: 'https://x.com',
          headers: [], parameters: [],
          body: {
            mimeType: 'application/x-www-form-urlencoded',
            params: [
              { name: 'active', value: '1' },
              { name: 'off', value: '2', disabled: true },
            ],
          },
          authentication: {}, parentId: 'wrk_1',
        },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].bodyContent).toBe('active=1');
  });

  it('handles Insomnia GraphQL with invalid JSON body gracefully', () => {
    const data = {
      _type: 'export', __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'W', parentId: null },
        {
          _id: 'req_1', _type: 'request', name: 'BadGQL', method: 'POST', url: 'https://x.com',
          headers: [], parameters: [],
          body: { mimeType: 'application/graphql', text: 'not-json' },
          authentication: {}, parentId: 'wrk_1',
        },
      ],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].bodyType).toBe('graphql');
    expect(result.collections[0].requests[0].bodyContent).toBe('not-json');
  });

  it('handles Postman URL that is a string with query params', () => {
    const data = {
      info: { name: 'QP', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'WithQP', request: { method: 'GET', url: 'https://api.com/x?a=1&b=2' } }],
    };
    const result = importCollection(JSON.stringify(data));
    const req = result.collections[0].requests[0];
    expect(req.params).toContainEqual({ key: 'a', value: '1' });
    expect(req.params).toContainEqual({ key: 'b', value: '2' });
  });

  it('handles Postman disabled query params', () => {
    const data = {
      info: { name: 'DQ', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'DQ',
        request: {
          method: 'GET',
          url: {
            raw: 'https://api.com/x',
            query: [
              { key: 'active', value: '1' },
              { key: 'off', value: '2', disabled: true },
            ],
          },
        },
      }],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].requests[0].params).toHaveLength(1);
  });

  it('handles variables with null values', () => {
    const data = {
      info: { name: 'NV', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [],
      variable: [{ key: 'nullVal', value: null }],
    };
    const result = importCollection(JSON.stringify(data));
    expect(result.collections[0].variables[0]).toEqual({ key: 'nullVal', value: '' });
  });
});
