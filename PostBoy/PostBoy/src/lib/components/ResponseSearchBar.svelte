<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let matchCount = 0;
  export let currentMatch = 0;
  export let query = '';

  let inputEl: HTMLInputElement;
  const dispatch = createEventDispatcher<{
    search: string;
    next: void;
    prev: void;
    close: void;
  }>();

  onMount(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  function handleInput() {
    dispatch('search', query);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dispatch('close');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        dispatch('prev');
      } else {
        dispatch('next');
      }
    }
  }

  export function focus() {
    inputEl?.focus();
    inputEl?.select();
  }
</script>

<div class="search-bar" on:keydown={handleKeydown}>
  <div class="search-input-wrap">
    <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      on:input={handleInput}
      type="text"
      class="search-input"
      placeholder="Search in response..."
      spellcheck="false"
    />
    {#if query}
      <span class="match-count" class:no-matches={query && matchCount === 0}>
        {matchCount > 0 ? `${currentMatch} of ${matchCount}` : 'No matches'}
      </span>
    {/if}
  </div>
  <div class="search-actions">
    <button class="search-nav-btn" on:click={() => dispatch('prev')} disabled={matchCount === 0} title="Previous match (Shift+Enter)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/></svg>
    </button>
    <button class="search-nav-btn" on:click={() => dispatch('next')} disabled={matchCount === 0} title="Next match (Enter)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>
    </button>
    <button class="search-close-btn" on:click={() => dispatch('close')} title="Close (Esc)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
    </button>
  </div>
</div>

<style>
  .search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-secondary, #2b2d31);
    border-bottom: 1px solid var(--border-color, #3e4045);
    flex-shrink: 0;
  }

  .search-input-wrap {
    display: flex;
    align-items: center;
    flex: 1;
    background: #1e1f22;
    border: 1px solid #3e4045;
    border-radius: 4px;
    padding: 0 8px;
    transition: border-color 0.15s;
  }

  .search-input-wrap:focus-within {
    border-color: #5865f2;
  }

  .search-icon {
    color: #72767d;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #f2f3f5;
    font-size: 13px;
    padding: 5px 8px;
    outline: none;
    font-family: inherit;
    min-width: 0;
  }

  .search-input::placeholder {
    color: #72767d;
  }

  .match-count {
    font-size: 11px;
    color: #949ba4;
    white-space: nowrap;
    padding-right: 4px;
    flex-shrink: 0;
  }

  .match-count.no-matches {
    color: #f38ba8;
  }

  .search-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .search-nav-btn,
  .search-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    color: #949ba4;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .search-nav-btn:hover:not(:disabled),
  .search-close-btn:hover {
    background: #383a40;
    color: #e0e0e0;
    border-color: #4e5058;
  }

  .search-nav-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .search-close-btn:hover {
    color: #f38ba8;
  }
</style>
