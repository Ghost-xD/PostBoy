import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ws, sse } from '$lib/api/tauri';
import { variables } from '$lib/stores/variableStore';
import { parseStreamConfig } from './streamConfig';
import { runStreamPreConnectScript } from './streamScriptRunner';
import { createScriptVariableApi } from './scriptVariables';
import type { ChainExtraction, StepResult, StepResponse } from './chainRunner';
import { extractValues } from './chainRunner';

export interface StreamChainInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  requestName: string;
}

interface ArmedWait<T> {
  wait: Promise<T>;
}

async function armWsConnectedWait(id: string, timeoutMs: number): Promise<ArmedWait<void>> {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let unlistenConnected: UnlistenFn | undefined;
  let unlistenError: UnlistenFn | undefined;
  let settled = false;

  const wait = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const cleanup = () => {
    unlistenConnected?.();
    unlistenError?.();
  };

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectReady(new Error('WebSocket connect timed out'));
  }, timeoutMs);

  unlistenConnected = await listen<{ id: string }>('ws-connected', (event) => {
    if (event.payload.id !== id || settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();
    resolveReady();
  });

  unlistenError = await listen<{ id: string; error: string }>('ws-error', (event) => {
    if (event.payload.id !== id || settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();
    rejectReady(new Error(event.payload.error));
  });

  return { wait };
}

async function wsConnectAndWait(
  id: string,
  url: string,
  headers: Record<string, string> | undefined,
  timeoutMs: number
): Promise<void> {
  const armed = await armWsConnectedWait(id, timeoutMs);
  try {
    await ws.connect(id, url, headers);
  } catch (error) {
    await armed.wait.catch(() => {});
    throw error instanceof Error ? error : new Error(String(error));
  }
  await armed.wait;
}

async function armWsMessageWait(
  id: string,
  timeoutMs: number
): Promise<ArmedWait<{ data: string; binary: boolean; timestamp: number }>> {
  let resolveReady!: (value: { data: string; binary: boolean; timestamp: number }) => void;
  let rejectReady!: (error: Error) => void;
  let unlisten: UnlistenFn | undefined;
  let settled = false;

  const wait = new Promise<{ data: string; binary: boolean; timestamp: number }>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    unlisten?.();
    rejectReady(new Error('Timed out waiting for WebSocket message'));
  }, timeoutMs);

  unlisten = await listen<{ id: string; data: string; binary: boolean; timestamp: number }>(
    'ws-message',
    (event) => {
      if (event.payload.id !== id || settled) return;
      settled = true;
      clearTimeout(timer);
      unlisten?.();
      resolveReady(event.payload);
    }
  );

  return { wait };
}

async function armSseConnectedWait(id: string, timeoutMs: number): Promise<ArmedWait<void>> {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let unlistenConnected: UnlistenFn | undefined;
  let unlistenError: UnlistenFn | undefined;
  let settled = false;

  const wait = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const cleanup = () => {
    unlistenConnected?.();
    unlistenError?.();
  };

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectReady(new Error('SSE connect timed out'));
  }, timeoutMs);

  unlistenConnected = await listen<{ id: string }>('sse-connected', (event) => {
    if (event.payload.id !== id || settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();
    resolveReady();
  });

  unlistenError = await listen<{ id: string; error: string }>('sse-error', (event) => {
    if (event.payload.id !== id || settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();
    rejectReady(new Error(event.payload.error));
  });

  return { wait };
}

async function sseConnectAndWait(
  id: string,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<void> {
  const armed = await armSseConnectedWait(id, timeoutMs);
  try {
    await sse.connect(id, url, headers, false);
  } catch (error) {
    await armed.wait.catch(() => {});
    throw error instanceof Error ? error : new Error(String(error));
  }
  await armed.wait;
}

async function armSseMessageWait(
  id: string,
  timeoutMs: number,
  eventFilter?: string
): Promise<ArmedWait<{ data: string; eventType: string; lastEventId: string; timestamp: number }>> {
  let resolveReady!: (value: {
    data: string;
    eventType: string;
    lastEventId: string;
    timestamp: number;
  }) => void;
  let rejectReady!: (error: Error) => void;
  let unlisten: UnlistenFn | undefined;
  let settled = false;

  const wait = new Promise<{
    data: string;
    eventType: string;
    lastEventId: string;
    timestamp: number;
  }>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    unlisten?.();
    rejectReady(new Error('Timed out waiting for SSE event'));
  }, timeoutMs);

  unlisten = await listen<{
    id: string;
    data: string;
    eventType: string;
    lastEventId: string;
    timestamp: number;
  }>('sse-message', (event) => {
    if (event.payload.id !== id || settled) return;
    if (eventFilter && event.payload.eventType !== eventFilter) return;
    settled = true;
    clearTimeout(timer);
    unlisten?.();
    resolveReady(event.payload);
  });

  return { wait };
}

export async function executeStreamChainStep(
  input: StreamChainInput,
  collectionId: number,
  extractions: ChainExtraction[]
): Promise<StepResult> {
  const config = parseStreamConfig(input.body, input.method);
  const timeoutMs = config.chainTimeoutMs ?? 10000;
  const connId = `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let url = input.url;
  let headers = { ...input.headers };
  const variableApi = createScriptVariableApi(collectionId);

  const preScript = config.wsPreRequestScript?.trim();
  if (preScript) {
    const pre = runStreamPreConnectScript(
      preScript,
      { method: input.method, url, headers, collectionId },
      variableApi
    );
    url = pre.request.url;
    headers = pre.request.headers;
  }

  const start = Date.now();

  try {
    if (input.method === 'SSE') {
      const hdrs = { ...headers };
      if (config.sseLastEventId) hdrs['Last-Event-ID'] = config.sseLastEventId;

      await sseConnectAndWait(connId, url, hdrs, timeoutMs);

      const armedMessage = await armSseMessageWait(
        connId,
        timeoutMs,
        config.sseEventFilter || undefined
      );
      const msg = await armedMessage.wait;
      await sse.disconnect(connId).catch(() => {});

      const body = msg.data;
      const elapsed = Date.now() - start;
      const stepResponse: StepResponse = {
        status: 200,
        statusText: 'SSE Event',
        body,
        time: elapsed,
        headers: { 'event-type': msg.eventType, 'last-event-id': msg.lastEventId },
      };

      const extractedValues = extractValues(body, extractions);
      for (const ev of extractedValues) {
        await variables.set(collectionId, ev.variableName, ev.value);
      }

      return {
        stepIndex: 0,
        requestName: input.requestName,
        requestMethod: input.method,
        requestUrl: url,
        status: 'success',
        response: stepResponse,
        extractedValues,
      };
    }

    await wsConnectAndWait(
      connId,
      url,
      Object.keys(headers).length > 0 ? headers : undefined,
      timeoutMs
    );

    const armedMessage = await armWsMessageWait(connId, timeoutMs);

    const initial = config.wsInitialMessage?.trim();
    if (initial) {
      if (config.wsSendMode === 'binary') {
        await ws.sendBinary(connId, initial);
      } else {
        await ws.send(connId, initial);
      }
    }

    const msg = await armedMessage.wait;
    await ws.disconnect(connId).catch(() => {});

    const body = msg.data;
    const elapsed = Date.now() - start;
    const stepResponse: StepResponse = {
      status: 101,
      statusText: 'WebSocket Message',
      body,
      time: elapsed,
    };

    const extractedValues = extractValues(body, extractions);
    for (const ev of extractedValues) {
      await variables.set(collectionId, ev.variableName, ev.value);
    }

    return {
      stepIndex: 0,
      requestName: input.requestName,
      requestMethod: input.method,
      requestUrl: url,
      status: 'success',
      response: stepResponse,
      extractedValues,
    };
  } catch (error: any) {
    await ws.disconnect(connId).catch(() => {});
    await sse.disconnect(connId).catch(() => {});

    return {
      stepIndex: 0,
      requestName: input.requestName,
      requestMethod: input.method,
      requestUrl: url,
      status: 'error',
      extractedValues: [],
      error: error?.message || String(error),
      response: {
        status: 0,
        statusText: 'Error',
        body: error?.message || String(error),
        time: Date.now() - start,
      },
    };
  }
}
