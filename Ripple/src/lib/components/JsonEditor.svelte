<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import * as monaco from 'monaco-editor';
  import { settings } from '$lib/stores/settingsStore';
  import { registerMonacoThemes, monacoThemeName } from '$lib/utils/monacoTheme';
  import { variables, getResolvedVariables, variablesRev, type Variable } from '$lib/stores/variableStore';
  import { environmentsRev } from '$lib/stores/environmentStore';
  import {
    getVariableContext,
    filterVariableSuggestions,
    maskVariableValue,
    applyVariableSelection,
  } from '$lib/utils/variableAutocomplete';
  import {
    getCompleteVariableTokenAt,
    resolveVariableValue,
  } from '$lib/utils/variableHoverPreview';
  import {
    showSensitiveValuePopover,
    scheduleHideSensitiveValuePopover,
    hideSensitiveValuePopover,
  } from '$lib/utils/sensitiveValuePopoverHost';
  import {
    formatJsonBody,
    unmaskSensitiveJsonText,
    findSensitiveJsonMatches,
    findSensitiveMatchAtPos,
    maskSecret,
    defaultMaskedSecretResolver,
    type SensitiveJsonMatch,
  } from '$lib/utils/sensitiveData';

  registerMonacoThemes();

  // Don't auto-close `{` inside JSON strings — avoids `{{` becoming `{{}}` before autocomplete.
  monaco.languages.setLanguageConfiguration('json', {
    autoClosingPairs: [
      { open: '{', close: '}', notIn: ['string'] },
      { open: '[', close: ']', notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
  });

  if (typeof window !== 'undefined') {
    (window as any).MonacoEnvironment = {
      getWorker: () =>
        new Worker(URL.createObjectURL(new Blob([''], { type: 'application/javascript' }))),
    };
  }

  interface Props {
    value?: string;
    wordWrap?: boolean;
    placeholder?: string;
    collectionId?: number | null;
  }

  let {
    value = $bindable(''),
    wordWrap = true,
    placeholder = '',
    collectionId = null,
  }: Props = $props();

  let editorDiv: HTMLDivElement | undefined = $state();
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let model: monaco.editor.ITextModel | undefined;
  let currentCollectionId: number | null = null;
  let variablesRevTick = $state(0);

  let showVarSuggestions = $state(false);
  let varSuggestions: Variable[] = $state([]);
  let varSuggestionIndex = $state(-1);
  let activeVarContext = $state<ReturnType<typeof getVariableContext>>(null);
  let suggestLeft = $state(0);
  let suggestTop = $state(0);

  let secretsByKey = new Map<string, string>();
  let sensitiveMatches: SensitiveJsonMatch[] = [];
  let revealedSecrets = new Set<string>();
  let revealTimeout: ReturnType<typeof setTimeout> | null = null;
  let decorationIds: string[] = [];
  let lastExternalValue = '';
  // Guards reentrancy: programmatic edits shouldn't be treated as user input.
  let applyingEdit = false;

  $effect(() => {
    currentCollectionId = collectionId ?? null;
    if (currentCollectionId) void variables.load(currentCollectionId);
  });

  onMount(() => {
    const unsubVars = variablesRev.subscribe(() => {
      variablesRevTick++;
    });
    const unsubEnv = environmentsRev.subscribe(() => {
      variablesRevTick++;
    });
    return () => {
      unsubVars();
      unsubEnv();
    };
  });

  function resolvedVariables(): Variable[] {
    variablesRevTick;
    get(environmentsRev);
    return getResolvedVariables(currentCollectionId ?? undefined);
  }

  function positionSuggestList() {
    if (!editor || !editorDiv) return;
    const pos = editor.getPosition();
    if (!pos) return;
    const coords = editor.getScrolledVisiblePosition(pos);
    if (!coords) return;
    suggestLeft = coords.left;
    suggestTop = coords.top + coords.height + 4;
  }

  function updateVariableSuggestions() {
    if (!editor || !model) {
      showVarSuggestions = false;
      return;
    }

    const pos = editor.getPosition();
    if (!pos) return;

    const offset = model.getOffsetAt(pos);
    const ctx = getVariableContext(model.getValue(), offset);
    activeVarContext = ctx;

    if (!ctx) {
      showVarSuggestions = false;
      varSuggestions = [];
      varSuggestionIndex = -1;
      return;
    }

    const vars = resolvedVariables();
    if (vars.length === 0) {
      showVarSuggestions = false;
      varSuggestions = [];
      varSuggestionIndex = -1;
      return;
    }

    varSuggestions = filterVariableSuggestions(vars, ctx.query);
    showVarSuggestions = varSuggestions.length > 0;
    varSuggestionIndex = showVarSuggestions ? 0 : -1;
    if (showVarSuggestions) positionSuggestList();
  }

  async function pickVariableSuggestion(variable: Variable) {
    if (!editor || !model || !activeVarContext) return;

    const { text: unmasked } = unmaskSensitiveJsonText(model.getValue(), secretsByKey);
    const { value: nextValue, cursor } = applyVariableSelection(
      unmasked,
      activeVarContext,
      variable.key
    );

    value = nextValue;
    lastExternalValue = nextValue;
    setDocText(prepareDisplayDoc(nextValue));
    showVarSuggestions = false;
    varSuggestions = [];
    varSuggestionIndex = -1;
    activeVarContext = null;

    const nextPos = model.getPositionAt(cursor);
    editor.setPosition(nextPos);
    editor.focus();
  }

  function handleSuggestKeyDown(e: monaco.IKeyboardEvent) {
    if (!showVarSuggestions || varSuggestions.length === 0) return;

    if (e.keyCode === monaco.KeyCode.DownArrow) {
      e.preventDefault();
      e.stopPropagation();
      varSuggestionIndex = (varSuggestionIndex + 1) % varSuggestions.length;
      return;
    }
    if (e.keyCode === monaco.KeyCode.UpArrow) {
      e.preventDefault();
      e.stopPropagation();
      varSuggestionIndex =
        varSuggestionIndex <= 0 ? varSuggestions.length - 1 : varSuggestionIndex - 1;
      return;
    }
    if (
      (e.keyCode === monaco.KeyCode.Enter || e.keyCode === monaco.KeyCode.Tab) &&
      varSuggestionIndex >= 0
    ) {
      e.preventDefault();
      e.stopPropagation();
      void pickVariableSuggestion(varSuggestions[varSuggestionIndex]);
      return;
    }
    if (e.keyCode === monaco.KeyCode.Escape) {
      e.preventDefault();
      e.stopPropagation();
      showVarSuggestions = false;
      varSuggestionIndex = -1;
    }
  }

  function handleEditorMouseMove(e: monaco.editor.IEditorMouseEvent) {
    if (!model) {
      scheduleHideSensitiveValuePopover();
      return;
    }
    if (!e.target.position) {
      scheduleHideSensitiveValuePopover();
      return;
    }

    const offset = model.getOffsetAt(e.target.position);
    const mouseEvent = e.event.browserEvent;
    let bottom = mouseEvent.clientY + 12;

    try {
      const coords = editor!.getScrolledVisiblePosition(e.target.position);
      const editorDom = editor!.getDomNode()?.getBoundingClientRect();
      if (coords && editorDom) {
        bottom = editorDom.top + coords.top + coords.height;
      }
    } catch {
      /* use fallback */
    }

    const token = getCompleteVariableTokenAt(model.getValue(), offset);
    if (token) {
      const resolved = resolveVariableValue(token.name, resolvedVariables());
      showSensitiveValuePopover(
        { left: mouseEvent.clientX, bottom },
        `{{${token.name}}}`,
        resolved ?? '',
        { unresolved: resolved === null, showReveal: resolved !== null }
      );
      return;
    }

    const match = findSensitiveMatchAtPos(sensitiveMatches, offset);
    if (!match) {
      scheduleHideSensitiveValuePopover();
      return;
    }

    const secret = defaultMaskedSecretResolver(match, secretsByKey);
    if (!secret) {
      scheduleHideSensitiveValuePopover();
      return;
    }

    showSensitiveValuePopover(
      { left: mouseEvent.clientX, bottom },
      `"${match.key}"`,
      secret
    );
  }

  function syncSensitiveMatches(doc: string) {
    sensitiveMatches = findSensitiveJsonMatches(doc);
  }

  function maskSensitiveJsonTextSelective(
    text: string,
    revealedKeys: Set<string>
  ): { text: string; matches: SensitiveJsonMatch[] } {
    const matches = findSensitiveJsonMatches(text);
    if (matches.length === 0) return { text, matches };

    let masked = text;
    for (let i = matches.length - 1; i >= 0; i--) {
      const item = matches[i];
      if (revealedKeys.has(item.key)) continue;
      const inner = maskSecret(item.value);
      masked = masked.slice(0, item.valueFrom) + `"${inner}"` + masked.slice(item.valueTo);
    }
    return { text: masked, matches };
  }

  function prepareDisplayDoc(raw: string): string {
    const formatted = formatJsonBody(raw);
    const { text, matches } = maskSensitiveJsonTextSelective(formatted, revealedSecrets);
    secretsByKey = new Map(matches.map((item) => [item.key, item.value]));
    syncSensitiveMatches(text);
    return text;
  }

  /** Replace the whole document without firing the user-input path. */
  function setDocText(text: string) {
    if (!editor || !model) return;
    applyingEdit = true;
    const fullRange = model.getFullModelRange();
    editor.executeEdits('json-editor', [{ range: fullRange, text, forceMoveMarkers: true }]);
    model.pushStackElement();
    applyingEdit = false;
    refreshDecorations();
  }

  function refreshDecorations() {
    if (!editor || !model) return;
    const newDecorations: monaco.editor.IModelDeltaDecoration[] = sensitiveMatches.map((m) => {
      const start = model!.getPositionAt(m.valueFrom);
      const end = model!.getPositionAt(m.valueTo);
      const revealed = revealedSecrets.has(m.key);
      return {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          inlineClassName: revealed ? 'revealed-secret' : 'masked-secret',
        },
      };
    });
    decorationIds = editor.deltaDecorations(decorationIds, newDecorations);
  }

  function toggleSecretReveal(key: string) {
    if (revealedSecrets.has(key)) {
      revealedSecrets.delete(key);
    } else {
      revealedSecrets.add(key);
      if (revealTimeout) clearTimeout(revealTimeout);
      revealTimeout = setTimeout(() => {
        revealedSecrets.delete(key);
        setDocText(prepareDisplayDoc(value));
      }, 10000);
    }
    setDocText(prepareDisplayDoc(value));
  }

  function destroyEditor() {
    hideSensitiveValuePopover();
    showVarSuggestions = false;
    if (editor) {
      editor.dispose();
      editor = undefined;
    }
    model = undefined;
  }

  function createEditor(theme: 'dark' | 'light') {
    if (!editorDiv || !monaco) return;

    const displayDoc = prepareDisplayDoc(value);

    editor = monaco.editor.create(editorDiv, {
      value: displayDoc,
      language: 'json',
      theme: monacoThemeName(theme),
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
      folding: true,
      autoClosingBrackets: 'languageDefined',
      autoClosingQuotes: 'always',
      placeholder,
    });
    model = editor.getModel() ?? undefined;
    lastExternalValue = value;

    syncSensitiveMatches(displayDoc);
    refreshDecorations();

    // User edits: unmask -> update bound value.
    editor.onDidChangeModelContent(() => {
      if (applyingEdit || !model) return;
      const docText = model.getValue();
      const { text: unmasked, secretsByKey: nextSecrets } = unmaskSensitiveJsonText(
        docText,
        secretsByKey
      );
      secretsByKey = nextSecrets;
      syncSensitiveMatches(docText);
      refreshDecorations();
      value = unmasked;
      updateVariableSuggestions();
    });

    editor.onDidChangeCursorPosition(() => {
      updateVariableSuggestions();
    });

    editor.onKeyDown(handleSuggestKeyDown);

    editor.onMouseMove(handleEditorMouseMove);

    editor.onMouseLeave(() => {
      scheduleHideSensitiveValuePopover();
    });

    // Click a masked value to toggle reveal.
    editor.onMouseDown((e) => {
      if (!model || !e.target.position) return;
      const offset = model.getOffsetAt(e.target.position);
      const match = findSensitiveMatchAtPos(sensitiveMatches, offset);
      if (match) {
        toggleSecretReveal(match.key);
      }
    });

    // Re-mask on blur.
    editor.onDidBlurEditorText(() => {
      hideSensitiveValuePopover();
      showVarSuggestions = false;
      if (!model) return;
      const { text: unmasked, secretsByKey: nextSecrets } = unmaskSensitiveJsonText(
        model.getValue(),
        secretsByKey
      );
      secretsByKey = nextSecrets;
      const { text: masked } = maskSensitiveJsonTextSelective(unmasked, revealedSecrets);
      syncSensitiveMatches(masked);
      if (masked !== model.getValue()) setDocText(masked);
      else refreshDecorations();
    });

    // Auto-format + mask on paste.
    editor.onDidPaste(() => {
      if (!model) return;
      const docText = model.getValue();
      try {
        const parsed = JSON.parse(docText);
        const formatted = JSON.stringify(parsed, null, 2);
        revealedSecrets.clear();
        const { text: masked, matches } = maskSensitiveJsonTextSelective(formatted, new Set());
        secretsByKey = new Map(matches.map((item) => [item.key, item.value]));
        syncSensitiveMatches(masked);
        value = formatted;
        if (masked !== docText) setDocText(masked);
      } catch {
        /* not valid JSON, leave as-is */
      }
    });

    // Copy/cut unmasked text via the DOM (Monaco doesn't expose copy events).
    const domNode = editor.getDomNode();
    domNode?.addEventListener('copy', handleClipboard);
    domNode?.addEventListener('cut', handleClipboard);
  }

  function handleClipboard(event: ClipboardEvent) {
    if (!editor || !model) return;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return;

    const from = model.getOffsetAt(selection.getStartPosition());
    const to = model.getOffsetAt(selection.getEndPosition());
    const displayText = model.getValue().slice(from, to);
    const { text: unmasked } = unmaskSensitiveJsonText(displayText, secretsByKey);

    if (unmasked !== displayText) {
      event.clipboardData?.setData('text/plain', unmasked);
      event.preventDefault();
      if (event.type === 'cut') {
        applyingEdit = true;
        editor.executeEdits('json-editor', [{ range: selection, text: '' }]);
        applyingEdit = false;
      }
    }
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
    if (wordWrap !== undefined && editor) {
      editor.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' });
    }
  });

  // External value changes only (tab switch, programmatic set) — not keystrokes.
  $effect(() => {
    const current = value;
    if (!editor || !model) return;
    if (current === lastExternalValue) return;

    const { text: unmasked } = unmaskSensitiveJsonText(
      untrack(() => model!.getValue()),
      secretsByKey
    );
    if (current === unmasked) {
      lastExternalValue = current;
      return;
    }

    lastExternalValue = current;
    revealedSecrets.clear();
    setDocText(prepareDisplayDoc(current));
  });

  onDestroy(() => {
    const domNode = editor?.getDomNode();
    domNode?.removeEventListener('copy', handleClipboard);
    domNode?.removeEventListener('cut', handleClipboard);
    destroyEditor();
    hideSensitiveValuePopover();
    if (revealTimeout) clearTimeout(revealTimeout);
  });
</script>

<div class="json-editor-wrap">
  <div bind:this={editorDiv} class="json-editor-container"></div>

  {#if showVarSuggestions && varSuggestions.length > 0}
    <ul
      class="var-suggestions"
      style:left="{suggestLeft}px"
      style:top="{suggestTop}px"
      role="listbox"
      aria-label="Variables"
    >
      {#each varSuggestions as variable, i (variable.key)}
        <li
          role="option"
          aria-selected={varSuggestionIndex === i}
          class:active={varSuggestionIndex === i}
          onmousedown={(e) => {
            e.preventDefault();
            void pickVariableSuggestion(variable);
          }}
          onmouseenter={() => (varSuggestionIndex = i)}
        >
          <span class="var-suggestion-key">{'{{' + variable.key + '}}'}</span>
          <span class="var-suggestion-value">{maskVariableValue(variable.value)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .json-editor-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 300px;
  }

  .json-editor-container {
    width: 100%;
    height: 100%;
    min-height: 300px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }

  .var-suggestions {
    position: absolute;
    z-index: 20;
    min-width: 220px;
    max-width: min(420px, 90vw);
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    max-height: 240px;
    overflow-y: auto;
  }

  .var-suggestions li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
  }

  .var-suggestions li:hover,
  .var-suggestions li.active {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  }

  .var-suggestion-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--accent-color, #58a6ff);
  }

  .var-suggestion-value {
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }

  :global(.json-editor-container .monaco-editor),
  :global(.json-editor-container .monaco-editor .margin),
  :global(.json-editor-container .monaco-editor-background) {
    background-color: var(--bg-primary) !important;
  }

  :global(.json-editor-container .revealed-secret) {
    background-color: var(--accent-color-dim, rgba(88, 166, 255, 0.15));
    border-radius: 3px;
    cursor: pointer;
  }

  :global(.json-editor-container .masked-secret) {
    cursor: pointer;
    opacity: 0.8;
  }

  :global(.json-editor-container .masked-secret:hover) {
    opacity: 1;
    background-color: var(--bg-hover, rgba(255, 255, 255, 0.05));
    border-radius: 3px;
  }
</style>
