<script lang="ts">
  import { db } from '$lib/api/tauri';

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
  let methodFilter = $state('ALL');
  let searchInputEl: HTMLInputElement | undefined = $state();

  export function focusSearch() {
    searchInputEl?.focus();
    searchInputEl?.select();
  }

  let filteredHistory = $derived(history.filter((item) => {
    const matchesSearch =
      !searchQuery || item.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMethod = methodFilter === 'ALL' || item.method === methodFilter;
    return matchesSearch && matchesMethod;
  }));

  async function deleteHistoryItem(e: MouseEvent, item: any) {
    e.stopPropagation();
    try {
      await db.deleteHistory(item.id);
      await onReload();
    } catch (error) {
      console.error('Failed to delete history item:', error);
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

  function truncateUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname + parsed.search;
      return parsed.host + (path.length > 40 ? path.substring(0, 40) + '...' : path);
    } catch {
      return url.length > 60 ? url.substring(0, 60) + '...' : url;
    }
  }
</script>

<div class="history-toolbar">
  <span class="history-count">
    {searchQuery || methodFilter !== 'ALL'
      ? `${filteredHistory.length}/${history.length}`
      : history.length}
    requests
  </span>
  <button onclick={onClearHistory} class="clear-btn" title="Clear all history">Clear All</button>
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
  <select class="method-filter" bind:value={methodFilter}>
    <option value="ALL">All</option>
    <option value="GET">GET</option>
    <option value="POST">POST</option>
    <option value="PUT">PUT</option>
    <option value="DELETE">DEL</option>
    <option value="PATCH">PATCH</option>
  </select>
</div>
<div class="history-list">
  {#if history.length === 0}
    <div class="empty-history">
      <p>No history yet</p>
      <p>Requests you send will appear here</p>
    </div>
  {:else}
    {#each filteredHistory as item}
      <div class="history-item" role="button" tabindex="0" onclick={() => onHistoryClick(item)} onkeypress={(e) => e.key === 'Enter' && onHistoryClick(item)}>
        <div class="history-item-top">
          <span class="method {item.method.toLowerCase()}">{item.method}</span>
          <span class="status {item.status_code >= 200 && item.status_code < 300 ? 'success' : 'error'}">
            {item.status_code || 'ERR'}
          </span>
          <button
            class="history-delete-btn"
            onclick={(e) => deleteHistoryItem(e, item)}
            title="Delete this item"
          >×</button>
        </div>
        <div class="history-item-url">{truncateUrl(item.url)}</div>
        {#if item.created_at}
          <div class="history-item-time">{getTimeAgo(item.created_at)}</div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .history-toolbar {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .history-count {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .clear-btn {
    background: none;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--text-secondary);
    background-color: var(--bg-primary);
    transition: all 0.2s ease;
  }

  .clear-btn:hover {
    background-color: var(--error-color);
    color: white;
    border-color: var(--error-color);
  }

  .history-filter {
    display: flex;
    gap: 6px;
    padding: 6px 0.75rem;
    border-bottom: 1px solid var(--border-color);
  }

  .search-input {
    flex: 1;
    padding: 5px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary, #dbdee1);
    font-size: 0.75rem;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent-color, #5865f2);
  }

  .method-filter {
    padding: 5px 4px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary, #dbdee1);
    font-size: 0.7rem;
    min-width: 55px;
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
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

  .history-item {
    padding: 0.6rem 0.75rem;
    margin-bottom: 0.35rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
  }

  .history-item:hover {
    background-color: var(--bg-tertiary);
    border-color: var(--accent-color);
  }

  .history-item-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }

  .history-item-url {
    font-size: 0.8rem;
    color: var(--text-secondary);
    word-break: break-all;
    line-height: 1.3;
  }

  .history-item-time {
    font-size: 0.7rem;
    color: var(--text-secondary);
    opacity: 0.6;
    margin-top: 0.25rem;
  }

  .method {
    display: inline-block;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.3px;
    min-width: 38px;
    text-align: center;
    flex-shrink: 0;
  }

  .method.get { background-color: var(--success-color); color: white; }
  .method.post { background-color: #3b82f6; color: white; }
  .method.put { background-color: #ff9500; color: white; }
  .method.delete { background-color: var(--error-color); color: white; }
  .method.patch { background-color: var(--warning-color); color: black; }
  .method.options { background-color: #17a2b8; color: white; }
  .method.head { background-color: #6c757d; color: white; }

  .status {
    font-size: 0.7rem;
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
    font-size: 0.9rem;
    line-height: 1;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.15s ease;
    margin-left: auto;
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
