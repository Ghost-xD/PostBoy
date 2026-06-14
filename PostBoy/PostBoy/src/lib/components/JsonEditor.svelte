<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onDestroy, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { EditorView, basicSetup } from 'codemirror';
  import { json } from '@codemirror/lang-json';
  import { EditorState } from '@codemirror/state';
  import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
  import { settings } from '$lib/stores/settingsStore';
  import { buildJsonEditorShellTheme, codeMirrorSyntaxTheme } from '$lib/utils/codemirrorTheme';
  import { variables, getResolvedVariables } from '$lib/stores/variableStore';
  import { environmentsRev } from '$lib/stores/environmentStore';
  import { filterVariableSuggestions, maskVariableValue } from '$lib/utils/variableAutocomplete';
  import {
    formatJsonBody,
    maskSensitiveJsonText,
    unmaskSensitiveJsonText,
    findSensitiveJsonMatches,
    findSensitiveMatchAtPos,
    maskSecret,
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
  let view: EditorView | undefined;
  let activeCollectionId = $state<number | null>(null);

  let secretsByKey = new Map<string, string>();
  let sensitiveMatches: SensitiveJsonMatch[] = [];
  let revealedSecrets = $state(new Set<string>());
  let revealTimeout: ReturnType<typeof setTimeout> | null = null;

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
    get(environmentsRev);
    const vars = getResolvedVariables(activeCollectionId ?? undefined);
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
    const { text, matches } = maskSensitiveJsonTextSelective(formatted, revealedSecrets);
    secretsByKey = new Map(matches.map((item) => [item.key, item.value]));
    syncSensitiveMatches(text);
    return text;
  }

  function maskSensitiveJsonTextSelective(text: string, revealedKeys: Set<string>): {
    text: string;
    matches: SensitiveJsonMatch[];
  } {
    const matches = findSensitiveJsonMatches(text);
    if (matches.length === 0) return { text, matches };

    let masked = text;
    for (let i = matches.length - 1; i >= 0; i--) {
      const item = matches[i];
      if (revealedKeys.has(item.key)) {
        // Don't mask - keep original value
        continue;
      }
      const inner = maskSecret(item.value);
      masked = masked.slice(0, item.valueFrom) + `"${inner}"` + masked.slice(item.valueTo);
    }

    return { text: masked, matches };
  }

  function toggleSecretReveal(key: string) {
    if (revealedSecrets.has(key)) {
      revealedSecrets.delete(key);
    } else {
      revealedSecrets.add(key);
      // Auto-hide after 10 seconds
      if (revealTimeout) clearTimeout(revealTimeout);
      revealTimeout = setTimeout(() => {
        revealedSecrets.delete(key);
        revealedSecrets = new Set(revealedSecrets);
        if (view) {
          const displayDoc = prepareDisplayDoc(value);
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: displayDoc },
          });
        }
      }, 10000);
    }
    revealedSecrets = new Set(revealedSecrets);
    
    // Update editor display
    if (view) {
      const displayDoc = prepareDisplayDoc(value);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: displayDoc },
      });
    }
  }

  function remaskDisplay(editorView: EditorView) {
    const { text: unmasked, secretsByKey: nextSecrets } = unmaskSensitiveJsonText(
      editorView.state.doc.toString(),
      secretsByKey
    );
    secretsByKey = nextSecrets;
    const { text: masked } = maskSensitiveJsonTextSelective(unmasked, revealedSecrets);
    syncSensitiveMatches(masked);
    if (masked !== editorView.state.doc.toString()) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: masked },
      });
    }
  }

  function destroyEditor() {
    hideSensitiveValuePopover();
    if (view) {
      view.destroy();
      view = undefined;
    }
  }

  function createEditor(theme: 'dark' | 'light') {
    if (!editorDiv) return;

    const displayDoc = prepareDisplayDoc(value);

    const extensions = [
      basicSetup,
      json(),
      codeMirrorSyntaxTheme(theme),
      autocompletion({ override: [variableCompletionSource] }),
      jsonSensitiveValueHoverExtension(() => sensitiveMatches, {
        resolveSecret: (match) => defaultMaskedSecretResolver(match, secretsByKey),
      }),
      EditorView.domEventHandlers({
        click(event, editorView) {
          const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          
          const match = findSensitiveMatchAtPos(sensitiveMatches, pos);
          if (!match) return false;
          
          // Toggle reveal state for this key
          toggleSecretReveal(match.key);
          event.preventDefault();
          return true;
        },
        keydown(event, editorView) {
          // Handle Ctrl+A to select all then Ctrl+C to copy unmasked
          if (event.ctrlKey && event.key === 'a') {
            // Let the default select-all happen, but prepare for copy
            return false;
          }
          return false;
        },
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
        copy(event, editorView) {
          // Copy the unmasked version instead of the masked dots
          const selection = editorView.state.selection.main;
          if (selection.empty) return false; // No selection
          
          let selectedText: string;
          if (selection.from === 0 && selection.to === editorView.state.doc.length) {
            // Full document selected - get unmasked version
            const { text: unmasked } = unmaskSensitiveJsonText(
              editorView.state.doc.toString(),
              secretsByKey
            );
            selectedText = unmasked;
          } else {
            // Partial selection - unmask just the selected portion
            selectedText = editorView.state.doc.sliceString(selection.from, selection.to);
            const { text: unmasked } = unmaskSensitiveJsonText(selectedText, secretsByKey);
            selectedText = unmasked;
          }
          
          const displayText = editorView.state.doc.sliceString(selection.from, selection.to);
          if (selectedText !== displayText) {
            event.clipboardData?.setData('text/plain', selectedText);
            event.preventDefault();
            return true;
          }
          return false;
        },
        cut(event, editorView) {
          // Cut the unmasked version instead of the masked dots
          const selection = editorView.state.selection.main;
          if (selection.empty) return false; // No selection
          
          let selectedText: string;
          if (selection.from === 0 && selection.to === editorView.state.doc.length) {
            // Full document selected - get unmasked version
            const { text: unmasked } = unmaskSensitiveJsonText(
              editorView.state.doc.toString(),
              secretsByKey
            );
            selectedText = unmasked;
          } else {
            // Partial selection - unmask just the selected portion
            selectedText = editorView.state.doc.sliceString(selection.from, selection.to);
            const { text: unmasked } = unmaskSensitiveJsonText(selectedText, secretsByKey);
            selectedText = unmasked;
          }
          
          const displayText = editorView.state.doc.sliceString(selection.from, selection.to);
          if (selectedText !== displayText) {
            event.clipboardData?.setData('text/plain', selectedText);
            editorView.dispatch({
              changes: { from: selection.from, to: selection.to, insert: '' }
            });
            event.preventDefault();
            return true;
          }
          return false;
        },
        paste(event, editorView) {
          const pastedText = event.clipboardData?.getData('text');
          if (pastedText) {
            try {
              const parsed = JSON.parse(pastedText);
              const formatted = JSON.stringify(parsed, null, 2);
              
              // Mask sensitive fields in pasted content
              const { text: masked, matches } = maskSensitiveJsonTextSelective(formatted, new Set());
              secretsByKey = new Map(matches.map((item) => [item.key, item.value]));
              revealedSecrets.clear(); // Clear any revealed state
              syncSensitiveMatches(masked);
              
              editorView.dispatch({
                changes: {
                  from: editorView.state.selection.main.from,
                  to: editorView.state.selection.main.to,
                  insert: masked,
                },
              });
              
              // Update the underlying value with unmasked content
              value = formatted;
              
              event.preventDefault();
              return true;
            } catch {
              // Not valid JSON, let default paste happen
            }
          }
          return false;
        },
      }),
      buildJsonEditorShellTheme(theme),
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
  }

  $effect(() => {
    const theme = $settings.theme;
    if (!editorDiv) return;
    destroyEditor();
    untrack(() => createEditor(theme));
    return () => destroyEditor();
  });

  onDestroy(() => {
    destroyEditor();
    if (revealTimeout) clearTimeout(revealTimeout);
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
      // Clear revealed secrets when value changes externally (e.g., pasted)
      revealedSecrets.clear();
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

  /* Style for revealed secret values */
  :global(.json-editor-container .revealed-secret) {
    background-color: var(--accent-color-dim, rgba(88, 166, 255, 0.15));
    border-radius: 3px;
    padding: 1px 2px;
    cursor: pointer;
  }

  /* Style for masked secret values */
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
