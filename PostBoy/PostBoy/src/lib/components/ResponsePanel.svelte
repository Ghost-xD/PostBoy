<script lang="ts">
  import { run, createBubbler, stopPropagation } from 'svelte/legacy';

  const bubble = createBubbler();
  import { onMount, onDestroy } from 'svelte';
  import { activeTab, updateActiveTabBatch } from '$lib/stores/tabStore';
  import { responseLayout, rightSidebarCollapsed, rightSidebarWidth, responsePanelHeight, activeResponseTab, sendingTabIds } from '$lib/stores/uiStore';
  import { logs, clearLogs, formatLogLine } from '$lib/stores/consoleStore';
  import { variables, flattenJsonPaths } from '$lib/stores/variableStore';
  import { addLog } from '$lib/stores/consoleStore';
  import ResponseViewer from './ResponseViewer.svelte';
  import ResponseDiff from './ResponseDiff.svelte';
  import JsonTreeViewer from './JsonTreeViewer.svelte';
  import JsonGraphViewer from './JsonGraphViewer.svelte';
  import BinaryPreview from './BinaryPreview.svelte';
  import ResponseSearchBar from './ResponseSearchBar.svelte';
  import { generateSnapshotHtml } from '$lib/utils/snapshotExporter';
  import { detectResponseType } from '$lib/utils/responseUtils';
  import type { ResponseTypeInfo } from '$lib/utils/responseUtils';
  import { fileOps, db } from '$lib/api/tauri';
  import * as modalManager from '$lib/utils/modalManager.svelte';
  import { shortcutTitle } from '$lib/utils/platform';
  import {
    buildExamplePayloadFromResponse,
    exampleToTabUpdates,
  } from '$lib/utils/requestExamples';

  interface Props {
    onDragBottom?: (e: MouseEvent) => void;
    onDragRight?: (e: MouseEvent) => void;
    collections?: any[];
  }

  let { onDragBottom = () => {}, onDragRight = () => {}, collections = [] }: Props = $props();

  let isActiveTabSending = $derived($sendingTabIds.has($activeTab.id));
  let responseStatus = $derived($activeTab.responseStatus);
  let responseStatusText = $derived($activeTab.responseStatusText);
  let responseTime = $derived($activeTab.responseTime);
  let responseSize = $derived($activeTab.responseSize);
  let responseHeaders = $derived($activeTab.responseHeaders);
  let responseBody = $derived($activeTab.responseBody);
  let responseContentType = $derived($activeTab.responseContentType || '');
  let responseIsBinary = $derived($activeTab.responseIsBinary || false);
  let responseTimestamp = $derived($activeTab.responseTimestamp);
  let collectionId = $derived($activeTab.collectionId);

  let responseTypeInfo = $derived(detectResponseType(responseContentType, responseIsBinary) as ResponseTypeInfo);
  let isBinaryPreview = $derived(responseIsBinary && responseTypeInfo.previewable);

  let showVariableModal = $state(false);
  let extractedPaths: Array<{path: string, value: string}> = $state([]);
  let selectedPath = $state('');
  let variableName = $state('');
  let targetCollectionId: number | null = $state(null);
  let searchFilter = $state('');
  let previewMode: 'tree' | 'raw' | 'graph' = $state('raw');
  let rawFullView = $state(false);
  let graphFullscreen = $state(false);
  let graphFullscreenVisible = $state(false);
  let responseCopied = $state(false);
  let responseCopyTimeout: ReturnType<typeof setTimeout> | null = null;
  let snapshotExported = $state(false);
  let snapshotExportTimeout: ReturnType<typeof setTimeout> | null = null;
  let examples: Array<{
    id: number;
    name: string;
    status_code?: number | null;
    response_time?: number | null;
    response_headers?: string | null;
    response_body?: string | null;
  }> = $state([]);
  let selectedExampleId = $state('');
  let examplesLoading = $state(false);
  let exampleSaved = $state(false);
  let exampleSavedTimeout: ReturnType<typeof setTimeout> | null = null;

  let showSearch = $state(false);
  let searchQuery = $state('');
  let searchMatchCount = $state(0);
  let searchCurrentMatch = $state(0);
  let responseViewerRef: ResponseViewer | undefined = $state();
  let searchBarRef: ResponseSearchBar | undefined = $state();

  export function openSearch() {
    if (!responseBody || responseIsBinary) return;
    showSearch = true;
    activeResponseTab.set('preview');
    requestAnimationFrame(() => searchBarRef?.focus());
  }

  function closeSearch() {
    showSearch = false;
    searchQuery = '';
    searchMatchCount = 0;
    searchCurrentMatch = 0;
  }

  function handleSearch(e: CustomEvent<string>) {
    searchQuery = e.detail;
    if (previewMode === 'raw' && responseViewerRef) {
      requestAnimationFrame(() => {
        searchMatchCount = responseViewerRef?.getMatchCount() ?? 0;
        searchCurrentMatch = searchMatchCount > 0 ? 1 : 0;
      });
    } else if (previewMode === 'tree') {
      countTreeMatches(searchQuery);
    }
  }

  function handleSearchNext() {
    if (previewMode === 'raw' && responseViewerRef) {
      responseViewerRef.goToNext();
      if (searchMatchCount > 0) {
        searchCurrentMatch = searchCurrentMatch >= searchMatchCount ? 1 : searchCurrentMatch + 1;
      }
    } else if (previewMode === 'tree') {
      scrollToNextTreeMatch(1);
    }
  }

  function handleSearchPrev() {
    if (previewMode === 'raw' && responseViewerRef) {
      responseViewerRef.goToPrevious();
      if (searchMatchCount > 0) {
        searchCurrentMatch = searchCurrentMatch <= 1 ? searchMatchCount : searchCurrentMatch - 1;
      }
    } else if (previewMode === 'tree') {
      scrollToNextTreeMatch(-1);
    }
  }

  let treeMatchIndex = -1;

  function countTreeMatches(query: string) {
    if (!query) { searchMatchCount = 0; searchCurrentMatch = 0; return; }
    requestAnimationFrame(() => {
      const container = document.querySelector('.tree-view-container');
      if (!container) { searchMatchCount = 0; searchCurrentMatch = 0; return; }
      const marks = container.querySelectorAll('.tree-search-match');
      searchMatchCount = marks.length;
      searchCurrentMatch = marks.length > 0 ? 1 : 0;
      treeMatchIndex = marks.length > 0 ? 0 : -1;
      if (marks.length > 0) marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  function scrollToNextTreeMatch(direction: number) {
    const container = document.querySelector('.tree-view-container');
    if (!container) return;
    const marks = container.querySelectorAll('.tree-search-match');
    if (marks.length === 0) return;
    treeMatchIndex = (treeMatchIndex + direction + marks.length) % marks.length;
    searchCurrentMatch = treeMatchIndex + 1;
    marks[treeMatchIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  run(() => {
    if (searchQuery && previewMode === 'tree') {
      countTreeMatches(searchQuery);
    }
  });

  async function copyResponseBody() {
    if (!responseBody) return;
    await navigator.clipboard.writeText(responseBody);
    responseCopied = true;
    if (responseCopyTimeout) clearTimeout(responseCopyTimeout);
    responseCopyTimeout = setTimeout(() => { responseCopied = false; }, 1500);
  }

  export async function exportSnapshot() {
    const tab = $activeTab;
    const html = generateSnapshotHtml(tab);
    const slug = (tab.name || tab.url || 'request')
      .replace(/https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const filePath = await fileOps.showSaveDialog({
      title: 'Export Request Snapshot',
      defaultPath: `${slug}-snapshot.html`
    }) as string | null;
    if (!filePath) return;
    await fileOps.writeFile(filePath, html);
    addLog('✓ Exported request snapshot as HTML', 'system');
    snapshotExported = true;
    if (snapshotExportTimeout) clearTimeout(snapshotExportTimeout);
    snapshotExportTimeout = setTimeout(() => { snapshotExported = false; }, 1500);
  }

  async function loadExamples(requestId: number) {
    examplesLoading = true;
    try {
      examples = (await db.getRequestExamples(requestId)) as typeof examples;
    } catch (error) {
      console.error('Failed to load examples:', error);
      examples = [];
    } finally {
      examplesLoading = false;
    }
  }

  $effect(() => {
    const requestId = $activeTab.requestId;
    selectedExampleId = '';
    if (requestId) {
      void loadExamples(requestId);
    } else {
      examples = [];
    }
  });

  function buildExamplePayload() {
    return buildExamplePayloadFromResponse({
      responseStatus,
      responseTime,
      responseHeaders,
      responseBody,
    });
  }

  async function saveAsExample() {
    const requestId = $activeTab.requestId;
    const payload = buildExamplePayload();
    if (!requestId || !payload) return;

    const result = await modalManager.showForm('Save as Example', 'Name this saved response:', [
      { id: 'name', label: 'Example name', type: 'text', value: `Example ${examples.length + 1}` },
    ]);
    if (!result?.name?.trim()) return;

    await db.createRequestExample(requestId, {
      name: result.name.trim(),
      ...buildExamplePayload(),
    });
    await loadExamples(requestId);
    addLog(`✓ Saved response example "${result.name.trim()}"`, 'system');
    exampleSaved = true;
    if (exampleSavedTimeout) clearTimeout(exampleSavedTimeout);
    exampleSavedTimeout = setTimeout(() => { exampleSaved = false; }, 1500);
  }

  async function loadSelectedExample() {
    const id = Number(selectedExampleId);
    if (!id) return;
    const example = examples.find((item) => item.id === id);
    if (!example) return;

    updateActiveTabBatch({
      ...exampleToTabUpdates(example),
      responseTimestamp: new Date().toLocaleString(),
    });
    addLog(`✓ Loaded example "${example.name}"`, 'system');
  }

  async function deleteSelectedExample() {
    const id = Number(selectedExampleId);
    if (!id) return;
    const example = examples.find((item) => item.id === id);
    if (!example) return;

    const confirmed = await modalManager.showModal({
      type: 'warning',
      title: 'Delete Example',
      message: `Delete example <strong>"${example.name}"</strong>?`,
      buttons: ['Delete', 'Cancel'],
      defaultButton: 1,
    });
    if (confirmed !== 0) return;

    await db.deleteRequestExample(id);
    selectedExampleId = '';
    if ($activeTab.requestId) {
      await loadExamples($activeTab.requestId);
    }
    addLog(`✓ Deleted example "${example.name}"`, 'system');
  }

  let parsedJson = $derived((() => {
    if (!responseBody) return null;
    try { return JSON.parse(responseBody); } catch { return null; }
  })());

  function getStatusClass(status: number) {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    if (status >= 500) return 'server-error';
    return '';
  }

  function openSaveToVariable() {
    if (!responseBody) return;
    
    try {
      const parsed = JSON.parse(responseBody);
      extractedPaths = flattenJsonPaths(parsed);
      selectedPath = '';
      variableName = '';
      targetCollectionId = collectionId || (collections.length > 0 ? collections[0].id : null);
      searchFilter = '';
      showVariableModal = true;
    } catch {
      addLog('✗ Response is not valid JSON', 'error');
    }
  }

  function selectPath(path: string, value: string) {
    selectedPath = path;
    variableName = path.split('.').pop()?.replace(/\[.*\]/g, '') || path;
  }

  async function saveVariable() {
    if (!targetCollectionId || !variableName || !selectedPath) return;
    
    const selected = extractedPaths.find(p => p.path === selectedPath);
    if (!selected) return;
    
    await variables.set(targetCollectionId, variableName, selected.value);
    const col = collections.find(c => c.id === targetCollectionId);
    addLog(`✓ Saved variable "{{${variableName}}}" to ${col?.name || 'collection'}`, 'system');
    showVariableModal = false;
  }

  let filteredPaths = $derived(extractedPaths.filter(p => 
    !searchFilter || 
    p.path.toLowerCase().includes(searchFilter.toLowerCase()) ||
    p.value.toLowerCase().includes(searchFilter.toLowerCase())
  ));

  function openGraphFullscreen() {
    if (!parsedJson) return;
    graphFullscreen = true;
    // Double RAF ensures browser paints the initial state (opacity:0, scale:0.92)
    // before transitioning to the visible state
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        graphFullscreenVisible = true;
      });
    });
  }

  function closeGraphFullscreen() {
    graphFullscreenVisible = false;
    setTimeout(() => { graphFullscreen = false; }, 350);
  }

  function handlePreviewMode(e: Event) {
    const mode = (e as CustomEvent).detail;
    if (mode === 'graph') {
      openGraphFullscreen();
    } else if (mode === 'tree' || mode === 'raw') {
      previewMode = mode;
    }
  }

  function handleGraphEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && graphFullscreen) {
      e.preventDefault();
      e.stopPropagation();
      closeGraphFullscreen();
    }
  }

  function handleOpenSearch(e: Event) {
    openSearch();
  }

  onMount(() => {
    window.addEventListener('set-preview-mode', handlePreviewMode);
    window.addEventListener('keydown', handleGraphEsc, true);
    window.addEventListener('open-response-search', handleOpenSearch);
  });

  onDestroy(() => {
    window.removeEventListener('set-preview-mode', handlePreviewMode);
    window.removeEventListener('keydown', handleGraphEsc, true);
    window.removeEventListener('open-response-search', handleOpenSearch);
    if (exampleSavedTimeout) clearTimeout(exampleSavedTimeout);
  });
</script>

<div
  class="response-panel {$responseLayout === 'right' ? 'sidebar right-sidebar' : 'bottom-panel'}"
  class:collapsed={$responseLayout === 'right' && $rightSidebarCollapsed}
  style={$responseLayout === 'right'
    ? `width: ${$rightSidebarCollapsed ? '50px' : $rightSidebarWidth + 'px'}`
    : `height: ${$responsePanelHeight}px`}
>
  {#if $responseLayout === 'bottom'}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="drag-handle drag-handle-top" onmousedown={onDragBottom} role="separator" aria-orientation="horizontal" aria-label="Resize response panel" tabindex="-1"></div>
  {/if}

  <div class="resp-collapsed-view" class:is-collapsed={$responseLayout === 'right' && $rightSidebarCollapsed}>
    <button class="expand-btn" onclick={() => rightSidebarCollapsed.set(false)} title="Expand Response">
      <span class="expand-icon">◀</span>
    </button>
  </div>

  <div class="resp-expanded-view" class:is-collapsed={$responseLayout === 'right' && $rightSidebarCollapsed}>
    {#if $responseLayout === 'right'}
      <div class="sidebar-header">
        <div class="header-title">
          <h3>Response</h3>
          <button class="collapse-btn" onclick={() => rightSidebarCollapsed.update(v => !v)}>
            <span class="collapse-icon">▶</span>
          </button>
        </div>
      </div>
    {/if}

    {#if isActiveTabSending}
      <div class="loading-panel">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">Sending request...</div>
          <div class="loading-bar">
            <div class="loading-bar-inner"></div>
          </div>
        </div>
      </div>
    {/if}

    <div class="resp-header">
      <div class="resp-tabs">
      <button
        class="resp-tab {$activeResponseTab === 'preview' ? 'active' : ''}"
        onclick={() => activeResponseTab.set('preview')}
        title={shortcutTitle('Preview', 'Alt+1')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8l-3.147-3.146z"/></svg>
        Preview
      </button>
      <button
        class="resp-tab {$activeResponseTab === 'headers' ? 'active' : ''}"
        onclick={() => activeResponseTab.set('headers')}
        title={shortcutTitle('Headers', 'Alt+2')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 0 0 1-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 0 0 1 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"/></svg>
        Headers
        {#if Object.keys(responseHeaders).length > 0}
          <span class="resp-tab-badge">{Object.keys(responseHeaders).length}</span>
        {/if}
      </button>
      <button
        class="resp-tab {$activeResponseTab === 'console' ? 'active' : ''}"
        onclick={() => activeResponseTab.set('console')}
        title={shortcutTitle('Console', 'Alt+3')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9zM3.854 4.146a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2z"/><path d="M2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12z"/></svg>
        Console
        {#if $logs.length > 0}
          <span class="resp-tab-badge">{$logs.length}</span>
        {/if}
      </button>
      <button
        class="resp-tab {$activeResponseTab === 'diff' ? 'active' : ''}"
        onclick={() => activeResponseTab.set('diff')}
        title={shortcutTitle('Diff', 'Alt+4')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
        Diff
      </button>
      </div>

      {#if responseStatus !== null && !isActiveTabSending}
        <div class="resp-status-inline">
          <span class="resp-status-pill {getStatusClass(responseStatus)}">
            {responseStatus} {responseStatusText}
          </span>
          <span class="resp-meta">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>
            {responseTime}ms
          </span>
          <span class="resp-meta">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 0a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z"/></svg>
            {responseSize}
          </span>
          <span class="resp-timestamp">{responseTimestamp}</span>
          {#if $activeTab.requestId}
            <div class="examples-controls">
              <select
                class="examples-select"
                bind:value={selectedExampleId}
                onchange={loadSelectedExample}
                disabled={examplesLoading || examples.length === 0}
              >
                <option value="">
                  {examplesLoading ? 'Loading examples…' : examples.length === 0 ? 'No examples' : 'Examples'}
                </option>
                {#each examples as example}
                  <option value={String(example.id)}>
                    {example.name}{example.status_code != null ? ` (${example.status_code})` : ''}
                  </option>
                {/each}
              </select>
              <button
                class="examples-btn {exampleSaved ? 'success' : ''}"
                onclick={saveAsExample}
                disabled={responseStatus == null}
                title="Save current response as a named example"
              >
                {exampleSaved ? 'Saved' : 'Save example'}
              </button>
              {#if selectedExampleId}
                <button
                  class="examples-btn danger"
                  onclick={deleteSelectedExample}
                  title="Delete selected example"
                >×</button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="resp-body">
      {#if $activeResponseTab === 'preview'}
        <div class="resp-pane">
          {#if responseBody}
            {#if isBinaryPreview}
              <BinaryPreview body={responseBody} typeInfo={responseTypeInfo} contentType={responseContentType} />
            {:else if responseIsBinary}
              <BinaryPreview body={responseBody} typeInfo={responseTypeInfo} contentType={responseContentType} />
            {:else}
              <div class="resp-preview-toolbar">
                <div class="toolbar-left">
                  <div class="view-toggle">
                    <button class="view-toggle-btn {previewMode === 'tree' ? 'active' : ''}" onclick={() => previewMode = 'tree'} disabled={!parsedJson} title={shortcutTitle('Tree view', 'Alt+T')}>Tree</button>
                    <button class="view-toggle-btn {previewMode === 'raw' ? 'active' : ''}" onclick={() => previewMode = 'raw'} title={shortcutTitle('Raw view', 'Alt+R')}>Raw</button>
                    <button class="view-toggle-btn {graphFullscreen ? 'active' : ''}" onclick={openGraphFullscreen} disabled={!parsedJson} title={shortcutTitle('Graph view', 'Alt+G')}>Graph</button>
                  </div>
                  {#if previewMode === 'raw'}
                    <div class="raw-full-toggle" title={rawFullView ? 'Switch to compact raw view' : 'Switch to full editor view'}>
                      <button
                        type="button"
                        class="mac-toggle"
                        class:on={rawFullView}
                        role="switch"
                        aria-checked={rawFullView}
                        aria-label="Full raw editor view"
                        onclick={() => { rawFullView = !rawFullView; }}
                      >
                        <span class="mac-toggle-knob"></span>
                      </button>
                    </div>
                  {/if}
                </div>
                <div class="toolbar-actions">
                  {#if responseContentType}
                    <span class="content-type-label">{responseTypeInfo.label}</span>
                  {/if}
                  <button
                    class="toolbar-icon-btn {showSearch ? 'active' : ''}"
                    onclick={openSearch}
                    title="Search in response (Ctrl+F)"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>
                  </button>
                  <button 
                    class="toolbar-icon-btn {responseCopied ? 'success' : ''}"
                    onclick={copyResponseBody}
                    title="Copy response (Ctrl+Shift+C)"
                  >
                    {#if responseCopied}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
                    {:else}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>
                    {/if}
                  </button>
                  <button 
                    class="toolbar-icon-btn" 
                    onclick={openSaveToVariable}
                    title="Save to variable"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/>
                    </svg>
                  </button>
                  <button 
                    class="toolbar-icon-btn {snapshotExported ? 'success' : ''}"
                    onclick={exportSnapshot}
                    title="Export HTML (Ctrl+Shift+S)"
                  >
                    {#if snapshotExported}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
                    {:else}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>
                    {/if}
                  </button>
                </div>
              </div>
              {#if showSearch}
                <ResponseSearchBar
                  bind:this={searchBarRef}
                  bind:query={searchQuery}
                  matchCount={searchMatchCount}
                  currentMatch={searchCurrentMatch}
                  on:search={handleSearch}
                  on:next={handleSearchNext}
                  on:prev={handleSearchPrev}
                  on:close={closeSearch}
                />
              {/if}
              {#if previewMode === 'tree' && parsedJson}
                <div class="tree-view-container">
                  <JsonTreeViewer data={parsedJson} lineCounter={{ current: 1 }} {searchQuery} />
                </div>
              {:else}
                {#key `${rawFullView}-${responseBody}`}
                  <ResponseViewer
                    bind:this={responseViewerRef}
                    value={responseBody}
                    language="json"
                    {searchQuery}
                    fieldMode={previewMode === 'raw' && !rawFullView && !!parsedJson}
                  />
                {/key}
              {/if}
            {/if}
          {:else}
            <div class="resp-empty">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
                <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2"/>
                <path d="M14 20l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="24" y1="32" x2="34" y2="32" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <span>Send a request to see the response</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if $activeResponseTab === 'headers'}
        <div class="resp-pane">
          {#if Object.entries(responseHeaders).length > 0}
            <div class="resp-headers-list">
              {#each Object.entries(responseHeaders) as [key, value]}
                <div class="resp-header-row">
                  <span class="resp-header-key">{key}</span>
                  <span class="resp-header-val">{value}</span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="resp-empty">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
                <rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" stroke-width="2"/>
                <line x1="6" y1="18" x2="42" y2="18" stroke="currentColor" stroke-width="2"/>
                <line x1="6" y1="30" x2="42" y2="30" stroke="currentColor" stroke-width="2"/>
                <line x1="20" y1="6" x2="20" y2="42" stroke="currentColor" stroke-width="2"/>
              </svg>
              <span>No headers in response</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if $activeResponseTab === 'console'}
        <div class="resp-pane resp-console-pane">
          <div class="resp-console-toolbar">
            <span class="resp-console-label">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9zM3.854 4.146a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2z"/><path d="M2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12z"/></svg>
              Console
            </span>
            <button class="resp-console-clear" onclick={clearLogs} title="Clear Console">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5.5l1-1h3l1 1h2.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
              Clear
            </button>
          </div>
          <div class="resp-console-output" id="console-content">
            {#if $logs.length > 0}
              {#each $logs as log}
                <div class="resp-console-line">{formatLogLine(log)}</div>
              {/each}
            {:else}
              <div class="resp-console-empty">No console output yet</div>
            {/if}
          </div>
        </div>
      {/if}

      {#if $activeResponseTab === 'diff'}
        <div class="resp-pane">
          <ResponseDiff currentResponse={responseBody || ''} currentUrl={$activeTab.url || ''} />
        </div>
      {/if}
    </div>

    {#if $responseLayout === 'right'}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="drag-handle drag-handle-left" onmousedown={onDragRight} role="separator" aria-orientation="vertical" aria-label="Resize response panel" tabindex="-1"></div>
    {/if}
  </div>
</div>

{#if showVariableModal}
  <div class="variable-modal-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={() => showVariableModal = false} onkeypress={() => {}}>
    <div class="variable-modal" role="presentation" onclick={stopPropagation(bubble('click'))} onkeypress={stopPropagation(bubble('keypress'))}>
      <div class="variable-modal-header">
        <h3>Save to Variable</h3>
        <button class="close-btn" onclick={() => showVariableModal = false}>×</button>
      </div>
      
      <div class="variable-modal-body">
        <div class="variable-search">
          <input 
            type="text" 
            placeholder="Search paths or values..."
            bind:value={searchFilter}
            class="search-input"
          />
        </div>
        
        <div class="variable-paths-list">
          {#each filteredPaths as item}
            <button 
              type="button"
              class="variable-path-row" 
              class:selected={selectedPath === item.path}
              onclick={() => selectPath(item.path, item.value)}
            >
              <span class="path-name">{item.path}</span>
              <span class="path-value">{item.value.length > 50 ? item.value.slice(0, 50) + '...' : item.value}</span>
            </button>
          {/each}
          {#if filteredPaths.length === 0}
            <div class="no-paths">No matching paths found</div>
          {/if}
        </div>
        
        {#if selectedPath}
          <div class="variable-form">
            <div class="form-group">
              <label for="var-name">Variable Name</label>
              <div class="variable-name-preview">
                <span class="var-prefix">{'{{'}</span>
                <input 
                  id="var-name"
                  type="text" 
                  bind:value={variableName}
                  placeholder="variable_name"
                  class="var-name-input"
                />
                <span class="var-suffix">{'}}'}</span>
              </div>
            </div>
            
            <div class="form-group">
              <label for="var-collection">Save to Collection</label>
              <select id="var-collection" bind:value={targetCollectionId} class="collection-select">
                {#each collections as col}
                  <option value={col.id}>{col.name}</option>
                {/each}
              </select>
            </div>
            
            <div class="form-group">
              <span class="field-label">Value</span>
              <div class="value-preview">{extractedPaths.find(p => p.path === selectedPath)?.value || ''}</div>
            </div>
          </div>
        {/if}
      </div>
      
      <div class="variable-modal-footer">
        <button class="cancel-btn" onclick={() => showVariableModal = false}>Cancel</button>
        <button 
          class="save-btn" 
          onclick={saveVariable}
          disabled={!selectedPath || !variableName || !targetCollectionId}
        >
          Save Variable
        </button>
      </div>
    </div>
  </div>
{/if}

{#if graphFullscreen && parsedJson}
  <div
    class="graph-fullscreen-overlay"
    class:visible={graphFullscreenVisible}
  >
    <div class="graph-fullscreen-header">
      <div class="graph-fullscreen-title">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6 1H1v5h1V2.707l4.146 4.147.708-.708L2.707 2H6V1zm10 10h-1v3.293l-4.146-4.147-.708.708L14.293 15H11v1h5v-5z"/></svg>
        JSON Graph
      </div>
      <button class="graph-fullscreen-close" onclick={closeGraphFullscreen} title="Close (Esc)">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
      </button>
    </div>
    <div class="graph-fullscreen-body">
      <JsonGraphViewer data={parsedJson} />
    </div>
  </div>
{/if}

<style>
  .resp-expanded-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 200px;
  }

  .resp-expanded-view.is-collapsed {
    opacity: 0;
    pointer-events: none;
    position: absolute;
    width: 0;
    overflow: hidden;
  }

  .resp-collapsed-view {
    display: none;
    flex-direction: column;
    padding: 0.5rem 0;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
  }

  .resp-collapsed-view.is-collapsed {
    display: flex;
  }

  .resp-preview-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    background: var(--bg-secondary, #2b2d31);
    border-bottom: 1px solid var(--border-color, var(--border-color));
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .view-toggle {
    display: flex;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }

  .view-toggle-btn {
    padding: 3px 10px;
    background: transparent;
    color: #949ba4;
    border: none;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .view-toggle-btn:hover { background: #383a40; }

  .view-toggle-btn.active {
    background: #5865f2;
    color: white;
  }

  .view-toggle-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .raw-full-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 12px;
    cursor: pointer;
    user-select: none;
  }

  .raw-full-toggle-label {
    font-size: 11px;
    color: #949ba4;
  }

  .mac-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: #3a3a3c;
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;
  }

  .mac-toggle.on {
    background: #34c759;
  }

  .mac-toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
    transition: transform 0.2s ease;
  }

  .mac-toggle.on .mac-toggle-knob {
    transform: translateX(16px);
  }

  .tree-view-container {
    flex: 1;
    overflow: auto;
    padding: 8px 4px;
    background: var(--bg-primary);
  }

  .graph-fullscreen-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    background: var(--bg-primary, #1e1f22);
    display: flex;
    flex-direction: column;
    opacity: 0;
    transform: translateY(40px) scale(0.97);
    transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1), transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
  }

  .graph-fullscreen-overlay.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: all;
  }

  .graph-fullscreen-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: var(--bg-secondary, #2b2d31);
    border-bottom: 1px solid var(--border-color, var(--border-color));
    flex-shrink: 0;
  }

  .graph-fullscreen-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary, #fff);
    letter-spacing: 0.02em;
  }

  .graph-fullscreen-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #b0b0b0);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .graph-fullscreen-close:hover {
    background: var(--error-color, #ff6b6b);
    color: white;
  }

  .graph-fullscreen-body {
    flex: 1;
    overflow: hidden;
  }
  
  .content-type-label {
    padding: 2px 8px;
    background: rgba(88, 101, 242, 0.1);
    color: #8b9cf7;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .toolbar-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    color: #949ba4;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .toolbar-icon-btn:hover {
    background: #383a40;
    color: #e0e0e0;
    border-color: #4e5058;
  }

  .toolbar-icon-btn.active {
    background: rgba(88, 101, 242, 0.2);
    color: #8b9cf7;
    border-color: rgba(88, 101, 242, 0.3);
  }

  .toolbar-icon-btn.success {
    background: rgba(36, 128, 69, 0.2);
    color: #43b581;
    border-color: rgba(67, 181, 129, 0.3);
  }
  
  .variable-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }
  
  .variable-modal {
    background: var(--bg-tertiary);
    border-radius: 8px;
    width: 500px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  
  .variable-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
  }
  
  .variable-modal-header h3 {
    margin: 0;
    font-size: 16px;
    color: #f2f3f5;
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
  
  .variable-modal-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 16px 20px;
  }
  
  .variable-search {
    margin-bottom: 12px;
  }
  
  .search-input {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 13px;
  }
  
  .search-input:focus {
    outline: none;
    border-color: #5865f2;
  }
  
  .variable-paths-list {
    flex: 1;
    overflow-y: auto;
    max-height: 200px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    margin-bottom: 16px;
  }
  
  .variable-path-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    border: none;
    border-bottom: 1px solid var(--border-color);
    transition: background 0.15s;
    background: transparent;
    width: 100%;
    text-align: left;
  }
  
  .variable-path-row:last-child {
    border-bottom: none;
  }
  
  .variable-path-row:hover {
    background: #383a40;
  }
  
  .variable-path-row.selected {
    background: #5865f2;
  }
  
  .path-name {
    color: #f2f3f5;
    font-family: monospace;
    font-size: 12px;
  }
  
  .path-value {
    color: #949ba4;
    font-size: 12px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .variable-path-row.selected .path-value {
    color: rgba(255, 255, 255, 0.8);
  }
  
  .no-paths {
    padding: 20px;
    text-align: center;
    color: #949ba4;
  }
  
  .variable-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  
  .form-group label,
  .form-group .field-label {
    font-size: 12px;
    color: #949ba4;
    font-weight: 500;
  }
  
  .variable-name-preview {
    display: flex;
    align-items: center;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 0 10px;
  }
  
  .var-prefix, .var-suffix {
    color: #f0b132;
    font-family: monospace;
    font-size: 14px;
  }
  
  .var-name-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #f0b132;
    font-family: monospace;
    font-size: 14px;
    padding: 8px 4px;
  }
  
  .var-name-input:focus {
    outline: none;
  }
  
  .collection-select {
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 13px;
  }
  
  .collection-select:focus {
    outline: none;
    border-color: #5865f2;
  }
  
  .value-preview {
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-family: monospace;
    font-size: 12px;
    max-height: 60px;
    overflow-y: auto;
    word-break: break-all;
  }
  
  .variable-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--border-color);
  }
  
  .cancel-btn {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 13px;
    cursor: pointer;
  }
  
  .cancel-btn:hover {
    background: #383a40;
  }
  
  .save-btn {
    padding: 8px 16px;
    background: #5865f2;
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }
  
  .save-btn:hover:not(:disabled) {
    background: #4752c4;
  }
  
  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .examples-controls {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: 0.5rem;
    flex-wrap: wrap;
  }

  .examples-select {
    max-width: 150px;
    padding: 3px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary, #dbdee1);
    font-size: 0.72rem;
  }

  .examples-btn {
    padding: 3px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.72rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .examples-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .examples-btn.success {
    border-color: var(--success-color);
    color: var(--success-color);
  }

  .examples-btn.danger {
    padding-inline: 6px;
    min-width: 24px;
  }

  .examples-btn.danger:hover {
    border-color: var(--error-color);
    color: var(--error-color);
  }

  .examples-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
