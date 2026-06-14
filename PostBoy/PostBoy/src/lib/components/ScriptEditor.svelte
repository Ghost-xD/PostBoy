<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { settings } from '$lib/stores/settingsStore';

  // Disable Monaco workers to avoid 404 errors
  if (typeof window !== 'undefined') {
    (window as any).MonacoEnvironment = {
      getWorker: () => {
        return new Worker(
          URL.createObjectURL(
            new Blob([''], { type: 'application/javascript' })
          )
        );
      }
    };
  }

  interface Props {
    value?: string;
    placeholder?: string;
    minHeight?: string;
    oninput?: (value: string) => void;
  }

  let {
    value = '',
    placeholder: placeholderText = '',
    minHeight = '280px',
    oninput,
  }: Props = $props();

  let editorDiv: HTMLDivElement | undefined = $state();
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let lastExternalValue = $state('');

  function destroyEditor() {
    if (editor) {
      editor.dispose();
      editor = undefined;
    }
  }

  function createEditor(theme: 'dark' | 'light') {
    if (!editorDiv || !monaco) return;

    // Create custom dark theme with black background
    if (theme === 'dark') {
      monaco.editor.defineTheme('black-theme', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: 'C586C0' },
          { token: 'string', foreground: 'CE9178' },
          { token: 'number', foreground: 'B5CEA8' },
          { token: 'comment', foreground: '6A9955' },
          { token: 'identifier', foreground: '9CDCFE' },
          { token: 'type', foreground: '4EC9B0' },
        ],
        colors: {
          'editor.background': '#000000',
          'editor.foreground': '#D4D4D4',
          'editorLineNumber.foreground': '#858585',
          'editorLineNumber.activeForeground': '#C6C6C6',
          'editor.selectionBackground': '#264F78',
          'editorCursor.foreground': '#AEAFAD',
        }
      });
      monaco.editor.setTheme('black-theme');
    } else {
      monaco.editor.setTheme('vs');
    }

    // Create the editor
    editor = monaco.editor.create(editorDiv, {
      value,
      language: 'javascript',
      theme: theme === 'dark' ? 'black-theme' : 'vs',
      minimap: { enabled: false },
      lineNumbers: 'on',
      wordWrap: 'on',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      scrollBeyondLastLine: false,
      renderWhitespace: 'none',
      tabSize: 2,
      insertSpaces: true,
      folding: true,
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'on',
      placeholder: placeholderText,
    });

    lastExternalValue = value;

    // Listen for content changes
    editor.onDidChangeModelContent(() => {
      const newValue = editor?.getValue() || '';
      lastExternalValue = newValue;
      oninput?.(newValue);
    });

    // Debug: expose editor instance
    if (typeof window !== 'undefined') {
      (window as any).debugEditor = editor;
    }
  }

  // React to theme changes
  $effect(() => {
    const theme = $settings.theme;
    if (!editorDiv) return;
    
    if (editor && monaco) {
      // Update theme if editor exists
      if (theme === 'dark') {
        monaco.editor.defineTheme('black-theme', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'keyword', foreground: 'C586C0' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'number', foreground: 'B5CEA8' },
            { token: 'comment', foreground: '6A9955' },
            { token: 'identifier', foreground: '9CDCFE' },
            { token: 'type', foreground: '4EC9B0' },
          ],
          colors: {
            'editor.background': '#000000',
            'editor.foreground': '#D4D4D4',
            'editorLineNumber.foreground': '#858585',
            'editorLineNumber.activeForeground': '#C6C6C6',
            'editor.selectionBackground': '#264F78',
            'editorCursor.foreground': '#AEAFAD',
          }
        });
        monaco.editor.setTheme('black-theme');
      } else {
        monaco.editor.setTheme('vs');
      }
    } else {
      // Create editor if it doesn't exist
      createEditor(theme);
    }

    return () => destroyEditor();
  });

  // React to external value changes
  $effect(() => {
    if (editor && value !== lastExternalValue) {
      lastExternalValue = value;
      editor.setValue(value);
    }
  });

  onDestroy(() => destroyEditor());
</script>

<div bind:this={editorDiv} class="script-editor-container" style:--script-editor-min-height={minHeight}></div>

<style>
  .script-editor-container {
    width: 100%;
    min-height: var(--script-editor-min-height, 280px);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }
</style>