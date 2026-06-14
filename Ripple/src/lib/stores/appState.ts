import { writable } from 'svelte/store';

// Types
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
  formDataPairs: Array<{key: string, value: string, type: 'text' | 'file'}>;
  formUrlencodedPairs: Array<{key: string, value: string}>;
  graphqlQuery: string;
  graphqlVariables: string;
  binaryFileName: string;
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
  responseTimestamp: string;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  requests: Request[];
}

export interface Request {
  id: number;
  collectionId?: number;
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  description?: string;
}

export interface HistoryItem {
  id: number;
  method: string;
  url: string;
  status: number;
  responseTime: number;
  timestamp: number;
}

// Helper to create a default tab
function createDefaultTab(id?: string): Tab {
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
    responseTimestamp: ''
  };
}

// Stores
export const tabs = writable<Tab[]>([
  createDefaultTab('1')
]);

export const activeTabId = writable<string>('1');
export const collections = writable<Collection[]>([]);
export const history = writable<HistoryItem[]>([]);
export const settings = writable<Record<string, any>>({});

// Tab management
export function addTab() {
  const newTab = createDefaultTab();
  
  tabs.update(currentTabs => [...currentTabs, newTab]);
  activeTabId.set(newTab.id);
  
  return newTab; // Return the created tab
}

export function removeTab(id: string) {
  tabs.update(currentTabs => {
    if (currentTabs.length <= 1) {
      // Last tab — replace with a fresh blank tab
      const freshTab = createDefaultTab();
      activeTabId.set(freshTab.id);
      return [freshTab];
    }
    
    const newTabs = currentTabs.filter(t => t.id !== id);
    
    // If removing active tab, switch to nearest tab
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

export function setActiveTab(id: string) {
  activeTabId.set(id);
}

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

// Collection management
export function addCollection(collection: Collection) {
  collections.update(current => [...current, collection]);
}

export function removeCollection(id: number) {
  collections.update(current => current.filter(c => c.id !== id));
}

export function updateCollection(id: number, updates: Partial<Collection>) {
  collections.update(current => {
    return current.map(collection => {
      if (collection.id === id) {
        return { ...collection, ...updates };
      }
      return collection;
    });
  });
}

// History management
const MAX_HISTORY_ITEMS = 100;

export function addToHistory(item: HistoryItem) {
  history.update(current => {
    const newHistory = [item, ...current];
    // Limit to MAX_HISTORY_ITEMS
    return newHistory.slice(0, MAX_HISTORY_ITEMS);
  });
}

export function clearHistory() {
  history.set([]);
}

// Settings management
export function updateSetting(key: string, value: any) {
  settings.update(current => ({
    ...current,
    [key]: value
  }));
}
