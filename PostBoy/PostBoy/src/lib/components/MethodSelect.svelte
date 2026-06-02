<script lang="ts">
  import { Select } from 'bits-ui';

  interface Props {
    value: string;
    onValueChange: (value: string) => void;
  }

  let { value, onValueChange }: Props = $props();

  const httpMethods = [
    { value: 'GET', label: 'GET' },
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'DELETE', label: 'DELETE' },
    { value: 'PATCH', label: 'PATCH' },
    { value: 'OPTIONS', label: 'OPTIONS' },
    { value: 'HEAD', label: 'HEAD' },
  ];

  const wsMethods = [
    { value: 'WS', label: 'WS' },
    { value: 'WSS', label: 'WSS' },
  ];

  const sseMethods = [
    { value: 'SSE', label: 'SSE' },
  ];

  const allItems = [...httpMethods, ...wsMethods, ...sseMethods];
</script>

<Select.Root
  type="single"
  value={value}
  onValueChange={(v) => { if (v) onValueChange(v); }}
  items={allItems}
>
  <Select.Trigger
    class="method-trigger"
    style="color: var(--method-{value.toLowerCase()})"
    aria-label="Select HTTP method"
  >
    <span class="method-label">{value}</span>
    <svg class="chevron" width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
      <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </Select.Trigger>

  <Select.Portal>
    <Select.Content class="method-content" sideOffset={4} side="bottom" align="start">
      <Select.Viewport class="method-viewport">
        <Select.Group>
          <Select.GroupHeading class="method-group-heading">HTTP</Select.GroupHeading>
          {#each httpMethods as method (method.value)}
            <Select.Item
              class="method-item"
              value={method.value}
              label={method.label}
              style="--item-color: var(--method-{method.value.toLowerCase()})"
            >
              {#snippet children({ selected })}
                <span class="item-label">{method.label}</span>
                {#if selected}
                  <svg class="item-check" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                  </svg>
                {/if}
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Group>

        <div class="method-separator"></div>

        <Select.Group>
          <Select.GroupHeading class="method-group-heading">WebSocket</Select.GroupHeading>
          {#each wsMethods as method (method.value)}
            <Select.Item
              class="method-item"
              value={method.value}
              label={method.label}
              style="--item-color: var(--method-{method.value.toLowerCase()})"
            >
              {#snippet children({ selected })}
                <span class="item-label">{method.label}</span>
                {#if selected}
                  <svg class="item-check" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                  </svg>
                {/if}
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Group>

        <div class="method-separator"></div>

        <Select.Group>
          <Select.GroupHeading class="method-group-heading">Streaming</Select.GroupHeading>
          {#each sseMethods as method (method.value)}
            <Select.Item
              class="method-item"
              value={method.value}
              label={method.label}
              style="--item-color: var(--method-{method.value.toLowerCase()})"
            >
              {#snippet children({ selected })}
                <span class="item-label">{method.label}</span>
                {#if selected}
                  <svg class="item-check" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                  </svg>
                {/if}
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Group>
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.method-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 42px;
    padding: 0 14px;
    background: transparent;
    border: none;
    border-radius: 12px 0 0 12px;
    font-family: var(--font-family-primary, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
    outline: none;
    transition: background 0.15s;
    min-width: 90px;
    user-select: none;
    flex-shrink: 0;
  }

  :global(.method-trigger:hover) {
    background: var(--bg-tertiary);
  }

  :global(.method-trigger:focus-visible) {
    background: var(--bg-tertiary);
  }

  :global(.method-trigger .method-label) {
    flex: 1;
    text-align: left;
  }

  :global(.method-trigger .chevron) {
    opacity: 0.4;
    transition: transform 0.15s, opacity 0.15s;
    flex-shrink: 0;
  }

  :global(.method-trigger[data-state="open"] .chevron) {
    transform: rotate(180deg);
    opacity: 0.7;
  }

  :global(.method-content) {
    z-index: 1000;
    min-width: 160px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    transform-origin: top left;
  }

  :global(.method-content[data-state="open"]) {
    animation: methodDropdownIn 150ms ease-out;
  }

  :global(.method-content[data-state="closed"]) {
    animation: methodDropdownOut 100ms ease-in;
  }

  @keyframes methodDropdownIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  @keyframes methodDropdownOut {
    from {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
    to {
      opacity: 0;
      transform: scale(0.95) translateY(-4px);
    }
  }

  :global(.method-viewport) {
    padding: 4px;
  }

  :global(.method-group-heading) {
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    opacity: 0.6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    user-select: none;
  }

  .method-separator {
    height: 1px;
    margin: 4px 10px;
    background: var(--border-color);
    opacity: 0.4;
  }

  :global(.method-item) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 5px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--item-color);
    cursor: pointer;
    outline: none;
    transition: background 0.1s;
    user-select: none;
  }

  :global(.method-item[data-highlighted]) {
    background: var(--bg-tertiary);
  }

  :global(.method-item[data-state="checked"]) {
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  }

  :global(.method-item .item-label) {
    flex: 1;
  }

  :global(.method-item .item-check) {
    color: var(--accent-color);
    flex-shrink: 0;
  }
</style>
