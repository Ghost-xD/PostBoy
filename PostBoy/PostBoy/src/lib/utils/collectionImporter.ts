/**
 * Postman v2.1 and Insomnia v4 collection importer.
 * Detects the format automatically and converts into PostBoy's internal
 * collection/request model, reusing the same interfaces as openApiParser.
 */

import type { ParsedRequest, ParsedCollection } from './openApiParser';

export interface ImportVariable {
  key: string;
  value: string;
}

export interface ImportedCollection extends ParsedCollection {
  variables: ImportVariable[];
}

export interface CollectionImportResult {
  format: 'postman-v2.1' | 'insomnia-v4' | 'postboy';
  collections: ImportedCollection[];
  errors: string[];
}

type DetectedFormat = 'postman-v2.1' | 'insomnia-v4' | 'postboy' | null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function importCollection(raw: string): CollectionImportResult {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e: any) {
    return { format: 'postboy', collections: [], errors: [`Invalid JSON: ${e.message}`] };
  }

  const format = detectFormat(data);
  if (!format) {
    return {
      format: 'postboy',
      collections: [],
      errors: ['Unrecognised file format. Expected Postman v2.1, Insomnia v4, or PostBoy collection JSON.'],
    };
  }

  switch (format) {
    case 'postman-v2.1':
      return parsePostmanCollection(data);
    case 'insomnia-v4':
      return parseInsomniaExport(data);
    case 'postboy':
      return parsePostBoyCollection(data);
  }
}

export function detectFormat(data: any): DetectedFormat {
  if (!data || typeof data !== 'object') return null;

  if (data.info?.schema?.includes('getpostman.com/json/collection/v2')) {
    return 'postman-v2.1';
  }

  if (data._type === 'export' && typeof data.__export_format === 'number' && Array.isArray(data.resources)) {
    return 'insomnia-v4';
  }

  if (data.format === 'postboy-collection') {
    return 'postboy';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Postman v2.1
// ---------------------------------------------------------------------------

function parsePostmanCollection(data: any): CollectionImportResult {
  const errors: string[] = [];
  const name = data.info?.name || 'Imported Postman Collection';
  const description = data.info?.description || '';

  const collectionAuth = data.auth ?? null;
  const requests: ParsedRequest[] = [];
  flattenPostmanItems(data.item || [], requests, errors, '', collectionAuth);

  const variables: ImportVariable[] = (data.variable || [])
    .filter((v: any) => v.key)
    .map((v: any) => ({ key: v.key, value: String(v.value ?? '') }));

  return {
    format: 'postman-v2.1',
    collections: [{ name, description, requests, variables }],
    errors,
  };
}

function flattenPostmanItems(
  items: any[],
  out: ParsedRequest[],
  errors: string[],
  prefix: string,
  collectionAuth: any,
): void {
  for (const item of items) {
    if (Array.isArray(item.item)) {
      const folderName = prefix ? `${prefix}/${item.name}` : item.name;
      const folderAuth = item.auth ?? collectionAuth;
      flattenPostmanItems(item.item, out, errors, folderName, folderAuth);
      continue;
    }

    const req = item.request;
    if (!req) continue;

    try {
      out.push(convertPostmanRequest(item.name || 'Untitled', req, prefix, collectionAuth));
    } catch (e: any) {
      errors.push(`${item.name || 'unknown'}: ${e.message}`);
    }
  }
}

function convertPostmanRequest(
  name: string,
  req: any,
  folderPrefix: string,
  collectionAuth: any,
): ParsedRequest {
  const method = (typeof req === 'string' ? 'GET' : req.method || 'GET').toUpperCase();
  const url = resolvePostmanUrl(req.url);
  const displayName = folderPrefix ? `${folderPrefix}/${name}` : name;

  const headers: Array<{ key: string; value: string }> = (req.header || [])
    .filter((h: any) => !h.disabled)
    .map((h: any) => ({ key: h.key, value: h.value ?? '' }));

  const params: Array<{ key: string; value: string }> = extractPostmanQueryParams(req.url);

  const { bodyType, bodyContent } = convertPostmanBody(req.body);
  const { authType, authData } = convertPostmanAuth(req.auth ?? collectionAuth);

  return {
    name: displayName,
    method,
    url,
    headers,
    params,
    bodyType,
    bodyContent,
    authType,
    authData,
    description: req.description || '',
  } as ParsedRequest & { description: string };
}

function resolvePostmanUrl(url: any): string {
  if (typeof url === 'string') return url;
  if (!url) return '';
  if (url.raw) return url.raw;

  const protocol = url.protocol || 'http';
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host || '');
  const path = Array.isArray(url.path) ? url.path.join('/') : (url.path || '');
  return `${protocol}://${host}${path ? '/' + path : ''}`;
}

function extractPostmanQueryParams(url: any): Array<{ key: string; value: string }> {
  if (!url || typeof url === 'string') {
    try {
      const parsed = new URL(url || 'http://x');
      return Array.from(parsed.searchParams.entries()).map(([key, value]) => ({ key, value }));
    } catch {
      return [];
    }
  }
  return (url.query || [])
    .filter((q: any) => !q.disabled)
    .map((q: any) => ({ key: q.key, value: q.value ?? '' }));
}

function convertPostmanBody(body: any): { bodyType: string; bodyContent: string } {
  if (!body) return { bodyType: 'none', bodyContent: '' };

  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language?.toLowerCase() || '';
      const type = lang === 'json' ? 'json'
        : lang === 'xml' ? 'xml'
        : lang === 'html' ? 'html'
        : lang === 'yaml' ? 'yaml'
        : 'text';
      return { bodyType: type, bodyContent: body.raw || '' };
    }
    case 'urlencoded': {
      const pairs = (body.urlencoded || [])
        .filter((p: any) => !p.disabled)
        .map((p: any) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
        .join('&');
      return { bodyType: 'form-urlencoded', bodyContent: pairs };
    }
    case 'formdata': {
      const fields = (body.formdata || [])
        .filter((f: any) => !f.disabled)
        .map((f: any) => JSON.stringify({ key: f.key, value: f.value ?? '', type: f.type || 'text' }));
      return { bodyType: 'form-data', bodyContent: `[${fields.join(',')}]` };
    }
    case 'graphql': {
      const gql = body.graphql || {};
      const content = JSON.stringify({ query: gql.query || '', variables: gql.variables || '' });
      return { bodyType: 'graphql', bodyContent: content };
    }
    default:
      return { bodyType: 'none', bodyContent: '' };
  }
}

function convertPostmanAuth(auth: any): { authType: string; authData: Record<string, unknown> } {
  if (!auth || auth.type === 'noauth') return { authType: 'none', authData: {} };

  const type = auth.type;

  const kvToMap = (arr: any[]): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const item of arr || []) {
      if (item.key) m[item.key] = String(item.value ?? '');
    }
    return m;
  };

  switch (type) {
    case 'bearer': {
      const vals = kvToMap(auth.bearer);
      return { authType: 'bearer', authData: { token: vals.token || '' } };
    }
    case 'basic': {
      const vals = kvToMap(auth.basic);
      return { authType: 'basic', authData: { username: vals.username || '', password: vals.password || '' } };
    }
    case 'apikey': {
      const vals = kvToMap(auth.apikey);
      return { authType: 'apikey', authData: { key: vals.key || 'X-API-Key', value: vals.value || '', addTo: vals.in || 'header' } };
    }
    default:
      return { authType: 'none', authData: {} };
  }
}

// ---------------------------------------------------------------------------
// Insomnia v4
// ---------------------------------------------------------------------------

function parseInsomniaExport(data: any): CollectionImportResult {
  const errors: string[] = [];
  const resources: any[] = data.resources || [];

  const workspaces = resources.filter(r => r._type === 'workspace');
  const requestGroups = resources.filter(r => r._type === 'request_group');
  const requests = resources.filter(r => r._type === 'request');
  const environments = resources.filter(r => r._type === 'environment');

  if (workspaces.length === 0) {
    workspaces.push({ _id: '__root__', name: 'Imported Insomnia Collection', description: '' });
  }

  const nameCache = new Map<string, string>();
  for (const ws of workspaces) nameCache.set(ws._id, ws.name || 'Untitled Workspace');
  for (const rg of requestGroups) nameCache.set(rg._id, rg.name || 'Untitled Folder');

  const buildFolderPath = (parentId: string): string => {
    const parts: string[] = [];
    let current = parentId;
    const visited = new Set<string>();
    while (current && nameCache.has(current) && !visited.has(current)) {
      visited.add(current);
      const isWorkspace = workspaces.some(w => w._id === current);
      if (isWorkspace) break;
      parts.unshift(nameCache.get(current)!);
      const parent = [...requestGroups, ...workspaces].find(r => r._id === current);
      current = parent?.parentId || '';
    }
    return parts.join('/');
  };

  const collections: ImportedCollection[] = [];

  for (const ws of workspaces) {
    const wsRequests: ParsedRequest[] = [];

    for (const req of requests) {
      const ownerWs = resolveWorkspace(req.parentId, requestGroups, workspaces);
      if (ownerWs !== ws._id) continue;

      try {
        const folderPath = buildFolderPath(req.parentId);
        wsRequests.push(convertInsomniaRequest(req, folderPath));
      } catch (e: any) {
        errors.push(`${req.name || 'unknown'}: ${e.message}`);
      }
    }

    const vars: ImportVariable[] = [];
    for (const env of environments) {
      if (env.parentId !== ws._id) continue;
      if (env.data && typeof env.data === 'object') {
        for (const [key, value] of Object.entries(env.data)) {
          vars.push({ key, value: String(value ?? '') });
        }
      }
    }

    collections.push({
      name: ws.name || 'Imported Insomnia Collection',
      description: ws.description || '',
      requests: wsRequests,
      variables: vars,
    });
  }

  return { format: 'insomnia-v4', collections, errors };
}

function resolveWorkspace(
  parentId: string,
  requestGroups: any[],
  workspaces: any[],
): string {
  const visited = new Set<string>();
  let current = parentId;
  while (current) {
    if (visited.has(current)) return current;
    visited.add(current);
    if (workspaces.some(w => w._id === current)) return current;
    const group = requestGroups.find(rg => rg._id === current);
    if (!group) return current;
    current = group.parentId;
  }
  return parentId;
}

function convertInsomniaRequest(req: any, folderPrefix: string): ParsedRequest {
  const method = (req.method || 'GET').toUpperCase();
  const url = req.url || '';
  const displayName = folderPrefix ? `${folderPrefix}/${req.name || 'Untitled'}` : (req.name || 'Untitled');

  const headers: Array<{ key: string; value: string }> = (req.headers || [])
    .filter((h: any) => !h.disabled)
    .map((h: any) => ({ key: h.name || h.key || '', value: h.value ?? '' }));

  const params: Array<{ key: string; value: string }> = (req.parameters || [])
    .filter((p: any) => !p.disabled)
    .map((p: any) => ({ key: p.name || p.key || '', value: p.value ?? '' }));

  const { bodyType, bodyContent } = convertInsomniaBody(req.body);
  const { authType, authData } = convertInsomniaAuth(req.authentication);

  return {
    name: displayName,
    method,
    url,
    headers,
    params,
    bodyType,
    bodyContent,
    authType,
    authData,
  };
}

function convertInsomniaBody(body: any): { bodyType: string; bodyContent: string } {
  if (!body) return { bodyType: 'none', bodyContent: '' };

  const mime = (body.mimeType || '').toLowerCase();

  if (mime.includes('json')) {
    return { bodyType: 'json', bodyContent: body.text || '' };
  }
  if (mime.includes('xml')) {
    return { bodyType: 'xml', bodyContent: body.text || '' };
  }
  if (mime.includes('yaml')) {
    return { bodyType: 'yaml', bodyContent: body.text || '' };
  }
  if (mime.includes('html')) {
    return { bodyType: 'html', bodyContent: body.text || '' };
  }
  if (mime.includes('urlencoded')) {
    const pairs = (body.params || [])
      .filter((p: any) => !p.disabled)
      .map((p: any) => `${encodeURIComponent(p.name || p.key || '')}=${encodeURIComponent(p.value ?? '')}`)
      .join('&');
    return { bodyType: 'form-urlencoded', bodyContent: pairs };
  }
  if (mime.includes('multipart') || mime.includes('form-data')) {
    const fields = (body.params || [])
      .filter((f: any) => !f.disabled)
      .map((f: any) => JSON.stringify({ key: f.name || f.key || '', value: f.value ?? '', type: f.type || 'text' }));
    return { bodyType: 'form-data', bodyContent: `[${fields.join(',')}]` };
  }
  if (mime.includes('graphql')) {
    try {
      const parsed = JSON.parse(body.text || '{}');
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: parsed.query || '', variables: parsed.variables || '' }) };
    } catch {
      return { bodyType: 'graphql', bodyContent: body.text || '' };
    }
  }
  if (body.text) {
    return { bodyType: 'text', bodyContent: body.text };
  }

  return { bodyType: 'none', bodyContent: '' };
}

function convertInsomniaAuth(auth: any): { authType: string; authData: Record<string, unknown> } {
  if (!auth || !auth.type || auth.type === 'none') return { authType: 'none', authData: {} };

  switch (auth.type) {
    case 'bearer':
      return { authType: 'bearer', authData: { token: auth.token || '' } };
    case 'basic':
      return { authType: 'basic', authData: { username: auth.username || '', password: auth.password || '' } };
    case 'apikey':
      return { authType: 'apikey', authData: { key: auth.key || 'X-API-Key', value: auth.value || '', addTo: auth.addTo || 'header' } };
    default:
      return { authType: 'none', authData: {} };
  }
}

// ---------------------------------------------------------------------------
// PostBoy native format (pass-through)
// ---------------------------------------------------------------------------

function parsePostBoyCollection(data: any): CollectionImportResult {
  const col = data.collection;
  if (!col) {
    return { format: 'postboy', collections: [], errors: ['Missing "collection" field in PostBoy export.'] };
  }

  const requests: ParsedRequest[] = (col.requests || []).map((r: any) => {
    let headers: Array<{ key: string; value: string }> = [];
    try {
      const raw = typeof r.headers === 'string' ? JSON.parse(r.headers) : r.headers;
      headers = Array.isArray(raw) ? raw : [];
    } catch { /* use empty */ }

    let params: Array<{ key: string; value: string }> = [];
    try {
      const raw = typeof r.params === 'string' ? JSON.parse(r.params) : r.params;
      params = Array.isArray(raw) ? raw : [];
    } catch { /* use empty */ }

    let authData: Record<string, unknown> = {};
    try {
      authData = typeof r.auth_data === 'string' ? JSON.parse(r.auth_data) : (r.auth_data || {});
    } catch { /* use empty */ }

    return {
      name: r.name || 'Untitled',
      method: r.method || 'GET',
      url: r.url || '',
      headers,
      params,
      bodyType: r.body_type || 'none',
      bodyContent: r.body_content || '',
      authType: r.auth_type || 'none',
      authData,
    };
  });

  const variables: ImportVariable[] = (col.variables || [])
    .filter((v: any) => v.key)
    .map((v: any) => ({ key: v.key, value: String(v.value ?? '') }));

  return {
    format: 'postboy',
    collections: [{
      name: col.name || 'Imported Collection',
      description: col.description || '',
      requests,
      variables,
    }],
    errors: [],
  };
}
