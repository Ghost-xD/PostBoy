<script lang="ts">
  import { run, createBubbler, stopPropagation } from 'svelte/legacy';

  const bubble = createBubbler();
  import { db, http, fileOps } from '$lib/api/tauri';
  import { onMount, onDestroy } from 'svelte';
  import { flip } from 'svelte/animate';
  import { quintOut } from 'svelte/easing';
  import { variables, materializeMappingsFromResponse, resolveMappingEntry, type Variable, getValueAtPath, interpolate, interpolateKeyValues } from '$lib/stores/variableStore';
  import { addLog } from '$lib/stores/consoleStore';
  import { showLoadTest } from '$lib/stores/uiStore';
  import RequestChainPanel from './RequestChainPanel.svelte';
  import { loadChains as loadChainsFromDb, resolveRequest, type Chain } from '$lib/utils/chainRunner';
  import { pickChainRunEnvironment, applyChainRunEnvironment } from '$lib/utils/chainEnvironmentPicker';
  import { exportCollection, importCollectionFile } from '$lib/utils/collectionExporter';
  import * as modalManager from '$lib/utils/modalManager.svelte';

  function openLoadTest(collectionId: number) {
    showLoadTest.set({ collectionId });
  }

  interface Props {
    collections?: any[];
    onReload: () => Promise<void>;
    onRequestClick: (request: any) => void;
  }

  let { collections = [], onReload, onRequestClick }: Props = $props();

  let searchQuery = $state('');
  let searchInputEl: HTMLInputElement | undefined = $state();

  export function focusSearch() {
    searchInputEl?.focus();
    searchInputEl?.select();
  }

  function collectionMatchesSearch(collection: any, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    if ((collection.name || '').toLowerCase().includes(q)) return true;
    if (collection.requests) {
      return collection.requests.some((r: any) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.url || '').toLowerCase().includes(q) ||
        (r.method || '').toLowerCase().includes(q)
      );
    }
    return false;
  }

  function requestMatchesSearch(request: any, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return (request.name || '').toLowerCase().includes(q) ||
           (request.url || '').toLowerCase().includes(q) ||
           (request.method || '').toLowerCase().includes(q);
  }

  let expandedCollections = $state(new Set<number>());
  let expandedVariables = $state(new Set<number>());
  let editingVariable: { collectionId: number; key: string; value: string } | null = $state(null);
  let addingVariable: { collectionId: number; key: string; value: string } | null = $state(null);
  let revealedValues = $state(new Set<string>());

  let editingCollectionName: { id: number; name: string } | null = $state(null);
  let editingRequestName: { id: number; collectionId: number; name: string } | null = $state(null);

  let dragRequestId: number | null = $state(null);
  let dragCollectionId: number | null = $state(null);
  let dragInsertIndex: number | null = $state(null);
  let dragOriginalOrder: number[] | null = null;
  let dragClone: HTMLElement | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const flipDuration = 220;

  function requestOrdersEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
  }

  function buildOrderWithInsert(original: number[], dragId: number, insertIndex: number): number[] {
    const without = original.filter((id) => id !== dragId);
    const next = [...without];
    next.splice(insertIndex, 0, dragId);
    return next;
  }

  function findDropIndex(clientY: number, collectionId: number): number | null {
    if (dragInsertIndex === null) return null;

    const container = document.querySelector(`.collection-requests[data-collection-id="${collectionId}"]`);
    if (!container) return null;

    const rows = Array.from(container.querySelectorAll('.collection-request')) as HTMLElement[];
    if (rows.length === 0) return 0;

    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return i;
    }

    return rows.length;
  }

  function getReorderableRequests(collection: any): any[] {
    const requests = collection.requests || [];
    let list = requests;

    if (
      dragCollectionId === collection.id &&
      dragRequestId !== null &&
      dragOriginalOrder &&
      !searchQuery
    ) {
      const byId = new Map(requests.map((r: any) => [r.id, r]));
      list = dragOriginalOrder
        .filter((id) => id !== dragRequestId)
        .map((id) => byId.get(id))
        .filter(Boolean) as any[];
    }

    if (!searchQuery) return list;

    const q = searchQuery.toLowerCase();
    return list.filter(
      (r: any) =>
        requestMatchesSearch(r, searchQuery) ||
        (collection.name || '').toLowerCase().includes(q)
    );
  }

  function isDraggingCollection(collectionId: number): boolean {
    return dragCollectionId === collectionId && dragInsertIndex !== null && !searchQuery;
  }

  type ReorderSlot =
    | { kind: 'spacer'; key: string }
    | { kind: 'request'; key: string; request: any };

  function getReorderRenderSlots(collection: any): ReorderSlot[] {
    const items = getReorderableRequests(collection);
    const dragging = isDraggingCollection(collection.id);

    if (!dragging || dragInsertIndex === null) {
      return items.map((request: any) => ({
        kind: 'request' as const,
        key: `request-${request.id}`,
        request
      }));
    }

    const slots: ReorderSlot[] = [];
    for (let index = 0; index < items.length; index++) {
      if (dragInsertIndex === index) {
        slots.push({ kind: 'spacer', key: 'drag-spacer' });
      }
      slots.push({
        kind: 'request',
        key: `request-${items[index].id}`,
        request: items[index]
      });
    }
    if (dragInsertIndex === items.length) {
      slots.push({ kind: 'spacer', key: 'drag-spacer' });
    }
    return slots;
  }

  function startRenameCollection(id: number, currentName: string) {
    editingCollectionName = { id, name: currentName };
    editingRequestName = null;
    setTimeout(() => {
      const input = document.querySelector('.rename-collection-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
  }

  async function saveRenameCollection() {
    if (!editingCollectionName || !editingCollectionName.name.trim()) return;
    try {
      await db.renameCollection(editingCollectionName.id, editingCollectionName.name.trim());
      addLog(`✓ Renamed collection to "${editingCollectionName.name.trim()}"`, 'system');
      editingCollectionName = null;
      await onReload();
    } catch (e: any) {
      addLog(`✗ Failed to rename collection: ${e}`, 'error');
    }
  }

  function cancelRenameCollection() {
    editingCollectionName = null;
  }

  function startRenameRequest(id: number, collectionId: number, currentName: string) {
    editingRequestName = { id, collectionId, name: currentName };
    editingCollectionName = null;
    setTimeout(() => {
      const input = document.querySelector('.rename-request-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
  }

  async function saveRenameRequest() {
    if (!editingRequestName || !editingRequestName.name.trim()) return;
    try {
      await db.renameRequest(editingRequestName.id, editingRequestName.name.trim());
      addLog(`✓ Renamed request to "${editingRequestName.name.trim()}"`, 'system');
      editingRequestName = null;
      await onReload();
    } catch (e: any) {
      addLog(`✗ Failed to rename request: ${e}`, 'error');
    }
  }

  function cancelRenameRequest() {
    editingRequestName = null;
  }

  function handleGripMouseDown(e: MouseEvent, requestId: number, collectionId: number) {
    if (searchQuery) return;

    e.preventDefault();
    e.stopPropagation();

    const row = (e.target as HTMLElement).closest('.collection-request') as HTMLElement;
    if (!row) return;

    const collection = collections.find((c) => c.id === collectionId);
    const order = (collection?.requests || []).map((r: any) => r.id);
    if (order.length < 2) return;

    const rect = row.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    dragRequestId = requestId;
    dragCollectionId = collectionId;
    dragInsertIndex = order.indexOf(requestId);
    dragOriginalOrder = [...order];

    const clone = row.cloneNode(true) as HTMLElement;
    clone.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      z-index: 9999;
      pointer-events: none;
      opacity: 0.96;
      box-shadow: 0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(88, 101, 242, 0.45);
      border-radius: 6px;
      transform: scale(1.02);
      transition: opacity 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
      background: var(--bg-secondary, #2b2d31);
    `;
    document.body.appendChild(clone);
    dragClone = clone;

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    function onMouseMove(ev: MouseEvent) {
      if (dragClone) {
        dragClone.style.left = `${ev.clientX - dragOffsetX}px`;
        dragClone.style.top = `${ev.clientY - dragOffsetY}px`;
      }

      if (dragInsertIndex !== null && dragRequestId !== null && dragCollectionId !== null) {
        const targetIndex = findDropIndex(ev.clientY, dragCollectionId);
        if (targetIndex !== null && targetIndex !== dragInsertIndex) {
          dragInsertIndex = targetIndex;
        }
      }
    }

    async function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (dragClone) {
        dragClone.style.opacity = '0';
        dragClone.style.transform = 'scale(0.98)';
        const cloneRef = dragClone;
        setTimeout(() => cloneRef.remove(), 180);
        dragClone = null;
      }

      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const finalOrder =
        dragOriginalOrder && dragRequestId !== null && dragInsertIndex !== null
          ? buildOrderWithInsert(dragOriginalOrder, dragRequestId, dragInsertIndex)
          : null;
      const originalOrder = dragOriginalOrder;

      dragRequestId = null;
      dragCollectionId = null;
      dragInsertIndex = null;

      if (finalOrder && originalOrder && !requestOrdersEqual(finalOrder, originalOrder)) {
        try {
          await db.reorderRequests(finalOrder);
          addLog('✓ Requests reordered', 'system');
          await onReload();
        } catch (err: any) {
          addLog(`✗ Failed to reorder: ${err}`, 'error');
        }
      }

      dragOriginalOrder = null;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  async function shareCollection(collectionId: number, collectionName: string) {
    try {
      const pick = await modalManager.showForm('Export Collection', 'Choose export format:', [
        {
          id: 'format',
          label: 'Format',
          type: 'select',
          value: 'ripple',
          options: [
            { value: 'ripple', label: 'Ripple JSON (variables, chains, token refresh)' },
            { value: 'postman', label: 'Postman Collection v2.1' },
          ],
        },
      ]);
      if (!pick) return;

      const format = pick.format === 'postman' ? 'postman' : 'ripple';
      const json = await exportCollection(collectionId, format);
      const ext = format === 'postman' ? 'postman_collection.json' : 'ripple.json';
      const filePath = await fileOps.showSaveDialog({
        defaultPath: `${collectionName.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`,
        filters: [{ name: format === 'postman' ? 'Postman Collection' : 'Ripple Collection', extensions: ['json'] }],
      });
      if (filePath) {
        await fileOps.writeFile(filePath as string, json);
        addLog(`✓ Exported collection "${collectionName}" (${format})`, 'system');
      }
    } catch (e: any) {
      addLog(`✗ Failed to export collection: ${e}`, 'error');
    }
  }

  async function importSharedCollection() {
    try {
      const filePath = await fileOps.showOpenDialog({
        filters: [{ name: 'Collection JSON', extensions: ['json'] }],
        multiple: false,
      });
      if (!filePath) return;
      const path = Array.isArray(filePath) ? filePath[0] : filePath;
      const result = await fileOps.readFile(path as string) as any;
      const raw = typeof result === 'string' ? result : result?.data;
      if (!raw) return;

      const { format } = await importCollectionFile(raw);
      addLog(`✓ Imported collection (${format})`, 'system');
      await onReload();
    } catch (e: any) {
      addLog(`✗ Failed to import collection: ${e}`, 'error');
    }
  }

  interface TokenRefreshMapping {
    jsonPath: string;
    variableName: string;
  }

  interface TokenRefreshConfig {
    requestId: number;
    mappings: TokenRefreshMapping[];
  }

  let tokenRefreshConfigs: Map<number, TokenRefreshConfig | null> = new Map();
  let tokenConfigVersion = $state(0);
  let refreshingCollections = new Set<number>();
  let refreshVersion = $state(0);
  let refreshStatus: Map<number, { state: 'loading' | 'success' | 'error'; label: string; detail: string }> = new Map();
  let showConfigModal = $state(false);
  let configModalCollectionId: number | null = $state(null);

  let modalContainer: HTMLDivElement | null = null;

  let expandedChains = $state(new Set<number>());
  let chainCache: Map<number, Chain[]> = new Map();
  let chainCacheVersion = $state(0);
  let showChainModal = $state(false);
  let chainModalCollectionId: number | null = $state(null);
  let chainModalInitialChainId: string | null = $state(null);
  let chainModalInitialResults: any[] | null = $state(null);
  let chainModalAutoRun = $state(false);
  let chainModalEnvPreselected = $state(false);

  async function toggleChainsSection(collectionId: number) {
    if (expandedChains.has(collectionId)) {
      expandedChains.delete(collectionId);
    } else {
      expandedChains.add(collectionId);
      if (!chainCache.has(collectionId)) {
        const chains = await loadChainsFromDb(collectionId);
        chainCache.set(collectionId, chains);
        chainCache = new Map(chainCache);
        chainCacheVersion++;
      }
    }
    expandedChains = new Set(expandedChains);
  }

  function getChainsForCollection(collectionId: number, _v?: number): Chain[] {
    return chainCache.get(collectionId) || [];
  }

  function openChainBuilder(collectionId: number) {
    chainModalCollectionId = collectionId;
    chainModalInitialChainId = null;
    chainModalInitialResults = null;
    chainModalAutoRun = false;
    showChainModal = true;
  }

  async function closeChainBuilder() {
    if (chainModalCollectionId) {
      const chains = await loadChainsFromDb(chainModalCollectionId);
      chainCache.set(chainModalCollectionId, chains);
      chainCache = new Map(chainCache);
      chainCacheVersion++;
    }
    showChainModal = false;
    chainModalCollectionId = null;
    chainModalInitialChainId = null;
    chainModalInitialResults = null;
    chainModalAutoRun = false;
    chainModalEnvPreselected = false;
  }

  async function runChainFromSidebar(collectionId: number, chain: Chain) {
    if (showChainModal && chainModalCollectionId === collectionId) return;

    const picked = await pickChainRunEnvironment(chain.name);
    if (picked === undefined) return;

    const envName = await applyChainRunEnvironment(picked);
    addLog(`▶ Chain "${chain.name}" → ${envName}`, 'system');

    chainModalCollectionId = collectionId;
    chainModalInitialChainId = chain.id;
    chainModalInitialResults = null;
    chainModalAutoRun = true;
    chainModalEnvPreselected = true;
    showChainModal = true;
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }
  let configModalRequestId: number | null = $state(null);
  let configModalMappings: TokenRefreshMapping[] = $state([]);
  let availableJsonPaths: Array<{ path: string; value: string }> = $state([]);
  let isTestingRequest = $state(false);
  let testRequestError: string | null = $state(null);
  // Cached parsed JSON from the last successful Test in this modal session.
  // Used by Save to write mapped variables without re-running the request.
  let testResponseJson: any = $state(null);

  async function testTokenRequest() {
    if (!configModalCollectionId || !configModalRequestId) return;
    
    isTestingRequest = true;
    testRequestError = null;
    availableJsonPaths = [];
    testResponseJson = null;
    
    try {
      const request = await db.getRequest(configModalRequestId) as any;
      if (!request) {
        testRequestError = 'Request not found';
        return;
      }

      // Reuse the same builder as normal sends/chains so the Test button
      // applies auth and encodes the body identically (avoids false 400s on
      // form-urlencoded token endpoints or those using the Authorization tab).
      const resolved = await resolveRequest(request, configModalCollectionId);

      const response: any = await http.executeRequest(
        resolved.method,
        resolved.url,
        Object.keys(resolved.headers).length > 0 ? resolved.headers : undefined,
        resolved.body
      );

      if (response.status >= 400) {
        testRequestError = `Request failed: ${response.status} ${response.statusText || ''}`;
        return;
      }

      let responseJson: any;
      try {
        responseJson = JSON.parse(response.body);
      } catch {
        testRequestError = 'Response is not valid JSON';
        return;
      }

      const { flattenJsonPaths } = await import('$lib/stores/variableStore');
      availableJsonPaths = flattenJsonPaths(responseJson);
      testResponseJson = responseJson;
      
      addLog(`✓ Found ${availableJsonPaths.length} JSON paths`, 'system');
    } catch (error: any) {
      testRequestError = error.message || 'Request failed';
    } finally {
      isTestingRequest = false;
    }
  }

  function selectJsonPath(path: string, mappingIndex: number) {
    if (configModalMappings[mappingIndex]) {
      configModalMappings[mappingIndex].jsonPath = path;
      configModalMappings = [...configModalMappings];
    }
  }

  function suggestVariableName(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1].replace(/\[\d+\]/g, '');
  }

  async function loadTokenRefreshConfig(collectionId: number): Promise<TokenRefreshConfig | null> {
    try {
      const saved = await db.getSetting(`token_refresh_${collectionId}`, null);
      if (saved && saved !== 'null') {
        const config = typeof saved === 'string' ? JSON.parse(saved) : saved;
        return config as TokenRefreshConfig;
      }
    } catch (error) {
      console.error('Failed to load token refresh config:', error);
    }
    return null;
  }

  async function saveTokenRefreshConfig(collectionId: number, config: TokenRefreshConfig | null): Promise<void> {
    try {
      if (config) {
        await db.setSetting(`token_refresh_${collectionId}`, JSON.stringify(config));
      } else {
        await db.setSetting(`token_refresh_${collectionId}`, 'null');
      }
      tokenRefreshConfigs.set(collectionId, config);
      tokenRefreshConfigs = tokenRefreshConfigs;
      tokenConfigVersion++;
    } catch (error) {
      console.error('Failed to save token refresh config:', error);
    }
  }

  function openConfigModal(collectionId: number) {
    configModalCollectionId = collectionId;
    const existing = tokenRefreshConfigs.get(collectionId);
    if (existing) {
      configModalRequestId = existing.requestId;
      configModalMappings = [...existing.mappings];
    } else {
      configModalRequestId = null;
      configModalMappings = [{ jsonPath: '', variableName: '' }];
    }
    showConfigModal = true;
  }

  function closeConfigModal() {
    showConfigModal = false;
    configModalCollectionId = null;
    configModalRequestId = null;
    configModalMappings = [];
    availableJsonPaths = [];
    testRequestError = null;
    testResponseJson = null;
  }

  function addMapping() {
    configModalMappings = [...configModalMappings, { jsonPath: '', variableName: '' }];
  }

  function removeMapping(index: number) {
    configModalMappings = configModalMappings.filter((_, i) => i !== index);
  }

  async function saveConfigModal() {
    if (!configModalCollectionId || !configModalRequestId) return;

    const collectionId = configModalCollectionId;
    const validMappings = configModalMappings
      .map(m => ({ jsonPath: m.jsonPath.trim(), variableName: m.variableName.trim() }))
      .filter(m => m.jsonPath && m.variableName);

    // Capture before closeConfigModal clears testResponseJson.
    const cachedTestJson = testResponseJson;

    if (validMappings.length === 0) {
      await saveTokenRefreshConfig(collectionId, null);
      addLog(`✓ Token refresh cleared for collection`, 'system');
    } else {
      await saveTokenRefreshConfig(collectionId, {
        requestId: configModalRequestId,
        mappings: validMappings
      });

      // Keep the variables section open so new values are visible immediately.
      expandedVariables.add(collectionId);
      expandedVariables = new Set(expandedVariables);

      closeConfigModal();

      if (cachedTestJson !== null) {
        const written = await materializeMappingsFromResponse(collectionId, cachedTestJson, validMappings);
        if (written > 0) {
          addLog(`✓ Token refresh configured; wrote ${written} variable(s) from Test response`, 'system');
        } else {
          addLog(`✓ Token refresh configured (no values extracted from Test response)`, 'system');
        }
        variablesTick++;
      } else {
        addLog(`✓ Token refresh configured — fetching token…`, 'system');
        await executeTokenRefresh(collectionId);
      }
      return;
    }

    closeConfigModal();
  }

  function setRefreshStatus(
    collectionId: number,
    state: 'loading' | 'success' | 'error',
    label: string,
    detail: string
  ) {
    refreshStatus.set(collectionId, { state, label, detail });
    refreshStatus = refreshStatus;
    refreshVersion++;
  }

  function clearRefreshStatusLater(collectionId: number, ms: number) {
    setTimeout(() => {
      refreshStatus.delete(collectionId);
      refreshStatus = refreshStatus;
      refreshVersion++;
    }, ms);
  }

  async function executeTokenRefresh(collectionId: number) {
    let config = tokenRefreshConfigs.get(collectionId);
    if (!config) {
      config = await loadTokenRefreshConfig(collectionId);
      if (config) {
        tokenRefreshConfigs.set(collectionId, config);
        tokenRefreshConfigs = tokenRefreshConfigs;
        tokenConfigVersion++;
      }
    }
    if (!config) {
      addLog('✗ No token refresh configured for this collection', 'error');
      return;
    }

    // Ensure all existing variables are loaded into the store before modifying
    await variables.load(collectionId);

    refreshingCollections.add(collectionId);
    refreshingCollections = refreshingCollections;
    setRefreshStatus(collectionId, 'loading', 'Refreshing…', 'Refreshing tokens from configured request');

    try {
      const request = await db.getRequest(config.requestId) as any;
      if (!request) {
        const detail = 'Token request not found';
        addLog(`✗ ${detail}`, 'error');
        setRefreshStatus(collectionId, 'error', 'Request not found', detail);
        clearRefreshStatusLater(collectionId, 4000);
        return;
      }

      // Reuse the same builder as normal sends/chains so auth and every body
      // type (form-urlencoded, form-data, binary, graphql, json, xml) are
      // handled identically to a real send — no divergence between paths.
      const resolved = await resolveRequest(request, collectionId);

      addLog(`⏳ Refreshing tokens: ${resolved.method} ${resolved.url}`, 'info');
      addLog(`  Auth: ${request.auth_type || 'none'}, Headers: ${Object.keys(resolved.headers).join(', ') || 'none'}`, 'info');

      const response: any = await http.executeRequest(
        resolved.method,
        resolved.url,
        Object.keys(resolved.headers).length > 0 ? resolved.headers : undefined,
        resolved.body
      );

      addLog(`  Response: ${response.status} ${response.statusText || ''}`, 'info');

      if (response.status >= 400) {
        const bodyPreview = (response.body || '').slice(0, 300);
        const detail = `Refresh failed: HTTP ${response.status}${bodyPreview ? ` — ${bodyPreview}` : ''}`;
        addLog(`✗ Token refresh failed: ${response.status} — ${bodyPreview}`, 'error');
        setRefreshStatus(collectionId, 'error', 'Refresh failed', detail);
        clearRefreshStatusLater(collectionId, 4000);
        return;
      }

      let responseJson: any;
      try {
        responseJson = JSON.parse(response.body);
      } catch {
        const detail = 'Token refresh response is not valid JSON';
        addLog(`✗ ${detail}`, 'error');
        setRefreshStatus(collectionId, 'error', 'Invalid response', detail);
        clearRefreshStatusLater(collectionId, 4000);
        return;
      }

      const responseKeys = Object.keys(responseJson);
      addLog(`  Response keys: [${responseKeys.slice(0, 10).join(', ')}]`, 'info');

      let successCount = 0;
      successCount = await materializeMappingsFromResponse(collectionId, responseJson, config.mappings);

      for (const mapping of config.mappings) {
        const resolved = resolveMappingEntry(responseJson, mapping.jsonPath, mapping.variableName);
        if (resolved) {
          const masked = resolved.value.length > 8 ? resolved.value.slice(0, 4) + '...' + resolved.value.slice(-4) : '***';
          addLog(`  ✓ {{${resolved.variableName}}} = ${masked} (from ${mapping.jsonPath})`, 'system');
        } else {
          addLog(`  ✗ Path "${mapping.jsonPath}" not found in response. Available: [${responseKeys.join(', ')}]`, 'error');
        }
      }

      const msg = `Refreshed ${successCount}/${config.mappings.length} variable${config.mappings.length === 1 ? '' : 's'}`;
      addLog(`✓ ${msg}`, 'system');
      setRefreshStatus(
        collectionId,
        'success',
        `${successCount}/${config.mappings.length} updated`,
        msg
      );
      clearRefreshStatusLater(collectionId, 3000);
      await variables.load(collectionId);
      variablesTick++;
    } catch (error: any) {
      const detail = error.message || String(error);
      addLog(`✗ Token refresh failed: ${detail}`, 'error');
      setRefreshStatus(collectionId, 'error', 'Refresh failed', detail);
      clearRefreshStatusLater(collectionId, 4000);
    } finally {
      refreshingCollections.delete(collectionId);
      refreshingCollections = refreshingCollections;
      refreshVersion++;
    }
  }

  function hasTokenConfig(collectionId: number, _v?: number): boolean {
    return tokenRefreshConfigs.get(collectionId) != null;
  }

  function isRefreshing(collectionId: number, _v?: number): boolean {
    return refreshingCollections.has(collectionId);
  }

  function getRefreshStatus(collectionId: number, _v?: number): { state: 'loading' | 'success' | 'error'; label: string; detail: string } | undefined {
    return refreshStatus.get(collectionId);
  }

  function getCollectionRequests(collectionId: number): any[] {
    const collection = collections.find(c => c.id === collectionId);
    return collection?.requests || [];
  }

  async function preloadChains(cols: any[]) {
    let changed = false;
    for (const col of cols) {
      if (!chainCache.has(col.id)) {
        const chains = await loadChainsFromDb(col.id);
        chainCache.set(col.id, chains);
        changed = true;
      }
    }
    if (changed) {
      chainCache = new Map(chainCache);
      chainCacheVersion++;
    }
  }

  async function preloadTokenRefreshConfigs(cols: any[]) {
    let changed = false;
    for (const col of cols) {
      if (!tokenRefreshConfigs.has(col.id)) {
        const config = await loadTokenRefreshConfig(col.id);
        tokenRefreshConfigs.set(col.id, config);
        changed = true;
      }
    }
    if (changed) {
      tokenRefreshConfigs = tokenRefreshConfigs;
      tokenConfigVersion++;
    }
  }

  run(() => {
    if (collections.length > 0) {
      preloadChains(collections);
      preloadTokenRefreshConfigs(collections);
    }
  });

  onMount(async () => {
    await restoreExpandedState();
  });

  async function restoreExpandedState() {
    try {
      const saved = await db.getSetting('expanded_collections', null);
      if (saved && saved !== 'null') {
        const expandedIds = JSON.parse(saved as string);
        expandedCollections = new Set(expandedIds);
      } else {
        collections.forEach(c => expandedCollections.add(c.id));
        saveExpandedState();
      }
      
      // Load variables for all expanded collections
      for (const id of expandedCollections) {
        await variables.load(id);
      }
    } catch (error) {
      console.error('Failed to restore expanded state:', error);
      collections.forEach(c => expandedCollections.add(c.id));
    }
  }

  async function saveExpandedState() {
    try {
      await db.setSetting('expanded_collections', JSON.stringify([...expandedCollections]));
    } catch (error) {
      console.error('Failed to save expanded state:', error);
    }
  }

  async function toggleCollection(id: number) {
    if (expandedCollections.has(id)) {
      expandedCollections.delete(id);
    } else {
      expandedCollections.add(id);
      await variables.load(id);
    }
    // Svelte 5: reassigning to the same proxy is a no-op; cloning the Set
    // gives the runtime a fresh reference so {#each} / `has(...)` callers
    // re-render. Same pattern applies to the other `expanded*` Sets below.
    expandedCollections = new Set(expandedCollections);
    saveExpandedState();
  }

  function toggleVariablesSection(collectionId: number) {
    if (expandedVariables.has(collectionId)) {
      expandedVariables.delete(collectionId);
    } else {
      expandedVariables.add(collectionId);
    }
    expandedVariables = new Set(expandedVariables);
  }

  async function copyVariable(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    addLog(`✓ Copied {{${key}}} value`, 'system');
  }

  function toggleReveal(key: string) {
    if (revealedValues.has(key)) {
      revealedValues.delete(key);
    } else {
      revealedValues.add(key);
    }
    revealedValues = new Set(revealedValues);
  }

  async function deleteCollection(id: number) {
    const collection = collections.find(c => c.id === id);
    if (!collection) return;
    
    const { confirm } = await import('$lib/utils/modalManager.svelte');
    const confirmed = await confirm('Delete Collection', `Delete collection "${collection.name}"?`, 'This action cannot be undone.');
    if (confirmed) {
      await db.deleteCollection(id);
      await onReload();
    }
  }

  async function deleteRequest(collectionId: number, requestId: number) {
    const { confirm } = await import('$lib/utils/modalManager.svelte');
    const confirmed = await confirm('Delete Request', 'Delete this request?', 'This action cannot be undone.');
    if (confirmed) {
      await db.deleteRequest(requestId);
      await onReload();
    }
  }

  async function duplicateRequest(collectionId: number, requestId: number) {
    try {
      const original = (await db.getRequest(requestId)) as any;
      if (!original) return;

      const parseField = (v: unknown, fallback: unknown) => {
        if (v == null) return fallback;
        if (typeof v === 'string') {
          try {
            return JSON.parse(v);
          } catch {
            return fallback;
          }
        }
        return v;
      };

      await db.createRequest(collectionId, {
        name: original.name + ' (copy)',
        method: original.method,
        url: original.url,
        headers: parseField(original.headers, []),
        params: parseField(original.params, []),
        bodyType: original.body_type,
        bodyContent: original.body_content ?? '',
        authType: original.auth_type,
        authData: parseField(original.auth_data, {})
      });

      await onReload();
      addLog(`✓ Duplicated "${original.name}"`, 'system');
    } catch (error) {
      console.error('Failed to duplicate request:', error);
    }
  }

  function startAddVariable(collectionId: number) {
    addingVariable = { collectionId, key: '', value: '' };
  }

  async function saveNewVariable() {
    if (!addingVariable || !addingVariable.key.trim()) return;
    const { collectionId, key, value } = addingVariable;
    const trimmedKey = key.trim();
    const ok = await variables.set(collectionId, trimmedKey, value);
    if (!ok) {
      addLog(`✗ Failed to save variable {{${trimmedKey}}}`, 'error');
      return;
    }
    // Re-read from DB so the list always reflects what was persisted.
    await variables.load(collectionId);
    expandedVariables.add(collectionId);
    expandedVariables = new Set(expandedVariables);
    variablesTick++;
    addLog(`✓ Added variable {{${trimmedKey}}}`, 'system');
    addingVariable = null;
  }

  function cancelAddVariable() {
    addingVariable = null;
  }

  function startEditVariable(collectionId: number, key: string, value: string) {
    editingVariable = { collectionId, key, value };
  }

  async function saveEditVariable() {
    if (!editingVariable) return;
    const ok = await variables.set(editingVariable.collectionId, editingVariable.key, editingVariable.value);
    if (!ok) {
      addLog(`✗ Failed to update variable {{${editingVariable.key}}}`, 'error');
      return;
    }
    await variables.load(editingVariable.collectionId);
    variablesTick++;
    addLog(`✓ Updated variable {{${editingVariable.key}}}`, 'system');
    editingVariable = null;
  }

  function cancelEditVariable() {
    editingVariable = null;
  }

  async function deleteVariable(collectionId: number, key: string) {
    const { confirm } = await import('$lib/utils/modalManager.svelte');
    const confirmed = await confirm('Delete Variable', `Delete variable "{{${key}}}"?`, 'This action cannot be undone.');
    if (confirmed) {
      await variables.delete(collectionId, key);
      addLog(`✗ Deleted variable {{${key}}}`, 'system');
    }
  }

  // Reactive tick bumped whenever the variables store mutates.
  let variablesTick = $state(0);

  onMount(() => {
    const unsub = variables.subscribe(() => {
      variablesTick++;
    });
    return unsub;
  });

  function varsForCollection(collectionId: number): Variable[] {
    variablesTick;
    return variables.getForCollection(collectionId);
  }

  interface TreeNode {
    collection: any;
    children: TreeNode[];
    depth: number;
  }

  function buildTree(items: any[], parentId: number | null = null, depth: number = 0): TreeNode[] {
    return items
      .filter(c => (c.parent_id ?? null) === parentId)
      .map(c => ({
        collection: c,
        children: buildTree(items, c.id, depth + 1),
        depth,
      }));
  }

  function flattenTree(nodes: TreeNode[]): TreeNode[] {
    const result: TreeNode[] = [];
    for (const node of nodes) {
      result.push(node);
      if (expandedCollections.has(node.collection.id)) {
        result.push(...flattenTree(node.children));
      }
    }
    return result;
  }

  function flattenTreeAll(nodes: TreeNode[]): TreeNode[] {
    const result: TreeNode[] = [];
    for (const node of nodes) {
      result.push(node);
      result.push(...flattenTreeAll(node.children));
    }
    return result;
  }

  let filteredCollections = $derived(searchQuery
    ? collections.filter(c => collectionMatchesSearch(c, searchQuery))
    : collections);
  let tree = $derived(buildTree(filteredCollections));
  let flatNodes = $derived(searchQuery ? flattenTreeAll(tree) : flattenTree(tree));

  let creatingFolder = $state(false);
  let newFolderName = $state('');
  let creatingFolderParent: number | null = $state(null);

  function startCreateFolder(parentId: number | null = null) {
    creatingFolder = true;
    creatingFolderParent = parentId;
    newFolderName = '';
    setTimeout(() => {
      const input = document.querySelector('.new-folder-input') as HTMLInputElement;
      input?.focus();
    }, 0);
  }

  async function saveNewFolder() {
    if (!newFolderName.trim()) { creatingFolder = false; return; }
    try {
      await db.createFolder(newFolderName.trim(), creatingFolderParent);
      addLog(`✓ Created folder "${newFolderName.trim()}"`, 'system');
      creatingFolder = false;
      newFolderName = '';
      await onReload();
    } catch (e: any) {
      addLog(`✗ Failed to create folder: ${e}`, 'error');
    }
  }

  function cancelNewFolder() {
    creatingFolder = false;
    newFolderName = '';
  }
</script>

<div class="collections-search">
  <input
    type="text"
    class="search-input"
    placeholder="Search collections..."
    bind:value={searchQuery}
    bind:this={searchInputEl}
    onkeydown={(e) => { if (e.key === 'Escape') { searchQuery = ''; searchInputEl?.blur(); } }}
  />
  {#if searchQuery}
    <button class="search-clear-btn" onclick={() => { searchQuery = ''; }} title="Clear search">×</button>
  {/if}
</div>
<div class="collections-list">
  {#if creatingFolder && creatingFolderParent === null}
    <div class="new-folder-row">
      <span class="folder-icon">📁</span>
      <input
        class="new-folder-input"
        type="text"
        placeholder="Folder name"
        bind:value={newFolderName}
        onkeydown={(e) => { if (e.key === 'Enter') saveNewFolder(); if (e.key === 'Escape') cancelNewFolder(); }}
        onblur={saveNewFolder}
      />
    </div>
  {/if}
  {#if collections.length === 0 && !creatingFolder}
    <div class="empty-collections">
      <p>No collections yet</p>
      <p>Click "+" to create your first collection</p>
    </div>
  {:else}
    {#each flatNodes as node (node.collection.id)}
      {@const collection = node.collection}
      {@const hasChildren = node.children.length > 0}
      {@const isFolder = hasChildren || (collection.requests?.length === 0 && collection.description === '' && node.children.length === 0 && collection.parent_id !== undefined)}
      {@const reorderSlots = getReorderRenderSlots(collection)}
      <div class="collection-item {expandedCollections.has(collection.id) ? 'expanded' : ''}" style="padding-left: {node.depth * 16}px">
        <div class="collection-header" role="button" tabindex="0" onclick={() => toggleCollection(collection.id)} onkeypress={(e) => e.key === 'Enter' && toggleCollection(collection.id)}>
          <div class="collection-name">
            <span class="collection-toggle">▶</span>
            {#if editingCollectionName?.id === collection.id}
              <input
                class="rename-collection-input"
                type="text"
                bind:value={editingCollectionName!.name}
                onkeydown={(e) => { if (e.key === 'Enter') saveRenameCollection(); if (e.key === 'Escape') cancelRenameCollection(); }}
                onblur={saveRenameCollection}
                onclick={stopPropagation(bubble('click'))}
              />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="collection-name-text" ondblclick={stopPropagation(() => startRenameCollection(collection.id, collection.name))}>{collection.name}</span>
            {/if}
          </div>
          <div class="collection-actions">
            <button 
              class="collection-action-btn rename-collection-btn" 
              onclick={stopPropagation(() => startRenameCollection(collection.id, collection.name))}
              title="Rename"
            >
              ✎
            </button>
            <button 
              class="collection-action-btn new-subfolder-btn" 
              onclick={stopPropagation(() => { expandedCollections.add(collection.id); expandedCollections = new Set(expandedCollections); startCreateFolder(collection.id); })}
              title="New Subfolder"
            >
              📁
            </button>
            <button
              class="collection-action-btn share-collection-btn"
              onclick={stopPropagation(() => shareCollection(collection.id, collection.name))}
              title="Export/Share"
            >
              📤
            </button>
            <button
              class="collection-action-btn loadtest-collection-btn"
              onclick={stopPropagation(() => openLoadTest(collection.id))}
              title="Load Test (Ctrl+Shift+T)"
            >
              ⚡
            </button>
            <button
              class="collection-action-btn delete-collection-btn"
              onclick={stopPropagation(() => deleteCollection(collection.id))}
              title="Delete"
            >
              🗑️
            </button>
          </div>
        </div>
        <div class="collection-expanded-wrapper" class:open={expandedCollections.has(collection.id)}>
          <div class="collection-expanded-content">
          {#if creatingFolder && creatingFolderParent === collection.id}
            <div class="new-folder-row" style="padding-left: 12px">
              <span class="folder-icon">📁</span>
              <input
                class="new-folder-input"
                type="text"
                placeholder="Subfolder name"
                bind:value={newFolderName}
                onkeydown={(e) => { if (e.key === 'Enter') saveNewFolder(); if (e.key === 'Escape') cancelNewFolder(); }}
                onblur={saveNewFolder}
              />
            </div>
          {/if}
          <!-- Variables Section -->
          <div class="variables-section">
            <button 
              type="button"
              class="variables-header" 
              onclick={stopPropagation(() => toggleVariablesSection(collection.id))}
            >
              <span class="variables-toggle" class:open={expandedVariables.has(collection.id)}>▶</span>
              <span class="variables-label">Variables</span>
              <span class="variables-count">{varsForCollection(collection.id).length}</span>
              <span 
                class="token-refresh-btn"
                class:has-config={hasTokenConfig(collection.id, tokenConfigVersion)}
                class:refreshing={isRefreshing(collection.id, refreshVersion)}
                role="button"
                tabindex="0"
                onclick={stopPropagation(() => executeTokenRefresh(collection.id))}
                onkeypress={stopPropagation((e: Event) => (e as KeyboardEvent).key === 'Enter' && executeTokenRefresh(collection.id))}
                title={isRefreshing(collection.id, refreshVersion)
                  ? 'Refreshing tokens…'
                  : hasTokenConfig(collection.id, tokenConfigVersion)
                    ? 'Refresh tokens'
                    : 'No token refresh configured'}
              >
                <svg class="refresh-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M21 21v-5h-5" />
                </svg>
              </span>
              <span 
                class="token-config-btn"
                role="button"
                tabindex="0"
                onclick={stopPropagation(() => openConfigModal(collection.id))}
                onkeypress={stopPropagation((e: Event) => (e as KeyboardEvent).key === 'Enter' && openConfigModal(collection.id))}
                title="Configure token refresh"
              >⚙️</span>
              <span 
                class="add-variable-btn"
                role="button"
                tabindex="0"
                onclick={stopPropagation(() => startAddVariable(collection.id))}
                onkeypress={stopPropagation((e: Event) => (e as KeyboardEvent).key === 'Enter' && startAddVariable(collection.id))}
                title="Add Variable"
              >+</span>
            </button>

            {#if getRefreshStatus(collection.id, refreshVersion)}
              {@const status = getRefreshStatus(collection.id, refreshVersion)}
              <div
                class="token-refresh-status {status?.state}"
                title={status?.detail}
                role="status"
                aria-live="polite"
              >
                {#if status?.state === 'loading'}
                  <span class="refresh-status-pulse" aria-hidden="true"></span>
                {:else if status?.state === 'success'}
                  <span class="refresh-status-icon" aria-hidden="true">✓</span>
                {:else}
                  <span class="refresh-status-icon" aria-hidden="true">✕</span>
                {/if}
                <span class="refresh-status-label">{status?.label}</span>
              </div>
            {/if}
            
            {#if expandedVariables.has(collection.id)}
              <div class="variables-list">
                {#if addingVariable?.collectionId === collection.id}
                  <div class="variable-row editing">
                    <input 
                      type="text" 
                      class="var-key-input"
                      placeholder="name"
                      bind:value={addingVariable!.key}
                      onkeypress={(e) => e.key === 'Enter' && saveNewVariable()}
                    />
                    <input 
                      type="text" 
                      class="var-value-input"
                      placeholder="value"
                      bind:value={addingVariable!.value}
                      onkeypress={(e) => e.key === 'Enter' && saveNewVariable()}
                    />
                    <button class="var-action-btn save" onclick={saveNewVariable} title="Save">✓</button>
                    <button class="var-action-btn cancel" onclick={cancelAddVariable} title="Cancel">×</button>
                  </div>
                {/if}
                
                {#each varsForCollection(collection.id) as variable (variable.key)}
                  {#if editingVariable?.collectionId === collection.id && editingVariable?.key === variable.key}
                    <div class="variable-row editing">
                      <span class="var-key-display">{'{{' + variable.key + '}}'}</span>
                      <input 
                        type="text" 
                        class="var-value-input"
                        bind:value={editingVariable.value}
                        onkeypress={(e) => e.key === 'Enter' && saveEditVariable()}
                      />
                      <button class="var-action-btn save" onclick={saveEditVariable} title="Save">✓</button>
                      <button class="var-action-btn cancel" onclick={cancelEditVariable} title="Cancel">×</button>
                    </div>
                  {:else}
                    <div class="variable-row">
                      <span class="var-key">{'{{'}{variable.key}{'}}'}</span>
                      <span 
                        class="var-value" 
                        class:revealed={revealedValues.has(variable.key)}
                        role="button"
                        tabindex="0"
                        onclick={() => toggleReveal(variable.key)}
                        onkeypress={(e) => e.key === 'Enter' && toggleReveal(variable.key)}
                        title="Click to reveal/hide"
                      >
                        {revealedValues.has(variable.key) ? variable.value : '••••••••'}
                      </span>
                      <button 
                        class="var-action-btn copy" 
                        onclick={stopPropagation(() => copyVariable(variable.key, variable.value))}
                        title="Copy value"
                      >📋</button>
                      <button 
                        class="var-action-btn edit" 
                        onclick={() => startEditVariable(collection.id, variable.key, variable.value)}
                        title="Edit"
                      >✎</button>
                      <button 
                        class="var-action-btn delete" 
                        onclick={() => deleteVariable(collection.id, variable.key)}
                        title="Delete"
                      >🗑️</button>
                    </div>
                  {/if}
                {/each}
                
                {#if varsForCollection(collection.id).length === 0 && !addingVariable}
                  <div class="no-variables">No variables. Click + to add.</div>
                {/if}
              </div>
            {/if}
          </div>
          
          <!-- Chains Section -->
          <div class="chains-section">
            <button
              type="button"
              class="chains-header"
              onclick={stopPropagation(() => toggleChainsSection(collection.id))}
            >
              <span class="chains-toggle" class:open={expandedChains.has(collection.id)}>▶</span>
              <span class="chains-label">Chains</span>
              <span class="chains-count">{getChainsForCollection(collection.id, chainCacheVersion).length}</span>
              <span
                class="chain-manage-btn"
                role="button"
                tabindex="0"
                onclick={stopPropagation(() => openChainBuilder(collection.id))}
                onkeypress={stopPropagation((e: Event) => (e as KeyboardEvent).key === 'Enter' && openChainBuilder(collection.id))}
                title="Manage chains"
              >⚙️</span>
              <span
                class="add-chain-btn"
                role="button"
                tabindex="0"
                onclick={stopPropagation(() => openChainBuilder(collection.id))}
                onkeypress={stopPropagation((e: Event) => (e as KeyboardEvent).key === 'Enter' && openChainBuilder(collection.id))}
                title="Add chain"
              >+</span>
            </button>
            {#if expandedChains.has(collection.id)}
              <div class="chains-list">
                {#each getChainsForCollection(collection.id, chainCacheVersion) as chain}
                  <div class="chain-row">
                    <span class="chain-name" title="{chain.steps.length} step(s)">⛓ {chain.name}</span>
                    <button
                      class="chain-action-btn run"
                      onclick={stopPropagation(() => runChainFromSidebar(collection.id, chain))}
                      disabled={showChainModal && chainModalCollectionId === collection.id}
                      title="Run chain"
                    >▶</button>
                    <button
                      class="chain-action-btn edit"
                      onclick={stopPropagation(() => openChainBuilder(collection.id))}
                      title="Edit chain"
                    >✎</button>
                  </div>
                {/each}
                {#if getChainsForCollection(collection.id, chainCacheVersion).length === 0}
                  <div class="no-chains">No chains. Click + to create one.</div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Requests Section -->
          <div class="collection-requests" data-collection-id={collection.id}>
            {#each reorderSlots as slot (slot.key)}
              {@const request = slot.kind === 'request' ? slot.request : null}
              <div
                class={slot.kind === 'spacer' ? 'drag-spacer' : 'collection-request'}
                animate:flip={{ duration: flipDuration, easing: quintOut }}
                aria-hidden={slot.kind === 'spacer' ? true : undefined}
                role={slot.kind === 'request' ? 'button' : undefined}
                tabindex={slot.kind === 'request' ? 0 : undefined}
                data-request-id={request?.id}
                onclick={() => { if (request && !editingRequestName) onRequestClick({...request, collectionId: collection.id}); }}
                onkeypress={(e) => { if (request && e.key === 'Enter') onRequestClick({...request, collectionId: collection.id}); }}
              >
                {#if request}
                  <div class="drag-grip" title="Drag to reorder" onmousedown={(e) => handleGripMouseDown(e, request.id, collection.id)} role="button" tabindex="-1" aria-label="Drag to reorder">⋮⋮</div>
                  <div class="method {request.method.toLowerCase()}">{request.method}</div>
                  <div class="name">
                    {#if editingRequestName?.id === request.id}
                      <input
                        class="rename-request-input"
                        type="text"
                        bind:value={editingRequestName!.name}
                        onkeydown={(e) => { if (e.key === 'Enter') saveRenameRequest(); if (e.key === 'Escape') cancelRenameRequest(); }}
                        onblur={saveRenameRequest}
                        onclick={stopPropagation(bubble('click'))}
                      />
                    {:else}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span class="request-name-text" ondblclick={stopPropagation(() => startRenameRequest(request.id, collection.id, request.name))}>{request.name}</span>
                    {/if}
                  </div>
                  <div class="request-actions">
                    <button
                      class="request-action-btn rename-request-btn"
                      onclick={stopPropagation(() => startRenameRequest(request.id, collection.id, request.name))}
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      class="request-action-btn duplicate-request-btn"
                      onclick={stopPropagation(() => duplicateRequest(collection.id, request.id))}
                      title="Duplicate Request"
                    >
                      📋
                    </button>
                    <button
                      class="request-action-btn delete-request-btn"
                      onclick={stopPropagation(() => deleteRequest(collection.id, request.id))}
                      title="Delete Request"
                    >
                      🗑️
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>

{#if showConfigModal && configModalCollectionId}
  <div class="config-modal-overlay" role="dialog" tabindex="-1" use:portal onclick={closeConfigModal} onkeypress={() => {}}>
    <div class="config-modal" role="presentation" onclick={stopPropagation(bubble('click'))} onkeypress={stopPropagation(bubble('keypress'))}>
      <div class="config-modal-header">
        <h3>Configure Token Refresh</h3>
        <button class="close-btn" onclick={closeConfigModal}>×</button>
      </div>
      
      <div class="config-modal-body">
        <div class="config-field">
          <label for="token-request-select">Token Request</label>
          <div class="request-select-row">
            <select id="token-request-select" bind:value={configModalRequestId} onchange={() => { availableJsonPaths = []; testRequestError = null; }}>
              <option value={null}>-- Select a request --</option>
              {#each getCollectionRequests(configModalCollectionId) as request}
                <option value={request.id}>{request.method} {request.name}</option>
              {/each}
            </select>
            <button 
              class="test-request-btn" 
              onclick={testTokenRequest} 
              disabled={!configModalRequestId || isTestingRequest}
              title="Execute request to discover JSON paths"
            >
              {isTestingRequest ? '⏳' : '▶'} Test
            </button>
          </div>
          {#if testRequestError}
            <div class="test-error">{testRequestError}</div>
          {/if}
        </div>

        {#if availableJsonPaths.length > 0}
          <div class="available-paths-section">
            <span class="section-label">Available Paths (click to add)</span>
            <div class="available-paths-list">
              {#each availableJsonPaths.slice(0, 50) as pathItem}
                <button 
                  class="path-suggestion" 
                  onclick={() => {
                    const newMapping = { jsonPath: pathItem.path, variableName: suggestVariableName(pathItem.path) };
                    configModalMappings = [...configModalMappings.filter(m => m.jsonPath || m.variableName), newMapping];
                  }}
                  title={pathItem.value}
                >
                  <span class="path-name">{pathItem.path}</span>
                  <span class="path-preview">{pathItem.value.length > 30 ? pathItem.value.slice(0, 30) + '...' : pathItem.value}</span>
                </button>
              {/each}
              {#if availableJsonPaths.length > 50}
                <div class="paths-truncated">...and {availableJsonPaths.length - 50} more</div>
              {/if}
            </div>
          </div>
        {/if}

        <div class="mappings-section">
          <div class="mappings-header">
            <span class="section-label">Response Mappings</span>
            <button class="add-mapping-btn" onclick={addMapping}>+ Add</button>
          </div>
          
          {#each configModalMappings as mapping, index}
            <div class="mapping-row">
              <input 
                type="text" 
                class="mapping-input"
                placeholder="JSON path (e.g., data.accessToken)"
                bind:value={mapping.jsonPath}
              />
              <span class="mapping-arrow">→</span>
              <input 
                type="text" 
                class="mapping-input"
                placeholder="Variable name"
                bind:value={mapping.variableName}
              />
              <button class="remove-mapping-btn" onclick={() => removeMapping(index)}>×</button>
            </div>
          {/each}
          
          {#if configModalMappings.length === 0}
            <div class="no-mappings">No mappings. Click "+ Add" or click a path above.</div>
          {/if}
        </div>
      </div>

      <div class="config-modal-footer">
        <button class="cancel-btn" onclick={closeConfigModal}>Cancel</button>
        <button class="save-btn" onclick={saveConfigModal} disabled={!configModalRequestId}>Save</button>
      </div>
    </div>
  </div>
{/if}

{#if showChainModal && chainModalCollectionId}
  <RequestChainPanel
    collectionId={chainModalCollectionId}
    {collections}
    onClose={closeChainBuilder}
    initialChainId={chainModalInitialChainId}
    initialResults={chainModalInitialResults}
    autoRun={chainModalAutoRun}
    environmentPreselected={chainModalEnvPreselected}
  />
{/if}

<style>
  .collections-search {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 0.75rem;
    border-bottom: 1px solid var(--border-color);
    position: relative;
  }

  .collections-search .search-input {
    flex: 1;
    padding: 7px 28px 7px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary, #dbdee1);
    font-size: 0.8rem;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .collections-search .search-input:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 15%, transparent);
  }

  .search-clear-btn {
    position: absolute;
    right: 0.95rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
    padding: 0 4px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .search-clear-btn:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .collection-expanded-wrapper {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .collection-expanded-wrapper.open {
    grid-template-rows: 1fr;
  }

  .collection-expanded-content {
    overflow: hidden;
  }

  .variables-section,
  .chains-section {
    margin: 0 4px;
    padding: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .chains-section {
    margin-bottom: 4px;
  }
  
  .variables-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px 7px 20px;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 10.5px;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.04em;
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    transition: color 0.15s ease;
    line-height: 1;
  }
  
  .variables-header:hover {
    color: var(--text-primary);
  }
  
  .variables-toggle {
    font-size: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    flex-shrink: 0;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .variables-toggle.open {
    transform: rotate(90deg);
  }
  
  .variables-label {
    flex: 1;
    line-height: 1;
  }
  
  .variables-count {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    min-width: 18px;
    text-align: center;
    line-height: 1.4;
  }
  
  .add-variable-btn {
    background: var(--accent-color);
    color: white;
    border: none;
    border-radius: 3px;
    width: 14px;
    height: 14px;
    font-size: 11px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 1;
    transition: background 0.15s ease, filter 0.15s ease;
    line-height: 1;
    flex-shrink: 0;
  }

  .add-variable-btn:hover {
    filter: brightness(1.15);
  }
  
  .variables-list {
    padding: 4px 10px 8px 20px;
    overflow: hidden;
  }
  
  .variable-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: var(--bg-primary);
    border-radius: 5px;
    margin-bottom: 3px;
    font-size: 12px;
    border: 1px solid transparent;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .variable-row:hover {
    border-color: rgba(255, 255, 255, 0.06);
  }
  
  .variable-row.editing {
    background: var(--bg-secondary);
    border: 1px solid var(--accent-color);
  }
  
  .var-key {
    color: #f0b132;
    font-family: monospace;
    font-size: 11px;
    min-width: 80px;
  }
  
  .var-key-display {
    color: #f0b132;
    font-family: monospace;
    font-size: 11px;
    min-width: 80px;
  }
  
  .var-key-input {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #f0b132;
    font-family: monospace;
    font-size: 11px;
    padding: 3px 6px;
    min-width: 60px;
    max-width: 80px;
    transition: border-color 0.15s ease;
  }
  
  .var-key-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }
  
  .var-value {
    flex: 1;
    color: var(--text-secondary);
    font-family: monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    transition: background 0.15s ease;
  }
  
  .var-value:hover {
    background: var(--bg-tertiary);
  }
  
  .var-value.revealed {
    color: var(--text-primary);
  }
  
  .var-value-input {
    flex: 1;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-family: monospace;
    font-size: 11px;
    padding: 3px 6px;
    min-width: 80px;
    transition: border-color 0.15s ease;
  }
  
  .var-value-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }
  
  .var-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    font-size: 10px;
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }

  .var-action-btn:hover {
    opacity: 1;
  }
  
  .var-action-btn.save {
    color: var(--success-color);
    opacity: 0.9;
  }
  
  .var-action-btn.cancel {
    color: var(--error-color);
    opacity: 0.9;
  }
  
  .var-action-btn.edit {
    color: var(--text-secondary);
  }
  
  .var-action-btn.delete {
    color: var(--error-color);
  }
  
  .no-variables {
    color: var(--text-secondary);
    font-size: 11px;
    font-style: italic;
    padding: 8px 0;
    opacity: 0.6;
  }

  /* ── Chains Section ── */
  .chains-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px 7px 20px;
    cursor: pointer;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 10.5px;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-align: left;
    transition: color 0.15s ease;
    line-height: 1;
  }

  .chains-header:hover {
    color: var(--text-primary);
  }

  .chains-toggle {
    font-size: 8px;
    color: var(--text-secondary);
    width: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .chains-toggle.open {
    transform: rotate(90deg);
  }

  .chains-label {
    flex: 1;
    line-height: 1;
  }

  .chains-count {
    font-size: 10px;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    padding: 1px 7px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
    font-weight: 600;
    line-height: 1.4;
  }

  .add-chain-btn {
    background: var(--accent-color);
    color: white;
    border: none;
    border-radius: 3px;
    width: 14px;
    height: 14px;
    font-size: 11px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 1;
    transition: background 0.15s ease, filter 0.15s ease;
    line-height: 1;
    flex-shrink: 0;
  }

  .add-chain-btn:hover {
    filter: brightness(1.15);
  }

  .chain-manage-btn {
    font-size: 12px;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.15s ease;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    flex-shrink: 0;
  }

  .chain-manage-btn:hover {
    opacity: 1;
  }

  .chains-list {
    padding-left: 18px;
    overflow: hidden;
  }

  .chain-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    font-size: 11px;
    border-radius: 4px;
    transition: background 0.15s ease;
  }

  .chain-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .chain-name {
    flex: 1;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s ease;
  }

  .chain-row:hover .chain-name {
    color: var(--text-primary);
  }

  .chain-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    opacity: 0.7;
    transition: opacity 0.15s ease;
    border-radius: 3px;
  }

  .chain-action-btn:hover {
    opacity: 1;
  }

  .chain-action-btn.run { color: var(--success-color); }
  .chain-action-btn.run:hover { background: rgba(81, 207, 102, 0.1); }
  .chain-action-btn.edit { color: var(--text-secondary); }
  .chain-action-btn.edit:hover { background: rgba(255, 255, 255, 0.06); }
  .chain-action-btn:disabled { opacity: 0.3 !important; cursor: default; }

  .no-chains {
    color: var(--text-secondary);
    font-size: 11px;
    font-style: italic;
    padding: 8px 0;
    opacity: 0.6;
  }

  .token-refresh-btn, .token-config-btn {
    font-size: 12px;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.15s ease;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    flex-shrink: 0;
  }

  .token-refresh-btn {
    width: 16px;
    height: 16px;
    color: var(--text-secondary);
  }

  .refresh-icon {
    display: block;
    flex-shrink: 0;
    shape-rendering: geometricPrecision;
  }

  .token-refresh-btn:hover, .token-config-btn:hover {
    opacity: 1;
  }

  .token-refresh-btn.has-config {
    opacity: 0.8;
    color: var(--text-secondary);
  }

  .token-refresh-btn:not(.has-config) {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .token-refresh-btn.refreshing {
    opacity: 1;
    color: var(--accent-color);
  }

  .token-refresh-btn.refreshing .refresh-icon {
    animation: spin 1s linear infinite;
    transform-origin: center;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .token-refresh-status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 8px 4px 38px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.01em;
    text-transform: none;
    line-height: 1.2;
    min-width: 0;
    animation: fadeIn 0.2s ease;
  }

  .token-refresh-status.loading {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
  }

  .token-refresh-status.success {
    color: var(--success-color);
    background: color-mix(in srgb, var(--success-color) 12%, var(--bg-secondary));
  }

  .token-refresh-status.error {
    color: var(--error-color);
    background: color-mix(in srgb, var(--error-color) 10%, var(--bg-secondary));
  }

  .refresh-status-pulse {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-color);
    animation: refreshPulse 1s ease-in-out infinite;
  }

  @keyframes refreshPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  }

  .refresh-status-icon {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .refresh-status-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .config-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .config-modal {
    background: var(--bg-tertiary);
    border-radius: 8px;
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  .config-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .config-modal-header h3 {
    margin: 0;
    color: #f2f3f5;
    font-size: 16px;
  }

  .close-btn {
    background: none;
    border: none;
    color: #949ba4;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
  }

  .close-btn:hover {
    color: #f2f3f5;
  }

  .config-modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .config-field {
    margin-bottom: 20px;
  }

  .config-field label {
    display: block;
    color: #b5bac1;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .config-field select {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 14px;
  }

  .config-field select:focus {
    outline: none;
    border-color: #5865f2;
  }

  .mappings-section {
    margin-top: 16px;
  }

  .mappings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .mappings-header .section-label {
    color: #b5bac1;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .add-mapping-btn {
    background: #5865f2;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .add-mapping-btn:hover {
    background: #4752c4;
  }

  .mapping-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .mapping-input {
    flex: 1;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 13px;
    font-family: monospace;
  }

  .mapping-input:focus {
    outline: none;
    border-color: #5865f2;
  }

  .mapping-arrow {
    color: #949ba4;
    font-size: 14px;
  }

  .remove-mapping-btn {
    background: none;
    border: none;
    color: #f04747;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    opacity: 0.7;
  }

  .remove-mapping-btn:hover {
    opacity: 1;
  }

  .no-mappings {
    color: #72767d;
    font-size: 12px;
    font-style: italic;
    text-align: center;
    padding: 16px;
  }

  .config-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid var(--border-color);
  }

  .cancel-btn {
    background: #4e5058;
    color: #dbdee1;
    border: none;
    border-radius: 4px;
    padding: 10px 20px;
    font-size: 14px;
    cursor: pointer;
  }

  .cancel-btn:hover {
    background: #6d6f78;
  }

  .save-btn {
    background: #5865f2;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 20px;
    font-size: 14px;
    cursor: pointer;
  }

  .save-btn:hover {
    background: #4752c4;
  }

  .save-btn:disabled {
    background: #4e5058;
    cursor: not-allowed;
    opacity: 0.5;
  }

  .request-select-row {
    display: flex;
    gap: 8px;
  }

  .request-select-row select {
    flex: 1;
  }

  .test-request-btn {
    background: #43b581;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }

  .test-request-btn:hover {
    background: #3ca374;
  }

  .test-request-btn:disabled {
    background: #4e5058;
    cursor: not-allowed;
    opacity: 0.6;
  }

  .test-error {
    color: #f04747;
    font-size: 12px;
    margin-top: 8px;
  }

  .available-paths-section {
    margin-bottom: 20px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 12px;
    background: var(--bg-secondary);
  }

  .available-paths-section .section-label {
    display: block;
    color: #43b581;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .available-paths-list {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .path-suggestion {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    width: 100%;
  }

  .path-suggestion:hover {
    background: #383a40;
    border-color: #5865f2;
  }

  .path-name {
    color: #f0b132;
    font-family: monospace;
    font-size: 12px;
  }

  .path-preview {
    color: #72767d;
    font-size: 11px;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .paths-truncated {
    color: #72767d;
    font-size: 11px;
    font-style: italic;
    text-align: center;
    padding: 8px;
  }

  .rename-collection-input,
  .rename-request-input {
    background: var(--bg-primary);
    border: 1px solid var(--accent-color);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 12px;
    padding: 2px 6px;
    width: 100%;
    outline: none;
  }

  .rename-collection-input:focus,
  .rename-request-input:focus {
    border-color: var(--accent-hover);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .rename-collection-btn,
  .share-collection-btn,
  .rename-request-btn {
    opacity: 0.8;
    transition: opacity 0.15s;
  }

  .rename-collection-btn:hover,
  .share-collection-btn:hover,
  .rename-request-btn:hover {
    opacity: 1;
  }

  :global(.collection-request) .drag-grip {
    color: color-mix(in srgb, var(--text-secondary) 55%, var(--text-primary));
    font-size: 12px;
    cursor: grab;
    user-select: none;
    line-height: 1;
    letter-spacing: -2px;
    transition: color 0.15s ease;
    flex-shrink: 0;
    width: 14px;
    margin-left: -4px;
    margin-right: 2px;
  }

  :global(.collection-request:hover) .drag-grip,
  :global(.collection-request) .drag-grip:hover {
    color: color-mix(in srgb, var(--text-secondary) 30%, var(--text-primary));
  }

  :global(.collection-request) .drag-grip:active {
    cursor: grabbing;
    color: color-mix(in srgb, var(--text-secondary) 15%, var(--text-primary));
  }

  :global(.drag-spacer) {
    box-sizing: border-box;
    min-height: calc(0.76rem + 1.2em);
    margin-bottom: 2px;
    border-radius: 5px;
    border: 1px dashed rgba(88, 101, 242, 0.4);
    background: rgba(88, 101, 242, 0.07);
  }

  .new-folder-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
  }

  .folder-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .new-folder-input {
    flex: 1;
    background: var(--bg-primary);
    border: 1px solid var(--accent-color);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 12px;
    padding: 3px 8px;
    outline: none;
  }

  .new-subfolder-btn {
    opacity: 0.8;
    transition: opacity 0.15s;
  }

  .new-subfolder-btn:hover {
    opacity: 1;
  }
</style>
