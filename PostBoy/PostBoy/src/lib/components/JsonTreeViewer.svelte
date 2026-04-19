<script lang="ts">
  export let data: any;
  export let rootKey = '';
  export let depth = 0;
  export let defaultExpanded = true;
  export let lineCounter = { current: 1 };
  export let searchQuery = '';

  let collapsed = !defaultExpanded && depth > 0;
  let copiedKey = '';
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  function toggle() { collapsed = !collapsed; }

  function getType(val: any): string {
    if (val === null) return 'null';
    if (Array.isArray(val)) return 'array';
    return typeof val;
  }

  function formatValue(val: any): string {
    if (val === null) return 'null';
    if (typeof val === 'string') return `"${val}"`;
    return String(val);
  }

  function truncateStr(val: string, max = 120): string {
    return val.length > max ? val.slice(0, max) + '...' : val;
  }

  function highlightText(text: string): string {
    if (!searchQuery || !text) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const queryEscaped = escapeHtml(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!queryEscaped) return escaped;
    const regex = new RegExp(`(${queryEscaped})`, 'gi');
    return escaped.replace(regex, '<mark class="tree-search-match">$1</mark>');
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function nodeContainsQuery(val: any, key: string): boolean {
    if (!searchQuery) return false;
    const q = searchQuery.toLowerCase();
    if (key.toLowerCase().includes(q)) return true;
    if (val === null) return 'null'.includes(q);
    if (typeof val !== 'object') return String(val).toLowerCase().includes(q);
    if (Array.isArray(val)) return val.some((v, i) => nodeContainsQuery(v, String(i)));
    return Object.entries(val).some(([k, v]) => nodeContainsQuery(v, k));
  }

  async function copyValue(val: any, id: string) {
    const text = typeof val === 'object' && val !== null ? JSON.stringify(val, null, 2) : String(val);
    await navigator.clipboard.writeText(text);
    copiedKey = id;
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => { copiedKey = ''; }, 1200);
  }

  $: entries = data !== null && typeof data === 'object'
    ? (Array.isArray(data) ? data.map((v: any, i: number) => [String(i), v]) : Object.entries(data))
    : [];
  $: isContainer = data !== null && typeof data === 'object';
  $: bracket = Array.isArray(data) ? ['[', ']'] : ['{', '}'];
  $: if (depth < 2) collapsed = false;
  $: if (searchQuery && isContainer && nodeContainsQuery(data, rootKey)) collapsed = false;

  function getLine() {
    return lineCounter.current++;
  }
</script>

{#if isContainer}
  <div class="node">
    <div class="line hoverable" on:click={toggle} on:keypress={toggle} role="button" tabindex="0">
      <span class="line-num">{getLine()}</span>
      <span class="indent" style="width: {depth * 18}px"></span>
      <span class="arrow" class:collapsed>{collapsed ? '▶' : '▼'}</span>
      {#if rootKey}
        <span class="key">{@html highlightText(`"${rootKey}"`)}</span><span class="colon">: </span>
      {/if}
      <span class="bracket">{bracket[0]}</span>
      {#if collapsed}
        <span class="ellipsis"> {entries.length} {Array.isArray(data) ? 'items' : 'keys'} </span>
        <span class="bracket">{bracket[1]}</span>
      {/if}
      <button class="copy-btn" class:copied={copiedKey === `${depth}.${rootKey}.root`} on:click|stopPropagation={() => copyValue(data, `${depth}.${rootKey}.root`)} title="Copy object">
        {copiedKey === `${depth}.${rootKey}.root` ? '✓' : '⧉'}
      </button>
    </div>

    {#if !collapsed}
      {#each entries as [key, value], i}
        {@const type = getType(value)}
        {@const uid = `${depth}.${rootKey}.${key}`}
        {@const isLast = i === entries.length - 1}
        {#if type === 'object' || type === 'array'}
          <svelte:self data={value} rootKey={key} depth={depth + 1} defaultExpanded={depth < 1} {lineCounter} {searchQuery} />
          {#if !isLast}
            <!-- comma after nested closing bracket is handled in the close line -->
          {/if}
        {:else}
          <div class="line leaf">
            <span class="line-num">{getLine()}</span>
            <span class="indent" style="width: {(depth + 1) * 18}px"></span>
            <span class="key">{@html highlightText(`"${key}"`)}</span><span class="colon">: </span>
            <span class="val {type}" title={typeof value === 'string' ? value : ''}>{@html highlightText(truncateStr(formatValue(value)))}</span>{#if !isLast}<span class="comma">,</span>{/if}
            <button class="copy-btn" class:copied={copiedKey === uid} on:click|stopPropagation={() => copyValue(value, uid)} title="Copy value">
              {copiedKey === uid ? '✓' : '⧉'}
            </button>
          </div>
        {/if}
      {/each}
      <div class="line">
        <span class="line-num">{getLine()}</span>
        <span class="indent" style="width: {depth * 18}px"></span>
        <span class="bracket">{bracket[1]}</span>
      </div>
    {/if}
  </div>
{:else}
  <div class="line leaf">
    <span class="line-num">{getLine()}</span>
    <span class="indent" style="width: {depth * 18}px"></span>
    {#if rootKey}
      <span class="key">{@html highlightText(`"${rootKey}"`)}</span><span class="colon">: </span>
    {/if}
    <span class="val {getType(data)}">{@html highlightText(truncateStr(formatValue(data)))}</span>
    <button class="copy-btn" class:copied={copiedKey === rootKey} on:click|stopPropagation={() => copyValue(data, rootKey)} title="Copy value">
      {copiedKey === rootKey ? '✓' : '⧉'}
    </button>
  </div>
{/if}

<style>
  .node { font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 13px; }

  .line {
    display: flex;
    align-items: baseline;
    line-height: 22px;
    min-height: 22px;
    white-space: nowrap;
    padding-right: 12px;
  }

  .line.leaf:hover, .line.hoverable:hover {
    background: rgba(88, 101, 242, 0.07);
  }

  .line-num {
    display: inline-block;
    width: 44px;
    min-width: 44px;
    text-align: right;
    padding-right: 12px;
    color: #4a4e58;
    font-size: 12px;
    user-select: none;
    border-right: 1px solid #2e3038;
    margin-right: 8px;
  }

  .indent { display: inline-block; flex-shrink: 0; }

  .arrow {
    display: inline-block;
    width: 14px;
    font-size: 9px;
    color: #6c7086;
    cursor: pointer;
    user-select: none;
    text-align: center;
    margin-right: 2px;
    transition: color 0.15s;
  }
  .arrow:hover { color: #cdd6f4; }

  .key { color: #89b4fa; }
  .colon { color: #585b70; margin-right: 4px; }
  .bracket { color: #a6adc8; font-weight: 500; }
  .comma { color: #585b70; }

  .ellipsis {
    color: #585b70;
    font-style: italic;
    font-size: 11px;
    background: #2a2c37;
    padding: 0 6px;
    border-radius: 3px;
    margin: 0 4px;
  }

  .val.string { color: #a6e3a1; }
  .val.number { color: #fab387; }
  .val.boolean { color: #cba6f7; font-weight: 600; }
  .val.null { color: #6c7086; font-style: italic; }

  .copy-btn {
    opacity: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    color: #7f849c;
    font-size: 13px;
    cursor: pointer;
    padding: 0 3px;
    margin-left: 8px;
    line-height: 1;
    transition: opacity 0.12s, color 0.12s, border-color 0.12s;
    flex-shrink: 0;
  }

  .line:hover > .copy-btn,
  .line:hover > .node > .line > .copy-btn {
    opacity: 0.7;
  }
  .copy-btn:hover { opacity: 1 !important; color: #b4befe; border-color: #45475a; }

  .copy-btn.copied {
    opacity: 1 !important;
    color: #a6e3a1;
    border-color: #a6e3a1;
  }

  :global(.tree-search-match) {
    background: rgba(240, 177, 50, 0.35);
    border-radius: 2px;
    color: inherit;
    padding: 0 1px;
  }
</style>
