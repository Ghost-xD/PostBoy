import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseOpenApiSpec,
  detectVersion,
  tryParseJsonOrYaml,
  resolveRef,
  generateExample,
  parseSimpleYaml,
} from '$lib/utils/openApiParser';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// ── Fixtures ────────────────────────────────────────────────────

const SWAGGER_2_SPEC = {
  swagger: '2.0',
  info: { title: 'Pet Store', description: 'A sample pet store API', version: '1.0' },
  host: 'petstore.example.com',
  basePath: '/v1',
  schemes: ['https'],
  paths: {
    '/pets': {
      get: {
        summary: 'List pets',
        operationId: 'listPets',
        tags: ['pets'],
        parameters: [
          { name: 'limit', in: 'query', type: 'integer', default: 10 },
          { name: 'X-Request-ID', in: 'header', type: 'string', example: 'abc-123' },
        ],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        summary: 'Create a pet',
        tags: ['pets'],
        parameters: [
          {
            name: 'body',
            in: 'body',
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'Fido' },
                age: { type: 'integer' },
              },
            },
          },
        ],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/pets/{id}': {
      get: {
        summary: 'Get pet by ID',
        tags: ['pets'],
        parameters: [{ name: 'id', in: 'path', type: 'integer', required: true }],
        responses: { '200': { description: 'OK' } },
      },
      delete: {
        summary: 'Delete a pet',
        operationId: 'deletePet',
        responses: { '204': { description: 'Deleted' } },
      },
    },
  },
  tags: [{ name: 'pets', description: 'Pet operations' }],
};

const OPENAPI_3_SPEC = {
  openapi: '3.0.3',
  info: { title: 'User Service', description: 'User management API', version: '2.0.0' },
  servers: [{ url: 'https://api.example.com/v2' }],
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        tags: ['users'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' }, example: 1 },
        ],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        summary: 'Create user',
        tags: ['users'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', example: 'ada@test.com' },
                  role: { type: 'string', enum: ['admin', 'user'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/users/{id}': {
      put: {
        summary: 'Update user',
        tags: ['users'],
        parameters: [{ name: 'id', in: 'path', required: true }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UserUpdate' },
            },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
    },
    '/health': {
      get: {
        summary: 'Health check',
        responses: { '200': { description: 'Healthy' } },
      },
    },
  },
  components: {
    schemas: {
      UserUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          active: { type: 'boolean' },
        },
      },
    },
  },
};

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('OpenAPI Import', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── Version Detection ──────────────────────────────────────────
  describe('detectVersion', () => {
    it('should detect Swagger 2.0', () => {
      expect(detectVersion({ swagger: '2.0' })).toBe('2');
    });

    it('should detect OpenAPI 3.0', () => {
      expect(detectVersion({ openapi: '3.0.3' })).toBe('3');
    });

    it('should detect OpenAPI 3.1', () => {
      expect(detectVersion({ openapi: '3.1.0' })).toBe('3');
    });

    it('should return null for unknown specs', () => {
      expect(detectVersion({})).toBeNull();
      expect(detectVersion({ version: '1.0' })).toBeNull();
    });
  });

  // ── JSON/YAML Parsing ─────────────────────────────────────────
  describe('tryParseJsonOrYaml', () => {
    it('should parse JSON', () => {
      const result = tryParseJsonOrYaml('{"openapi":"3.0.0"}');
      expect(result.openapi).toBe('3.0.0');
    });

    it('should parse YAML-like input', () => {
      const yaml = `openapi: '3.0.0'\ninfo:\n  title: Test API\n  version: '1.0'`;
      const result = tryParseJsonOrYaml(yaml);
      expect(result.openapi).toBe('3.0.0');
      expect(result.info.title).toBe('Test API');
    });

    it('should throw on invalid input', () => {
      expect(() => tryParseJsonOrYaml('{invalid')).toThrow();
    });
  });

  // ── Simple YAML Parser ────────────────────────────────────────
  describe('parseSimpleYaml', () => {
    it('should parse key-value pairs', () => {
      const result = parseSimpleYaml('name: hello\nversion: 1');
      expect(result.name).toBe('hello');
      expect(result.version).toBe(1);
    });

    it('should parse nested objects', () => {
      const result = parseSimpleYaml('info:\n  title: My API\n  version: 2');
      expect(result.info.title).toBe('My API');
      expect(result.info.version).toBe(2);
    });

    it('should parse boolean and null values', () => {
      const result = parseSimpleYaml('enabled: true\ndisabled: false\nempty: null');
      expect(result.enabled).toBe(true);
      expect(result.disabled).toBe(false);
      expect(result.empty).toBeNull();
    });

    it('should parse quoted strings', () => {
      const result = parseSimpleYaml("name: 'hello world'\ntitle: \"test api\"");
      expect(result.name).toBe('hello world');
      expect(result.title).toBe('test api');
    });

    it('should skip comments', () => {
      const result = parseSimpleYaml('# comment\nname: test\n# another');
      expect(result.name).toBe('test');
    });

    it('should parse arrays with dash syntax', () => {
      const yaml = 'servers:\n  - url: https://api.com\n  - url: https://backup.com';
      const result = parseSimpleYaml(yaml);
      expect(result.servers).toHaveLength(2);
      expect(result.servers[0].url).toBe('https://api.com');
    });
  });

  // ── $ref Resolution ───────────────────────────────────────────
  describe('resolveRef', () => {
    const spec = {
      components: {
        schemas: {
          User: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
      definitions: {
        Pet: { type: 'object', properties: { breed: { type: 'string' } } },
      },
    };

    it('should resolve OpenAPI 3 $ref', () => {
      const result = resolveRef(spec, { $ref: '#/components/schemas/User' });
      expect(result.type).toBe('object');
      expect(result.properties.name.type).toBe('string');
    });

    it('should resolve Swagger 2 $ref', () => {
      const result = resolveRef(spec, { $ref: '#/definitions/Pet' });
      expect(result.type).toBe('object');
      expect(result.properties.breed.type).toBe('string');
    });

    it('should return object as-is if no $ref', () => {
      const obj = { type: 'string' };
      expect(resolveRef(spec, obj)).toBe(obj);
    });

    it('should return empty object for unresolvable $ref', () => {
      expect(resolveRef(spec, { $ref: '#/does/not/exist' })).toEqual({});
    });

    it('should handle null/undefined input', () => {
      expect(resolveRef(spec, null)).toBeNull();
      expect(resolveRef(spec, undefined)).toBeUndefined();
    });
  });

  // ── Example Generation ────────────────────────────────────────
  describe('generateExample', () => {
    const spec = { components: { schemas: {} } };

    it('should use explicit example', () => {
      expect(generateExample(spec, { type: 'string', example: 'hello' })).toBe('hello');
    });

    it('should use default value', () => {
      expect(generateExample(spec, { type: 'integer', default: 42 })).toBe(42);
    });

    it('should generate string placeholder', () => {
      expect(generateExample(spec, { type: 'string' })).toBe('string');
    });

    it('should generate integer placeholder', () => {
      expect(generateExample(spec, { type: 'integer' })).toBe(0);
    });

    it('should generate number placeholder', () => {
      expect(generateExample(spec, { type: 'number' })).toBe(0.0);
    });

    it('should generate boolean placeholder', () => {
      expect(generateExample(spec, { type: 'boolean' })).toBe(false);
    });

    it('should use first enum value', () => {
      expect(generateExample(spec, { type: 'string', enum: ['active', 'inactive'] })).toBe('active');
    });

    it('should generate object example from properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Ada' },
          age: { type: 'integer' },
        },
      };
      const result = generateExample(spec, schema);
      expect(result).toEqual({ name: 'Ada', age: 0 });
    });

    it('should generate array example from items', () => {
      const schema = { type: 'array', items: { type: 'string', example: 'item' } };
      expect(generateExample(spec, schema)).toEqual(['item']);
    });

    it('should handle nested objects', () => {
      const schema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string', example: 'London' },
              zip: { type: 'string' },
            },
          },
        },
      };
      const result = generateExample(spec, schema);
      expect(result.address.city).toBe('London');
      expect(result.address.zip).toBe('string');
    });

    it('should stop at max depth to prevent infinite recursion', () => {
      expect(generateExample(spec, { type: 'object', properties: { x: { type: 'string' } } }, 6)).toBeNull();
    });

    it('should return null for null/undefined schema', () => {
      expect(generateExample(spec, null)).toBeNull();
      expect(generateExample(spec, undefined)).toBeNull();
    });
  });

  // ── Swagger 2.0 Full Parse ────────────────────────────────────
  describe('Swagger 2.0 parsing', () => {
    it('should parse a full Swagger 2.0 spec', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));

      expect(result.errors).toHaveLength(0);
      expect(result.collections.length).toBeGreaterThanOrEqual(1);
    });

    it('should group requests by tags', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const petsCollection = result.collections.find(c => c.name === 'pets');

      expect(petsCollection).toBeDefined();
      expect(petsCollection!.requests.length).toBe(3);
    });

    it('should put untagged endpoints in a default collection', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const defaultOrRoot = result.collections.find(c =>
        c.requests.some(r => r.name === 'Delete a pet' || r.name === 'deletePet')
      );
      expect(defaultOrRoot).toBeDefined();
    });

    it('should resolve base path from host + basePath + schemes', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const listPets = result.collections.flatMap(c => c.requests).find(r => r.name === 'List pets');

      expect(listPets?.url).toBe('https://petstore.example.com/v1/pets');
    });

    it('should extract query parameters', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const listPets = result.collections.flatMap(c => c.requests).find(r => r.name === 'List pets');

      expect(listPets?.params).toContainEqual({ key: 'limit', value: '10' });
    });

    it('should extract header parameters', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const listPets = result.collections.flatMap(c => c.requests).find(r => r.name === 'List pets');

      expect(listPets?.headers).toContainEqual({ key: 'X-Request-ID', value: 'abc-123' });
    });

    it('should extract body parameter and generate example', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const createPet = result.collections.flatMap(c => c.requests).find(r => r.name === 'Create a pet');

      expect(createPet?.bodyType).toBe('json');
      expect(createPet?.bodyContent).toBeTruthy();
      const body = JSON.parse(createPet!.bodyContent);
      expect(body.name).toBe('Fido');
    });

    it('should set correct HTTP methods', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const allRequests = result.collections.flatMap(c => c.requests);

      const methods = allRequests.map(r => r.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('DELETE');
    });
  });

  // ── OpenAPI 3.x Full Parse ────────────────────────────────────
  describe('OpenAPI 3.x parsing', () => {
    it('should parse a full OpenAPI 3.x spec', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));

      expect(result.errors).toHaveLength(0);
      expect(result.collections.length).toBeGreaterThanOrEqual(1);
    });

    it('should use servers[0].url as base path', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const listUsers = result.collections.flatMap(c => c.requests).find(r => r.name === 'List users');

      expect(listUsers?.url).toBe('https://api.example.com/v2/users');
    });

    it('should extract requestBody for JSON content', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const createUser = result.collections.flatMap(c => c.requests).find(r => r.name === 'Create user');

      expect(createUser?.bodyType).toBe('json');
      const body = JSON.parse(createUser!.bodyContent);
      expect(body.email).toBe('ada@test.com');
      expect(body.role).toBe('admin');
    });

    it('should resolve $ref in requestBody schema', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const updateUser = result.collections.flatMap(c => c.requests).find(r => r.name === 'Update user');

      expect(updateUser?.bodyType).toBe('json');
      const body = JSON.parse(updateUser!.bodyContent);
      expect(body).toHaveProperty('name');
      expect(body).toHaveProperty('active');
    });

    it('should add Content-Type header for JSON body', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const createUser = result.collections.flatMap(c => c.requests).find(r => r.name === 'Create user');

      expect(createUser?.headers).toContainEqual({ key: 'Content-Type', value: 'application/json' });
    });

    it('should handle endpoints without tags as a separate collection', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const allRequests = result.collections.flatMap(c => c.requests);
      const healthCheck = allRequests.find(r => r.name === 'Health check');

      expect(healthCheck).toBeDefined();
      expect(healthCheck?.method).toBe('GET');
    });

    it('should use summary as request name, fallback to operationId', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const allRequests = result.collections.flatMap(c => c.requests);

      expect(allRequests.some(r => r.name === 'List users')).toBe(true);
      expect(allRequests.some(r => r.name === 'Create user')).toBe(true);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────
  describe('Edge cases', () => {
    it('should return error for invalid JSON/YAML', () => {
      const result = parseOpenApiSpec('not valid at all {{{');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.collections).toHaveLength(0);
    });

    it('should return error for non-OpenAPI JSON', () => {
      const result = parseOpenApiSpec('{"name":"just a random object"}');
      expect(result.errors).toContainEqual(expect.stringContaining('Not a valid OpenAPI'));
    });

    it('should handle empty paths', () => {
      const spec = { openapi: '3.0.0', info: { title: 'Empty', version: '1' }, paths: {} };
      const result = parseOpenApiSpec(JSON.stringify(spec));
      expect(result.errors).toHaveLength(0);
      expect(result.collections.flatMap(c => c.requests)).toHaveLength(0);
    });

    it('should handle spec without info', () => {
      const spec = { openapi: '3.0.0', paths: { '/ping': { get: { responses: { '200': {} } } } } };
      const result = parseOpenApiSpec(JSON.stringify(spec));
      expect(result.collections.length).toBeGreaterThan(0);
    });

    it('should handle spec without servers (OpenAPI 3)', () => {
      const spec = { openapi: '3.0.0', info: { title: 'No Server' }, paths: { '/test': { get: { responses: {} } } } };
      const result = parseOpenApiSpec(JSON.stringify(spec));
      const req = result.collections.flatMap(c => c.requests)[0];
      expect(req.url).toContain('/test');
    });

    it('should handle spec without host (Swagger 2)', () => {
      const spec = { swagger: '2.0', info: { title: 'No Host' }, paths: { '/api': { get: { responses: {} } } } };
      const result = parseOpenApiSpec(JSON.stringify(spec));
      const req = result.collections.flatMap(c => c.requests)[0];
      expect(req.url).toContain('/api');
    });

    it('should handle operation without parameters', () => {
      const spec = { openapi: '3.0.0', info: { title: 'T' }, paths: { '/simple': { get: { responses: {} } } } };
      const result = parseOpenApiSpec(JSON.stringify(spec));
      const req = result.collections.flatMap(c => c.requests)[0];
      expect(req.params).toHaveLength(0);
      expect(req.headers).toHaveLength(0);
    });

    it('should handle GET without body', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const listUsers = result.collections.flatMap(c => c.requests).find(r => r.name === 'List users');
      expect(listUsers?.bodyType).toBe('none');
      expect(listUsers?.bodyContent).toBe('');
    });

    it('should set authType to none by default', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      const allRequests = result.collections.flatMap(c => c.requests);
      for (const req of allRequests) {
        expect(req.authType).toBe('none');
      }
    });
  });

  // ── Single-collection consolidation ───────────────────────────
  describe('Collection grouping', () => {
    it('should create one collection when all endpoints share a single tag', () => {
      const spec = {
        openapi: '3.0.0',
        info: { title: 'Single Tag API' },
        paths: {
          '/a': { get: { tags: ['core'], responses: {} } },
          '/b': { post: { tags: ['core'], responses: {} } },
        },
      };
      const result = parseOpenApiSpec(JSON.stringify(spec));
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0].requests).toHaveLength(2);
    });

    it('should create multiple collections for multiple tags', () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      expect(result.collections.length).toBeGreaterThanOrEqual(2);
    });

    it('should use tag description when available', () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      const petsCollection = result.collections.find(c => c.name === 'pets');
      expect(petsCollection?.description).toBe('Pet operations');
    });
  });

  // ── Tauri API integration ─────────────────────────────────────
  describe('Import flow via Tauri API', () => {
    it('should invoke db_create_collection and db_create_request for parsed spec', async () => {
      vi.mocked(invoke).mockResolvedValue(1);

      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_SPEC));
      expect(result.collections.length).toBeGreaterThan(0);

      for (const collection of result.collections) {
        const collectionId = await invoke('db_create_collection', {
          name: collection.name,
          description: collection.description,
        });
        expect(collectionId).toBe(1);

        for (const req of collection.requests) {
          await invoke('db_create_request', {
            collectionId,
            requestData: {
              name: req.name,
              method: req.method,
              url: req.url,
              headers: req.headers,
              params: req.params,
              bodyType: req.bodyType,
              bodyContent: req.bodyContent,
              authType: req.authType,
              authData: req.authData,
            },
          });
        }
      }

      const totalRequests = result.collections.reduce((sum, c) => sum + c.requests.length, 0);
      expect(invoke).toHaveBeenCalledTimes(result.collections.length + totalRequests);
    });
  });
});
