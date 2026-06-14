<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { LARGE_RESPONSE_THRESHOLD, TRUNCATED_PREVIEW_SIZE, formatBytes } from '$lib/utils/responseUtils';
  import { buildFieldModeDocument } from '$lib/utils/jsonRawLines';
  import {
    findSensitiveJsonMatches,
    findSensitiveMatchAtPos,
    isMaskPlaceholder,
    type SensitiveJsonMatch,
  } from '$lib/utils/sensitiveData';
  import {
    showSensitiveValuePopover,
    scheduleHideSensitiveValuePopover,
    hideSensitiveValuePopover,
  } from '$lib/utils/sensitiveValuePopoverHost';
  import { settings } from '$lib/stores/settingsStore';
  import { registerMonacoThemes, monacoThemeName } from '$lib/utils/monacoTheme';

  registerMonacoThemes();

  if (typeof window !== 'undefined') {
    (window as any).MonacoEnvironment = {
      getWorker: () =>
        new Worker(URL.createObjectURL(new Blob([''], { type: 'application/javascript' }))),
    };
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
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let showingFull = $state(false);
  let loadingFull = $state(false);
  let copiesByLine = $state(new Map<number, string>());
  let copyButtonTops = $state(new Map<number, number>());
  let copiedLineNumber = $state<number | null>(null);
  let copiedLineTimeout: ReturnType<typeof setTimeout> | null = null;
  let sensitiveMatches: SensitiveJsonMatch[] = [];
  let previewShortcutCleanup: (() => void) | undefined;

  /** Alt+1–4/G — app preview shortcuts; swallow before Monaco tries to insert macOS alternate chars. */
  const PREVIEW_ALT_CODES = new Set(['KeyG', 'Digit1', 'Digit2', 'Digit3', 'Digit4']);

  function attachPreviewShortcutGuards(domNode: HTMLElement) {
    let swallowNextInput = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (!PREVIEW_ALT_CODES.has(e.code)) return;
      swallowNextInput = true;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const onBeforeInput = (e: Event) => {
      if (!swallowNextInput) return;
      e.preventDefault();
      swallowNextInput = false;
    };

    domNode.addEventListener('keydown', onKeyDown, true);
    domNode.addEventListener('beforeinput', onBeforeInput, true);

    return () => {
      domNode.removeEventListener('keydown', onKeyDown, true);
      domNode.removeEventListener('beforeinput', onBeforeInput, true);
    };
  }

  function swallowPreviewShortcut(e: monaco.IKeyboardEvent) {
    const ev = e.browserEvent;
    if (!ev.altKey || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    if (!PREVIEW_ALT_CODES.has(ev.code)) return;
    ev.preventDefault();
    ev.stopPropagation();
    e.preventDefault();
    e.stopPropagation();
  }

  let copyGutterEntries = $derived.by(() => [...copiesByLine.entries()]);
  let showCopyGutter = $derived(fieldMode && copiesByLine.size > 0);

  function destroyEditor() {
    hideSensitiveValuePopover();
    previewShortcutCleanup?.();
    previewShortcutCleanup = undefined;
    if (copiedLineTimeout) clearTimeout(copiedLineTimeout);
    copiedLineTimeout = null;
    if (editor) {
      editor.dispose();
      editor = undefined;
    }
  }

  function getMonacoLanguage(lang: string): string {
    switch (lang) {
      case 'json':
        return 'json';
      case 'html':
        return 'html';
      case 'xml':
        return 'xml';
      case 'text':
      default:
        return 'plaintext';
    }
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

  function mapsEqual(a: Map<number, string>, b: Map<number, string>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, val] of a) {
      if (b.get(key) !== val) return false;
    }
    return true;
  }

  function numberMapsEqual(a: Map<number, number>, b: Map<number, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, val] of a) {
      if (b.get(key) !== val) return false;
    }
    return true;
  }

  function syncCopiesByLine() {
    let next: Map<number, string>;
    if (fieldMode && language === 'json') {
      try {
        next = buildFieldModeDocument(value).copiesByLine;
      } catch {
        next = new Map();
      }
    } else {
      next = new Map();
    }
    if (!mapsEqual(copiesByLine, next)) {
      copiesByLine = next;
    }
  }

  function updateCopyButtonPositions() {
    if (!editor || !fieldMode || copiesByLine.size === 0) {
      if (copyButtonTops.size > 0) copyButtonTops = new Map();
      return;
    }

    const next = new Map<number, number>();
    copiesByLine.forEach((_copyValue, lineNumber) => {
      const coords = editor!.getScrolledVisiblePosition({ lineNumber, column: 1 });
      if (coords) next.set(lineNumber, coords.top);
    });
    if (!numberMapsEqual(copyButtonTops, next)) {
      copyButtonTops = next;
    }
  }

  async function copyLineValue(lineNumber: number) {
    const copyValue = copiesByLine.get(lineNumber);
    if (!copyValue) return;
    await navigator.clipboard.writeText(copyValue);
    copiedLineNumber = lineNumber;
    if (copiedLineTimeout) clearTimeout(copiedLineTimeout);
    copiedLineTimeout = setTimeout(() => {
      copiedLineNumber = null;
    }, 1200);
  }

  function resolveSensitiveSecret(match: SensitiveJsonMatch): string {
    if (fieldMode && isMaskPlaceholder(match.value)) {
      return copiesByLine.get(match.line) ?? match.value;
    }
    return match.value;
  }

  function isMonacoCanceled(err: unknown): boolean {
    const message =
      typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);
    return message === 'Canceled' || message.includes('Canceled');
  }

  function startFindSearch(query: string) {
    if (!editor) return;
    const findController = editor.getContribution('editor.contrib.findController') as {
      start?: (opts: object) => Promise<void> | void;
      closeFindWidget?: () => void;
    } | null;
    if (!findController) return;

    if (!query) {
      findController.closeFindWidget?.();
      return;
    }

    const start = findController.start;
    if (!start) return;

    try {
      const result = start({
        searchString: query,
        isRegex: false,
        matchCase: false,
        matchWholeWord: false,
      });
      void Promise.resolve(result).catch((err) => {
        if (!isMonacoCanceled(err)) console.error(err);
      });
    } catch (err) {
      if (!isMonacoCanceled(err)) throw err;
    }
  }

  function handleEditorMouseMove(e: monaco.editor.IEditorMouseEvent) {
    if (!editor?.getModel() || !e.target.position) {
      scheduleHideSensitiveValuePopover();
      return;
    }

    const model = editor.getModel()!;
    const offset = model.getOffsetAt(e.target.position);
    const match = findSensitiveMatchAtPos(sensitiveMatches, offset);
    if (!match) {
      scheduleHideSensitiveValuePopover();
      return;
    }

    const secret = resolveSensitiveSecret(match);
    if (!secret) {
      scheduleHideSensitiveValuePopover();
      return;
    }

    const mouseEvent = e.event.browserEvent;
    let bottom = mouseEvent.clientY + 12;
    try {
      const coords = editor.getScrolledVisiblePosition(e.target.position);
      const editorDom = editor.getDomNode()?.getBoundingClientRect();
      if (coords && editorDom) {
        bottom = editorDom.top + coords.top + coords.height;
      }
    } catch {
      /* use fallback */
    }

    showSensitiveValuePopover({ left: mouseEvent.clientX, bottom }, `"${match.key}"`, secret);
  }

  function createEditor(theme: 'dark' | 'light') {
    if (!editorDiv || !monaco) return;

    const doc = computeDisplayValue(value, showingFull);
    syncCopiesByLine();
    sensitiveMatches = findSensitiveJsonMatches(doc);

    editor = monaco.editor.create(editorDiv, {
      value: doc,
      language: getMonacoLanguage(language),
      theme: monacoThemeName(theme),
      readOnly: true,
      minimap: { enabled: false },
      lineNumbers: 'on',
      wordWrap: wordWrap ? 'on' : 'off',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: 'Consolas, Monaco, Courier New, monospace',
      scrollBeyondLastLine: false,
      renderWhitespace: 'none',
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      folding: true,
      foldingStrategy: 'indentation',
      foldingHighlight: true,
      showFoldingControls: 'always',
      unfoldOnClickAfterEndOfLine: true,
      find: {
        autoFindInSelection: 'never',
        seedSearchStringFromSelection: 'never',
      },
      fixedOverflowWidgets: true,
    });

    editor.onDidScrollChange(() => updateCopyButtonPositions());
    editor.onDidLayoutChange(() => updateCopyButtonPositions());
    editor.onMouseMove(handleEditorMouseMove);
    editor.onMouseLeave(() => scheduleHideSensitiveValuePopover());
    editor.onKeyDown(swallowPreviewShortcut);

    const domNode = editor.getDomNode();
    if (domNode) {
      previewShortcutCleanup?.();
      previewShortcutCleanup = attachPreviewShortcutGuards(domNode);
    }

    updateCopyButtonPositions();

    if (searchQuery) {
      startFindSearch(searchQuery);
    }
  }

  function showFullResponse() {
    loadingFull = true;
    requestAnimationFrame(() => {
      showingFull = true;
      loadingFull = false;
    });
  }

  export function getMatchCount(): number {
    if (!editor || !searchQuery) return 0;
    const findController = editor.getContribution('editor.contrib.findController') as any;
    if (findController && findController.getState()?.matchesCount) {
      return findController.getState().matchesCount;
    }
    return 0;
  }

  export function goToNext() {
    if (!editor) return;
    const findController = editor.getContribution('editor.contrib.findController') as any;
    findController?.moveToNextMatch();
  }

  export function goToPrevious() {
    if (!editor) return;
    const findController = editor.getContribution('editor.contrib.findController') as any;
    findController?.moveToPrevMatch();
  }

  $effect(() => {
    const theme = $settings.theme;
    if (!editorDiv) return;
    if (editor && monaco) {
      monaco.editor.setTheme(monacoThemeName(theme));
    } else {
      createEditor(theme);
    }
  });

  $effect(() => {
    if (!editor) return;
    fieldMode;
    language;
    showingFull;
    const newDoc = computeDisplayValue(value, showingFull);
    syncCopiesByLine();
    if (language === 'json') {
      sensitiveMatches = findSensitiveJsonMatches(newDoc);
    }
    if (newDoc !== editor.getValue()) {
      editor.setValue(newDoc);
      if (searchQuery) {
        startFindSearch(searchQuery);
      }
    }
    untrack(() => updateCopyButtonPositions());
  });

  $effect(() => {
    if (!editor || searchQuery === undefined) return;
    startFindSearch(searchQuery);
  });

  $effect(() => {
    if (editor) {
      editor.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' });
    }
  });

  onDestroy(() => destroyEditor());

  let isLarge = $derived(value.length > LARGE_RESPONSE_THRESHOLD);
  $effect(() => {
    if (!isLarge) showingFull = false;
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

<div class="response-viewer-wrap">
  <div bind:this={editorDiv} class="response-viewer-container"></div>
  {#if showCopyGutter}
    <div class="field-copy-overlay" aria-hidden="true">
      {#each copyGutterEntries as [lineNumber] (lineNumber)}
        {@const top = copyButtonTops.get(lineNumber)}
        {#if top !== undefined}
          <button
            type="button"
            class="field-copy-btn"
            class:copied={copiedLineNumber === lineNumber}
            style:top="{top}px"
            title="Copy value"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => void copyLineValue(lineNumber)}
          >
            {copiedLineNumber === lineNumber ? '✓' : '⧉'}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .response-viewer-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 300px;
    flex: 1;
  }

  .response-viewer-container {
    width: 100%;
    height: 100%;
    min-height: 300px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }

  .field-copy-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 2;
  }

  .field-copy-btn {
    position: absolute;
    left: 34px;
    width: 24px;
    height: 18px;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: #7b8398;
    font-size: 12px;
    line-height: 18px;
    cursor: pointer;
    pointer-events: auto;
    border-radius: 3px;
  }

  .field-copy-btn:hover {
    color: #abb2bf;
    background: rgba(255, 255, 255, 0.05);
  }

  .field-copy-btn.copied {
    color: var(--accent-color, #58a6ff);
  }

  :global(.response-viewer-container .monaco-editor),
  :global(.response-viewer-container .monaco-editor .margin),
  :global(.response-viewer-container .monaco-editor-background) {
    background-color: var(--bg-primary) !important;
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
