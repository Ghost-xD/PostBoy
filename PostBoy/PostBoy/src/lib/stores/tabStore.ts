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
  return newTab;
}

// Remove a tab by ID
export function removeTab(id: string) {
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
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(async () => {
    try {
      const currentTabs = get(tabs);
      const currentActiveId = get(activeTabId);
      
      const data: SavedTabsData = {
        tabs: currentTabs,
        activeTabId: currentActiveId,
        ...uiState
      };
      
      await db.setSetting('saved_tabs', JSON.stringify(data));
    } catch (err) {
      console.error('Failed to save tabs:', err);
    }
  }, 500);
}

export function saveTabsImmediate(uiState?: Partial<SavedTabsData>) {
  if (saveTimeout) clearTimeout(saveTimeout);
  
  const currentTabs = get(tabs);
  const currentActiveId = get(activeTabId);
  
  const data: SavedTabsData = {
    tabs: currentTabs,
    activeTabId: currentActiveId,
    ...uiState
  };
  
  db.setSetting('saved_tabs', JSON.stringify(data)).catch(err => {
    console.error('Failed to save tabs:', err);
  });
}

export async function restoreTabs(): Promise<SavedTabsData | null> {
  try {
    const saved = await db.getSetting('saved_tabs', null);
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
