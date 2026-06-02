import { writable, get } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import { ws } from '$lib/api/tauri';
import { tabs, type WsMessage } from '$lib/stores/tabStore';
import { addLog } from '$lib/stores/consoleStore';

const MAX_MESSAGES = 1000;

let listenersInitialized = false;

function generateMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateTabWs(tabId: string, updates: Partial<{ wsStatus: string; wsMessages: WsMessage[] }>) {
  tabs.update(current =>
    current.map(tab =>
      tab.id === tabId ? { ...tab, ...updates } as any : tab
    )
  );
}

function pushMessage(tabId: string, msg: WsMessage) {
  tabs.update(current =>
    current.map(tab => {
      if (tab.id !== tabId) return tab;
      const messages = [...tab.wsMessages, msg];
      if (messages.length > MAX_MESSAGES) messages.shift();
      return { ...tab, wsMessages: messages };
    })
  );
}

export function initWsListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  listen<{ id: string }>('ws-connected', (event) => {
    const { id } = event.payload;
    updateTabWs(id, { wsStatus: 'connected' });
    addLog(`WebSocket connected: ${id}`, 'info');
  });

  listen<{ id: string; data: string; binary: boolean; timestamp: number }>('ws-message', (event) => {
    const { id, data, binary, timestamp } = event.payload;
    pushMessage(id, {
      id: generateMsgId(),
      direction: 'received',
      data,
      timestamp,
      type: binary ? 'binary' : 'text',
      size: new Blob([data]).size,
    });
  });

  listen<{ id: string; code: number; reason: string }>('ws-disconnected', (event) => {
    const { id, code, reason } = event.payload;
    updateTabWs(id, { wsStatus: 'disconnected' });
    addLog(`WebSocket disconnected (${code}): ${reason}`, 'info');
  });

  listen<{ id: string; error: string }>('ws-error', (event) => {
    const { id, error } = event.payload;
    updateTabWs(id, { wsStatus: 'error' });
    addLog(`WebSocket error [${id}]: ${error}`, 'error');
  });
}

export async function wsConnect(tabId: string, url: string, headers?: Record<string, string>) {
  updateTabWs(tabId, { wsStatus: 'connecting' });
  try {
    await ws.connect(tabId, url, headers);
  } catch (err: any) {
    updateTabWs(tabId, { wsStatus: 'error' });
    addLog(`WebSocket connect failed: ${err}`, 'error');
  }
}

export async function wsSend(tabId: string, message: string) {
  try {
    await ws.send(tabId, message);
    pushMessage(tabId, {
      id: generateMsgId(),
      direction: 'sent',
      data: message,
      timestamp: Date.now(),
      type: 'text',
      size: new Blob([message]).size,
    });
  } catch (err: any) {
    addLog(`WebSocket send failed: ${err}`, 'error');
  }
}

export async function wsDisconnect(tabId: string) {
  try {
    await ws.disconnect(tabId);
  } catch (err: any) {
    addLog(`WebSocket disconnect: ${err}`, 'warn');
  }
}

export function clearWsMessages(tabId: string) {
  updateTabWs(tabId, { wsMessages: [] });
}
