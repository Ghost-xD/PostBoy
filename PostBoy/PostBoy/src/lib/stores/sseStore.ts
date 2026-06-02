import { listen } from '@tauri-apps/api/event';
import { sse } from '$lib/api/tauri';
import { tabs, type SseMessage } from '$lib/stores/tabStore';
import { addLog } from '$lib/stores/consoleStore';

const MAX_MESSAGES = 1000;

let listenersInitialized = false;

function generateMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateTabSse(tabId: string, updates: Partial<{ sseStatus: string; sseMessages: SseMessage[] }>) {
  tabs.update(current =>
    current.map(tab =>
      tab.id === tabId ? { ...tab, ...updates } as any : tab
    )
  );
}

function pushMessage(tabId: string, msg: SseMessage) {
  tabs.update(current =>
    current.map(tab => {
      if (tab.id !== tabId) return tab;
      const messages = [...tab.sseMessages, msg];
      if (messages.length > MAX_MESSAGES) messages.shift();
      return { ...tab, sseMessages: messages };
    })
  );
}

export function initSseListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  listen<{ id: string }>('sse-connected', (event) => {
    const { id } = event.payload;
    updateTabSse(id, { sseStatus: 'connected' });
    addLog(`SSE connected: ${id}`, 'info');
  });

  listen<{ id: string; data: string; eventType: string; lastEventId: string; timestamp: number }>('sse-message', (event) => {
    const { id, data, eventType, lastEventId, timestamp } = event.payload;
    pushMessage(id, {
      id: generateMsgId(),
      eventType,
      data,
      lastEventId,
      timestamp,
      size: new Blob([data]).size,
    });
  });

  listen<{ id: string; reason: string }>('sse-disconnected', (event) => {
    const { id, reason } = event.payload;
    updateTabSse(id, { sseStatus: 'disconnected' });
    addLog(`SSE disconnected: ${reason}`, 'info');
  });

  listen<{ id: string; error: string }>('sse-error', (event) => {
    const { id, error } = event.payload;
    updateTabSse(id, { sseStatus: 'error' });
    addLog(`SSE error [${id}]: ${error}`, 'error');
  });

  listen<{ id: string; attempt: number; delayMs: number }>('sse-reconnecting', (event) => {
    const { id, attempt, delayMs } = event.payload;
    updateTabSse(id, { sseStatus: 'reconnecting' });
    addLog(`SSE reconnecting [${id}]: attempt ${attempt}, delay ${delayMs}ms`, 'warn');
  });
}

export async function sseConnect(tabId: string, url: string, headers?: Record<string, string>, autoReconnect?: boolean) {
  updateTabSse(tabId, { sseStatus: 'connecting' });
  try {
    await sse.connect(tabId, url, headers, autoReconnect);
  } catch (err: any) {
    updateTabSse(tabId, { sseStatus: 'error' });
    addLog(`SSE connect failed: ${err}`, 'error');
  }
}

export async function sseDisconnect(tabId: string) {
  try {
    await sse.disconnect(tabId);
  } catch (err: any) {
    addLog(`SSE disconnect: ${err}`, 'warn');
  }
}

export function clearSseMessages(tabId: string) {
  updateTabSse(tabId, { sseMessages: [] });
}
