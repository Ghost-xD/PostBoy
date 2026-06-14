import type { Tab } from '$lib/stores/tabStore';

export const STREAM_METHODS = new Set(['WS', 'WSS', 'SSE']);

export function isStreamMethod(method: string | undefined): boolean {
  return !!method && STREAM_METHODS.has(method);
}

export interface StreamConfig {
  wsSendMode?: 'text' | 'binary';
  /** Text message or base64 payload (when wsSendMode is binary). */
  wsInitialMessage?: string;
  wsPreRequestScript?: string;
  wsOnMessageScript?: string;
  sseAutoReconnect?: boolean;
  sseEventFilter?: string;
  sseLastEventId?: string;
  sseOnMessageScript?: string;
  /** Max wait for first message in collection chains (ms). */
  chainTimeoutMs?: number;
}

export function serializeStreamConfig(tab: Tab): string {
  const config: StreamConfig = {
    wsSendMode: tab.wsSendMode || 'text',
    wsInitialMessage: tab.wsInitialMessage || '',
    wsPreRequestScript: tab.preRequestScript || '',
    wsOnMessageScript: tab.wsOnMessageScript || '',
    sseAutoReconnect: tab.sseAutoReconnect ?? true,
    sseEventFilter: tab.sseEventFilter || '',
    sseLastEventId: tab.sseLastEventId || '',
    sseOnMessageScript: tab.sseOnMessageScript || '',
    chainTimeoutMs: tab.streamChainTimeoutMs ?? 10000,
  };
  return JSON.stringify(config);
}

export function parseStreamConfig(raw: string | undefined | null, method?: string): StreamConfig {
  if (!raw?.trim()) return defaultStreamConfig(method);
  try {
    const parsed = JSON.parse(raw) as StreamConfig;
    return { ...defaultStreamConfig(method), ...parsed };
  } catch {
    return defaultStreamConfig(method);
  }
}

function defaultStreamConfig(method?: string): StreamConfig {
  const base: StreamConfig = { chainTimeoutMs: 10000 };
  if (method === 'SSE') {
    base.sseAutoReconnect = true;
  } else if (method === 'WS' || method === 'WSS') {
    base.wsSendMode = 'text';
  }
  return base;
}

/** Apply persisted stream config onto a tab patch object. */
export function applyStreamConfigToTab(
  patch: Record<string, unknown>,
  config: StreamConfig,
  method: string
): void {
  if (method === 'WS' || method === 'WSS') {
    patch.wsSendMode = config.wsSendMode ?? 'text';
    patch.wsInitialMessage = config.wsInitialMessage ?? '';
    patch.preRequestScript = config.wsPreRequestScript ?? '';
    patch.wsOnMessageScript = config.wsOnMessageScript ?? '';
  }
  if (method === 'SSE') {
    patch.sseAutoReconnect = config.sseAutoReconnect ?? true;
    patch.sseEventFilter = config.sseEventFilter ?? '';
    patch.sseLastEventId = config.sseLastEventId ?? '';
    patch.preRequestScript = config.wsPreRequestScript ?? patch.preRequestScript ?? '';
    patch.sseOnMessageScript = config.sseOnMessageScript ?? '';
  }
  patch.streamChainTimeoutMs = config.chainTimeoutMs ?? 10000;
  patch.bodyType = 'stream';
}
