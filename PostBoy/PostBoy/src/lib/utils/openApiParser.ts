/**
 * OpenAPI / Swagger spec parser.
 * Converts OpenAPI 2.0 (Swagger) and 3.x specs into PostBoy request templates.
 */

export interface ParsedRequest {
  name: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  params: Array<{ key: string; value: string }>;
  bodyType: string;
  bodyContent: string;
  authType: string;
  authData: Record<string, unknown>;
  description?: string;
}

export interface ParsedCollection {
  name: string;
  description: string;
  requests: ParsedRequest[];
}

export interface OpenApiParseResult {
  collections: ParsedCollection[];
  errors: string[];
}

export function parseOpenApiSpec(raw: string): OpenApiParseResult {
  const errors: string[] = [];
  let spec: any;

  try {
    spec = tryParseJsonOrYaml(raw);
  } catch (e: any) {
    return { collections: [], errors: [`Failed to parse spec: ${e.message}`] };
  }

  if (!spec || typeof spec !== 'object') {
    return { collections: [], errors: ['Spec is not a valid object'] };
  }

  const version = detectVersion(spec);
  if (!version) {
    return { collections: [], errors: ['Not a valid OpenAPI/Swagger spec (missing openapi or swagger field)'] };
  }

  const title = spec.info?.title || 'Imported API';
  const description = spec.info?.description || '';
  const basePath = resolveBasePath(spec, version);
  const paths: Record<string, any> = spec.paths || {};

  const taggedRequests = new Map<string, ParsedRequest[]>();
  taggedRequests.set('_default', []);

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const operation = (pathItem as Record<string, any>)[method];
      if (!operation) continue;

      try {
        const request = buildRequest(spec, version, basePath, path, method, operation, pathItem);
        const tags = operation.tags?.length ? operation.tags : ['_default'];

        for (const tag of tags) {
          if (!taggedRequests.has(tag)) taggedRequests.set(tag, []);
          taggedRequests.get(tag)!.push(request);
        }
      } catch (e: any) {
        errors.push(`${method.toUpperCase()} ${path}: ${e.message}`);
      }
    }
  }

  const collections: ParsedCollection[] = [];

  const namedTags = Array.from(taggedRequests.keys()).filter(t => t !== '_default');
  const defaultReqs = taggedRequests.get('_default') || [];

  if (namedTags.length <= 1 && defaultReqs.length === 0) {
    const allRequests = Array.from(taggedRequests.values()).flat();
    collections.push({ name: title, description, requests: allRequests });
  } else {
    for (const [tag, requests] of taggedRequests.entries()) {
      if (tag === '_default' && requests.length === 0) continue;
      const tagInfo = spec.tags?.find((t: any) => t.name === tag);
      collections.push({
        name: tag === '_default' ? title : tag,
        description: tagInfo?.description || '',
        requests,
      });
    }
  }

  return { collections, errors };
}

export function detectVersion(spec: any): '2' | '3' | null {
  if (spec.swagger === '2.0') return '2';
  if (typeof spec.openapi === 'string' && spec.openapi.startsWith('3')) return '3';
  return null;
}

export function tryParseJsonOrYaml(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  return parseSimpleYaml(trimmed);
}

/**
 * Lightweight YAML subset parser for OpenAPI specs.
 * Handles indentation-based nesting, quoted strings, arrays (- item),
 * and flow literals. Not a full YAML parser — covers the subset used
 * by most OpenAPI specs without requiring a dependency.
 */
export function parseSimpleYaml(text: string): any {
  const lines = text.split('\n');
  const root: any = {};
  const stack: Array<{ indent: number; obj: any; key?: string }> = [{ indent: -1, obj: root }];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const stripped = raw.replace(/\r$/, '');
    if (stripped.trim() === '' || stripped.trim().startsWith('#')) continue;

    const indent = stripped.search(/\S/);
    const content = stripped.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (content.startsWith('- ')) {
      const arrContent = content.slice(2).trim();
      let targetArr: any[] | null = null;

      if (Array.isArray(parent)) {
        targetArr = parent;
      } else {
        const top = stack[stack.length - 1];
        if (top.key !== undefined && stack.length >= 2) {
          const grandparent = stack[stack.length - 2].obj;
          if (!Array.isArray(grandparent[top.key])) {
            grandparent[top.key] = [];
          }
          targetArr = grandparent[top.key];
          top.obj = targetArr;
        }
      }

      if (targetArr) {
        if (arrContent.includes(':')) {
          const obj: any = {};
          parseInlineKeyValue(arrContent, obj);
          targetArr.push(obj);
          stack.push({ indent, obj });
        } else {
          targetArr.push(parseYamlValue(arrContent));
        }
      }
      continue;
    }

    const colonIdx = content.indexOf(':');
    if (colonIdx > 0) {
      const key = content.slice(0, colonIdx).trim();
      const val = content.slice(colonIdx + 1).trim();

      if (val === '' || val === '|' || val === '>') {
        parent[key] = {};
        stack.push({ indent, obj: parent[key], key });
      } else {
        parent[key] = parseYamlValue(val);
        stack.push({ indent, obj: parent, key });
      }
    }
  }

  return root;
}

function parseInlineKeyValue(content: string, obj: any) {
  const colonIdx = content.indexOf(':');
  if (colonIdx > 0) {
    const key = content.slice(0, colonIdx).trim();
    const val = content.slice(colonIdx + 1).trim();
    obj[key] = parseYamlValue(val);
  }
}

function parseYamlValue(val: string): any {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1);
  }
  if (val.startsWith('[') && val.endsWith(']')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  if (val.startsWith('{') && val.endsWith('}')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

function resolveBasePath(spec: any, version: '2' | '3'): string {
  if (version === '2') {
    const host = spec.host || 'localhost';
    const base = spec.basePath || '';
    const scheme = spec.schemes?.[0] || 'https';
    return `${scheme}://${host}${base}`;
  }

  const server = spec.servers?.[0];
  if (server?.url) {
    return server.url.replace(/\/$/, '');
  }
  return 'http://localhost';
}

function buildRequest(
  spec: any,
  version: '2' | '3',
  basePath: string,
  path: string,
  method: string,
  operation: any,
  pathItem: any,
): ParsedRequest {
  const name = operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`;
  const url = `${basePath}${path}`;
  const headers: Array<{ key: string; value: string }> = [];
  const params: Array<{ key: string; value: string }> = [];

  const allParams = [...(pathItem.parameters || []), ...(operation.parameters || [])];
  const resolvedParams = allParams.map((p: any) => resolveRef(spec, p));

  for (const param of resolvedParams) {
    if (param.in === 'query') {
      params.push({ key: param.name, value: String(param.example ?? param.default ?? '') });
    } else if (param.in === 'header') {
      headers.push({ key: param.name, value: String(param.example ?? param.default ?? '') });
    }
  }

  const { bodyType, bodyContent } = extractRequestBody(spec, version, operation);

  if (bodyType === 'json' && bodyContent) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  } else if (bodyType === 'form-urlencoded') {
    headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
  }

  const consumes = operation.consumes || spec.consumes;
  if (version === '2' && consumes?.includes('application/json') && !headers.find(h => h.key === 'Content-Type')) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  }

  return {
    name,
    method: method.toUpperCase(),
    url,
    headers,
    params,
    bodyType,
    bodyContent,
    authType: 'none',
    authData: {},
  };
}

function extractRequestBody(spec: any, version: '2' | '3', operation: any): { bodyType: string; bodyContent: string } {
  if (version === '2') {
    const bodyParam = (operation.parameters || []).find((p: any) => {
      const resolved = resolveRef(spec, p);
      return resolved.in === 'body';
    });
    if (bodyParam) {
      const resolved = resolveRef(spec, bodyParam);
      const schema = resolveRef(spec, resolved.schema || {});
      const example = generateExample(spec, schema);
      return { bodyType: 'json', bodyContent: example ? JSON.stringify(example, null, 2) : '' };
    }
    return { bodyType: 'none', bodyContent: '' };
  }

  const requestBody = resolveRef(spec, operation.requestBody);
  if (!requestBody?.content) return { bodyType: 'none', bodyContent: '' };

  const jsonContent = requestBody.content['application/json'];
  if (jsonContent) {
    const schema = resolveRef(spec, jsonContent.schema || {});
    const example = jsonContent.example || generateExample(spec, schema);
    return { bodyType: 'json', bodyContent: example ? JSON.stringify(example, null, 2) : '' };
  }

  if (requestBody.content['application/x-www-form-urlencoded']) {
    return { bodyType: 'form-urlencoded', bodyContent: '' };
  }

  return { bodyType: 'none', bodyContent: '' };
}

export function resolveRef(spec: any, obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.$ref) return obj;

  const refPath = obj.$ref.replace(/^#\//, '').split('/');
  let current = spec;
  for (const segment of refPath) {
    current = current?.[segment];
    if (current === undefined) return {};
  }
  return current;
}

export function generateExample(spec: any, schema: any, depth = 0): any {
  if (!schema || depth > 5) return null;

  const resolved = resolveRef(spec, schema);
  if (!resolved) return null;
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;

  switch (resolved.type) {
    case 'object': {
      const obj: Record<string, any> = {};
      const props = resolved.properties || {};
      for (const [key, propSchema] of Object.entries(props)) {
        obj[key] = generateExample(spec, propSchema, depth + 1);
      }
      return Object.keys(obj).length ? obj : null;
    }
    case 'array': {
      const itemExample = generateExample(spec, resolved.items, depth + 1);
      return itemExample !== null ? [itemExample] : [];
    }
    case 'string':
      return resolved.enum?.[0] ?? 'string';
    case 'integer':
      return resolved.enum?.[0] ?? 0;
    case 'number':
      return resolved.enum?.[0] ?? 0.0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}
