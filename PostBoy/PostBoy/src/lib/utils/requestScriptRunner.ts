/**
 * Minimal Postman-compatible pre-request / test script runner.
 * Runs in the browser with a restricted pm API (no Node/fs/network).
 */

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

function buildPm(
  request: ScriptRequestContext,
  response: ScriptResponseContext | null,
  scopes: ScriptVariableApi | ScriptVariableScope,
  logs: string[],
  errors: string[],
  testResults: ScriptRunResult['testResults']
) {
  const { environment, collection, globals } = normalizeScopes(scopes);
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
    test: (name: string, fn: () => void) => {
      try {
        fn();
        testResults.push({ name, passed: true });
      } catch (e: any) {
        testResults.push({ name, passed: false, error: e.message || String(e) });
      }
    },
    expect: (actual: unknown) => ({
      to: {
        equal: (expected: unknown) => {
          if (actual !== expected) {
            throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
          }
        },
        eql: (expected: unknown) => {
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
          }
        },
        be: {
          ok: () => {
            if (!actual) throw new Error(`Expected truthy value but got ${JSON.stringify(actual)}`);
          },
        },
      },
    }),
    sendRequest: undefined as unknown,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    },
  };

  return pm;
}

function runScript(source: string, pm: ReturnType<typeof buildPm>): void {
  if (!source?.trim()) return;
  const fn = new Function('pm', '"use strict";\n' + source);
  fn(pm);
}

export function runPreRequestScript(
  script: string,
  request: ScriptRequestContext,
  scopes: ScriptVariableApi | ScriptVariableScope
): ScriptRunResult {
  const logs: string[] = [];
  const errors: string[] = [];
  const testResults: ScriptRunResult['testResults'] = [];
  const reqCopy: ScriptRequestContext = {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: request.body,
  };
  const pm = buildPm(reqCopy, null, scopes, logs, errors, testResults);
  try {
    runScript(script, pm);
  } catch (e: any) {
    errors.push(e.message || String(e));
  }
  return { request: reqCopy, logs, errors, testResults };
}

export function runTestScript(
  script: string,
  request: ScriptRequestContext,
  response: ScriptResponseContext,
  scopes: ScriptVariableApi | ScriptVariableScope
): ScriptRunResult {
  const logs: string[] = [];
  const errors: string[] = [];
  const testResults: ScriptRunResult['testResults'] = [];
  const pm = buildPm({ ...request }, response, scopes, logs, errors, testResults);
  try {
    runScript(script, pm);
  } catch (e: any) {
    errors.push(e.message || String(e));
  }
  return { request, logs, errors, testResults };
}
