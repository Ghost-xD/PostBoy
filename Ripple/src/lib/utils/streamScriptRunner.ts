import {
  runPreRequestScript,
  type ScriptVariableApi,
  type ScriptVariableScope,
  type ScriptRunResult,
} from './requestScriptRunner';
import { createPmExpect, runPmTest } from './pmExpect';
import type { ScriptVariableContext } from './scriptVariables';

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

export async function runStreamPreConnectScript(
  script: string,
  ctx: StreamScriptContext,
  scopes: ScriptVariableApi | ScriptVariableScope | ScriptVariableContext
): Promise<ScriptRunResult> {
  return await runPreRequestScript(
    script,
    {
      method: ctx.method,
      url: ctx.url,
      headers: { ...ctx.headers },
    },
    scopes,
    ctx.collectionId ?? undefined
  );
}

export async function runStreamOnMessageScript(
  script: string,
  ctx: StreamScriptContext,
  message: StreamMessageContext,
  scopes: ScriptVariableApi | ScriptVariableScope | ScriptVariableContext
): Promise<ScriptRunResult> {
  const logs: string[] = [];
  const errors: string[] = [];
  const testResults: ScriptRunResult['testResults'] = [];
  const pendingTests: Promise<void>[] = [];

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

  const pm = buildStreamMessagePm(request, response, message, scopes, logs, errors, testResults, pendingTests);

  if (!script?.trim()) {
    return { request, logs, errors, testResults };
  }

  try {
    const asyncFn = new Function('pm', `
      return (async () => {
        "use strict";
        ${script}
      })();
    `);
    await asyncFn(pm);
    await Promise.all(pendingTests);
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
  scopes: ScriptVariableApi | ScriptVariableScope | ScriptVariableContext,
  logs: string[],
  errors: string[],
  testResults: ScriptRunResult['testResults'],
  pendingTests: Promise<void>[]
) {
  const normalized =
    'environment' in scopes && 'collection' in scopes
      ? scopes
      : { environment: scopes as ScriptVariableApi, collection: scopes as ScriptVariableApi };

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
    variables: normalized.environment,
    environment: normalized.environment,
    collectionVariables: normalized.collection,
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
    test: (name: string, fn: () => void | Promise<void>) => {
      pendingTests.push(runPmTest(name, fn, testResults));
    },
    expect: (actual: unknown) => createPmExpect(actual),
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    },
  };
}
