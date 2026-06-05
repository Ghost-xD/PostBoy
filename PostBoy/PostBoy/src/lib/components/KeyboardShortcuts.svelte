<script lang="ts">
  import { run, createBubbler, stopPropagation } from 'svelte/legacy';
  import { settings } from '$lib/stores/settingsStore';
  import { chatbotSupported } from '$lib/stores/chatbotStore';

  const bubble = createBubbler();
  interface Props {
    show?: boolean;
  }

  let { show = $bindable(false) }: Props = $props();
  let searchQuery = $state('');
  let searchInput: HTMLInputElement | undefined = $state();

  interface ShortcutItem { keys: string; label: string; sub?: boolean; }
  interface ShortcutSection { title: string; items: ShortcutItem[]; }

  const sections: ShortcutSection[] = [
    { title: 'Actions', items: [
      { keys: 'Enter', label: 'Send request (in URL field)' },
      { keys: 'Ctrl + Enter', label: 'Send request (anywhere)' },
      { keys: 'Ctrl + S', label: 'Save request' },
      { keys: 'Ctrl + M', label: 'Open request method dropdown' },
    ]},
    { title: 'Navigation', items: [
      { keys: 'Ctrl + T', label: 'New tab' },
      { keys: 'Ctrl + W', label: 'Close current tab' },
      { keys: 'Ctrl + Tab', label: 'Next tab' },
      { keys: 'Ctrl + Shift + Tab', label: 'Previous tab' },
      { keys: 'Ctrl + I', label: 'Focus & select URL input' },
      { keys: 'Ctrl + H', label: 'Headers tab' },
      { keys: 'Ctrl + D', label: 'Docs tab' },
      { keys: 'Ctrl + Shift + D', label: 'Toggle Docs edit / preview' },
      { keys: 'Ctrl + B', label: 'Body tab' },
      { keys: 'Ctrl + P', label: 'Params tab' },
      { keys: 'Ctrl + Shift + A', label: 'Auth tab' },
      { keys: 'Ctrl + Shift + C', label: 'Collections sidebar' },
      { keys: 'Ctrl + Shift + H', label: 'History sidebar' },
      { keys: 'Tab', label: 'Navigate between fields' },
    ]},
    { title: 'Body Types (press key within 2s of Ctrl+B)', items: [
      { keys: 'Ctrl + B then J', label: 'JSON' },
      { keys: 'Ctrl + B then X', label: 'XML' },
      { keys: 'Ctrl + B then Y', label: 'YAML' },
      { keys: 'Ctrl + B then H', label: 'HTML' },
      { keys: 'Ctrl + B then T', label: 'Plain Text' },
      { keys: 'Ctrl + B then F', label: 'Form Data' },
      { keys: 'Ctrl + B then U', label: 'Form URL Encoded' },
      { keys: 'Ctrl + B then I', label: 'Binary / File' },
      { keys: 'Ctrl + B then G', label: 'GraphQL' },
      { keys: 'Ctrl + B then N', label: 'No Body' },
    ]},
    { title: 'Response Tabs', items: [
      { keys: 'Ctrl + F', label: 'Open search picker (Collections / History / Response)' },
      { keys: 'Alt + 1', label: 'Preview' },
      { keys: 'Alt + 2', label: 'Headers' },
      { keys: 'Alt + 3', label: 'Console' },
      { keys: 'Alt + 4', label: 'Diff' },
      { keys: 'Alt + T', label: 'Tree view (Preview)' },
      { keys: 'Alt + R', label: 'Raw view (Preview)' },
      { keys: 'Alt + G', label: 'Graph view (Preview)' },
    ]},
    { title: 'Graph View', items: [
      { keys: 'Ctrl + =', label: 'Zoom in' },
      { keys: 'Ctrl + -', label: 'Zoom out' },
      { keys: 'Ctrl + 0', label: 'Fit to view' },
      { keys: 'Two-finger pinch', label: 'Trackpad zoom' },
      { keys: 'Esc', label: 'Close graph' },
    ]},
    { title: 'WebSocket', items: [
      { keys: 'Ctrl + Enter', label: 'Connect / Disconnect' },
      { keys: 'Enter', label: 'Send message (in composer)' },
      { keys: 'Ctrl + L', label: 'Clear messages' },
    ]},
    { title: 'SSE (Server-Sent Events)', items: [
      { keys: 'Ctrl + Enter', label: 'Connect / Disconnect' },
      { keys: 'Ctrl + L', label: 'Clear events' },
    ]},
    { title: 'Tools', items: [
      { keys: 'Ctrl + Shift + M', label: 'Son of Anton' },
      { keys: 'Ctrl + Shift + Enter', label: 'Toggle Tools panel fullscreen', sub: true },
      { keys: 'Ctrl + Shift + J', label: 'JWT Decoder' },
      { keys: 'Ctrl + Shift + E', label: 'Base64 / URL Encoder' },
      { keys: 'Ctrl + D', label: 'Toggle Encode / Decode', sub: true },
      { keys: 'Ctrl + M', label: 'Toggle Base64 / URL mode', sub: true },
      { keys: 'Ctrl + Shift + X', label: 'Cookie Jar' },
      { keys: 'Ctrl + Shift + N', label: 'Network Diagnostics' },
      { keys: 'Ctrl + Shift + B', label: 'Diff / Compare Tool' },
      { keys: 'Alt + N', label: 'Next diff change (in Diff Tool)', sub: true },
      { keys: 'Alt + P', label: 'Previous diff change (in Diff Tool)', sub: true },
      { keys: 'Ctrl + J', label: 'Toggle format JSON (in Diff Tool)', sub: true },
      { keys: 'Ctrl + Shift + T', label: 'Load Test Lab' },
      { keys: 'Ctrl + Shift + F', label: 'Format body (JSON/XML/HTML)' },
      { keys: 'Ctrl + Shift + K', label: 'Copy as cURL' },
      { keys: 'Ctrl + Shift + G', label: 'Generate code snippet' },
      { keys: 'Ctrl + Shift + S', label: 'Export as HTML snapshot' },
      { keys: 'Ctrl + Shift + O', label: 'Import OpenAPI / Swagger spec' },
    ]},
    { title: 'General', items: [
      { keys: 'Ctrl + ,', label: 'Settings' },
      { keys: 'Ctrl + /', label: 'Toggle this panel' },
      { keys: 'Ctrl + Shift + [', label: 'Collapse / expand collections panel' },
      { keys: 'Ctrl + Shift + ]', label: 'Collapse / expand response panel' },
      { keys: 'Ctrl + Shift + L', label: 'Toggle response panel position' },
      { keys: 'Escape', label: 'Close panel / modal' },
    ]},
  ];

  run(() => {
    if (show) {
      searchQuery = '';
      setTimeout(() => searchInput?.focus(), 50);
    }
  });

  let lowerQuery = $derived(searchQuery.toLowerCase());

  // Hide the Son of Anton row from the cheat sheet when Anton is disabled
  // or the chatbot feature isn't compiled in — otherwise the user sees a
  // shortcut for something that won't open.
  let antonAvailable = $derived(!!$chatbotSupported && $settings.chatbotEnabled);

  let filteredSections = $derived(sections
    .map(s => ({ ...s, items: s.items.filter(item => {
      if (!antonAvailable && item.label === 'Son of Anton') return false;
      if (!lowerQuery) return true;
      return item.label.toLowerCase().includes(lowerQuery) || item.keys.toLowerCase().includes(lowerQuery);
    })}))
    .filter(s => s.items.length > 0));

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }
</script>


{#if show}
  <div use:portal role="dialog" tabindex="-1" onclick={() => show = false} onkeypress={() => {}}
    style="position:fixed;inset:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;">
    <div role="presentation" onclick={stopPropagation(bubble('click'))} onkeypress={stopPropagation(bubble('keypress'))}
      style="background:var(--bg-tertiary);border-radius:12px;padding:28px;width:80vw;height:80vh;max-width:80vw;max-height:80vh;overflow-y:auto;border:1px solid var(--border-color);box-shadow:0 16px 48px rgba(0,0,0,0.6),0 0 0 1px var(--accent-glow);">
      <div class="shortcuts-header">
        <h3>Keyboard Shortcuts</h3>
        <button class="close-btn" onclick={() => show = false}>×</button>
      </div>

      <div class="search-box">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          type="text"
          class="search-input"
          placeholder="Search shortcuts..."
        />
      </div>
      
      {#each filteredSections as section}
        <div class="shortcuts-section">
          <h4>{section.title}</h4>
          {#each section.items as item}
            <div class="shortcut-item" class:sub-shortcut={item.sub}>
              <div class="shortcut-keys">
                {#each item.keys.split(' + ') as part, i}
                  {#if i > 0}<span class="key-sep">+</span>{/if}
                  {#if part.includes(' then ')}
                    {@const [before, after] = part.split(' then ')}
                    <kbd>{before}</kbd><span class="key-sep">then</span><kbd>{after}</kbd>
                  {:else}
                    <kbd>{part}</kbd>
                  {/if}
                {/each}
              </div>
              <span>{item.label}</span>
            </div>
          {/each}
        </div>
      {/each}

      {#if filteredSections.length === 0}
        <div class="no-results">No shortcuts match "{searchQuery}"</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .shortcuts-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .shortcuts-header h3 {
    margin: 0;
    color: #f2f3f5;
  }

  .close-btn {
    background: none;
    border: none;
    color: #949ba4;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .close-btn:hover {
    color: #f2f3f5;
  }

  .search-box {
    position: relative;
    margin-bottom: 16px;
  }

  .search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: #949ba4;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 8px 12px 8px 32px;
    background: var(--bg-secondary) !important;
    border: 1px solid var(--border-color) !important;
    border-radius: 6px;
    color: #f2f3f5 !important;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: #5865f2 !important;
  }

  .search-input::placeholder {
    color: #72767d;
  }

  .key-sep {
    color: #949ba4;
    font-size: 11px;
    margin: 0 2px;
  }

  .no-results {
    text-align: center;
    color: #949ba4;
    padding: 32px 0;
    font-size: 14px;
  }

  .shortcuts-section {
    margin-bottom: 24px;
  }

  .shortcuts-section h4 {
    margin: 0 0 12px 0;
    color: #949ba4;
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
  }

  .shortcut-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    color: #dbdee1;
  }

  .shortcut-item.sub-shortcut {
    padding-left: 16px;
    opacity: 0.7;
    font-size: 0.92em;
  }

  .shortcut-keys {
    display: flex;
    gap: 4px;
  }

  kbd {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 2px 8px;
    font-family: monospace;
    font-size: 12px;
    color: #949ba4;
  }
</style>
