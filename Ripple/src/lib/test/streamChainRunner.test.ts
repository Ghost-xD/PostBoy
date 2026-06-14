import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('$lib/api/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/tauri')>();
  return {
    ...actual,
    ws: {
      connect: vi.fn(),
      send: vi.fn(),
      sendBinary: vi.fn(),
      disconnect: vi.fn(),
    },
    sse: {
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});

import { ws, sse } from '$lib/api/tauri';
import { variables } from '$lib/stores/variableStore';
import { executeStreamChainStep } from '$lib/utils/streamChainRunner';

type StreamEventHandler = (event: { payload: Record<string, unknown> }) => void;

/** Minimal in-memory event bus mirroring Tauri listen/emit semantics. */
function createStreamEventBus() {
  const handlers = new Map<string, Set<StreamEventHandler>>();

  return {
    listen: vi.mocked(listen).mockImplementation(async (event, handler) => {
      const fn = handler as StreamEventHandler;
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return () => handlers.get(event)?.delete(fn);
    }),

    emit(event: string, payload: Record<string, unknown>) {
      for (const handler of handlers.get(event) ?? []) {
        handler({ payload });
      }
    },

    reset() {
      handlers.clear();
    },
  };
}

describe('streamChainRunner', () => {
  const bus = createStreamEventBus();

  beforeEach(() => {
    vi.clearAllMocks();
    bus.reset();
    bus.listen.mockClear();

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'db_get_variables') return Promise.resolve([]);
      if (cmd === 'db_set_variable') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    vi.mocked(ws.connect).mockImplementation(async (id) => {
      bus.emit('ws-connected', { id });
    });

    vi.mocked(ws.send).mockImplementation(async (id) => {
      bus.emit('ws-message', {
        id,
        data: '{"token":"abc123"}',
        binary: false,
        timestamp: Date.now(),
      });
    });

    vi.mocked(ws.sendBinary).mockResolvedValue(undefined);
    vi.mocked(ws.disconnect).mockResolvedValue(undefined);
    vi.mocked(sse.connect).mockResolvedValue(undefined);
    vi.mocked(sse.disconnect).mockResolvedValue(undefined);
  });

  it('connects WS, sends initial text, waits for message, extracts variables', async () => {
    const setVariable = vi.spyOn(variables, 'set').mockResolvedValue(true);

    const body = JSON.stringify({
      wsSendMode: 'text',
      wsInitialMessage: '{"subscribe":true}',
      chainTimeoutMs: 2000,
    });

    const result = await executeStreamChainStep(
      {
        method: 'WS',
        url: 'ws://localhost:8080',
        headers: {},
        body,
        requestName: 'WS Step',
      },
      1,
      [{ jsonPath: 'token', variableName: 'wsToken' }]
    );

    expect(result.status).toBe('success');
    expect(result.extractedValues).toEqual([
      { variableName: 'wsToken', jsonPath: 'token', value: 'abc123' },
    ]);
    expect(result.response?.status).toBe(101);
    expect(result.response?.body).toBe('{"token":"abc123"}');

    expect(ws.connect).toHaveBeenCalledWith(
      expect.stringMatching(/^chain-/),
      'ws://localhost:8080',
      undefined
    );
    expect(ws.send).toHaveBeenCalledWith(expect.stringMatching(/^chain-/), '{"subscribe":true}');
    expect(ws.disconnect).toHaveBeenCalledWith(expect.stringMatching(/^chain-/));
    expect(setVariable).toHaveBeenCalledWith(1, 'wsToken', 'abc123');

    setVariable.mockRestore();
  });

  it('returns error when SSE connect times out', async () => {
    vi.mocked(sse.connect).mockResolvedValue(undefined);

    const body = JSON.stringify({ chainTimeoutMs: 20 });

    const result = await executeStreamChainStep(
      {
        method: 'SSE',
        url: 'http://localhost/events',
        headers: {},
        body,
        requestName: 'SSE Step',
      },
      1,
      []
    );

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/SSE connect timed out/i);
    expect(sse.connect).toHaveBeenCalled();
    expect(sse.disconnect).toHaveBeenCalled();
  });

  it('filters SSE events when sseEventFilter is configured', async () => {
    const setVariable = vi.spyOn(variables, 'set').mockResolvedValue(true);

    vi.mocked(sse.connect).mockImplementation(async (id) => {
      bus.emit('sse-connected', { id });
    });

    const body = JSON.stringify({
      sseEventFilter: 'tick',
      chainTimeoutMs: 2000,
    });

    const run = executeStreamChainStep(
      {
        method: 'SSE',
        url: 'http://localhost/events',
        headers: {},
        body,
        requestName: 'SSE Step',
      },
      1,
      [{ jsonPath: 'value', variableName: 'tickValue' }]
    );

    await vi.waitFor(() => {
      expect(vi.mocked(sse.connect)).toHaveBeenCalled();
      expect(vi.mocked(listen).mock.calls.some(([event]) => event === 'sse-message')).toBe(true);
    });

    const connId = vi.mocked(sse.connect).mock.calls.at(-1)?.[0] as string;
    expect(connId).toBeTruthy();

    bus.emit('sse-message', {
      id: connId,
      eventType: 'ping',
      data: '{"value":"ignored"}',
      lastEventId: '1',
      timestamp: Date.now(),
    });
    bus.emit('sse-message', {
      id: connId,
      eventType: 'tick',
      data: '{"value":"42"}',
      lastEventId: '2',
      timestamp: Date.now(),
    });

    const result = await run;

    expect(result.status).toBe('success');
    expect(result.extractedValues).toEqual([
      { variableName: 'tickValue', jsonPath: 'value', value: '42' },
    ]);
    expect(setVariable).toHaveBeenCalledWith(1, 'tickValue', '42');

    setVariable.mockRestore();
  });
});
