<script lang="ts">
  import { db, fileOps } from '$lib/api/tauri';
  import { addLog } from '$lib/stores/consoleStore';
  import { isHistorySuccessStatus, HISTORY_UPDATED_EVENT } from '$lib/utils/streamHistory';
  import {
    filterHistoryItems,
    historyFiltersActive,
    METHOD_FILTER_OPTIONS,
    STATUS_FILTER_OPTIONS,
    type MethodFilter,
    type StatusFilter,
  } from '$lib/utils/historyFilters';
  import { importHarEntriesFromReadResult } from '$lib/utils/harImportWorkflow';

  interface Props {
    history?: any[];
    onClearHistory: () => Promise<void>;
    onHistoryClick: (item: any) => void;
    onReload: () => Promise<void>;
  }

  let {
    history = [],
    onClearHistory,
    onHistoryClick,
    onReload
  }: Props = $props();

  let searchQuery = $state('');
  let methodFilter = $state<MethodFilter>('ALL');
  let statusFilter = $state<StatusFilter>('ALL');
  let searchInputEl: HTMLInputElement | undefined = $state();
  let importingHar = $state(false);

  export function focusSearch() {
    searchInputEl?.focus();
    searchInputEl?.select();
  }

  let filteredHistory = $derived(
    filterHistoryItems(history, {
      query: searchQuery,
      method: methodFilter,
      status: statusFilter,
    })
  );

  let filtersActive = $derived(
    historyFiltersActive({ query: searchQuery, method: methodFilter, status: statusFilter })
  );

  async function deleteHistoryItem(e: MouseEvent, item: any) {
    e.stopPropagation();
    try {
      await db.deleteHistory(item.id);
      await onReload();
    } catch (error) {
      console.error('Failed to delete history item:', error);
    }
  }

  async function importHar() {
    if (importingHar) return;
    try {
      importingHar = true;
      const result = await fileOps.showOpenDialog({
        title: 'Import HAR into history',
        filters: [{ name: 'HTTP Archive', extensions: ['har', 'json'] }],
      });
      const path = Array.isArray(result) ? result[0] : result;
      if (!path) return;

      const readResult = await fileOps.readFile(path);
      const importResult = await importHarEntriesFromReadResult(readResult, db.addHistory);

      if (!importResult.ok) {
        addLog(`HAR import: ${importResult.message}`, 'error');
        return;
      }

      await onReload();
      window.dispatchEvent(new CustomEvent(HISTORY_UPDATED_EVENT));

      const skippedNote = importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : '';
      const errorNote = importResult.warningCount > 0 ? ` (${importResult.warningCount} warnings)` : '';
      addLog(`✓ Imported ${importResult.imported} HAR entries into history${skippedNote}${errorNote}`, 'system');
    } catch (error) {
      console.error('HAR import failed:', error);
      addLog(`HAR import failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      importingHar = false;
    }
  }

  function getTimeAgo(timestamp: string): string {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      return `${diffDay}d ago`;
    } catch {
      return '';
    }
  }

  function displayUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.host + parsed.pathname + parsed.search;
    } catch {
      return url;
    }
  }
</script>

<div class="history-toolbar">
  <span class="history-count">
    {filtersActive
      ? `${filteredHistory.length}/${history.length}`
      : history.length}
    requests
  </span>
  <div class="history-toolbar-actions">
    <button
      class="import-btn"
      onclick={importHar}
      disabled={importingHar}
      title="Import browser or proxy HAR file into history"
    >
      {importingHar ? 'Importing…' : 'Import HAR'}
    </button>
    <button onclick={onClearHistory} class="clear-btn" title="Clear all history">Clear All</button>
  </div>
</div>
<div class="history-filter">
  <input
    type="text"
    class="search-input"
    placeholder="Search URL..."
    bind:value={searchQuery}
    bind:this={searchInputEl}
    onkeydown={(e) => { if (e.key === 'Escape') { searchQuery = ''; searchInputEl?.blur(); } }}
  />
  <select class="method-filter" bind:value={methodFilter} title="Filter by method">
    {#each METHOD_FILTER_OPTIONS as method}
      <option value={method}>{method === 'ALL' ? 'Method' : method === 'DELETE' ? 'DEL' : method}</option>
    {/each}
  </select>
  <select class="status-filter" bind:value={statusFilter} title="Filter by status">
    {#each STATUS_FILTER_OPTIONS as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</div>
<div class="history-list">
  {#if history.length === 0}
    <div class="empty-history">
      <p>No history yet</p>
      <p>Requests you send will appear here</p>
      <p class="empty-hint">Or import a HAR file from DevTools or Charles</p>
    </div>
  {:else if filteredHistory.length === 0}
    <div class="empty-history">
      <p>No matching history</p>
      <p>Try adjusting search or filters</p>
    </div>
  {:else}
    {#each filteredHistory as item}
      <div
        class="history-item"
        role="button"
        tabindex="0"
        onclick={() => onHistoryClick(item)}
        onkeypress={(e) => e.key === 'Enter' && onHistoryClick(item)}
      >
        <div class="history-item-row">
          <span class="method {item.method.toLowerCase()}">{item.method}</span>
          <span class="status {isHistorySuccessStatus(item.status_code) ? 'success' : 'error'}">
            {item.status_code ?? 'ERR'}
          </span>
          {#if item.executed_at || item.created_at}
            <span class="history-item-time">{getTimeAgo(item.executed_at || item.created_at)}</span>
          {/if}
          <button
            class="history-delete-btn"
            onclick={(e) => deleteHistoryItem(e, item)}
            title="Delete this item"
          >×</button>
        </div>
        <div class="history-item-url" title={item.url}>{displayUrl(item.url)}</div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .history-toolbar {
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.35rem;
  }

  .history-toolbar-actions {
    display: flex;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .history-count {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-weight: 500;
    min-width: 0;
  }

  .import-btn,
  .clear-btn {
    background: none;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 0.15rem 0.4rem;
    cursor: pointer;
    font-size: 0.68rem;
    color: var(--text-secondary);
    background-color: var(--bg-primary);
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .import-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .import-btn:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .clear-btn:hover {
    background-color: var(--error-color);
    color: white;
    border-color: var(--error-color);
  }

  .history-filter {
    display: flex;
    gap: 4px;
    padding: 4px 0.6rem;
    border-bottom: 1px solid var(--border-color);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary, #dbdee1);
    font-size: 0.68rem;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent-color, #5865f2);
  }

  .method-filter,
  .status-filter {
    padding: 3px 3px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary, #dbdee1);
    font-size: 0.65rem;
    min-width: 48px;
    max-width: 76px;
  }

  .status-filter {
    max-width: 84px;
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.35rem;
    min-height: 0;
  }

  .empty-history {
    text-align: center;
    color: var(--text-secondary);
    padding: 2rem 1rem;
    font-style: italic;
  }

  .empty-history p {
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
  }

  .empty-hint {
    font-size: 0.75rem !important;
    opacity: 0.75;
  }

  .history-item {
    padding: 0.35rem 0.5rem;
    margin-bottom: 0.2rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
  }

  .history-item:hover {
    background-color: var(--bg-tertiary);
    border-color: var(--accent-color);
  }

  .history-item-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }

  .history-item-url {
    font-size: 0.72rem;
    color: var(--text-secondary);
    line-height: 1.25;
    margin-top: 0.15rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-item-time {
    font-size: 0.62rem;
    color: var(--text-secondary);
    opacity: 0.65;
    margin-left: auto;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .method {
    display: inline-block;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.2px;
    min-width: 34px;
    text-align: center;
    flex-shrink: 0;
    line-height: 1.3;
  }

  .method.get { background-color: var(--success-color); color: white; }
  .method.post { background-color: #3b82f6; color: white; }
  .method.put { background-color: #ff9500; color: white; }
  .method.delete { background-color: var(--error-color); color: white; }
  .method.patch { background-color: var(--warning-color); color: black; }
  .method.options { background-color: #17a2b8; color: white; }
  .method.head { background-color: #6c757d; color: white; }

  .status {
    font-size: 0.65rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .status.success { color: var(--success-color); }
  .status.error { color: var(--error-color); }

  .history-delete-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    border-radius: 3px;
    font-size: 0.85rem;
    line-height: 1;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .history-item:hover .history-delete-btn {
    opacity: 1;
  }

  .history-delete-btn:hover {
    background-color: var(--error-color);
    color: white;
  }
</style>
