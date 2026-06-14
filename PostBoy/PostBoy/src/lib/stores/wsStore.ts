import { listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { ws } from '$lib/api/tauri';
import { tabs, type WsMessage } from '$lib/stores/tabStore';
import { addLog } from '$lib/stores/consoleStore';
import { recordStreamConnectHistory } from '$lib/utils/streamHistory';
import { runStreamPreConnectScript, runStreamOnMessageScript } from '$lib/utils/streamScriptRunner';
import { createScriptVariableContext } from '$lib/utils/scriptVariables';

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

function runOnMessageScript(tabId: string, message: WsMessage) {
  void runOnMessageScriptAsync(tabId, message);
}

async function runOnMessageScriptAsync(tabId: string, message: WsMessage) {
  const tab = get(tabs).find((t) => t.id === tabId);
  if (!tab?.wsOnMessageScript?.trim()) return;

  const headers: Record<string, string> = {};
  for (const h of tab.headers || []) {
    if (h.key && h.value) headers[h.key] = h.value;
  }

  const variableApi = createScriptVariableContext(tab.collectionId);
  const result = await runStreamOnMessageScript(
    tab.wsOnMessageScript,
    { method: tab.method, url: tab.url, headers, collectionId: tab.collectionId },
    {
      data: message.data,
      binary: message.type === 'binary',
      timestamp: message.timestamp,
    },
    variableApi
  );

  for (const line of result.logs) addLog(line, 'info');
  for (const line of result.errors) addLog(`WS script: ${line}`, 'error');
  for (const test of result.testResults) {
    addLog(
      test.passed ? `✓ ${test.name}` : `✗ ${test.name}${test.error ? `: ${test.error}` : ''}`,
      test.passed ? 'info' : 'error'
    );
  }
}

export function initWsListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  listen<{ id: string }>('ws-connected', (event) => {
    const { id } = event.payload;
    updateTabWs(id, { wsStatus: 'connected' });
    addLog(`WebSocket connected: ${id}`, 'info');
  });

  listen<{ id: string; data: string; binary: boolean; base64?: string; timestamp: number }>(
    'ws-message',
    (event) => {
      const { id, data, binary, base64, timestamp } = event.payload;
      const displayData = binary && base64 ? base64 : data;
      const msg: WsMessage = {
        id: generateMsgId(),
        direction: 'received',
        data: displayData,
        timestamp,
        type: binary ? 'binary' : 'text',
        size: binary && base64 ? atob(base64).length : new Blob([data]).size,
      };
      pushMessage(id, msg);
      runOnMessageScript(id, msg);
    }
  );

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
  const started = Date.now();
  const tab = get(tabs).find((t) => t.id === tabId);
  if (!tab) return;

  let connectUrl = url;
  let connectHeaders = { ...(headers || {}) };

  if (tab.preRequestScript?.trim()) {
    const variableApi = createScriptVariableContext(tab.collectionId);
    const pre = await runStreamPreConnectScript(
      tab.preRequestScript,
      { method: tab.method, url: connectUrl, headers: connectHeaders, collectionId: tab.collectionId },
      variableApi
    );
    connectUrl = pre.request.url;
    connectHeaders = pre.request.headers;
    for (const line of pre.logs) addLog(line, 'info');
    for (const line of pre.errors) addLog(`WS pre-script: ${line}`, 'error');
  }

  updateTabWs(tabId, { wsStatus: 'connecting' });
  try {
    await ws.connect(tabId, connectUrl, Object.keys(connectHeaders).length > 0 ? connectHeaders : undefined);
    await recordStreamConnectHistory(tabId, {
      responseTimeMs: Date.now() - started,
      status: 101,
      summary: 'WebSocket connected',
    });
  } catch (err: any) {
    updateTabWs(tabId, { wsStatus: 'error' });
    addLog(`WebSocket connect failed: ${err}`, 'error');
    await recordStreamConnectHistory(tabId, {
      responseTimeMs: Date.now() - started,
      status: 0,
      summary: `WebSocket connect failed: ${err}`,
    }).catch(() => {});
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

export async function wsSendBinary(tabId: string, base64Payload: string, label?: string) {
  try {
    await ws.sendBinary(tabId, base64Payload);
    const byteLen = atob(base64Payload).length;
    pushMessage(tabId, {
      id: generateMsgId(),
      direction: 'sent',
      data: label || base64Payload,
      timestamp: Date.now(),
      type: 'binary',
      size: byteLen,
    });
  } catch (err: any) {
    addLog(`WebSocket binary send failed: ${err}`, 'error');
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
