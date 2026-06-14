<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { leftSidebarCollapsed, leftSidebarWidth, activeSidebarTab } from '$lib/stores/uiStore';
  import CollectionsSidebar from './CollectionsSidebar.svelte';
  import HistorySidebar from './HistorySidebar.svelte';

  interface Props {
    collections?: any[];
    history?: any[];
    onCreateCollection?: () => void;
    onImportCollections?: () => void;
    onImportOpenApi?: () => void;
    onExportCollections?: () => void;
    onClearAllCollections?: () => void;
    onLoadCollections?: () => Promise<void>;
    onLoadRequest?: (request: any) => void;
    onClearHistory?: () => Promise<void>;
    onLoadFromHistory?: (item: any) => void;
    onLoadHistory?: () => Promise<void>;
    onDragLeft?: (e: MouseEvent) => void;
  }

  let {
    collections = [],
    history = [],
    onCreateCollection = () => {},
    onImportCollections = () => {},
    onImportOpenApi = () => {},
    onExportCollections = () => {},
    onClearAllCollections = () => {},
    onLoadCollections = async () => {},
    onLoadRequest = () => {},
    onClearHistory = async () => {},
    onLoadFromHistory = () => {},
    onLoadHistory = async () => {},
    onDragLeft = () => {}
  }: Props = $props();

  let collectionsSidebarRef: CollectionsSidebar | undefined = $state();
  let historySidebarRef: HistorySidebar | undefined = $state();

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
        <button class="collapse-btn" onclick={() => leftSidebarCollapsed.update(v => !v)}>
          <span class="collapse-icon">◀</span>
        </button>
      </div>
      <div class="header-actions">
        <button onclick={onCreateCollection} class="collection-new-btn" title="New Collection">+</button>
        <button onclick={onImportCollections} class="collection-action-btn" title="Import Collection">📥</button>
        <button onclick={onImportOpenApi} class="collection-action-btn" title="Import OpenAPI Spec (Ctrl+Shift+O)">📋</button>
        <button onclick={onExportCollections} class="collection-action-btn" title="Export All">📤</button>
        <button onclick={onClearAllCollections} class="collection-action-btn" title="Clear All" style="color: #ff6b6b;">🗑️</button>
      </div>
    </div>

    <div class="sidebar-tabs">
      <button 
        class="sidebar-tab-btn {$activeSidebarTab === 'collections' ? 'active' : ''}"
        onclick={() => activeSidebarTab.set('collections')}
        title="Collections (Ctrl+Shift+C)"
      >
        Collections
      </button>
      <button 
        class="sidebar-tab-btn {$activeSidebarTab === 'history' ? 'active' : ''}"
        onclick={() => activeSidebarTab.set('history')}
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

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="drag-handle drag-handle-right" onmousedown={onDragLeft} role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="-1"></div>
  </div>

  <div class="sidebar-collapsed-view" class:is-collapsed={$leftSidebarCollapsed}>
    <button class="expand-btn" onclick={() => leftSidebarCollapsed.set(false)} title="Expand Collections (Ctrl+Shift+C)">
      <span class="expand-icon">▶</span>
    </button>
    <button onclick={onCreateCollection} class="collection-new-btn-collapsed" title="New Collection">+</button>
    <button onclick={onImportCollections} class="collection-action-btn-collapsed" title="Import">📥</button>
    <button onclick={onImportOpenApi} class="collection-action-btn-collapsed" title="OpenAPI">📋</button>
    <button onclick={onExportCollections} class="collection-action-btn-collapsed" title="Export">📤</button>
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
