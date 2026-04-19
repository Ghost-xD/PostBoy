<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { leftSidebarCollapsed, leftSidebarWidth, activeSidebarTab } from '$lib/stores/uiStore';
  import CollectionsSidebar from './CollectionsSidebar.svelte';
  import HistorySidebar from './HistorySidebar.svelte';

  export let collections: any[] = [];
  export let history: any[] = [];
  export let onCreateCollection: () => void = () => {};
  export let onImportCollections: () => void = () => {};
  export let onImportOpenApi: () => void = () => {};
  export let onExportCollections: () => void = () => {};
  export let onClearAllCollections: () => void = () => {};
  export let onLoadCollections: () => Promise<void> = async () => {};
  export let onLoadRequest: (request: any) => void = () => {};
  export let onClearHistory: () => void = () => {};
  export let onLoadFromHistory: (item: any) => void = () => {};
  export let onLoadHistory: () => Promise<void> = async () => {};
  export let onDragLeft: (e: MouseEvent) => void = () => {};

  let collectionsSidebarRef: CollectionsSidebar;
  let historySidebarRef: HistorySidebar;

  function handleFocusSidebarSearch() {
    if ($leftSidebarCollapsed) return;
    if ($activeSidebarTab === 'collections') {
      collectionsSidebarRef?.focusSearch();
    } else {
      historySidebarRef?.focusSearch();
    }
  }

  onMount(() => {
    window.addEventListener('focus-sidebar-search', handleFocusSidebarSearch);
  });

  onDestroy(() => {
    window.removeEventListener('focus-sidebar-search', handleFocusSidebarSearch);
  });
</script>

<div class="sidebar left-sidebar" class:collapsed={$leftSidebarCollapsed} style="width: {$leftSidebarCollapsed ? '50px' : $leftSidebarWidth + 'px'}">
  <div class="sidebar-expanded-view" class:is-collapsed={$leftSidebarCollapsed}>
    <div class="sidebar-header">
      <div class="header-title">
        <h3>Collections</h3>
        <button class="collapse-btn" on:click={() => leftSidebarCollapsed.update(v => !v)}>
          <span class="collapse-icon">◀</span>
        </button>
      </div>
      <div class="header-actions">
        <button on:click={onCreateCollection} class="collection-new-btn" title="New Collection">+</button>
        <button on:click={onImportCollections} class="collection-action-btn" title="Import Collection">📥</button>
        <button on:click={onImportOpenApi} class="collection-action-btn" title="Import OpenAPI Spec (Ctrl+Shift+O)">📋</button>
        <button on:click={onExportCollections} class="collection-action-btn" title="Export All">📤</button>
        <button on:click={onClearAllCollections} class="collection-action-btn" title="Clear All" style="color: #ff6b6b;">🗑️</button>
      </div>
    </div>

    <div class="sidebar-tabs">
      <button 
        class="sidebar-tab-btn {$activeSidebarTab === 'collections' ? 'active' : ''}"
        on:click={() => activeSidebarTab.set('collections')}
        title="Collections (Ctrl+Shift+C)"
      >
        Collections
      </button>
      <button 
        class="sidebar-tab-btn {$activeSidebarTab === 'history' ? 'active' : ''}"
        on:click={() => activeSidebarTab.set('history')}
        title="History (Ctrl+Shift+H)"
      >
        History
      </button>
    </div>

    {#if $activeSidebarTab === 'collections'}
      <CollectionsSidebar bind:this={collectionsSidebarRef} {collections} onReload={onLoadCollections} onRequestClick={onLoadRequest} />
    {:else}
      <HistorySidebar bind:this={historySidebarRef} {history} onClearHistory={onClearHistory} onHistoryClick={onLoadFromHistory} onReload={onLoadHistory} />
    {/if}

    <div class="drag-handle drag-handle-right" on:mousedown={onDragLeft}></div>
  </div>

  <div class="sidebar-collapsed-view" class:is-collapsed={$leftSidebarCollapsed}>
    <button class="expand-btn" on:click={() => leftSidebarCollapsed.set(false)} title="Expand Collections (Ctrl+Shift+C)">
      <span class="expand-icon">▶</span>
    </button>
    <button on:click={onCreateCollection} class="collection-new-btn-collapsed" title="New Collection">+</button>
    <button on:click={onImportCollections} class="collection-action-btn-collapsed" title="Import">📥</button>
    <button on:click={onImportOpenApi} class="collection-action-btn-collapsed" title="OpenAPI">📋</button>
    <button on:click={onExportCollections} class="collection-action-btn-collapsed" title="Export">📤</button>
  </div>
</div>

<style>
  .sidebar-expanded-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 200px;
  }

  .sidebar-expanded-view.is-collapsed {
    opacity: 0;
    pointer-events: none;
    position: absolute;
    width: 0;
    overflow: hidden;
  }

  .sidebar-collapsed-view {
    display: none;
    flex-direction: column;
    padding: 0.5rem 0;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
  }

  .sidebar-collapsed-view.is-collapsed {
    display: flex;
  }
</style>
