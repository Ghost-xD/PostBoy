import { describe, it, expect } from 'vitest';
import {
  isStreamMethod,
  serializeStreamConfig,
  parseStreamConfig,
  applyStreamConfigToTab,
} from '../utils/streamConfig';
import type { Tab } from '../stores/tabStore';

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-1',
    name: 'Test',
    method: 'WS',
    url: 'ws://localhost:8080',
    headers: [{ key: '', value: '' }],
    params: [{ key: '', value: '' }],
    bodyType: 'json',
    bodyContent: '',
    authType: 'none',
    authUsername: '',
    authPassword: '',
    authToken: '',
    authApiKey: '',
    authApiValue: '',
    authData: {},
    formDataPairs: [{ key: '', value: '', type: 'text' }],
    formUrlencodedPairs: [{ key: '', value: '' }],
    graphqlQuery: '',
    graphqlVariables: '{}',
    binaryFileName: '',
    binaryFilePath: '',
    binaryFileSize: '',
    description: '',
    collectionId: undefined,
    requestId: undefined,
    responseStatus: null,
    responseStatusText: '',
    responseTime: null,
    responseHeaders: {},
    responseBody: '',
    responseContentType: '',
    responseIsBinary: false,
    responseSize: '',
    responseTimestamp: '',
    grpcService: '',
    grpcMethod: '',
    preRequestScript: 'pm.variables.set("x", "1");',
    testScript: '',
    wsSendMode: 'binary',
    wsInitialMessage: 'aGVsbG8=',
    wsOnMessageScript: 'pm.test("ok", () => pm.expect(pm.message.data).to.be.ok());',
    sseOnMessageScript: '',
    sseAutoReconnect: false,
    sseEventFilter: 'update',
    sseLastEventId: 'evt-99',
    streamChainTimeoutMs: 5000,
    wsStatus: 'disconnected',
    wsMessages: [],
    sseStatus: 'disconnected',
    sseMessages: [],
    ...overrides,
  };
}

describe('streamConfig', () => {
  describe('isStreamMethod', () => {
    it('returns true for WS, WSS, and SSE', () => {
      expect(isStreamMethod('WS')).toBe(true);
      expect(isStreamMethod('WSS')).toBe(true);
      expect(isStreamMethod('SSE')).toBe(true);
    });

    it('returns false for HTTP methods', () => {
      expect(isStreamMethod('GET')).toBe(false);
      expect(isStreamMethod('POST')).toBe(false);
      expect(isStreamMethod(undefined)).toBe(false);
    });
  });

  describe('serializeStreamConfig / parseStreamConfig', () => {
    it('round-trips WebSocket settings', () => {
      const tab = makeTab();
      const raw = serializeStreamConfig(tab);
      const parsed = parseStreamConfig(raw, 'WS');

      expect(parsed.wsSendMode).toBe('binary');
      expect(parsed.wsInitialMessage).toBe('aGVsbG8=');
      expect(parsed.wsPreRequestScript).toContain('pm.variables.set');
      expect(parsed.wsOnMessageScript).toContain('pm.message.data');
      expect(parsed.chainTimeoutMs).toBe(5000);
    });

    it('round-trips SSE settings', () => {
      const tab = makeTab({
        method: 'SSE',
        sseOnMessageScript: 'pm.console.log(pm.message.eventType);',
        sseAutoReconnect: true,
        sseEventFilter: 'ping',
        sseLastEventId: '42',
      });
      const parsed = parseStreamConfig(serializeStreamConfig(tab), 'SSE');

      expect(parsed.sseAutoReconnect).toBe(true);
      expect(parsed.sseEventFilter).toBe('ping');
      expect(parsed.sseLastEventId).toBe('42');
      expect(parsed.sseOnMessageScript).toContain('eventType');
    });

    it('returns defaults for invalid JSON', () => {
      const parsed = parseStreamConfig('{not json', 'SSE');
      expect(parsed.sseAutoReconnect).toBe(true);
      expect(parsed.chainTimeoutMs).toBe(10000);
    });
  });

  describe('applyStreamConfigToTab', () => {
    it('applies WS fields and sets bodyType stream', () => {
      const patch: Record<string, unknown> = {};
      applyStreamConfigToTab(
        patch,
        {
          wsSendMode: 'text',
          wsInitialMessage: 'hi',
          wsPreRequestScript: 'pre',
          wsOnMessageScript: 'onmsg',
          chainTimeoutMs: 8000,
        },
        'WSS'
      );

      expect(patch.bodyType).toBe('stream');
      expect(patch.wsSendMode).toBe('text');
      expect(patch.wsInitialMessage).toBe('hi');
      expect(patch.preRequestScript).toBe('pre');
      expect(patch.wsOnMessageScript).toBe('onmsg');
      expect(patch.streamChainTimeoutMs).toBe(8000);
    });

    it('applies SSE fields', () => {
      const patch: Record<string, unknown> = {};
      applyStreamConfigToTab(
        patch,
        {
          sseAutoReconnect: false,
          sseEventFilter: 'tick',
          sseLastEventId: 'id-1',
          sseOnMessageScript: 'script',
          wsPreRequestScript: 'pre-sse',
        },
        'SSE'
      );

      expect(patch.sseAutoReconnect).toBe(false);
      expect(patch.sseEventFilter).toBe('tick');
      expect(patch.sseLastEventId).toBe('id-1');
      expect(patch.sseOnMessageScript).toBe('script');
      expect(patch.preRequestScript).toBe('pre-sse');
    });
  });
});
