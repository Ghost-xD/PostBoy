import { get } from 'svelte/store';
import { tabs } from '$lib/stores/tabStore';
import { db } from '$lib/api/tauri';

export const HISTORY_UPDATED_EVENT = 'ripple:history-updated';

const STREAM_METHODS = new Set(['WS', 'WSS', 'SSE']);

export function isStreamMethod(method: string | undefined): boolean {
  return !!method && STREAM_METHODS.has(method);
}

/** Persist a WebSocket or SSE connect attempt to the request history table. */
export async function recordStreamConnectHistory(
  tabId: string,
  options: { responseTimeMs: number; status: number; summary: string }
): Promise<void> {
  const tab = get(tabs).find((t) => t.id === tabId);
  if (!tab?.url?.trim() || !isStreamMethod(tab.method)) return;

  const headersObj: Record<string, string> = {};
  for (const h of tab.headers || []) {
    if (h.key && h.value) headersObj[h.key] = h.value;
  }

  await db.addHistory(
    {
      method: tab.method,
      url: tab.url,
      headers: headersObj,
      params: [],
      bodyType: 'none',
      bodyContent: '',
      authType: 'none',
      authData: {},
    },
    {
      status: options.status,
      responseTime: options.responseTimeMs,
      headers: {},
      body: options.summary,
    }
  );

  window.dispatchEvent(new CustomEvent(HISTORY_UPDATED_EVENT));
}

export function isHistorySuccessStatus(status: number | null | undefined): boolean {
  if (status == null) return false;
  return status === 101 || (status >= 200 && status < 300);
}
