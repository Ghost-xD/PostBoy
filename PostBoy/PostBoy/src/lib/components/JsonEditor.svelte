<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount, onDestroy } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { json } from '@codemirror/lang-json';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorState } from '@codemirror/state';
  import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
  import { variables } from '$lib/stores/variableStore';
  import { filterVariableSuggestions, maskVariableValue } from '$lib/utils/variableAutocomplete';
  import {
    formatJsonBody,
    maskSensitiveJsonText,
    unmaskSensitiveJsonText,
    findSensitiveJsonMatches,
    type SensitiveJsonMatch,
  } from '$lib/utils/sensitiveData';
  import {
    jsonSensitiveValueHoverExtension,
    defaultMaskedSecretResolver,
    hideSensitiveValuePopover,
  } from '$lib/utils/codemirrorSensitiveJson';

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
  let view: EditorView | undefined = $state();
  let activeCollectionId = $state<number | null>(null);

  let secretsByKey = new Map<string, string>();
  let sensitiveMatches: SensitiveJsonMatch[] = [];

  function syncSensitiveMatches(doc: string) {
    sensitiveMatches = findSensitiveJsonMatches(doc);
  }

  $effect(() => {
    activeCollectionId = collectionId ?? null;
    if (activeCollectionId) void variables.load(activeCollectionId);
  });

  function variableCompletionSource(context: CompletionContext) {
    const match = context.matchBefore(/\{\{[\w.-]*$/);
    if (!match || !activeCollectionId) return null;

    const query = match.text.slice(2);
    const vars = variables.getForCollection(activeCollectionId);
    const filtered = filterVariableSuggestions(vars, query);
    if (filtered.length === 0 && query) return null;

    return {
      from: match.from,
      options: (filtered.length > 0 ? filtered : vars).map((v) => ({
        label: v.key,
        apply: `{{${v.key}}}`,
        detail: maskVariableValue(v.value),
      })),
    };
  }

  function prepareDisplayDoc(raw: string): string {
    const formatted = formatJsonBody(raw);
    const { text, matches } = maskSensitiveJsonText(formatted);
    secretsByKey = new Map(matches.map((item) => [item.key, item.value]));
    syncSensitiveMatches(text);
    return text;
  }

  function remaskDisplay(editorView: EditorView) {
    const { text: unmasked, secretsByKey: nextSecrets } = unmaskSensitiveJsonText(
      editorView.state.doc.toString(),
      secretsByKey
    );
    secretsByKey = nextSecrets;
    const { text: masked } = maskSensitiveJsonText(unmasked);
    syncSensitiveMatches(masked);
    if (masked !== editorView.state.doc.toString()) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: masked },
      });
    }
  }

  onMount(() => {
    const displayDoc = prepareDisplayDoc(value);

    const extensions = [
      basicSetup,
      json(),
      oneDark,
      autocompletion({ override: [variableCompletionSource] }),
      jsonSensitiveValueHoverExtension(() => sensitiveMatches, {
        resolveSecret: (match) => defaultMaskedSecretResolver(match, secretsByKey),
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const { text: unmasked, secretsByKey: nextSecrets } = unmaskSensitiveJsonText(
            update.state.doc.toString(),
            secretsByKey
          );
          secretsByKey = nextSecrets;
          syncSensitiveMatches(update.state.doc.toString());
          value = unmasked;
        }
      }),
      EditorView.domEventHandlers({
        blur(_event, editorView) {
          remaskDisplay(editorView);
          return false;
        },
        paste(event, editorView) {
          const pastedText = event.clipboardData?.getData('text');
          if (pastedText) {
            try {
              const parsed = JSON.parse(pastedText);
              const formatted = JSON.stringify(parsed, null, 2);
              editorView.dispatch({
                changes: {
                  from: editorView.state.selection.main.from,
                  to: editorView.state.selection.main.to,
                  insert: formatted,
                },
              });
              event.preventDefault();
              return true;
            } catch {
              // Not valid JSON, let default paste happen
            }
          }
          return false;
        },
      }),
      EditorView.theme({
        '&': {
          fontSize: '13px',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          backgroundColor: '#000000',
        },
        '.cm-scroller': {
          fontFamily: 'Consolas, Monaco, Courier New, monospace',
          lineHeight: '1.6',
          minHeight: '300px',
          overflow: 'auto',
          backgroundColor: '#000000',
        },
        '.cm-content': {
          caretColor: '#4d8df6',
        },
        '.cm-gutters': {
          backgroundColor: '#000000 !important',
          color: '#5c6370',
          border: 'none',
          borderRight: 'none',
        },
        '.cm-gutter': {
          backgroundColor: '#000000',
        },
        '.cm-lineNumbers .cm-gutterElement': {
          backgroundColor: '#000000',
        },
        '.cm-activeLineGutter': {
          backgroundColor: '#000000',
          color: '#7b8398',
        },
        '.cm-activeLine': {
          backgroundColor: 'transparent',
        },
        '.cm-foldGutter': {
          backgroundColor: '#000000',
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: '#4d8df6',
        },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: '#3584e4 !important',
        },
      }),
    ];

    if (wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }

    const startState = EditorState.create({
      doc: displayDoc,
      extensions,
    });

    view = new EditorView({
      state: startState,
      parent: editorDiv,
    });
  });

  onDestroy(() => {
    hideSensitiveValuePopover();
    if (view) {
      view.destroy();
    }
  });

  let lastExternalValue = $state('');
  run(() => {
    if (view && value !== lastExternalValue) {
      const { text: unmasked } = unmaskSensitiveJsonText(view.state.doc.toString(), secretsByKey);
      if (value === unmasked) {
        lastExternalValue = value;
        return;
      }

      lastExternalValue = value;
      const displayDoc = prepareDisplayDoc(value);
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: displayDoc,
        },
      });
    }
  });
</script>

<div bind:this={editorDiv} class="json-editor-container"></div>

<style>
  .json-editor-container {
    width: 100%;
    height: 100%;
    min-height: 300px;
  }

  :global(.json-editor-container .cm-editor) {
    height: 100%;
  }

  :global(.json-editor-container .cm-content) {
    background-color: transparent !important;
  }

  :global(.json-editor-container .cm-editor.cm-focused .cm-selectionLayer .cm-selectionBackground) {
    background-color: #3584e4 !important;
  }

  :global(.json-editor-container .cm-selectionLayer .cm-selectionBackground) {
    background-color: #264f78 !important;
  }
</style>
