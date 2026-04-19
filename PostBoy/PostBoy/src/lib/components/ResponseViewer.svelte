<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { json } from '@codemirror/lang-json';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorState } from '@codemirror/state';
  import { SearchQuery, setSearchQuery, findNext, findPrevious, getSearchQuery, search } from '@codemirror/search';
  import { LARGE_RESPONSE_THRESHOLD, TRUNCATED_PREVIEW_SIZE, formatBytes } from '$lib/utils/responseUtils';
  
  export let value = '';
  export let language: 'json' | 'text' | 'html' | 'xml' = 'json';
  export let wordWrap = true;
  export let searchQuery = '';
  
  let editorDiv: HTMLDivElement;
  let view: EditorView;
  let showingFull = false;
  let loadingFull = false;

  $: isLarge = value.length > LARGE_RESPONSE_THRESHOLD;
  $: displayValue = computeDisplayValue(value, showingFull);

  function computeDisplayValue(raw: string, full: boolean): string {
    let working = raw;
    if (!full && raw.length > LARGE_RESPONSE_THRESHOLD) {
      working = raw.slice(0, TRUNCATED_PREVIEW_SIZE);
    }
    if (language === 'json') {
      try {
        if (working && working.trim()) {
          const parsed = JSON.parse(full ? raw : working);
          return JSON.stringify(parsed, null, 2);
        }
      } catch {
        // Truncated JSON won't parse — show raw
      }
    }
    return working;
  }

  function showFullResponse() {
    loadingFull = true;
    requestAnimationFrame(() => {
      showingFull = true;
      loadingFull = false;
    });
  }

  export function getMatchCount(): number {
    if (!view || !searchQuery) return 0;
    const query = new SearchQuery({ search: searchQuery, caseSensitive: false });
    const cursor = query.getCursor(view.state.doc);
    let count = 0;
    while (!cursor.next().done) count++;
    return count;
  }

  export function goToNext() {
    if (!view) return;
    findNext(view);
  }

  export function goToPrevious() {
    if (!view) return;
    findPrevious(view);
  }

  $: if (view && searchQuery !== undefined) {
    const q = searchQuery
      ? new SearchQuery({ search: searchQuery, caseSensitive: false })
      : new SearchQuery({ search: '' });
    view.dispatch({ effects: setSearchQuery.of(q) });
  }
  
  onMount(() => {
    const extensions = [
      basicSetup,
      search({ top: false, literal: true }),
      EditorView.editable.of(false),
      oneDark,
      EditorView.theme({
        '&': {
          fontSize: '13px',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          backgroundColor: '#282c34',
          height: '100%',
        },
        '.cm-scroller': {
          fontFamily: 'Consolas, Monaco, Courier New, monospace',
          lineHeight: '1.6',
          height: '100%',
          overflow: 'auto',
        },
        '.cm-gutters': {
          backgroundColor: '#21252b',
          color: '#5c6370',
          border: 'none',
        },
        '.cm-content': {
          caretColor: 'transparent',
        },
        '.cm-searchMatch': {
          backgroundColor: 'rgba(240, 177, 50, 0.3) !important',
          borderRadius: '2px',
        },
        '.cm-searchMatch-selected': {
          backgroundColor: 'rgba(88, 101, 242, 0.5) !important',
        },
        // Hide CodeMirror's built-in search panel — we use our own
        '.cm-search.cm-panel': {
          display: 'none !important',
        },
      }),
    ];
    
    if (language === 'json') {
      extensions.splice(1, 0, json());
    }
    
    if (wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }
    
    const startState = EditorState.create({
      doc: displayValue,
      extensions,
    });
    
    view = new EditorView({
      state: startState,
      parent: editorDiv,
    });
  });
  
  onDestroy(() => {
    if (view) {
      view.destroy();
    }
  });

  $: if (view) {
    const newDoc = displayValue;
    if (newDoc !== view.state.doc.toString()) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: newDoc,
        },
      });
    }
  }

  $: if (!isLarge) {
    showingFull = false;
  }
</script>

{#if isLarge && !showingFull}
  <div class="large-response-banner">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
      <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/>
    </svg>
    <span>
      Large response ({formatBytes(value.length)}) — showing first {formatBytes(TRUNCATED_PREVIEW_SIZE)}
    </span>
    <button class="show-full-btn" on:click={showFullResponse} disabled={loadingFull}>
      {loadingFull ? 'Loading...' : 'Show full response'}
    </button>
  </div>
{/if}
<div bind:this={editorDiv} class="response-viewer-container"></div>

<style>
  .response-viewer-container {
    width: 100%;
    height: 100%;
    min-height: 300px;
    flex: 1;
  }
  
  :global(.response-viewer-container .cm-editor) {
    height: 100%;
  }
  
  :global(.response-viewer-container .cm-scroller) {
    min-height: 300px;
  }

  .large-response-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(240, 177, 50, 0.1);
    border-bottom: 1px solid rgba(240, 177, 50, 0.2);
    color: #f0b132;
    font-size: 12px;
    flex-shrink: 0;
  }

  .show-full-btn {
    margin-left: auto;
    padding: 3px 10px;
    background: rgba(240, 177, 50, 0.15);
    color: #f0b132;
    border: 1px solid rgba(240, 177, 50, 0.3);
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .show-full-btn:hover:not(:disabled) {
    background: rgba(240, 177, 50, 0.25);
  }

  .show-full-btn:disabled {
    opacity: 0.6;
    cursor: wait;
  }
</style>
