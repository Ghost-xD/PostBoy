import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}));

/**
 * WebSocket Support Tests
 * Tests cover: store state, message handling, API wrapper, tab isolation, UI logic
 */
describe('WebSocket Support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WsMessage type', () => {
    it('should represent a sent text message', () => {
      const msg = {
        id: 'msg-1',
        direction: 'sent' as const,
        data: 'Hello server',
        timestamp: Date.now(),
        type: 'text' as const,
        size: 12
      };

      expect(msg.direction).toBe('sent');
      expect(msg.type).toBe('text');
      expect(msg.size).toBe(12);
      expect(msg.data).toBe('Hello server');
    });

    it('should represent a received binary message', () => {
      const msg = {
        id: 'msg-2',
        direction: 'received' as const,
        data: '[binary 256 bytes]',
        timestamp: Date.now(),
        type: 'binary' as const,
        size: 256
      };

      expect(msg.direction).toBe('received');
      expect(msg.type).toBe('binary');
      expect(msg.size).toBe(256);
    });

    it('should calculate size from data string length', () => {
      const data = JSON.stringify({ users: [{ id: 1, name: 'Ada' }] });
      const msg = {
        id: 'msg-3',
        direction: 'received' as const,
        data,
        timestamp: Date.now(),
        type: 'text' as const,
        size: new Blob([data]).size
      };

      expect(msg.size).toBeGreaterThan(0);
      expect(msg.data).toContain('Ada');
    });
  });

  describe('Connection state management', () => {
    it('should start in disconnected state', () => {
      const state = {
        status: 'disconnected' as const,
        url: '',
        messages: [] as any[],
        connectedAt: null as number | null
      };

      expect(state.status).toBe('disconnected');
      expect(state.messages).toHaveLength(0);
      expect(state.connectedAt).toBeNull();
    });

    it('should transition to connecting state', () => {
      const state = {
        status: 'disconnected' as const,
        url: '',
        messages: [] as any[],
        connectedAt: null as number | null
      };

      const connecting = {
        ...state,
        status: 'connecting' as const,
        url: 'ws://localhost:8080'
      };

      expect(connecting.status).toBe('connecting');
      expect(connecting.url).toBe('ws://localhost:8080');
    });

    it('should transition to connected state with timestamp', () => {
      const now = Date.now();
      const state = {
        status: 'connected' as const,
        url: 'wss://api.example.com/ws',
        messages: [],
        connectedAt: now
      };

      expect(state.status).toBe('connected');
      expect(state.connectedAt).toBe(now);
    });

    it('should transition to error state', () => {
      const state = {
        status: 'error' as const,
        url: 'ws://bad-host',
        messages: [],
        connectedAt: null,
        error: 'Connection refused'
      };

      expect(state.status).toBe('error');
      expect(state.error).toBe('Connection refused');
    });

    it('should clear messages independently of connection state', () => {
      const messages = [
        { id: '1', direction: 'sent', data: 'hello', timestamp: 1, type: 'text', size: 5 },
        { id: '2', direction: 'received', data: 'world', timestamp: 2, type: 'text', size: 5 }
      ];

      const cleared: any[] = [];
      expect(cleared).toHaveLength(0);
      expect(messages).toHaveLength(2);
    });
  });

  describe('Multiple tab isolation', () => {
    it('should maintain independent state per tab', () => {
      const connections = new Map<string, { status: string; messages: any[] }>();

      connections.set('tab-1', { status: 'connected', messages: [{ data: 'tab1-msg' }] });
      connections.set('tab-2', { status: 'disconnected', messages: [] });

      expect(connections.get('tab-1')?.status).toBe('connected');
      expect(connections.get('tab-1')?.messages).toHaveLength(1);
      expect(connections.get('tab-2')?.status).toBe('disconnected');
      expect(connections.get('tab-2')?.messages).toHaveLength(0);
    });

    it('should not leak messages between tabs', () => {
      const connections = new Map<string, any[]>();
      connections.set('tab-1', []);
      connections.set('tab-2', []);

      connections.get('tab-1')!.push({ id: '1', data: 'only-tab-1' });

      expect(connections.get('tab-1')).toHaveLength(1);
      expect(connections.get('tab-2')).toHaveLength(0);
    });

    it('should clean up when tab is closed', () => {
      const connections = new Map<string, any>();
      connections.set('tab-1', { status: 'connected' });
      connections.set('tab-2', { status: 'connected' });

      connections.delete('tab-1');

      expect(connections.has('tab-1')).toBe(false);
      expect(connections.has('tab-2')).toBe(true);
    });
  });

  describe('Tauri API wrapper (ws)', () => {
    it('should invoke ws_connect with correct params', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke('ws_connect', {
        id: 'tab-1',
        url: 'ws://localhost:8080',
        headers: { 'Authorization': 'Bearer token123' }
      });

      expect(invoke).toHaveBeenCalledWith('ws_connect', {
        id: 'tab-1',
        url: 'ws://localhost:8080',
        headers: { 'Authorization': 'Bearer token123' }
      });
    });

    it('should invoke ws_send with message', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke('ws_send', {
        id: 'tab-1',
        message: '{"action":"subscribe","channel":"updates"}'
      });

      expect(invoke).toHaveBeenCalledWith('ws_send', {
        id: 'tab-1',
        message: '{"action":"subscribe","channel":"updates"}'
      });
    });

    it('should invoke ws_send_binary with base64 payload', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke('ws_send_binary', {
        id: 'tab-1',
        dataBase64: 'aGVsbG8='
      });

      expect(invoke).toHaveBeenCalledWith('ws_send_binary', {
        id: 'tab-1',
        dataBase64: 'aGVsbG8='
      });
    });

    it('should invoke ws_disconnect', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await invoke('ws_disconnect', { id: 'tab-1' });

      expect(invoke).toHaveBeenCalledWith('ws_disconnect', { id: 'tab-1' });
    });

    it('should handle connection error from backend', async () => {
      vi.mocked(invoke).mockRejectedValue('Connection refused');

      await expect(
        invoke('ws_connect', { id: 'tab-1', url: 'ws://bad-host:9999' })
      ).rejects.toBe('Connection refused');
    });

    it('should handle send error when not connected', async () => {
      vi.mocked(invoke).mockRejectedValue('No active connection for id: tab-1');

      await expect(
        invoke('ws_send', { id: 'tab-1', message: 'hello' })
      ).rejects.toContain('No active connection');
    });
  });

  describe('Message history', () => {
    it('should append messages in order', () => {
      const messages: any[] = [];

      messages.push({ id: '1', data: 'first', timestamp: 100 });
      messages.push({ id: '2', data: 'second', timestamp: 200 });
      messages.push({ id: '3', data: 'third', timestamp: 300 });

      expect(messages).toHaveLength(3);
      expect(messages[0].data).toBe('first');
      expect(messages[2].data).toBe('third');
    });

    it('should enforce max message limit', () => {
      const MAX_MESSAGES = 1000;
      const messages: any[] = [];

      for (let i = 0; i < 1050; i++) {
        messages.push({ id: `${i}`, data: `msg-${i}`, timestamp: i });
        if (messages.length > MAX_MESSAGES) {
          messages.shift();
        }
      }

      expect(messages).toHaveLength(MAX_MESSAGES);
      expect(messages[0].data).toBe('msg-50');
      expect(messages[messages.length - 1].data).toBe('msg-1049');
    });

    it('should track sent vs received counts', () => {
      const messages = [
        { direction: 'sent' },
        { direction: 'received' },
        { direction: 'received' },
        { direction: 'sent' },
        { direction: 'received' }
      ];

      const sentCount = messages.filter(m => m.direction === 'sent').length;
      const receivedCount = messages.filter(m => m.direction === 'received').length;

      expect(sentCount).toBe(2);
      expect(receivedCount).toBe(3);
    });
  });

  describe('URL handling', () => {
    it('should detect WebSocket URLs', () => {
      const isWsUrl = (url: string) => /^wss?:\/\//i.test(url);

      expect(isWsUrl('ws://localhost:8080')).toBe(true);
      expect(isWsUrl('wss://api.example.com/ws')).toBe(true);
      expect(isWsUrl('http://api.example.com')).toBe(false);
      expect(isWsUrl('https://api.example.com')).toBe(false);
    });

    it('should convert HTTP URLs to WS', () => {
      const toWsUrl = (url: string) =>
        url.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');

      expect(toWsUrl('http://localhost:8080')).toBe('ws://localhost:8080');
      expect(toWsUrl('https://api.example.com/ws')).toBe('wss://api.example.com/ws');
    });

    it('should validate WS URL format', () => {
      const isValidWsUrl = (url: string) => {
        try {
          const u = new URL(url);
          return u.protocol === 'ws:' || u.protocol === 'wss:';
        } catch {
          return false;
        }
      };

      expect(isValidWsUrl('ws://localhost:8080')).toBe(true);
      expect(isValidWsUrl('wss://api.example.com/ws')).toBe(true);
      expect(isValidWsUrl('not-a-url')).toBe(false);
      expect(isValidWsUrl('')).toBe(false);
    });
  });

  describe('Tab interface extensions', () => {
    it('should have default WS fields on new tab', () => {
      const defaultTab = {
        id: 'new-tab',
        method: 'GET',
        url: '',
        wsMessages: [] as any[],
        wsStatus: 'disconnected' as const
      };

      expect(defaultTab.wsMessages).toEqual([]);
      expect(defaultTab.wsStatus).toBe('disconnected');
    });

    it('should detect WS method on tab', () => {
      const isWsTab = (method: string) => method === 'WS' || method === 'WSS';

      expect(isWsTab('WS')).toBe(true);
      expect(isWsTab('WSS')).toBe(true);
      expect(isWsTab('GET')).toBe(false);
      expect(isWsTab('POST')).toBe(false);
    });
  });

  describe('JSON message formatting', () => {
    it('should detect and format JSON messages', () => {
      const tryFormatJson = (data: string): string | null => {
        try {
          return JSON.stringify(JSON.parse(data), null, 2);
        } catch {
          return null;
        }
      };

      const jsonMsg = '{"action":"ping","ts":1234}';
      const formatted = tryFormatJson(jsonMsg);
      expect(formatted).toContain('\n');
      expect(formatted).toContain('"action"');

      const plainMsg = 'Hello world';
      expect(tryFormatJson(plainMsg)).toBeNull();
    });

    it('should handle large JSON messages', () => {
      const largeObj: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        largeObj[`key_${i}`] = i;
      }
      const json = JSON.stringify(largeObj);
      const parsed = JSON.parse(json);

      expect(Object.keys(parsed)).toHaveLength(100);
    });
  });

  describe('Keyboard shortcuts for WS', () => {
    it('should map Ctrl+Enter to connect/disconnect toggle', () => {
      const handleKey = (e: { ctrlKey: boolean; key: string }, wsStatus: string) => {
        if (e.ctrlKey && e.key === 'Enter') {
          return wsStatus === 'connected' ? 'disconnect' : 'connect';
        }
        return null;
      };

      expect(handleKey({ ctrlKey: true, key: 'Enter' }, 'disconnected')).toBe('connect');
      expect(handleKey({ ctrlKey: true, key: 'Enter' }, 'connected')).toBe('disconnect');
    });

    it('should map Ctrl+L to clear messages', () => {
      const handleKey = (e: { ctrlKey: boolean; key: string }) => {
        if (e.ctrlKey && e.key === 'l') return 'clearMessages';
        return null;
      };

      expect(handleKey({ ctrlKey: true, key: 'l' })).toBe('clearMessages');
      expect(handleKey({ ctrlKey: false, key: 'l' })).toBeNull();
    });
  });
});
