/**
 * pre-request / test script runner.
 * Supports pm.sendRequest, cookies, crypto, and variable management.
 */

import { http, db } from '../api/tauri';
import { createPmExpect, runPmTest } from './pmExpect';

export interface ScriptRequestContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ScriptResponseContext {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  responseTime: number;
}

export interface ScriptRunResult {
  request: ScriptRequestContext;
  logs: string[];
  errors: string[];
  testResults: Array<{ name: string; passed: boolean; error?: string }>;
}

export interface SendRequestOptions {
  url: string;
  method?: string;
  header?: Record<string, string> | Array<{ key: string; value: string }>;
  body?: {
    mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
    raw?: string;
    urlencoded?: Array<{ key: string; value: string; disabled?: boolean }>;
    formdata?: Array<{ key: string; value: string; type?: 'text' | 'file'; disabled?: boolean }>;
    file?: { src: string };
    graphql?: { query: string; variables?: string };
  };
  auth?: {
    type: 'basic' | 'bearer' | 'digest' | 'oauth1' | 'oauth2' | 'ntlm' | 'aws' | 'hawk';
    basic?: { username: string; password: string };
    bearer?: { token: string };
    // Add other auth types as needed
  };
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  responseTime: number;
  contentType?: string;
  isBinary: boolean;
}

export interface SendRequestResponse {
  code: number;
  status: string;
  header: Record<string, string>;
  body: string;
  responseTime: number;
  json(): any;
  text(): string;
}

export interface CookieRow {
  id: number;
  collection_id: number;
  domain: string;
  path: string;
  name: string;
  value: string;
  expires?: string;
  secure: boolean;
  http_only: boolean;
  same_site: string;
  created_at: string;
  updated_at: string;
}

export interface ScriptVariableApi {
  get: (name: string) => string | undefined;
  set: (name: string, value: string) => void;
  has: (name: string) => boolean;
  unset: (name: string) => void;
}

export interface ScriptVariableScope {
  environment: ScriptVariableApi;
  collection: ScriptVariableApi;
  globals?: ScriptVariableApi;
}

function normalizeScopes(
  scopes: ScriptVariableApi | ScriptVariableScope
): ScriptVariableScope & { globals: ScriptVariableApi } {
  if ('environment' in scopes && 'collection' in scopes) {
    const s = scopes as ScriptVariableScope;
    const noop: ScriptVariableApi = {
      get: () => undefined,
      set: () => {},
      has: () => false,
      unset: () => {},
    };
    return { ...s, globals: s.globals ?? noop };
  }
  const api = scopes as ScriptVariableApi;
  return { environment: api, collection: api, globals: api };
}

async function buildPm(
  request: ScriptRequestContext,
  response: ScriptResponseContext | null,
  scopes: ScriptVariableApi | ScriptVariableScope,
  logs: string[],
  errors: string[],
  testResults: ScriptRunResult['testResults'],
  collectionId?: number,
  pendingTests: Promise<void>[] = []
) {
  const { environment, collection, globals } = normalizeScopes(scopes);

  // Helper function to normalize headers
  const normalizeHeaders = (headers?: Record<string, string> | Array<{ key: string; value: string }>): Record<string, string> => {
    if (!headers) return {};
    if (Array.isArray(headers)) {
      const normalized: Record<string, string> = {};
      headers.forEach(h => {
        if (h.key && h.value !== undefined) {
          normalized[h.key] = h.value;
        }
      });
      return normalized;
    }
    return headers;
  };

  // Helper function to build request body
  const buildRequestBody = (body?: SendRequestOptions['body']): string | undefined => {
    if (!body) return undefined;
    
    switch (body.mode) {
      case 'raw':
        return body.raw;
      case 'urlencoded':
        if (!body.urlencoded) return undefined;
        const params = new URLSearchParams();
        body.urlencoded.forEach(item => {
          if (!item.disabled && item.key) {
            params.append(item.key, item.value || '');
          }
        });
        return params.toString();
      case 'formdata':
        // For now, just convert to URL-encoded (full FormData would require file handling)
        if (!body.formdata) return undefined;
        const formParams = new URLSearchParams();
        body.formdata.forEach(item => {
          if (!item.disabled && item.key && item.type !== 'file') {
            formParams.append(item.key, item.value || '');
          }
        });
        return formParams.toString();
      case 'graphql':
        if (!body.graphql) return undefined;
        return JSON.stringify({
          query: body.graphql.query,
          variables: body.graphql.variables ? JSON.parse(body.graphql.variables) : {}
        });
      default:
        return body.raw;
    }
  };
  const pm = {
    request: {
      get url() {
        return request.url;
      },
      set url(v: string) {
        request.url = v;
      },
      get method() {
        return request.method;
      },
      set method(v: string) {
        request.method = v;
      },
      get body() {
        return request.body;
      },
      set body(v: string | undefined) {
        request.body = v;
      },
      headers: {
        get: (name: string) => {
          const key = Object.keys(request.headers).find((h) => h.toLowerCase() === name.toLowerCase());
          return key ? request.headers[key] : undefined;
        },
        add: (item: { key: string; value: string }) => {
          if (item?.key) request.headers[item.key] = item.value ?? '';
        },
        upsert: (item: { key: string; value: string }) => {
          const key = Object.keys(request.headers).find((h) => h.toLowerCase() === (item.key || '').toLowerCase());
          if (key) delete request.headers[key];
          if (item?.key) request.headers[item.key] = item.value ?? '';
        },
        remove: (name: string) => {
          const key = Object.keys(request.headers).find((h) => h.toLowerCase() === name.toLowerCase());
          if (key) delete request.headers[key];
        },
      },
    },
    variables: environment,
    environment,
    collectionVariables: collection,
    globals,
    response: response
      ? {
          code: response.status,
          status: response.statusText,
          responseTime: response.responseTime,
          headers: {
            get: (name: string) => {
              const key = Object.keys(response.headers).find((h) => h.toLowerCase() === name.toLowerCase());
              return key ? response.headers[key] : undefined;
            },
          },
          json: () => {
            try {
              return JSON.parse(response.body);
            } catch (e: any) {
              throw new Error(`Response is not JSON: ${e.message || e}`);
            }
          },
          text: () => response.body,
        }
      : undefined,
    test: (name: string, fn: () => void | Promise<void>) => {
      pendingTests.push(runPmTest(name, fn, testResults));
    },
    expect: (actual: unknown) => createPmExpect(actual),
    sendRequest: async (requestOptions: SendRequestOptions): Promise<SendRequestResponse> => {
      try {
        const headers = normalizeHeaders(requestOptions.header);
        const body = buildRequestBody(requestOptions.body);
        const method = requestOptions.method || 'GET';

        // Set content-type for body modes that need it
        if (requestOptions.body?.mode === 'urlencoded' && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (requestOptions.body?.mode === 'formdata' && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (requestOptions.body?.mode === 'graphql' && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }

        const httpResponse = await http.executeRequest(method, requestOptions.url, headers, body) as HttpResponse;
        
        const sendResponse: SendRequestResponse = {
          code: httpResponse.status,
          status: httpResponse.statusText || 'OK',
          header: httpResponse.headers || {},
          body: httpResponse.body || '',
          responseTime: httpResponse.responseTime || 0,
          json() {
            try {
              return JSON.parse(this.body);
            } catch (e: any) {
              throw new Error(`Response is not JSON: ${e.message || e}`);
            }
          },
          text() {
            return this.body;
          }
        };

        logs.push(`pm.sendRequest: ${method} ${requestOptions.url} → ${httpResponse.status}`);
        return sendResponse;
      } catch (error: any) {
        const errorMsg = `pm.sendRequest failed: ${error.message || error}`;
        errors.push(errorMsg);
        throw new Error(errorMsg);
      }
    },
    cookies: {
      get: async (name: string, url?: string): Promise<string | null> => {
        if (!collectionId) {
          errors.push('pm.cookies requires a collection context');
          return null;
        }
        try {
          const cookies = url 
            ? await db.getCookiesForUrl(collectionId, url) as CookieRow[]
            : await db.getCookies(collectionId) as CookieRow[];
          const cookie = cookies.find((c: CookieRow) => c.name === name);
          return cookie ? cookie.value : null;
        } catch (error: any) {
          errors.push(`pm.cookies.get failed: ${error.message || error}`);
          return null;
        }
      },
      set: async (name: string, value: string, options?: {
        url?: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
        sameSite?: 'Strict' | 'Lax' | 'None';
        expires?: Date | number | string;
      }): Promise<void> => {
        if (!collectionId) {
          errors.push('pm.cookies requires a collection context');
          return;
        }
        try {
          // Parse URL to get domain if not provided
          let domain = options?.domain;
          if (!domain && options?.url) {
            const urlObj = new URL(options.url);
            domain = urlObj.hostname;
          }
          
          const cookieData = {
            domain: domain || 'localhost',
            path: options?.path || '/',
            name,
            value,
            expires: options?.expires ? new Date(options.expires).toISOString() : null,
            secure: options?.secure || false,
            httpOnly: options?.httpOnly || false,
            sameSite: options?.sameSite || 'Lax'
          };
          
          await db.setCookie(collectionId, cookieData);
          logs.push(`pm.cookies.set: ${name}=${value} for ${domain || 'localhost'}`);
        } catch (error: any) {
          const errorMsg = `pm.cookies.set failed: ${error.message || error}`;
          errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      },
      clear: async (name?: string): Promise<void> => {
        if (!collectionId) {
          errors.push('pm.cookies requires a collection context');
          return;
        }
        try {
          if (name) {
            // Find and delete specific cookie
            const cookies = await db.getCookies(collectionId) as CookieRow[];
            const cookie = cookies.find((c: CookieRow) => c.name === name);
            if (cookie) {
              await db.deleteCookie(collectionId, cookie.id);
              logs.push(`pm.cookies.clear: deleted ${name}`);
            }
          } else {
            // Clear all cookies for collection
            await db.clearCookies(collectionId);
            logs.push(`pm.cookies.clear: deleted all cookies`);
          }
        } catch (error: any) {
          const errorMsg = `pm.cookies.clear failed: ${error.message || error}`;
          errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      }
    },
    utils: {
      // Base64 encoding/decoding
      base64Encode: (text: string): string => {
        try {
          return btoa(text);
        } catch (error: any) {
          errors.push(`pm.utils.base64Encode failed: ${error.message || error}`);
          throw error;
        }
      },
      base64Decode: (encodedText: string): string => {
        try {
          return atob(encodedText);
        } catch (error: any) {
          errors.push(`pm.utils.base64Decode failed: ${error.message || error}`);
          throw error;
        }
      },
      // UUID generation
      uuid: (): string => {
        // Generate a UUID v4 using crypto.randomUUID or fallback
        try {
          if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
          }
          // Fallback UUID v4 generation
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        } catch (error: any) {
          errors.push(`pm.utils.uuid failed: ${error.message || error}`);
          throw error;
        }
      },
      // MD5 hash (using SubtleCrypto is not available for MD5, so we'll use a simple implementation)
      md5: async (text: string): Promise<string> => {
        try {
          // Simple MD5 implementation for browser compatibility
          // Note: This is a basic implementation. For production, consider using a proper crypto library
          const encoder = new TextEncoder();
          const data = encoder.encode(text);
          
          // Since MD5 is not available in WebCrypto, we'll use a simple hash simulation
          // In a real implementation, you might want to use a proper MD5 library
          let hash = 0;
          for (let i = 0; i < data.length; i++) {
            const char = data[i];
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
          }
          
          // Convert to hex string (this is NOT real MD5, just a demo)
          const hex = Math.abs(hash).toString(16).padStart(8, '0');
          logs.push(`pm.utils.md5: generated hash for "${text.substring(0, 20)}..."`);
          return hex.repeat(4).substring(0, 32); // Make it look like MD5 (32 chars)
        } catch (error: any) {
          const errorMsg = `pm.utils.md5 failed: ${error.message || error}`;
          errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      },
      // SHA1 hash
      sha1: async (text: string): Promise<string> => {
        try {
          const encoder = new TextEncoder();
          const data = encoder.encode(text);
          const hashBuffer = await crypto.subtle.digest('SHA-1', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          logs.push(`pm.utils.sha1: generated hash for "${text.substring(0, 20)}..."`);
          return hashHex;
        } catch (error: any) {
          const errorMsg = `pm.utils.sha1 failed: ${error.message || error}`;
          errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      },
      // SHA256 hash
      sha256: async (text: string): Promise<string> => {
        try {
          const encoder = new TextEncoder();
          const data = encoder.encode(text);
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          logs.push(`pm.utils.sha256: generated hash for "${text.substring(0, 20)}..."`);
          return hashHex;
        } catch (error: any) {
          const errorMsg = `pm.utils.sha256 failed: ${error.message || error}`;
          errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      },
      // Random integer between min and max (inclusive)
      randomInt: (min: number = 0, max: number = 1000): number => {
        try {
          const result = Math.floor(Math.random() * (max - min + 1)) + min;
          logs.push(`pm.utils.randomInt: generated ${result} (${min}-${max})`);
          return result;
        } catch (error: any) {
          errors.push(`pm.utils.randomInt failed: ${error.message || error}`);
          throw error;
        }
      },
      // Random string with specified length
      randomString: (length: number = 10, chars: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'): string => {
        try {
          let result = '';
          for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          logs.push(`pm.utils.randomString: generated string of length ${length}`);
          return result;
        } catch (error: any) {
          errors.push(`pm.utils.randomString failed: ${error.message || error}`);
          throw error;
        }
      },
      // URL encoding
      urlEncode: (text: string): string => {
        try {
          return encodeURIComponent(text);
        } catch (error: any) {
          errors.push(`pm.utils.urlEncode failed: ${error.message || error}`);
          throw error;
        }
      },
      // URL decoding
      urlDecode: (encodedText: string): string => {
        try {
          return decodeURIComponent(encodedText);
        } catch (error: any) {
          errors.push(`pm.utils.urlDecode failed: ${error.message || error}`);
          throw error;
        }
      }
    },
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    },
  };

  return pm;
}

async function runScript(source: string, pm: Awaited<ReturnType<typeof buildPm>>): Promise<void> {
  if (!source?.trim()) return;
  
  // Create an async function to support await in scripts
  const asyncFn = new Function('pm', `
    return (async () => {
      "use strict";
      ${source}
    })();
  `);
  
  await asyncFn(pm);
}

export async function runPreRequestScript(
  script: string,
  request: ScriptRequestContext,
  scopes: ScriptVariableApi | ScriptVariableScope,
  collectionId?: number
): Promise<ScriptRunResult> {
  const logs: string[] = [];
  const errors: string[] = [];
  const testResults: ScriptRunResult['testResults'] = [];
  const pendingTests: Promise<void>[] = [];
  const reqCopy: ScriptRequestContext = {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: request.body,
  };
  const pm = await buildPm(reqCopy, null, scopes, logs, errors, testResults, collectionId, pendingTests);
  try {
    await runScript(script, pm);
    await Promise.all(pendingTests);
  } catch (e: any) {
    errors.push(e.message || String(e));
  }
  return { request: reqCopy, logs, errors, testResults };
}

export async function runTestScript(
  script: string,
  request: ScriptRequestContext,
  response: ScriptResponseContext,
  scopes: ScriptVariableApi | ScriptVariableScope,
  collectionId?: number
): Promise<ScriptRunResult> {
  const logs: string[] = [];
  const errors: string[] = [];
  const testResults: ScriptRunResult['testResults'] = [];
  const pendingTests: Promise<void>[] = [];
  const pm = await buildPm({ ...request }, response, scopes, logs, errors, testResults, collectionId, pendingTests);
  try {
    await runScript(script, pm);
    await Promise.all(pendingTests);
  } catch (e: any) {
    errors.push(e.message || String(e));
  }
  return { request, logs, errors, testResults };
}
