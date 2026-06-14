<script lang="ts">
  import { onDestroy } from 'svelte';
  import SensitiveFieldActions from './SensitiveFieldActions.svelte';
  import { maskSecret } from '$lib/utils/sensitiveData';

  interface Props {
    label: string;
    value: string;
    showReveal?: boolean;
    unresolved?: boolean;
    placement?: 'inline' | 'fixed';
    left?: number;
    top?: number;
    hoverBridge?: boolean;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
  }

  let {
    label,
    value,
    showReveal = true,
    unresolved = false,
    placement = 'inline',
    left = 0,
    top = 0,
    hoverBridge = placement === 'inline',
    onmouseenter,
    onmouseleave,
  }: Props = $props();

  let revealed = $state(false);
  let copied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  const displayValue = $derived(
    unresolved ? '(unresolved)' : revealed ? value : maskSecret(value)
  );

  onDestroy(() => {
    if (copyTimeout) clearTimeout(copyTimeout);
  });

  async function handleCopy() {
    if (unresolved || !value) return;
    await navigator.clipboard.writeText(value);
    copied = true;
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      copied = false;
    }, 1500);
  }
</script>

<div
  class="sensitive-value-popover"
  class:fixed={placement === 'fixed'}
  class:with-bridge={hoverBridge}
  role="tooltip"
  style:left={placement === 'fixed' ? `${left}px` : undefined}
  style:top={placement === 'fixed' ? `${top}px` : undefined}
  {onmouseenter}
  {onmouseleave}
>
  <div class="sensitive-value-popover-header">
    <span class="sensitive-value-popover-key">{label}</span>
    {#if unresolved}
      <span class="sensitive-value-popover-unresolved">unresolved</span>
    {/if}
  </div>
  <div class="sensitive-value-popover-row">
    <input
      class="sensitive-value-popover-value"
      readonly
      tabindex="-1"
      value={displayValue}
      aria-label={`Value for ${label}`}
    />
    <SensitiveFieldActions
      {revealed}
      {copied}
      showReveal={showReveal && !unresolved}
      onToggleReveal={() => (revealed = !revealed)}
      onCopy={handleCopy}
    />
  </div>
</div>

<style>
  .sensitive-value-popover {
    position: absolute;
    left: 0;
    top: 100%;
    z-index: 500;
    width: max-content;
    max-width: min(320px, 100%);
    padding: 8px 10px;
    background: var(--bg-tertiary, #383a40);
    border: 1px solid var(--accent-color, #5865f2);
    border-radius: 8px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.35),
      0 12px 32px rgba(0, 0, 0, 0.55);
  }

  .sensitive-value-popover.fixed {
    position: fixed;
    left: unset;
    top: unset;
    z-index: 6000;
  }

  .sensitive-value-popover.with-bridge::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -12px;
    height: 12px;
  }

  .sensitive-value-popover-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--border-color, #4a4d55);
  }

  .sensitive-value-popover-key {
    font-family: var(--font-family-mono, monospace);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--accent-color, #5865f2);
  }

  .sensitive-value-popover-unresolved {
    font-size: 0.68rem;
    color: var(--warning-color, #fee75c);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(254, 231, 92, 0.12);
  }

  .sensitive-value-popover-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sensitive-value-popover-value {
    width: 168px;
    max-width: 168px;
    flex: 0 0 auto;
    padding: 6px 8px;
    border: 1px solid var(--border-color, #4a4d55);
    border-radius: 6px;
    background: var(--bg-secondary, #2b2d31);
    color: var(--text-primary, #f2f3f5);
    font-family: var(--font-family-mono, monospace);
    font-size: 0.8rem;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }
</style>
