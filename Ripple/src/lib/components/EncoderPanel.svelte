<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount, onDestroy } from 'svelte';
  import { encodeBase64, decodeBase64, encodeUrlString, decodeUrlString } from '$lib/utils/encodingUtils';

  type Mode = 'base64' | 'url';
  type Direction = 'encode' | 'decode';

  let mode: Mode = $state('base64');
  let direction: Direction = $state('encode');
  let input = $state('');
  let output = $state('');
  let error = $state('');
  let copied = $state(false);

  function handlePanelKeydown(e: KeyboardEvent) {
    // Ctrl/Cmd+D — toggle encode/decode direction
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'd') {
      e.preventDefault();
      direction = direction === 'encode' ? 'decode' : 'encode';
      return;
    }
    // Ctrl/Cmd+M — toggle Base64/URL mode
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'm') {
      e.preventDefault();
      mode = mode === 'base64' ? 'url' : 'base64';
      return;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handlePanelKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handlePanelKeydown);
  });

  run(() => {
    error = '';
    if (!input) {
      output = '';
    } else {
      try {
        if (mode === 'base64') {
          output = direction === 'encode' ? encodeBase64(input) : decodeBase64(input);
        } else {
          output = direction === 'encode' ? encodeUrlString(input) : decodeUrlString(input);
        }
      } catch (e: any) {
        output = '';
        error = e.message || 'Invalid input';
      }
    }
  });

  function swap() {
    const temp = input;
    input = output;
    output = temp;
    direction = direction === 'encode' ? 'decode' : 'encode';
  }

  function clear() {
    input = '';
    output = '';
    error = '';
  }

  function copyOutput() {
    if (output) {
      navigator.clipboard.writeText(output);
      copied = true;
      setTimeout(() => copied = false, 1500);
    }
  }
</script>

<div class="encoder-panel">
  <div class="encoder-toolbar">
    <div class="mode-tabs">
      <button class="mode-tab" class:active={mode === 'base64'} onclick={() => mode = 'base64'}>Base64</button>
      <button class="mode-tab" class:active={mode === 'url'} onclick={() => mode = 'url'}>URL</button>
    </div>
    <div class="direction-toggle">
      <button class="dir-btn" class:active={direction === 'encode'} onclick={() => direction = 'encode'}>Encode</button>
      <button class="dir-btn" class:active={direction === 'decode'} onclick={() => direction = 'decode'}>Decode</button>
    </div>
  </div>

  <div class="encoder-body">
    <div class="encoder-pane">
      <div class="pane-header">
        <span class="pane-label">Input</span>
        <button class="pane-action" onclick={clear}>Clear</button>
      </div>
      <textarea
        bind:value={input}
        placeholder={direction === 'encode'
          ? (mode === 'base64' ? 'Plain text to encode...' : 'URL string to encode...')
          : (mode === 'base64' ? 'Base64 string to decode...' : 'URL-encoded string to decode...')}
        spellcheck="false"
      ></textarea>
    </div>

    <div class="swap-row">
      <button class="swap-btn" onclick={swap} title="Swap input and output">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.22 14.78a.75.75 0 0 0 1.06-1.06L4.56 12h8.69a.75.75 0 0 0 0-1.5H4.56l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3a.75.75 0 0 0 0 1.06l3 3ZM10.78 1.22a.75.75 0 0 0-1.06 1.06L11.44 4H2.75a.75.75 0 0 0 0 1.5h8.69l-1.72 1.72a.75.75 0 1 0 1.06 1.06l3-3a.75.75 0 0 0 0-1.06l-3-3Z"/></svg>
      </button>
    </div>

    <div class="encoder-pane">
      <div class="pane-header">
        <span class="pane-label">Output</span>
        {#if output}
          <span class="output-size">{output.length} chars</span>
        {/if}
        <button class="pane-action" onclick={copyOutput} disabled={!output}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {#if error}
        <div class="error-output">{error}</div>
      {:else}
        <textarea value={output} readonly placeholder="Output will appear here..." spellcheck="false"></textarea>
      {/if}
    </div>
  </div>
</div>

<style>
  .encoder-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    padding: 16px;
    gap: 12px;
  }

  .encoder-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .mode-tabs {
    display: flex;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: hidden;
  }

  .mode-tab {
    padding: 6px 16px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .mode-tab.active {
    background: var(--accent-color);
    color: white;
  }

  .mode-tab:hover:not(.active) {
    background: var(--bg-tertiary);
  }

  .direction-toggle {
    display: flex;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: hidden;
  }

  .dir-btn {
    padding: 6px 14px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .dir-btn.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .dir-btn:hover:not(.active) {
    color: var(--text-primary);
  }

  .encoder-body {
    display: flex;
    flex-direction: column;
    gap: 0;
    flex: 1;
    min-height: 0;
  }

  .encoder-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 120px;
  }

  .pane-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
  }

  .pane-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }

  .output-size {
    font-size: 11px;
    color: var(--text-secondary);
    opacity: 0.6;
  }

  .pane-action {
    margin-left: auto;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .pane-action:hover:not(:disabled) { background: var(--bg-tertiary); color: var(--text-primary); }
  .pane-action:disabled { opacity: 0.3; cursor: not-allowed; }

  textarea {
    flex: 1;
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    resize: none;
    outline: none;
    box-sizing: border-box;
    min-height: 80px;
  }

  textarea:focus { border-color: var(--accent-color); }
  textarea[readonly] { color: #e8c479; }

  .swap-row {
    display: flex;
    justify-content: center;
    padding: 6px 0;
  }

  .swap-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 50%;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .swap-btn:hover {
    background: var(--bg-tertiary);
    color: var(--accent-color);
    border-color: var(--accent-color);
  }

  .error-output {
    flex: 1;
    padding: 10px 12px;
    background: rgba(240, 71, 71, 0.06);
    border: 1px solid rgba(240, 71, 71, 0.2);
    border-radius: 6px;
    color: #f04747;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }
</style>
