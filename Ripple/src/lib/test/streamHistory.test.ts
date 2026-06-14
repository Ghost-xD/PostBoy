import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const { tabsStore } = vi.hoisted(() => {
  const { writable } = require('svelte/store');
  return {
    tabsStore: writable([
      {
        id: 'ws-tab',
        method: 'WSS',
        url: 'wss://api.example.com/ws',
        headers: [{ key: 'Authorization', value: 'Bearer tok' }],
      },
      {
        id: 'sse-tab',
        method: 'SSE',
        url: 'https://api.example.com/events',
        headers: [{ key: 'Accept', value: 'text/event-stream' }],
      },
    ]),
  };
});

vi.mock('$lib/stores/tabStore', () => ({
  tabs: tabsStore,
}));

vi.mock('$lib/api/tauri', () => ({
  db: {
    addHistory: vi.fn().mockResolvedValue(true),
  },
}));

import { db } from '$lib/api/tauri';
import {
  isStreamMethod,
  recordStreamConnectHistory,
  isHistorySuccessStatus,
  HISTORY_UPDATED_EVENT,
} from '$lib/utils/streamHistory';

const mockAddHistory = db.addHistory as ReturnType<typeof vi.fn>;

describe('streamHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isStreamMethod', () => {
    it('recognizes WS, WSS, and SSE', () => {
      expect(isStreamMethod('WS')).toBe(true);
      expect(isStreamMethod('WSS')).toBe(true);
      expect(isStreamMethod('SSE')).toBe(true);
    });

    it('rejects HTTP methods', () => {
      expect(isStreamMethod('GET')).toBe(false);
      expect(isStreamMethod(undefined)).toBe(false);
    });
  });

  describe('isHistorySuccessStatus', () => {
    it('treats 101 and 2xx as success', () => {
      expect(isHistorySuccessStatus(101)).toBe(true);
      expect(isHistorySuccessStatus(200)).toBe(true);
    });

    it('treats errors as failure', () => {
      expect(isHistorySuccessStatus(0)).toBe(false);
      expect(isHistorySuccessStatus(500)).toBe(false);
    });
  });

  describe('recordStreamConnectHistory', () => {
    it('writes WebSocket connect to history', async () => {
      await recordStreamConnectHistory('ws-tab', {
        responseTimeMs: 42,
        status: 101,
        summary: 'WebSocket connected',
      });

      expect(mockAddHistory).toHaveBeenCalledWith(
        {
          method: 'WSS',
          url: 'wss://api.example.com/ws',
          headers: { Authorization: 'Bearer tok' },
          params: [],
          bodyType: 'none',
          bodyContent: '',
          authType: 'none',
          authData: {},
        },
        {
          status: 101,
          responseTime: 42,
          headers: {},
          body: 'WebSocket connected',
        }
      );
    });

    it('writes SSE connect to history', async () => {
      await recordStreamConnectHistory('sse-tab', {
        responseTimeMs: 120,
        status: 200,
        summary: 'SSE connected',
      });

      expect(mockAddHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'SSE',
          url: 'https://api.example.com/events',
        }),
        expect.objectContaining({
          status: 200,
          responseTime: 120,
          body: 'SSE connected',
        })
      );
    });

    it('dispatches a history-updated event', async () => {
      const handler = vi.fn();
      window.addEventListener(HISTORY_UPDATED_EVENT, handler);

      await recordStreamConnectHistory('ws-tab', {
        responseTimeMs: 1,
        status: 101,
        summary: 'WebSocket connected',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener(HISTORY_UPDATED_EVENT, handler);
    });

    it('skips unknown tab ids', async () => {
      await recordStreamConnectHistory('missing-tab', {
        responseTimeMs: 1,
        status: 101,
        summary: 'WebSocket connected',
      });

      expect(mockAddHistory).not.toHaveBeenCalled();
    });
  });
});
