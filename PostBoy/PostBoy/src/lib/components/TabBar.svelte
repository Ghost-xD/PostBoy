<script lang="ts">
  import { tabs, activeTabId, addTab, removeTab, setActiveTab } from '$lib/stores/tabStore';
</script>

<div class="request-tabs-container">
  <div class="request-tabs-list">
    {#each $tabs as tab}
      <button 
        class="request-tab {$activeTabId === tab.id ? 'active' : ''}"
        on:click={() => setActiveTab(tab.id)}
        title="{tab.url || tab.name || 'New Request'} · Navigate: Ctrl+Tab / Ctrl+Shift+Tab"
      >
        <span class="tab-method-dot {(tab.method || 'GET').toLowerCase()}"></span>
        <span class="tab-title">{tab.name || 'New Request'}</span>
        <span class="tab-close-btn" role="button" tabindex="0" title="Close Tab (Ctrl+W)" on:click|stopPropagation={() => removeTab(tab.id)} on:keypress|stopPropagation={(e) => e.key === 'Enter' && removeTab(tab.id)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </span>
      </button>
    {/each}
  </div>
  <button class="new-tab-btn" on:click={() => addTab()} title="New Tab (Ctrl+T)">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </button>
</div>

<style>
  .request-tabs-container {
    display: flex;
    align-items: stretch;
    background-color: var(--bg-primary);
    padding: 6px 6px 0 6px;
    min-height: 38px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
    width: 100%;
    max-width: 100%;
    border-bottom: 1px solid var(--border-color);
  }

  .request-tabs-container::-webkit-scrollbar {
    height: 4px;
  }

  .request-tabs-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .request-tabs-container::-webkit-scrollbar-thumb {
    background-color: var(--border-color);
    border-radius: 2px;
  }

  .request-tabs-container::-webkit-scrollbar-thumb:hover {
    background-color: var(--text-secondary);
  }

  .request-tabs-list {
    display: flex;
    align-items: stretch;
    gap: 2px;
    flex-shrink: 0;
  }

  .request-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background-color: transparent;
    flex-shrink: 0;
    white-space: nowrap;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-secondary);
    transition: all 0.15s ease;
    position: relative;
  }

  .request-tab.active {
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--border-color);
  }

  .request-tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 1px;
    background-color: var(--bg-secondary);
  }

  .request-tab:hover:not(.active) {
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .tab-method-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background-color: var(--text-secondary);
  }

  .tab-method-dot.get { background-color: var(--success-color); }
  .tab-method-dot.post { background-color: #3b82f6; }
  .tab-method-dot.put { background-color: #ff9500; }
  .tab-method-dot.delete { background-color: var(--error-color); }
  .tab-method-dot.patch { background-color: var(--warning-color); }
  .tab-method-dot.options { background-color: #17a2b8; }
  .tab-method-dot.head { background-color: #6c757d; }

  .tab-title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 140px;
  }

  .tab-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    cursor: pointer;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: all 0.15s ease;
    margin-left: 2px;
  }

  .request-tab:hover .tab-close-btn,
  .request-tab.active .tab-close-btn {
    opacity: 0.6;
  }

  .tab-close-btn:hover {
    background-color: var(--error-color);
    color: white;
    opacity: 1 !important;
  }

  .new-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    transition: all 0.15s ease;
    margin-left: 4px;
    flex-shrink: 0;
    align-self: center;
  }

  .new-tab-btn:hover {
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
