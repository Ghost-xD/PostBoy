<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onDestroy, untrack } from 'svelte';
  import { EditorView } from 'codemirror';
  import {
    gutter,
    GutterMarker,
    lineNumbers,
    highlightSpecialChars,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    keymap,
  } from '@codemirror/view';
  import { RangeSetBuilder } from '@codemirror/state';
  import { json } from '@codemirror/lang-json';
  import { EditorState } from '@codemirror/state';
  import {
    foldGutter,
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
    foldKeymap,
  } from '@codemirror/language';
  import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
  import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
  import { lintKeymap } from '@codemirror/lint';
  import { SearchQuery, setSearchQuery, findNext, findPrevious, search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { LARGE_RESPONSE_THRESHOLD, TRUNCATED_PREVIEW_SIZE, formatBytes } from '$lib/utils/responseUtils';
  import { buildFieldModeDocument } from '$lib/utils/jsonRawLines';
  import {
    findSensitiveJsonMatches,
    isMaskPlaceholder,
    type SensitiveJsonMatch,
  } from '$lib/utils/sensitiveData';
  import {
    jsonSensitiveValueHoverExtension,
    hideSensitiveValuePopover,
  } from '$lib/utils/codemirrorSensitiveJson';
  import { settings } from '$lib/stores/settingsStore';
  import { buildResponseViewerShellTheme, codeMirrorSyntaxTheme } from '$lib/utils/codemirrorTheme';

  // basicSetup minus highlightActiveLine / highlightActiveLineGutter,
  // which mis-highlight a line in this read-only viewer (no real cursor).
  // Field mode skips highlightSpecialChars — special-char widgets break position mapping.
  function buildReadOnlySetup(fieldMode: boolean) {
    return [
      lineNumbers(),
      ...(fieldMode ? [] : [highlightSpecialChars()]),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
    ];
  }

  interface Props {
    value?: string;
    language?: 'json' | 'text' | 'html' | 'xml';
    wordWrap?: boolean;
    searchQuery?: string;
    /** Adds per-field copy gutter and truncates long values (raw default view). */
    fieldMode?: boolean;
  }

  let {
    value = '',
    language = 'json',
    wordWrap = true,
    searchQuery = '',
    fieldMode = false,
  }: Props = $props();

  let editorDiv: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;
  let showingFull = $state(false);
  let loadingFull = $state(false);
  let copiesByLine = new Map<number, string>();
  let sensitiveMatches: SensitiveJsonMatch[] = [];

  class CopyGutterMarker extends GutterMarker {
    copyValue: string;

    constructor(copyValue: string) {
      super();
      this.copyValue = copyValue;
    }

    toDOM() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cm-field-copy-btn';
      btn.textContent = '⧉';
      btn.title = 'Copy value';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard.writeText(this.copyValue);
        btn.textContent = '✓';
        setTimeout(() => {
          btn.textContent = '⧉';
        }, 1200);
      });
      return btn;
    }
  }

  function copyGutter(copiesByLine: Map<number, string>) {
    return gutter({
      class: 'cm-field-copy-gutter',
      markers(view) {
        const builder = new RangeSetBuilder<GutterMarker>();
        for (let lineNum = 1; lineNum <= view.state.doc.lines; lineNum++) {
          const copyValue = copiesByLine.get(lineNum);
          if (!copyValue) continue;
          const line = view.state.doc.line(lineNum);
          builder.add(line.from, line.from, new CopyGutterMarker(copyValue));
        }
        return builder.finish();
      },
    });
  }

  function computeDisplayValue(raw: string, full: boolean): string {
    let working = raw;
    if (!full && raw.length > LARGE_RESPONSE_THRESHOLD) {
      working = raw.slice(0, TRUNCATED_PREVIEW_SIZE);
    }

    if (fieldMode && language === 'json') {
      try {
        if (working && working.trim()) {
          return buildFieldModeDocument(full ? raw : working).text;
        }
      } catch {
        // fall through to default formatting
      }
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

  function destroyView() {
    hideSensitiveValuePopover();
    if (view) {
      view.destroy();
      view = undefined;
    }
  }

  function createView(theme: 'dark' | 'light') {
    if (!editorDiv) return;

    const doc = computeDisplayValue(value, showingFull);

    if (fieldMode && language === 'json') {
      try {
        copiesByLine = buildFieldModeDocument(value).copiesByLine;
      } catch {
        copiesByLine = new Map();
      }
    }

    sensitiveMatches = findSensitiveJsonMatches(doc);

    const extensions = [
      ...buildReadOnlySetup(fieldMode),
      search({ top: false, literal: true }),
      EditorView.editable.of(false),
      codeMirrorSyntaxTheme(theme),
      buildResponseViewerShellTheme(theme),
    ];

    if (language === 'json') {
      extensions.splice(1, 0, json());
    }

    if (fieldMode && copiesByLine.size > 0) {
      extensions.splice(1, 0, copyGutter(copiesByLine));
    }

    if (language === 'json') {
      extensions.push(
        jsonSensitiveValueHoverExtension(() => sensitiveMatches, {
          resolveSecret: (match) => {
            if (fieldMode && isMaskPlaceholder(match.value)) {
              return copiesByLine.get(match.line) ?? match.value;
            }
            return match.value;
          },
        })
      );
    }

    if (wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }

    const startState = EditorState.create({
      doc,
      extensions,
    });

    view = new EditorView({
      state: startState,
      parent: editorDiv,
    });

    if (searchQuery) {
      const q = new SearchQuery({ search: searchQuery, caseSensitive: false });
      view.dispatch({ effects: setSearchQuery.of(q) });
    }
  }

  $effect(() => {
    const theme = $settings.theme;
    if (!editorDiv) return;
    destroyView();
    untrack(() => createView(theme));
    return () => destroyView();
  });

  onDestroy(() => {
    destroyView();
  });

  let isLarge = $derived(value.length > LARGE_RESPONSE_THRESHOLD);
  run(() => {
    if (!isLarge) {
      showingFull = false;
    }
  });
  let displayValue = $derived(computeDisplayValue(value, showingFull));
  run(() => {
    if (view && searchQuery !== undefined) {
      const q = searchQuery
        ? new SearchQuery({ search: searchQuery, caseSensitive: false })
        : new SearchQuery({ search: '' });
      view.dispatch({ effects: setSearchQuery.of(q) });
    }
  });
  run(() => {
    if (view) {
      const newDoc = displayValue;
      if (fieldMode && language === 'json') {
        try {
          copiesByLine = buildFieldModeDocument(value).copiesByLine;
        } catch {
          copiesByLine = new Map();
        }
      }
      if (language === 'json') {
        sensitiveMatches = findSensitiveJsonMatches(newDoc);
      }
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
  });
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
    <button class="show-full-btn" onclick={showFullResponse} disabled={loadingFull}>
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

  :global(.response-viewer-container .cm-content) {
    background-color: transparent !important;
  }

  :global(.response-viewer-container .cm-editor.cm-focused .cm-selectionLayer .cm-selectionBackground) {
    background-color: #3584e4 !important;
  }

  :global(.response-viewer-container .cm-selectionLayer .cm-selectionBackground) {
    background-color: #264f78 !important;
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
