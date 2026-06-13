<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { variables, type Variable } from '$lib/stores/variableStore';
  import {
    getVariableContext,
    filterVariableSuggestions,
    applyVariableSelection,
    maskVariableValue,
  } from '$lib/utils/variableAutocomplete';

  interface Props {
    value: string;
    collectionId?: number | null;
    oninput: (value: string) => void;
    inputClass?: string;
    id?: string;
    type?: 'text' | 'password';
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    list?: string;
    debounceMs?: number;
    onpaste?: (e: ClipboardEvent) => void;
    onkeypress?: (e: KeyboardEvent) => void;
  }

  let {
    value,
    collectionId = null,
    oninput,
    inputClass = '',
    id,
    type = 'text',
    placeholder = '',
    multiline = false,
    rows = 5,
    list,
    debounceMs = 150,
    onpaste,
    onkeypress,
  }: Props = $props();

  let inputEl: HTMLInputElement | HTMLTextAreaElement | undefined = $state();
  let showSuggestions = $state(false);
  let suggestions: Variable[] = $state([]);
  let suggestionIndex = $state(-1);
  let activeContext: ReturnType<typeof getVariableContext> = $state(null);
  let variablesRev = $state(0);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const collectionVars = $derived.by(() => {
    variablesRev;
    return collectionId ? variables.getForCollection(collectionId) : [];
  });

  onMount(() => {
    if (collectionId) void variables.load(collectionId);
    const unsub = variables.subscribe(() => {
      variablesRev++;
    });
    return unsub;
  });

  $effect(() => {
    if (collectionId) void variables.load(collectionId);
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  function updateSuggestions(text: string, cursor: number, immediate = false) {
    const ctx = getVariableContext(text, cursor);
    activeContext = ctx;
    if (!ctx || !collectionId) {
      showSuggestions = false;
      suggestions = [];
      suggestionIndex = -1;
      return;
    }

    const run = () => {
      if (!activeContext) return;
      suggestions = filterVariableSuggestions(collectionVars, activeContext.query);
      showSuggestions = suggestions.length > 0;
      suggestionIndex = showSuggestions ? 0 : -1;
    };

    if (immediate || !ctx.query) {
      if (debounceTimer) clearTimeout(debounceTimer);
      run();
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, debounceMs);
  }

  function handleInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    oninput(el.value);
    updateSuggestions(el.value, el.selectionStart ?? el.value.length);
  }

  function handleClick(e: MouseEvent) {
    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    updateSuggestions(el.value, el.selectionStart ?? el.value.length, true);
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    updateSuggestions(el.value, el.selectionStart ?? el.value.length);
  }

  async function pickSuggestion(variable: Variable) {
    if (!inputEl || !activeContext) return;
    const { value: nextValue, cursor } = applyVariableSelection(
      value,
      activeContext,
      variable.key
    );
    oninput(nextValue);
    showSuggestions = false;
    suggestions = [];
    suggestionIndex = -1;
    activeContext = null;
    await tick();
    inputEl.focus();
    inputEl.setSelectionRange(cursor, cursor);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        suggestionIndex = (suggestionIndex + 1) % suggestions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        suggestionIndex =
          suggestionIndex <= 0 ? suggestions.length - 1 : suggestionIndex - 1;
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && suggestionIndex >= 0) {
        e.preventDefault();
        void pickSuggestion(suggestions[suggestionIndex]);
        return;
      }
    }

    if (e.key === 'Escape' && showSuggestions) {
      e.preventDefault();
      showSuggestions = false;
      suggestionIndex = -1;
      return;
    }

    onkeypress?.(e);
  }
</script>

<div class="variable-input-wrap" class:flex-grow={inputClass.includes('url-input')}>
  {#if multiline}
    <textarea
      bind:this={inputEl}
      {id}
      {rows}
      {placeholder}
      class={inputClass}
      {value}
      oninput={handleInput}
      onclick={handleClick}
      onkeyup={handleKeyUp}
      onkeydown={handleKeyDown}
      onpaste={onpaste}
    ></textarea>
  {:else}
    <input
      bind:this={inputEl}
      {id}
      {type}
      {placeholder}
      class={inputClass}
      {list}
      {value}
      oninput={handleInput}
      onclick={handleClick}
      onkeyup={handleKeyUp}
      onkeydown={handleKeyDown}
      onpaste={onpaste}
      onkeypress={onkeypress}
    />
  {/if}

  {#if showSuggestions}
    <ul class="var-suggestions" role="listbox" aria-label="Collection variables">
      {#each suggestions as variable, i (variable.key)}
        <li
          role="option"
          aria-selected={suggestionIndex === i}
          class:active={suggestionIndex === i}
          onmousedown={(e) => {
            e.preventDefault();
            void pickSuggestion(variable);
          }}
          onmouseenter={() => (suggestionIndex = i)}
        >
          <span class="var-suggestion-key">{'{{' + variable.key + '}}'}</span>
          <span class="var-suggestion-value">{maskVariableValue(variable.value)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .variable-input-wrap {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .variable-input-wrap.flex-grow {
    flex: 1;
  }

  .variable-input-wrap :global(input),
  .variable-input-wrap :global(textarea) {
    width: 100%;
    box-sizing: border-box;
  }

  .variable-input-wrap :global(.auth-input),
  .variable-input-wrap :global(.script-editor),
  .variable-input-wrap :global(.grpc-input),
  .variable-input-wrap :global(.grpc-body-input) {
    background-color: var(--bg-secondary) !important;
    color: var(--text-primary) !important;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 0.5rem;
    font-size: 0.9rem;
  }

  .variable-input-wrap :global(.auth-input:focus),
  .variable-input-wrap :global(.script-editor:focus),
  .variable-input-wrap :global(.grpc-input:focus),
  .variable-input-wrap :global(.grpc-body-input:focus) {
    outline: none;
    border-color: var(--accent-color);
  }

  .variable-input-wrap :global(.auth-input::placeholder),
  .variable-input-wrap :global(.script-editor::placeholder),
  .variable-input-wrap :global(.grpc-input::placeholder),
  .variable-input-wrap :global(.grpc-body-input::placeholder) {
    color: var(--text-secondary);
    opacity: 0.85;
  }

  .var-suggestions {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    z-index: 200;
    max-height: 220px;
    overflow-y: auto;
  }

  .var-suggestions li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 0.78rem;
  }

  .var-suggestions li:hover,
  .var-suggestions li.active {
    background: var(--bg-tertiary, #3a3d44);
  }

  .var-suggestion-key {
    font-family: var(--font-family-mono, monospace);
    color: var(--accent-color, #5865f2);
    flex-shrink: 0;
  }

  .var-suggestion-value {
    color: var(--text-secondary, #b0b0b0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
    text-align: right;
  }
</style>
