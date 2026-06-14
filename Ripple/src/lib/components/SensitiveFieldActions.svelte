<script lang="ts">
  interface Props {
    revealed?: boolean;
    copied?: boolean;
    onToggleReveal?: () => void;
    onCopy?: () => void;
    showReveal?: boolean;
  }

  let {
    revealed = false,
    copied = false,
    onToggleReveal,
    onCopy,
    showReveal = true,
  }: Props = $props();
</script>

<div class="sensitive-field-actions">
  {#if showReveal && onToggleReveal}
    <button
      type="button"
      class="sensitive-action-btn"
      onclick={onToggleReveal}
      title={revealed ? 'Hide value' : 'Show value'}
      aria-label={revealed ? 'Hide value' : 'Show value'}
    >
      {#if revealed}
        <svg class="action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M1.5 8s2.75-5.25 6.5-5.25S14.5 8 14.5 8s-2.75 5.25-6.5 5.25S1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      {:else}
        <svg class="action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M1.5 8s2.75-5.25 6.5-5.25S14.5 8 14.5 8s-2.75 5.25-6.5 5.25S1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="2" />
          <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
        </svg>
      {/if}
    </button>
  {/if}
  {#if onCopy}
    <button
      type="button"
      class="sensitive-action-btn"
      class:success={copied}
      onclick={onCopy}
      title="Copy value"
      aria-label="Copy value"
    >
      {#if copied}
        <svg class="action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      {:else}
        <svg class="action-icon copy-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect class="copy-back" x="6" y="6" width="8" height="8" rx="1.25" />
          <rect class="copy-front" x="2" y="2" width="8" height="8" rx="1.25" />
        </svg>
      {/if}
    </button>
  {/if}
</div>

<style>
  .sensitive-field-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .sensitive-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary, #b0b0b0);
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .sensitive-action-btn:hover {
    color: var(--text-primary, #dbdee1);
    background: var(--bg-tertiary, #3a3d44);
  }

  .sensitive-action-btn.success {
    color: var(--success-color, #57f287);
  }

  .action-icon {
    width: 14px;
    height: 14px;
    display: block;
  }

  .copy-icon .copy-back {
    fill: currentColor;
    opacity: 0.22;
    stroke: none;
  }

  .copy-icon .copy-front {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.25;
  }
</style>
