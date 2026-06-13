import {
  runPreRequestScript,
  type ScriptVariableApi,
  type ScriptRunResult,
} from './requestScriptRunner';

export interface StreamScriptContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  collectionId?: number | null;
}

export interface StreamMessageContext {
  data: string;
  binary?: boolean;
  eventType?: string;
  lastEventId?: string;
  timestamp: number;
}

export function runStreamPreConnectScript(
  script: string,
  ctx: StreamScriptContext,
  variables: ScriptVariableApi
): ScriptRunResult {
  return runPreRequestScript(
    script,
    {
      method: ctx.method,
      url: ctx.url,
      headers: { ...ctx.headers },
    },
    variables
  );
}

export function runStreamOnMessageScript(
  script: string,
  ctx: StreamScriptContext,
  message: StreamMessageContext,
  variables: ScriptVariableApi
): ScriptRunResult {
  const logs: string[] = [];
  const errors: string[] = [];
  const testResults: ScriptRunResult['testResults'] = [];

  const request = {
    method: ctx.method,
    url: ctx.url,
    headers: { ...ctx.headers },
  };

  const responseHeaders: Record<string, string> = {};
  if (message.eventType) {
    responseHeaders['event-type'] = message.eventType;
  }

  const response = {
    status: 200,
    statusText: 'OK',
    headers: responseHeaders,
    body: message.data,
    responseTime: 0,
  };

  const pm = buildStreamMessagePm(request, response, message, variables, logs, errors, testResults);

  if (!script?.trim()) {
    return { request, logs, errors, testResults };
  }

  try {
    const fn = new Function('pm', '"use strict";\n' + script);
    fn(pm);
  } catch (e: any) {
    errors.push(e.message || String(e));
  }

  return { request, logs, errors, testResults };
}

function buildStreamMessagePm(
  request: { method: string; url: string; headers: Record<string, string> },
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    responseTime: number;
  },
  message: StreamMessageContext,
  variables: ScriptVariableApi,
  logs: string[],
  errors: string[],
  testResults: ScriptRunResult['testResults']
) {
  return {
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
      headers: {
        upsert: (item: { key: string; value: string }) => {
          if (item?.key) request.headers[item.key] = item.value ?? '';
        },
      },
    },
    variables,
    message: {
      get data() {
        return message.data;
      },
      get binary() {
        return !!message.binary;
      },
      get eventType() {
        return message.eventType ?? 'message';
      },
      get lastEventId() {
        return message.lastEventId ?? '';
      },
      get timestamp() {
        return message.timestamp;
      },
    },
    response: {
      code: response.status,
      status: response.statusText,
      responseTime: response.responseTime,
      headers: {
        get: (name: string) => {
          const key = Object.keys(response.headers).find(
            (h) => h.toLowerCase() === name.toLowerCase()
          );
          return key ? response.headers[key] : undefined;
        },
      },
      json: () => {
        try {
          return JSON.parse(response.body);
        } catch (e: any) {
          throw new Error(`Message is not JSON: ${e.message || e}`);
        }
      },
      text: () => response.body,
    },
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
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    },
  };
}
