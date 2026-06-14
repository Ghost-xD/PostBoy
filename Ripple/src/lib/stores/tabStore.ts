import { writable, derived, get } from 'svelte/store';
import { db } from '$lib/api/tauri';

export interface Tab {
  id: string;
  name: string;
  requestId?: number;
  collectionId?: number;
  method: string;
  url: string;
  params: Array<{key: string, value: string}>;
  headers: Array<{key: string, value: string}>;
  bodyType: string;
  bodyContent: string;
  formDataPairs: Array<{key: string, value: string, type: 'text' | 'file', fileName?: string}>;
  formUrlencodedPairs: Array<{key: string, value: string}>;
  graphqlQuery: string;
  graphqlVariables: string;
  binaryFileName: string;
  binaryFilePath: string;
  binaryFileSize: string;
  authType: string;
  authUsername: string;
  authPassword: string;
  authToken: string;
  authApiKey: string;
  authApiValue: string;
  authData: Record<string, unknown>;
  grpcService: string;
  grpcMethod: string;
  preRequestScript: string;
  testScript: string;
  wsSendMode: 'text' | 'binary';
  wsInitialMessage: string;
  wsOnMessageScript: string;
  sseOnMessageScript: string;
  sseAutoReconnect: boolean;
  sseEventFilter: string;
  sseLastEventId: string;
  streamChainTimeoutMs: number;
  responseStatus: number | null;
  responseStatusText: string;
  responseTime: number | null;
  responseSize: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseContentType: string;
  responseIsBinary: boolean;
  responseTimestamp: string;
  description: string;
  wsMessages: WsMessage[];
  wsStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  sseMessages: SseMessage[];
  sseStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
}

export interface WsMessage {
  id: string;
  direction: 'sent' | 'received';
  data: string;
  timestamp: number;
  type: 'text' | 'binary';
  size: number;
}

export interface SseMessage {
  id: string;
  eventType: string;
  data: string;
  lastEventId: string;
  timestamp: number;
  size: number;
}

export function createDefaultTab(id?: string): Tab {
  return {
    id: id || Date.now().toString(),
    name: 'New Request',
    method: 'GET',
    url: '',
    params: [{key: '', value: ''}],
    headers: [{key: '', value: ''}],
    bodyType: 'json',
    bodyContent: '',
    formDataPairs: [{key: '', value: '', type: 'text'}],
    formUrlencodedPairs: [{key: '', value: ''}],
    graphqlQuery: '',
    graphqlVariables: '',
    binaryFileName: '',
    binaryFilePath: '',
    binaryFileSize: '',
    authType: 'none',
    authUsername: '',
    authPassword: '',
    authToken: '',
    authApiKey: '',
    authApiValue: '',
    authData: {},
    grpcService: '',
    grpcMethod: '',
    preRequestScript: '',
    testScript: '',
    wsSendMode: 'text',
    wsInitialMessage: '',
    wsOnMessageScript: '',
    sseOnMessageScript: '',
    sseAutoReconnect: true,
    sseEventFilter: '',
    sseLastEventId: '',
    streamChainTimeoutMs: 10000,
    responseStatus: null,
    responseStatusText: '',
    responseTime: null,
    responseSize: '',
    responseHeaders: {},
    responseBody: '',
    responseContentType: '',
    responseIsBinary: false,
    responseTimestamp: '',
    description: '',
    wsMessages: [],
    wsStatus: 'disconnected',
    sseMessages: [],
    sseStatus: 'disconnected'
  };
}

// Core stores
export const tabs = writable<Tab[]>([createDefaultTab('1')]);
export const activeTabId = writable<string>('1');

// Derived store: the currently active tab (reactive, updates when tabs or activeTabId change)
export const activeTab = derived(
  [tabs, activeTabId],
  ([$tabs, $activeTabId]) => {
    return $tabs.find(t => t.id === $activeTabId) || $tabs[0] || createDefaultTab();
  }
);

// Update a single field on the active tab
export function updateActiveTab<K extends keyof Tab>(field: K, value: Tab[K]) {
  const id = get(activeTabId);
  tabs.update(currentTabs => {
    return currentTabs.map(tab => {
      if (tab.id === id) {
        return { ...tab, [field]: value };
      }
      return tab;
    });
  });
}

// Batch update multiple fields on the active tab (for curl paste, load request, etc.)
export function updateActiveTabBatch(updates: Partial<Tab>) {
  const id = get(activeTabId);
  tabs.update(currentTabs => {
    return currentTabs.map(tab => {
      if (tab.id === id) {
        return { ...tab, ...updates };
      }
      return tab;
    });
  });
}

// Update any tab by ID
export function updateTab(id: string, updates: Partial<Tab>) {
  tabs.update(currentTabs => {
    return currentTabs.map(tab => {
      if (tab.id === id) {
        return { ...tab, ...updates };
      }
      return tab;
    });
  });
}

// Add a new blank tab and switch to it
export function addTab(): Tab {
  const newTab = createDefaultTab();
  tabs.update(currentTabs => [...currentTabs, newTab]);
  activeTabId.set(newTab.id);
  
  // Auto-focus URL input after creating new tab
  setTimeout(() => {
    const urlInput = document.getElementById('url-input') as HTMLInputElement | null;
    if (urlInput) {
      urlInput.focus();
      urlInput.select();
    }
  }, 50);
  
  return newTab;
}

// Remove a tab by ID
export function removeTab(id: string) {
  // If the tab has a live WebSocket connection, close it on the backend
  // before discarding the tab. Otherwise the Rust side keeps the socket
  // open (and, for chatty feeds like Binance, keeps streaming + logging)
  // until the process exits, because the connection id == tab id and
  // nothing else ever calls ws_disconnect for it.
  const closing = get(tabs).find(t => t.id === id);
  if (closing && (closing.wsStatus === 'connected' || closing.wsStatus === 'connecting')) {
    // Lazy import to avoid a circular dep with wsStore (which imports tabStore).
    import('$lib/stores/wsStore').then(m => m.wsDisconnect(id)).catch(() => {});
  }

  tabs.update(currentTabs => {
    if (currentTabs.length <= 1) {
      const freshTab = createDefaultTab();
      activeTabId.set(freshTab.id);
      return [freshTab];
    }
    
    const newTabs = currentTabs.filter(t => t.id !== id);
    
    activeTabId.update(activeId => {
      if (activeId === id) {
        const closedIndex = currentTabs.findIndex(t => t.id === id);
        const nextTab = newTabs[Math.min(closedIndex, newTabs.length - 1)];
        return nextTab?.id || newTabs[0]?.id || '';
      }
      return activeId;
    });
    
    return newTabs;
  });
}

// Set the active tab
export function setActiveTab(id: string) {
  activeTabId.set(id);
}

export function nextTab() {
  const all = get(tabs);
  if (all.length <= 1) return;
  const idx = all.findIndex(t => t.id === get(activeTabId));
  activeTabId.set(all[(idx + 1) % all.length].id);
}

export function prevTab() {
  const all = get(tabs);
  if (all.length <= 1) return;
  const idx = all.findIndex(t => t.id === get(activeTabId));
  activeTabId.set(all[(idx - 1 + all.length) % all.length].id);
}

// Find an open tab by URL and method
export function findOpenTab(url: string, method: string): Tab | undefined {
  return get(tabs).find(t => t.url === url && t.method === method);
}

// Persistence: save tabs + UI state to database
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
/** When true, debounced/immediate IPC saves are suppressed (page is reloading/closing). */
let ipcTabSavePaused = false;

const SAVED_TABS_LOCAL_KEY = 'ripple_saved_tabs_backup';

function buildSavedTabsData(uiState?: Partial<SavedTabsData>): SavedTabsData {
  return {
    tabs: get(tabs),
    activeTabId: get(activeTabId),
    ...uiState,
  };
}

function writeSavedTabsLocalBackup(data: SavedTabsData) {
  try {
    localStorage.setItem(SAVED_TABS_LOCAL_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

/** Block IPC tab saves during webview teardown (reload/close). */
export function pauseIpcTabSave() {
  ipcTabSavePaused = true;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
}

export function isIpcTabSavePaused(): boolean {
  return ipcTabSavePaused;
}

/** Await a durable save — call before `location.reload()`. */
export async function flushTabSave(uiState?: Partial<SavedTabsData>): Promise<void> {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  const data = buildSavedTabsData(uiState);
  await db.setSetting('saved_tabs', JSON.stringify(data));
  writeSavedTabsLocalBackup(data);
}

export interface SavedTabsData {
  tabs: Tab[];
  activeTabId: string;
  leftSidebarCollapsed?: boolean;
  rightSidebarCollapsed?: boolean;
  leftSidebarWidth?: number;
  rightSidebarWidth?: number;
  responseLayout?: 'right' | 'bottom';
  responsePanelHeight?: number;
}

export async function saveTabs(uiState?: Partial<SavedTabsData>) {
  if (ipcTabSavePaused) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    if (ipcTabSavePaused) return;
    try {
      const data = buildSavedTabsData(uiState);
      await db.setSetting('saved_tabs', JSON.stringify(data));
      writeSavedTabsLocalBackup(data);
    } catch (err) {
      console.error('Failed to save tabs:', err);
    }
  }, 500);
}

export function saveTabsImmediate(
  uiState?: Partial<SavedTabsData>,
  options?: { skipIpc?: boolean }
) {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  const data = buildSavedTabsData(uiState);

  // During reload/close the webview rejects Tauri IPC (ipc://localhost) with
  // "access control checks". Callers pass skipIpc and write a local backup instead.
  if (options?.skipIpc || ipcTabSavePaused) {
    writeSavedTabsLocalBackup(data);
    return;
  }
  
  db.setSetting('saved_tabs', JSON.stringify(data))
    .then(() => writeSavedTabsLocalBackup(data))
    .catch(err => {
      console.error('Failed to save tabs:', err);
    });
}

export async function restoreTabs(): Promise<SavedTabsData | null> {
  try {
    let saved = await db.getSetting('saved_tabs', null);

    if (!saved) {
      try {
        const backup =
          localStorage.getItem(SAVED_TABS_LOCAL_KEY) ??
          localStorage.getItem('postboy_saved_tabs_backup');
        if (backup) saved = backup;
      } catch {
        /* ignore */
      }
    }

    if (!saved) return null;
    
    const data: SavedTabsData = typeof saved === 'string' ? JSON.parse(saved) : saved;
    
    if (data.tabs && data.tabs.length > 0) {
      // Ensure all tabs have required default values (handles old saved data)
      const defaultTab = createDefaultTab();
      const restoredTabs = data.tabs.map(tab => ({
        ...defaultTab,
        ...tab,
        // Ensure critical fields always have valid values
        method: tab.method || 'GET',
        name: tab.name || 'New Request',
        url: tab.url || '',
        params: tab.params || [{key: '', value: ''}],
        headers: tab.headers || [{key: '', value: ''}],
      }));
      
      tabs.set(restoredTabs);
      
      const validId = restoredTabs.find(t => t.id === data.activeTabId)?.id || restoredTabs[0].id;
      activeTabId.set(validId);
    }
    
    return data;
  } catch (err) {
    console.error('Failed to restore tabs:', err);
    return null;
  }
}

// Auto-save tabs when they change (debounced)
let autoSaveUnsubscribe: (() => void) | null = null;

export function enableAutoSave() {
  if (autoSaveUnsubscribe) return;
  
  autoSaveUnsubscribe = tabs.subscribe(() => {
    saveTabs();
  });
}

export function disableAutoSave() {
  if (autoSaveUnsubscribe) {
    autoSaveUnsubscribe();
    autoSaveUnsubscribe = null;
  }
}
