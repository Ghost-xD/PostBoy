<script lang="ts">
  import { onMount } from 'svelte';
  import { responseLayout, toggleResponseLayout, showShortcuts, showToolsPanel, showDiffTool, showLoadTest } from '$lib/stores/uiStore';
  import { settings, toggleTheme } from '$lib/stores/settingsStore';
  import { formatShortcut, shortcutTitle, SQL_RUNNER_SHORTCUT, THEME_TOGGLE_SHORTCUT } from '$lib/utils/platform';

  interface Props {
    version?: string;
  }

  let { version = '' }: Props = $props();

  let zoomLevel = $state(100);
  let currentZoom = 100;
  let animFrame = 0;
  let appContainer: HTMLElement | null = null;

  onMount(() => {
    document.documentElement.style.removeProperty('zoom');
    appContainer = document.querySelector('.app-container');
    if (appContainer) {
      appContainer.style.removeProperty('transform');
      appContainer.style.removeProperty('transition');
      appContainer.style.transformOrigin = 'top left';
      appContainer.style.willChange = 'transform';
    }
  });

  function commitZoom(level: number) {
    if (!appContainer) appContainer = document.querySelector('.app-container');
    if (!appContainer) return;
    appContainer.style.transform = 'none';
    appContainer.style.zoom = `${level}%`;
  }

  function previewZoom(visualScale: number, baseZoom: number) {
    if (!appContainer) appContainer = document.querySelector('.app-container');
    if (!appContainer) return;
    const relativeScale = visualScale / baseZoom;
    appContainer.style.zoom = `${baseZoom}%`;
    appContainer.style.transform = `scale(${relativeScale})`;
  }

  function animateZoom(target: number) {
    if (animFrame) cancelAnimationFrame(animFrame);
    target = Math.min(200, Math.max(50, target));
    zoomLevel = target;
    const start = currentZoom;
    const diff = target - start;
    if (Math.abs(diff) < 1) {
      currentZoom = target;
      commitZoom(target);
      return;
    }
    const duration = 250;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const current = start + diff * ease;
      currentZoom = current;
      previewZoom(current, start);
      if (t < 1) {
        animFrame = requestAnimationFrame(tick);
      } else {
        currentZoom = target;
        commitZoom(target);
        animFrame = 0;
      }
    }
    animFrame = requestAnimationFrame(tick);
  }

  function setZoom(level: number) {
    animateZoom(level);
  }

  function onSliderInput() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = 0;
    currentZoom = zoomLevel;
    commitZoom(zoomLevel);
  }

  function stepZoom(delta: number) {
    setZoom(zoomLevel + delta);
  }

  function resetZoom() {
    setZoom(100);
  }

  async function toggleThemeShortcut() {
    await toggleTheme();
  }
</script>

<div class="app-footer">
  <div class="footer-left">
    <svg class="footer-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="footer-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#4d8df6"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="#000000"/>
      <circle cx="16" cy="16" r="3.5" fill="url(#footer-logo-grad)"/>
      <circle cx="16" cy="16" r="8" stroke="url(#footer-logo-grad)" stroke-opacity="0.55" stroke-width="1.5" fill="none"/>
      <circle cx="16" cy="16" r="13" stroke="url(#footer-logo-grad)" stroke-opacity="0.22" stroke-width="1.5" fill="none"/>
    </svg>
    <span class="footer-app-name">Ripple</span>
    <span class="footer-version">v{version}</span>
  </div>

  <div class="footer-center">
    <button class="zoom-btn" onclick={() => stepZoom(-10)} title={shortcutTitle('Zoom Out', 'Ctrl+-')} disabled={zoomLevel <= 50}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/></svg>
    </button>
    <input
      type="range"
      class="zoom-slider"
      min="50"
      max="200"
      step="5"
      bind:value={zoomLevel}
      oninput={onSliderInput}
      title="Zoom: {zoomLevel}%"
    />
    <button class="zoom-btn" onclick={() => stepZoom(10)} title={shortcutTitle('Zoom In', 'Ctrl+=')} disabled={zoomLevel >= 200}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
    </button>
    <button class="zoom-pct" onclick={resetZoom} title="Reset to 100%" class:is-zoomed={zoomLevel !== 100}>{zoomLevel}%</button>
    {#if zoomLevel !== 100}
      <button class="zoom-reset" onclick={resetZoom} title="Reset Zoom">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 1 .908-.418A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
      </button>
    {/if}
  </div>

  <div class="footer-right">
    <button
      class="footer-btn"
      onclick={toggleThemeShortcut}
      title={shortcutTitle($settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', THEME_TOGGLE_SHORTCUT)}
      aria-label={shortcutTitle($settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', THEME_TOGGLE_SHORTCUT)}
    >
      {#if $settings.theme === 'dark'}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 1 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z"/>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/>
        </svg>
      {/if}
    </button>
    <button class="footer-btn" onclick={() => showToolsPanel.update(v => v === 'jwt' ? false : 'jwt')} title={shortcutTitle('JWT Decoder', 'Ctrl+Shift+J')}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5Zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5ZM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5Zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4Z"/></svg>
    </button>
    <button class="footer-btn" onclick={() => showToolsPanel.update(v => v === 'encoder' ? false : 'encoder')} title={shortcutTitle('Base64/URL Encoder', 'Ctrl+Shift+E')}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.708 5.578L2.061 8.224l2.647 2.646-.708.708L.94 8.518a.5.5 0 0 1 0-.708L4 4.87l.708.708zm6.584 0l2.647 2.646-2.647 2.646.708.708 3.06-3.06a.5.5 0 0 0 0-.708L12 4.87l-.708.708zm-3.31-1.46-.925.382L8.94 12.118l.926-.382L7.982 4.118Z"/></svg>
    </button>
    <button class="footer-btn" onclick={() => showToolsPanel.update(v => v === 'sql' ? false : 'sql')} title={shortcutTitle('SQL Query Runner', SQL_RUNNER_SHORTCUT)}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1c-4.4 0-7 1.8-7 3.5v7C1 13.2 3.6 15 8 15s7-1.8 7-3.5v-7C15 2.8 12.4 1 8 1Zm0 1.2c3.6 0 5.8 1.4 5.8 2.3S11.6 6.8 8 6.8 2.2 5.4 2.2 4.5 4.4 2.2 8 2.2ZM2.2 6.8c1.2.9 3.3 1.5 5.8 1.5s4.6-.6 5.8-1.5v1.7c0 .9-2.2 2.3-5.8 2.3S2.2 9.4 2.2 8.5V6.8Zm0 4c1.2.9 3.3 1.5 5.8 1.5s4.6-.6 5.8-1.5v1.7c0 .9-2.2 2.3-5.8 2.3S2.2 13.4 2.2 12.5v-1.7Z"/></svg>
    </button>
    <button class="footer-btn" onclick={() => showDiffTool.update(v => !v)} title={shortcutTitle('Diff / Compare', 'Ctrl+Shift+B')}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.75A.75.75 0 0 1 2.75 3h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 2 3.75Zm0 4A.75.75 0 0 1 2.75 7h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 2 7.75Zm0 4a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75ZM13.25 3a.75.75 0 0 0-.75.75v8.5a.75.75 0 0 0 1.5 0v-8.5a.75.75 0 0 0-.75-.75Zm-3 0a.75.75 0 0 0-.75.75v8.5a.75.75 0 0 0 1.5 0v-8.5a.75.75 0 0 0-.75-.75Z"/></svg>
    </button>
    <button class="footer-btn" onclick={() => showLoadTest.update(v => v ? false : { collectionId: null })} title={shortcutTitle('Load Test Lab', 'Ctrl+Shift+T')}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 11.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-2.5h-1a.5.5 0 0 1-.5-.5zm2.5-7a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H4v9a.5.5 0 0 1-1 0v-9.5a.5.5 0 0 1 0-.5zm4-3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-1 0V2H7a.5.5 0 0 1-.5-.5zM11 6.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V7h-1.5a.5.5 0 0 1-.5-.5z"/></svg>
    </button>
    <button class="footer-btn" onclick={toggleResponseLayout} title={shortcutTitle('Toggle response panel position', 'Ctrl+Shift+L')}>
      {#if $responseLayout === 'right'}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14v14H1V1zm1 7h12V2H2v6zm0 1v5h12V9H2z"/></svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14v14H1V1zm7 1v12h6V2H8zM2 2v12h5V2H2z"/></svg>
      {/if}
    </button>
    <button class="footer-btn" onclick={() => showShortcuts.update(v => !v)} title={shortcutTitle('Keyboard Shortcuts', 'Ctrl+/')}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h12zM2 4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H2z"/><path d="M13 10.25a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5zm0-2a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5zm-5 0A.25.25 0 0 1 8.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 8 8.75v-.5zm2 0a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5zm1 2a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5zm-5-2A.25.25 0 0 1 6.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 6 8.75v-.5zm-2 0A.25.25 0 0 1 4.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 4 8.75v-.5zm-2 0A.25.25 0 0 1 2.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 2 8.75v-.5zm11-2a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5zm-2 0a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5zm-2 0A.25.25 0 0 1 9.25 6h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 9 6.75v-.5zm-2 0A.25.25 0 0 1 7.25 6h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 7 6.75v-.5zm-2 0A.25.25 0 0 1 5.25 6h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 5 6.75v-.5zm-3 0A.25.25 0 0 1 2.25 6h1.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-1.5A.25.25 0 0 1 2 6.75v-.5zm0 4a.25.25 0 0 1 .25-.25h8.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-.5z"/></svg>
    </button>
    <span class="footer-credit" title="Developed by Gaurav Saroha">GS</span>
  </div>
</div>

<style>
  .footer-center {
    display: flex;
    align-items: center;
    gap: 2px;
    justify-self: center;
  }

  .zoom-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 80px;
    height: 4px;
    background: var(--border-color, #3f4147);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s;
  }
  .zoom-slider:hover { opacity: 1; }
  .zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--accent-color, #5865f2);
    border-radius: 50%;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .zoom-slider::-webkit-slider-thumb:hover {
    transform: scale(1.3);
    box-shadow: 0 0 6px rgba(88, 101, 242, 0.5);
  }

  .zoom-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #b5bac1);
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    transition: all 0.15s ease;
  }
  .zoom-btn:hover:not(:disabled) {
    background: var(--bg-tertiary, #3f4147);
    color: var(--text-primary, #f2f3f5);
  }
  .zoom-btn:active:not(:disabled) {
    transform: scale(0.9);
  }
  .zoom-btn:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .zoom-pct {
    background: none;
    border: none;
    color: var(--text-secondary, #b5bac1);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 5px;
    border-radius: 3px;
    min-width: 34px;
    text-align: center;
    transition: all 0.15s ease;
    font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  }
  .zoom-pct.is-zoomed {
    color: var(--accent-color, #5865f2);
  }
  .zoom-pct:hover {
    background: var(--bg-tertiary, #3f4147);
    color: var(--text-primary, #f2f3f5);
  }

  .zoom-reset {
    background: none;
    border: none;
    color: var(--text-secondary, #b5bac1);
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    opacity: 0.6;
    transition: all 0.15s ease;
    animation: resetFadeIn 0.2s ease;
  }
  .zoom-reset:hover {
    background: var(--bg-tertiary, #3f4147);
    color: var(--text-primary, #f2f3f5);
    opacity: 1;
  }
  .zoom-reset:active {
    transform: rotate(-90deg);
  }

  @keyframes resetFadeIn {
    from { opacity: 0; transform: scale(0.7); }
    to { opacity: 0.6; transform: scale(1); }
  }
</style>
