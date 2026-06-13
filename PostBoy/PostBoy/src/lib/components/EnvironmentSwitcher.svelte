<script lang="ts">
  import { onMount } from 'svelte';
  import {
    environments,
    envVariables,
    activeEnvironmentId,
    setActiveEnvironment,
  } from '$lib/stores/environmentStore';
  import { showToolsPanel } from '$lib/stores/uiStore';

  let open = $state(false);
  let envRev = $state(0);
  let activeId = $state<number | null>(null);

  const envList = $derived.by(() => {
    envRev;
    return environments.getAll();
  });

  const activeName = $derived.by(() => {
    envRev;
    if (!activeId) return 'No Environment';
    return environments.getById(activeId)?.name ?? 'No Environment';
  });

  const varCount = $derived.by(() => {
    envRev;
    if (!activeId) return 0;
    return envVariables.getForEnvironment(activeId).filter((v) => v.enabled).length;
  });

  onMount(() => {
    const unsubEnv = environments.subscribe(() => {
      envRev++;
    });
    const unsubActive = activeEnvironmentId.subscribe((id) => {
      activeId = id;
      envRev++;
      if (id) void envVariables.load(id);
    });
    const unsubVars = envVariables.subscribe(() => {
      envRev++;
    });

    const closeOnClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.env-switcher')) open = false;
    };
    document.addEventListener('click', closeOnClick);

    return () => {
      unsubEnv();
      unsubActive();
      unsubVars();
      document.removeEventListener('click', closeOnClick);
    };
  });

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
  }

  async function pickEnvironment(id: number | null) {
    await setActiveEnvironment(id);
    open = false;
  }

  function openManager() {
    open = false;
    showToolsPanel.set('environments');
  }
</script>

<div class="env-switcher">
  <button
    class="env-select-btn"
    onclick={toggleDropdown}
    title="Select environment — overrides collection variables"
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-.75 2v3.19L5.03 9.03l.94.94L8.5 7.44V4.5H7.25Z"/>
    </svg>
    <span class="env-label">{activeName}</span>
    {#if varCount > 0}
      <span class="env-count">{varCount}</span>
    {/if}
    <svg class="chevron" width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </svg>
  </button>

  {#if open}
    <div class="env-dropdown" role="listbox">
      <button
        class="env-option"
        class:selected={!activeId}
        onclick={() => pickEnvironment(null)}
        role="option"
        aria-selected={!activeId}
      >
        No Environment
      </button>
      {#each envList as env (env.id)}
        <button
          class="env-option"
          class:selected={env.id === activeId}
          onclick={() => pickEnvironment(env.id)}
          role="option"
          aria-selected={env.id === activeId}
        >
          {env.name}
        </button>
      {/each}
      <div class="dropdown-divider"></div>
      <button class="env-option manage" onclick={openManager}>
        Manage Environments…
      </button>
    </div>
  {/if}
</div>

<style>
  .env-switcher {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
  }

  .env-select-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    min-height: 42px;
    padding: 0 12px;
    border: 1.5px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    max-width: 200px;
    transition: border-color 0.15s, box-shadow 0.15s;
    box-sizing: border-box;
  }

  .env-select-btn:hover {
    border-color: var(--accent-color);
  }

  .env-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .env-count {
    font-size: 0.65rem;
    padding: 1px 5px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .chevron {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .env-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 200px;
    max-width: 280px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    z-index: 100;
    padding: 6px;
  }

  .env-option {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .env-option:hover {
    background: var(--bg-tertiary);
  }

  .env-option.selected {
    background: rgba(88, 101, 242, 0.15);
    color: var(--accent-color, #5865f2);
    font-weight: 500;
  }

  .env-option.manage {
    color: var(--text-secondary);
    font-size: 0.78rem;
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
  }
</style>
