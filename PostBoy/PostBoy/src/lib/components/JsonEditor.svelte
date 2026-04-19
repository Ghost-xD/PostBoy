<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { json } from '@codemirror/lang-json';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorState } from '@codemirror/state';
  
  export let value = '';
  export let wordWrap = true; // Enable word wrap by default
  export let placeholder = '';
  
  let editorDiv: HTMLDivElement;
  let view: EditorView;
  
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
          backgroundColor: '#282c34',
        },
        '.cm-scroller': {
          fontFamily: 'Consolas, Monaco, Courier New, monospace',
          lineHeight: '1.6',
          minHeight: '300px',
          overflow: 'auto',
        },
        '.cm-gutters': {
          backgroundColor: '#21252b',
          color: '#5c6370',
          border: 'none',
        },
        '.cm-activeLineGutter': {
          backgroundColor: '#2c313c',
        },
        '.cm-activeLine': {
          backgroundColor: '#2c313c',
        },
        '.cm-content': {
          caretColor: '#528bff',
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: '#528bff',
        },
        '&.cm-focused .cm-selectionBackground, ::selection': {
          backgroundColor: '#3e4451',
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
  let lastExternalValue = '';
  $: if (view && value !== view.state.doc.toString() && value !== lastExternalValue) {
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
</script>

<div bind:this={editorDiv} class="json-editor-container" />

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
