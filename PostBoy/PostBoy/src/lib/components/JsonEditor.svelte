<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount, onDestroy } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { json } from '@codemirror/lang-json';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorState } from '@codemirror/state';
  
  interface Props {
    value?: string;
    wordWrap?: boolean; // Enable word wrap by default
    placeholder?: string;
  }

  let { value = $bindable(''), wordWrap = true, placeholder = '' }: Props = $props();
  
  let editorDiv: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined = $state();
  
  onMount(() => {
    // Format the initial value if it's JSON
    let initialValue = value;
    try {
      if (value && value.trim()) {
        const parsed = JSON.parse(value);
        initialValue = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Not valid JSON, use as-is
    }
    
    const extensions = [
      basicSetup,
      json(),
      oneDark,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          value = update.state.doc.toString();
        }
      }),
      EditorView.domEventHandlers({
        paste(event, view) {
          const pastedText = event.clipboardData?.getData('text');
          if (pastedText) {
            try {
              const parsed = JSON.parse(pastedText);
              const formatted = JSON.stringify(parsed, null, 2);
              view.dispatch({
                changes: {
                  from: view.state.selection.main.from,
                  to: view.state.selection.main.to,
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
          backgroundColor: '#000000',
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
        '&.cm-focused .cm-selectionBackground, ::selection': {
          backgroundColor: 'rgba(77, 141, 246, 0.25)',
        },
      }),
    ];
    
    // Add line wrapping if enabled
    if (wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }
    
    const startState = EditorState.create({
      doc: initialValue,
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
  
  // Update editor when value changes externally (from CURL parser or collection load)
  let lastExternalValue = $state('');
  run(() => {
    if (view && value !== view.state.doc.toString() && value !== lastExternalValue) {
      lastExternalValue = value;
      
      // Format the value before updating
      let formattedValue = value;
      try {
        if (value && value.trim()) {
          const parsed = JSON.parse(value);
          formattedValue = JSON.stringify(parsed, null, 2);
        }
      } catch {
        // Not valid JSON, use as-is
        formattedValue = value;
      }
      
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: formattedValue,
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
  
  :global(.cm-editor) {
    height: 100%;
  }
</style>
