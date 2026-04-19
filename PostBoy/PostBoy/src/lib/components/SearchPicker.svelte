<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  export let show = false;

  const dispatch = createEventDispatcher<{ select: string; close: void }>();

  interface SearchOption {
    id: string;
    label: string;
    shortcut: string;
    icon: string;
  }

  const options: SearchOption[] = [
    { id: 'collections', label: 'Collections', shortcut: '1', icon: '📁' },
    { id: 'history',     label: 'History',     shortcut: '2', icon: '🕐' },
    { id: 'response',    label: 'Response Body', shortcut: '3', icon: '📄' },
  ];

  let selectedIndex = 0;

  function handleKeydown(e: KeyboardEvent) {
    if (!show) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % options.length;
      return;
    }

    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      selectedIndex = (selectedIndex + options.length - 1) % options.length;
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      selectOption(options[selectedIndex].id);
      return;
    }

    const num = parseInt(e.key);
    if (num >= 1 && num <= options.length) {
      e.preventDefault();
      selectOption(options[num - 1].id);
      return;
    }
  }

  function selectOption(id: string) {
    dispatch('select', id);
    close();
  }

  function close() {
    show = false;
    selectedIndex = 0;
    dispatch('close');
  }

  function handleBackdrop() {
    close();
  }

  $: if (show) {
    selectedIndex = 0;
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

{#if show}
  <div class="picker-overlay" on:click={handleBackdrop} role="presentation">
    <div class="picker" on:click|stopPropagation role="presentation">
      <div class="picker-header">
        <span class="picker-title">Search in...</span>
        <span class="picker-hint">↑↓ navigate · Enter select · 1-3 jump · Esc close</span>
      </div>
      <div class="picker-options">
        {#each options as option, i}
          <button
            class="picker-option {selectedIndex === i ? 'selected' : ''}"
            on:click={() => selectOption(option.id)}
            on:mouseenter={() => { selectedIndex = i; }}
          >
            <span class="option-icon">{option.icon}</span>
            <span class="option-label">{option.label}</span>
            <span class="option-shortcut">{option.shortcut}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .picker-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 10000;
    display: flex;
    justify-content: center;
    padding-top: 20vh;
  }

  .picker {
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 10px;
    width: 320px;
    max-height: fit-content;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
    overflow: hidden;
    animation: picker-in 0.12s ease-out;
  }

  @keyframes picker-in {
    from { opacity: 0; transform: translateY(-8px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .picker-header {
    padding: 12px 16px 8px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid var(--border-color, #3e4045);
  }

  .picker-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary, #dbdee1);
  }

  .picker-hint {
    font-size: 0.65rem;
    color: var(--text-secondary, #8b8d91);
  }

  .picker-options {
    padding: 6px;
  }

  .picker-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text-primary, #dbdee1);
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.1s ease;
    text-align: left;
  }

  .picker-option:hover,
  .picker-option.selected {
    background: var(--bg-tertiary, #35373b);
    border-color: var(--accent-color, #5865f2);
  }

  .picker-option.selected {
    box-shadow: inset 3px 0 0 var(--accent-color, #5865f2);
  }

  .option-icon {
    font-size: 1rem;
    width: 24px;
    text-align: center;
    flex-shrink: 0;
  }

  .option-label {
    flex: 1;
    font-weight: 500;
  }

  .option-shortcut {
    font-size: 0.7rem;
    color: var(--text-secondary, #8b8d91);
    background: var(--bg-primary, #1e1f22);
    padding: 2px 7px;
    border-radius: 4px;
    font-weight: 600;
    font-family: monospace;
    min-width: 20px;
    text-align: center;
  }
</style>
