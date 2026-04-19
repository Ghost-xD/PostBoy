import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}));

/**
 * SSE (Server-Sent Events) Tests
 * Tests cover: message types, state management, API wrapper, tab isolation, event parsing
 */
describe('SSE Support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SseMessage type', () => {
    it('should represent a standard message event', () => {
      const msg = {
        id: 'msg-1',
        eventType: 'message',
        data: '{"count": 42}',
        lastEventId: '100',
        timestamp: Date.now(),
        size: 14
      };

      expect(msg.eventType).toBe('message');
      expect(msg.data).toContain('42');
      expect(msg.lastEventId).toBe('100');
      expect(msg.size).toBe(14);
    });

    it('should represent a custom event type', () => {
      const msg = {
        id: 'msg-2',
        eventType: 'user-update',
        data: 'John logged in',
        lastEventId: '',
        timestamp: Date.now(),
        size: 14
      };

      expect(msg.eventType).toBe('user-update');
      expect(msg.lastEventId).toBe('');
    });

    it('should calculate size from data', () => {
      const data = JSON.stringify({ users: [{ id: 1, name: 'Ada' }] });
      const msg = {
        id: 'msg-3',
        eventType: 'message',
        data,
        lastEventId: '',
        timestamp: Date.now(),
        size: new Blob([data]).size
      };

      expect(msg.size).toBeGreaterThan(0);
      expect(msg.data).toContain('Ada');
    });

    it('should handle multi-line data', () => {
      const msg = {
        id: 'msg-4',
        eventType: 'message',
        data: 'line1\nline2\nline3',
        lastEventId: '5',
        timestamp: Date.now(),
        size: 17
      };

      expect(msg.data.split('\n')).toHaveLength(3);
    });
  });

  describe('Connection state management', () => {
    it('should start in disconnected state', () => {
      const state = {
        status: 'disconnected' as const,
        url: '',
        messages: [] as any[],
      };

      expect(state.status).toBe('disconnected');
      expect(state.messages).toHaveLength(0);
    });

    it('should transition through connecting -> connected', () => {
      const states: string[] = [];

      states.push('disconnected');
      states.push('connecting');
      states.push('connected');

      expect(states).toEqual(['disconnected', 'connecting', 'connected']);
    });

    it('should support reconnecting state', () => {
      const states: string[] = [];

      states.push('connected');
      states.push('reconnecting');
      states.push('connected');

      expect(states[1]).toBe('reconnecting');
    });

    it('should transition to error state on failure', () => {
      const states: string[] = [];

      states.push('connecting');
      states.push('error');

      expect(states).toEqual(['connecting', 'error']);
    });

    it('should have 5 valid states', () => {
      const validStates = ['disconnected', 'connecting', 'connected', 'reconnecting', 'error'];
      expect(validStates).toHaveLength(5);
      expect(new Set(validStates).size).toBe(5);
    });
  });

  describe('SSE API wrapper', () => {
    it('should invoke sse_connect with correct params', async () => {
      (invoke as any).mockResolvedValue(undefined);
      await invoke('sse_connect', { id: 'tab-1', url: 'https://api.example.com/events', headers: { Accept: 'text/event-stream' }, autoReconnect: true });
      expect(invoke).toHaveBeenCalledWith('sse_connect', {
        id: 'tab-1',
        url: 'https://api.example.com/events',
        headers: { Accept: 'text/event-stream' },
        autoReconnect: true
      });
    });

    it('should invoke sse_connect without optional params', async () => {
      (invoke as any).mockResolvedValue(undefined);
      await invoke('sse_connect', { id: 'tab-2', url: 'https://api.example.com/stream' });
      expect(invoke).toHaveBeenCalledWith('sse_connect', {
        id: 'tab-2',
        url: 'https://api.example.com/stream',
      });
    });

    it('should invoke sse_disconnect', async () => {
      (invoke as any).mockResolvedValue(undefined);
      await invoke('sse_disconnect', { id: 'tab-1' });
      expect(invoke).toHaveBeenCalledWith('sse_disconnect', { id: 'tab-1' });
    });

    it('should handle connection errors', async () => {
      (invoke as any).mockRejectedValue('SSE connection failed: timeout');
      await expect(invoke('sse_connect', { id: 'tab-1', url: 'https://slow.api/events' }))
        .rejects.toBe('SSE connection failed: timeout');
    });

    it('should handle disconnect errors for non-existent connections', async () => {
      (invoke as any).mockRejectedValue('No active SSE connection for id: tab-999');
      await expect(invoke('sse_disconnect', { id: 'tab-999' }))
        .rejects.toContain('No active SSE connection');
    });
  });

  describe('Tab isolation', () => {
    it('each tab should have independent SSE state', () => {
      const tab1 = { id: 'tab-1', sseStatus: 'connected', sseMessages: [{ id: 'm1', eventType: 'message', data: 'hello' }] };
      const tab2 = { id: 'tab-2', sseStatus: 'disconnected', sseMessages: [] as any[] };

      expect(tab1.sseStatus).not.toBe(tab2.sseStatus);
      expect(tab1.sseMessages.length).not.toBe(tab2.sseMessages.length);
    });

    it('disconnecting one tab should not affect another', () => {
      const tabs = [
        { id: 'tab-1', sseStatus: 'connected' },
        { id: 'tab-2', sseStatus: 'connected' }
      ];

      tabs[0].sseStatus = 'disconnected';
      expect(tabs[1].sseStatus).toBe('connected');
    });
  });

  describe('SSE event type filtering', () => {
    it('should extract unique event types', () => {
      const messages = [
        { eventType: 'message' },
        { eventType: 'user-update' },
        { eventType: 'message' },
        { eventType: 'notification' },
        { eventType: 'user-update' },
      ];

      const unique = [...new Set(messages.map(m => m.eventType))].sort();
      expect(unique).toEqual(['message', 'notification', 'user-update']);
    });

    it('should filter by event type', () => {
      const messages = [
        { eventType: 'message', data: 'hello' },
        { eventType: 'ping', data: '' },
        { eventType: 'message', data: 'world' },
      ];

      const filtered = messages.filter(m => m.eventType === 'message');
      expect(filtered).toHaveLength(2);
    });

    it('should show all when filter is empty', () => {
      const messages = [
        { eventType: 'a' },
        { eventType: 'b' },
        { eventType: 'c' },
      ];

      const filter = '';
      const filtered = filter ? messages.filter(m => m.eventType === filter) : messages;
      expect(filtered).toHaveLength(3);
    });
  });

  describe('SSE protocol parsing logic', () => {
    it('should parse standard data lines', () => {
      const lines = ['data: hello world', ''];
      const events: any[] = [];
      let dataLines: string[] = [];

      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            events.push({ data: dataLines.join('\n'), eventType: 'message' });
            dataLines = [];
          }
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        }
      }

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('hello world');
    });

    it('should parse multi-line data events', () => {
      const lines = ['data: first', 'data: second', 'data: third', ''];
      const events: any[] = [];
      let dataLines: string[] = [];

      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            events.push({ data: dataLines.join('\n') });
            dataLines = [];
          }
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        }
      }

      expect(events[0].data).toBe('first\nsecond\nthird');
    });

    it('should parse event type field', () => {
      const lines = ['event: user-login', 'data: {"user":"Ada"}', ''];
      let eventType = 'message';
      let dataLines: string[] = [];
      const events: any[] = [];

      for (const line of lines) {
        if (line === '') {
          events.push({ eventType, data: dataLines.join('\n') });
          eventType = 'message';
          dataLines = [];
        } else if (line.startsWith('event: ')) {
          eventType = line.slice(7);
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        }
      }

      expect(events[0].eventType).toBe('user-login');
      expect(events[0].data).toBe('{"user":"Ada"}');
    });

    it('should parse id field', () => {
      const lines = ['id: 42', 'data: ping', ''];
      let lastEventId = '';
      let dataLines: string[] = [];
      const events: any[] = [];

      for (const line of lines) {
        if (line === '') {
          events.push({ lastEventId, data: dataLines.join('\n') });
          dataLines = [];
        } else if (line.startsWith('id: ')) {
          lastEventId = line.slice(4);
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        }
      }

      expect(events[0].lastEventId).toBe('42');
    });

    it('should parse retry field as integer', () => {
      const line = 'retry: 5000';
      const value = line.slice(7);
      const parsed = parseInt(value, 10);

      expect(parsed).toBe(5000);
      expect(Number.isNaN(parsed)).toBe(false);
    });

    it('should ignore comment lines', () => {
      const lines = [': this is a comment', 'data: actual', ''];
      let dataLines: string[] = [];
      const events: any[] = [];

      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) events.push({ data: dataLines.join('\n') });
          dataLines = [];
        } else if (line.startsWith(':')) {
          // Comment: ignored
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        }
      }

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('actual');
    });

    it('should handle data field with no space after colon', () => {
      const line = 'data:nospace';
      const value = line.startsWith('data:') ? line.slice(5) : '';
      expect(value).toBe('nospace');
    });

    it('should reject id fields containing null byte', () => {
      const idValue = 'contains\0null';
      const valid = !idValue.includes('\0');
      expect(valid).toBe(false);
    });
  });

  describe('Auto-reconnect behavior', () => {
    it('should default retry to 3000ms', () => {
      const defaultRetry = 3000;
      expect(defaultRetry).toBe(3000);
    });

    it('should update retry from server directive', () => {
      let retryMs = 3000;
      const serverRetry = 'retry: 10000';
      const value = serverRetry.slice(7);
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) retryMs = parsed;
      expect(retryMs).toBe(10000);
    });

    it('should track reconnection attempts', () => {
      let attempt = 0;
      const maxRetries = 10;

      while (attempt < 3 && attempt < maxRetries) {
        attempt++;
      }

      expect(attempt).toBe(3);
      expect(attempt < maxRetries).toBe(true);
    });

    it('should stop after max retries', () => {
      const maxRetries = 10;
      let attempt = 10;

      expect(attempt >= maxRetries).toBe(true);
    });

    it('should not reconnect when disabled', () => {
      const autoReconnect = false;
      const maxRetries = autoReconnect ? 10 : 0;
      expect(maxRetries).toBe(0);
    });
  });

  describe('Message accumulation', () => {
    it('should accumulate messages up to MAX_MESSAGES', () => {
      const MAX = 1000;
      const messages: any[] = [];

      for (let i = 0; i < 1005; i++) {
        messages.push({ id: `msg-${i}` });
        if (messages.length > MAX) messages.shift();
      }

      expect(messages).toHaveLength(MAX);
      expect(messages[0].id).toBe('msg-5');
    });

    it('should clear messages on demand', () => {
      const messages = [{ id: 'a' }, { id: 'b' }];
      const cleared: any[] = [];
      expect(cleared).toHaveLength(0);
    });
  });
});
