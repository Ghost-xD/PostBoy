/**
 * Export/import Ripple collections with variables, chains, and token-refresh config.
 * Also exports Postman Collection v2.1 for interoperability.
 */

import { db } from '$lib/api/tauri';
import { loadChains, type Chain } from '$lib/utils/chainRunner';

export type CollectionExportFormat = 'ripple' | 'postman';

interface StoredRequest {
  id?: number;
  name: string;
  method: string;
  url: string;
  headers: string | unknown;
  params: string | unknown;
  body_type?: string;
  body_content?: string;
  auth_type?: string;
  auth_data?: string | unknown;
  sort_order?: number;
  description?: string;
}

interface TokenRefreshExport {
  requestId: number;
  mappings: Array<{ jsonPath: string; variableName: string }>;
}

export interface RippleCollectionExport {
  format: 'ripple-collection';
  version: '2.0';
  exportedAt: string;
  collection: {
    name: string;
    description: string;
    variables: Array<{ key: string; value: string }>;
    requests: Array<Record<string, unknown>>;
    chains: Chain[];
    tokenRefresh: TokenRefreshExport | null;
  };
}

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

async function loadCollectionBundle(collectionId: number) {
  const collection = (await db.getCollection(collectionId)) as {
    name: string;
    description?: string;
  };
  const requests = (await db.getRequests(collectionId)) as StoredRequest[];
  const variables = (await db.getVariables(collectionId)) as Array<{ key: string; value: string }>;
  const chains = await loadChains(collectionId);

  let tokenRefresh: TokenRefreshExport | null = null;
  try {
    const raw = (await db.getSetting(`token_refresh_${collectionId}`, null)) as string | null;
    if (raw && raw !== 'null') {
      tokenRefresh = JSON.parse(raw) as TokenRefreshExport;
    }
  } catch {
    tokenRefresh = null;
  }

  return { collection, requests, variables, chains, tokenRefresh };
}

function serializeRequestForRipple(req: StoredRequest): Record<string, unknown> {
  return {
    name: req.name,
    method: req.method,
    url: req.url,
    headers: typeof req.headers === 'string' ? req.headers : JSON.stringify(req.headers ?? []),
    params: typeof req.params === 'string' ? req.params : JSON.stringify(req.params ?? []),
    body_type: req.body_type ?? 'none',
    body_content: req.body_content ?? '',
    auth_type: req.auth_type ?? 'none',
    auth_data: typeof req.auth_data === 'string' ? req.auth_data : JSON.stringify(req.auth_data ?? {}),
    sort_order: req.sort_order ?? 0,
    description: req.description ?? '',
  };
}

export async function exportRippleCollection(collectionId: number): Promise<string> {
  const { collection, requests, variables, chains, tokenRefresh } = await loadCollectionBundle(collectionId);

  const payload: RippleCollectionExport = {
    format: 'ripple-collection',
    version: '2.0',
    exportedAt: new Date().toISOString(),
    collection: {
      name: collection.name,
      description: collection.description ?? '',
      variables: variables || [],
      requests: requests
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(serializeRequestForRipple),
      chains,
      tokenRefresh,
    },
  };

  return JSON.stringify(payload, null, 2);
}

function authKv(obj: Record<string, unknown>): Array<{ key: string; value: string; type: string }> {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, value]) => ({ key, value: String(value), type: 'string' }));
}

function toPostmanAuth(authType: string | undefined, authDataRaw: unknown): unknown {
  const authTypeNorm = (authType || 'none').replace('api-key', 'apikey');
  const data = parseJsonField<Record<string, unknown>>(authDataRaw, {});

  switch (authTypeNorm) {
    case 'none':
      return { type: 'noauth' };
    case 'bearer':
      return { type: 'bearer', bearer: authKv({ token: data.token ?? data.accessToken ?? '' }) };
    case 'basic':
      return { type: 'basic', basic: authKv({ username: data.username, password: data.password }) };
    case 'apikey':
      return {
        type: 'apikey',
        apikey: authKv({
          key: data.key ?? 'X-API-Key',
          value: data.value,
          in: data.addTo ?? 'header',
        }),
      };
    case 'oauth2': {
      const grantMap: Record<string, string> = {
        client_credentials: 'client_credentials',
        password: 'password_credentials',
        authorization_code: 'authorization_code',
        implicit: 'implicit',
      };
      const grant = String(data.grantType ?? 'client_credentials');
      return {
        type: 'oauth2',
        oauth2: authKv({
          grant_type: grantMap[grant] ?? grant,
          accessTokenUrl: data.accessTokenUrl,
          authUrl: data.authUrl,
          redirectUri: data.redirectUri,
          clientId: data.clientId,
          clientSecret: data.clientSecret,
          username: data.username,
          password: data.password,
          scope: data.scope,
          accessToken: data.accessToken,
          addTokenTo: data.addTokenTo,
          headerPrefix: data.headerPrefix,
        }),
      };
    }
    case 'digest':
      return {
        type: 'digest',
        digest: authKv({
          username: data.username,
          password: data.password,
          realm: data.realm,
          nonce: data.nonce,
          algorithm: data.algorithm,
          qop: data.qop,
        }),
      };
    case 'aws-sigv4':
      return {
        type: 'awsv4',
        awsv4: authKv({
          accessKey: data.accessKey,
          secretKey: data.secretKey,
          sessionToken: data.sessionToken,
          region: data.region,
          service: data.service,
        }),
      };
    default:
      return { type: 'noauth' };
  }
}

function toPostmanBody(bodyType: string | undefined, bodyContent: string | undefined): unknown {
  const type = bodyType || 'none';
  const content = bodyContent ?? '';

  switch (type) {
    case 'json':
      return { mode: 'raw', raw: content, options: { raw: { language: 'json' } } };
    case 'xml':
      return { mode: 'raw', raw: content, options: { raw: { language: 'xml' } } };
    case 'html':
      return { mode: 'raw', raw: content, options: { raw: { language: 'html' } } };
    case 'text':
      return { mode: 'raw', raw: content, options: { raw: { language: 'text' } } };
    case 'form-urlencoded': {
      const pairs = content.split('&').filter(Boolean).map((part) => {
        const [k, ...rest] = part.split('=');
        return {
          key: decodeURIComponent(k || ''),
          value: decodeURIComponent(rest.join('=') || ''),
          type: 'text',
        };
      });
      return { mode: 'urlencoded', urlencoded: pairs };
    }
    case 'form-data': {
      let fields: Array<{ key: string; value: string; type: string }> = [];
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          fields = parsed.map((f) => ({
            key: f.key ?? '',
            value: f.value ?? '',
            type: f.type ?? 'text',
          }));
        }
      } catch {
        /* ignore */
      }
      return { mode: 'formdata', formdata: fields };
    }
    case 'graphql': {
      let query = content;
      let variables = '';
      try {
        const parsed = JSON.parse(content);
        query = parsed.query ?? content;
        variables = parsed.variables ?? '';
      } catch {
        /* use raw */
      }
      return { mode: 'graphql', graphql: { query, variables } };
    }
    default:
      return undefined;
  }
}

function toPostmanHeaders(headersRaw: unknown): Array<{ key: string; value: string; type: string }> {
  const headers = parseJsonField<Array<{ key: string; value: string }>>(headersRaw, []);
  return headers
    .filter((h) => h.key)
    .map((h) => ({ key: h.key, value: h.value ?? '', type: 'text' }));
}

function toPostmanUrl(url: string, paramsRaw: unknown) {
  const params = parseJsonField<Array<{ key: string; value: string }>>(paramsRaw, []);
  const validParams = params.filter((p) => p.key);

  if (validParams.length === 0) {
    return url;
  }

  try {
    const base = url.split('?')[0];
    const qs = validParams
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
      .join('&');
    return qs ? `${base}?${qs}` : base;
  } catch {
    return url;
  }
}

function buildPostmanItem(name: string, req: StoredRequest): unknown {
  const headers = toPostmanHeaders(req.headers);
  const auth = toPostmanAuth(req.auth_type, req.auth_data);
  const body = toPostmanBody(req.body_type, req.body_content);
  const url = toPostmanUrl(req.url, req.params);

  const request: Record<string, unknown> = {
    method: (req.method || 'GET').toUpperCase(),
    header: headers,
    url,
    description: req.description ?? '',
    auth,
  };
  if (body) request.body = body;

  return {
    name,
    request,
    response: [],
  };
}

function insertPostmanItem(root: unknown[], namePath: string, item: unknown) {
  const parts = namePath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    root.push(item);
    return;
  }

  const folderParts = parts.slice(0, -1);
  const leafName = parts[parts.length - 1];
  let current = root;

  for (let i = 0; i < folderParts.length; i++) {
    const folderName = folderParts[i];
    let folder = current.find(
      (entry: any) => entry?.name === folderName && Array.isArray(entry.item)
    ) as any;
    if (!folder) {
      folder = { name: folderName, item: [] };
      current.push(folder);
    }
    current = folder.item;
  }

  if (item && typeof item === 'object' && item !== null) {
    (item as any).name = leafName;
  }
  current.push(item);
}

export async function exportPostmanCollection(collectionId: number): Promise<string> {
  const { collection, requests, variables } = await loadCollectionBundle(collectionId);

  const items: unknown[] = [];
  for (const req of requests.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const displayName = req.name || 'Untitled';
    const leafName = displayName.includes('/') ? displayName.split('/').pop()! : displayName;
    const item = buildPostmanItem(leafName, req);
    if (displayName.includes('/')) {
      insertPostmanItem(items, displayName, item);
    } else {
      items.push(item);
    }
  }

  const payload = {
    info: {
      name: collection.name,
      description: collection.description ?? '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
    variable: (variables || []).map((v) => ({
      key: v.key,
      value: v.value,
      type: 'string',
    })),
  };

  return JSON.stringify(payload, null, 2);
}

export async function exportCollection(
  collectionId: number,
  format: CollectionExportFormat
): Promise<string> {
  return format === 'postman'
    ? exportPostmanCollection(collectionId)
    : exportRippleCollection(collectionId);
}

/** Export every collection (full data: variables, chains, token refresh). */
export async function exportAllCollections(format: CollectionExportFormat): Promise<string> {
  const all = (await db.getCollections()) as Array<{ id: number }>;
  const ids = all.map((c) => c.id);

  if (format === 'postman') {
    const collections = await Promise.all(ids.map((id) => exportPostmanCollection(id)));
    const parsed = collections.map((json) => JSON.parse(json));
    return JSON.stringify(parsed.length === 1 ? parsed[0] : parsed, null, 2);
  }

  const collections = await Promise.all(ids.map((id) => exportRippleCollection(id)));
  const parsed = collections.map((json) => JSON.parse(json) as RippleCollectionExport);
  return JSON.stringify(
    {
      format: 'ripple-collections-bundle',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      collections: parsed.map((p) => p.collection),
    },
    null,
    2
  );
}

/** Import a Ripple v1/v2 export back into the database. Returns new collection id. */
export async function importRippleCollection(jsonData: string): Promise<number> {
  const data = JSON.parse(jsonData);
  const col = data.collection;
  if (!col) throw new Error("Missing 'collection' field in Ripple export.");

  const collectionId = (await db.createCollection(
    col.name || 'Imported Collection',
    col.description || ''
  )) as number;

  const requests = Array.isArray(col.requests) ? col.requests : [];
  for (const req of requests) {
    await db.createRequest(collectionId, {
      name: req.name || 'Untitled',
      method: req.method || 'GET',
      url: req.url || '',
      headers: req.headers ?? '[]',
      params: req.params ?? '[]',
      bodyType: req.body_type || req.bodyType || 'none',
      bodyContent: req.body_content || req.bodyContent || '',
      authType: req.auth_type || req.authType || 'none',
      authData: req.auth_data || req.authData || '{}',
      description: req.description || '',
    });
  }

  const variables = Array.isArray(col.variables) ? col.variables : [];
  for (const v of variables) {
    if (v?.key) {
      await db.setVariable(collectionId, v.key, String(v.value ?? ''));
    }
  }

  if (Array.isArray(col.chains)) {
    await db.setSetting(`chains_${collectionId}`, JSON.stringify(col.chains));
  }

  if (col.tokenRefresh) {
    await db.setSetting(`token_refresh_${collectionId}`, JSON.stringify(col.tokenRefresh));
  }

  return collectionId;
}

/** Detect format and import (Ripple native or Postman via existing importer). */
export async function importCollectionFile(raw: string): Promise<{ collectionId: number; format: string }> {
  const data = JSON.parse(raw);

  if (data.format === 'ripple-collection' && data.collection) {
    const collectionId = await importRippleCollection(raw);
    return { collectionId, format: 'ripple' };
  }

  if (data.format === 'ripple-collections-bundle' && Array.isArray(data.collections)) {
    let lastId = 0;
    for (const col of data.collections) {
      lastId = await importRippleCollection(
        JSON.stringify({ format: 'ripple-collection', version: '2.0', collection: col })
      );
    }
    return { collectionId: lastId, format: 'ripple-bundle' };
  }

  const { importCollection } = await import('$lib/utils/collectionImporter');
  const result = importCollection(raw);
  if (!result.collections.length) {
    throw new Error(result.errors.join('\n') || 'Unrecognised collection format.');
  }

  const imported = result.collections[0];
  const collectionId = (await db.createCollection(imported.name, imported.description || '')) as number;

  for (const req of imported.requests) {
    await db.createRequest(collectionId, {
      name: req.name,
      method: req.method,
      url: req.url,
      headers: req.headers,
      params: req.params,
      bodyType: req.bodyType,
      bodyContent: req.bodyContent,
      authType: req.authType,
      authData: req.authData,
      description: (req as any).description || '',
    });
  }

  for (const v of imported.variables) {
    await db.setVariable(collectionId, v.key, v.value);
  }

  return { collectionId, format: result.format };
}
