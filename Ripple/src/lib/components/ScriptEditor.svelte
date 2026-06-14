<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { settings } from '$lib/stores/settingsStore';
  import { registerMonacoThemes, monacoThemeName } from '$lib/utils/monacoTheme';

  registerMonacoThemes();

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

    // Create the editor
    editor = monaco.editor.create(editorDiv, {
      value,
      language: 'javascript',
      theme: monacoThemeName(theme),
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
      monaco.editor.setTheme(monacoThemeName(theme));
    } else {
      // Create editor if it doesn't exist
      createEditor(theme);
    }
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

  /* Match the app background; syntax colors come from the shared Monaco theme */
  :global(.script-editor-container .monaco-editor),
  :global(.script-editor-container .monaco-editor .margin),
  :global(.script-editor-container .monaco-editor-background) {
    background-color: var(--bg-primary) !important;
  }
</style>