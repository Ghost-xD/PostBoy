<script lang="ts">
  import { run } from 'svelte/legacy';

  interface Props {
    currentResponse?: string;
    currentUrl?: string;
  }

  let { currentResponse = '', currentUrl = '' }: Props = $props();

  let pinnedResponse: string | null = $state(null);
  let pinnedLabel: string = $state('');
  let previousResponses: Map<string, string> = $state(new Map());

  interface DiffLine {
    type: 'added' | 'removed' | 'unchanged';
    text: string;
    lineNumA?: number;
    lineNumB?: number;
  }

  function prettyPrint(text: string): string {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  function computeDiff(a: string, b: string): DiffLine[] {
    const linesA = a.split('\n');
    const linesB = b.split('\n');
    const result: DiffLine[] = [];
    const maxLen = Math.max(linesA.length, linesB.length);
    let numA = 0;
    let numB = 0;

    for (let i = 0; i < maxLen; i++) {
      const lineA = i < linesA.length ? linesA[i] : undefined;
      const lineB = i < linesB.length ? linesB[i] : undefined;

      if (lineA === lineB) {
        numA++;
        numB++;
        result.push({ type: 'unchanged', text: lineA || '', lineNumA: numA, lineNumB: numB });
      } else {
        if (lineA !== undefined) {
          numA++;
          result.push({ type: 'removed', text: lineA, lineNumA: numA });
        }
        if (lineB !== undefined) {
          numB++;
          result.push({ type: 'added', text: lineB, lineNumB: numB });
        }
      }
    }
    return result;
  }

  function pinCurrentResponse() {
    pinnedResponse = currentResponse;
    pinnedLabel = `Pinned at ${new Date().toLocaleTimeString()}`;
  }

  function clearPinned() {
    pinnedResponse = null;
    pinnedLabel = '';
  }

  run(() => {
    if (currentResponse && currentUrl) {
      const prev = previousResponses.get(currentUrl);
      if (prev !== currentResponse) {
        if (prev) {
          // store previous automatically
        }
        previousResponses.set(currentUrl, currentResponse);
        previousResponses = previousResponses;
      }
    }
  });

  let responseA = $derived(pinnedResponse || '');
  let responseB = $derived(currentResponse || '');
  let prettyA = $derived(prettyPrint(responseA));
  let prettyB = $derived(prettyPrint(responseB));
  let diffLines = $derived(responseA ? computeDiff(prettyA, prettyB) : []);
  let hasChanges = $derived(diffLines.some(l => l.type !== 'unchanged'));
  let addedCount = $derived(diffLines.filter(l => l.type === 'added').length);
  let removedCount = $derived(diffLines.filter(l => l.type === 'removed').length);
</script>

<div class="diff-container">
  <div class="diff-toolbar">
    <div class="diff-actions">
      <button class="diff-btn" onclick={pinCurrentResponse} title="Pin current response as baseline (A)">
        📌 Pin Response A
      </button>
      {#if pinnedResponse}
        <button class="diff-btn diff-clear" onclick={clearPinned}>Clear Pinned</button>
        <span class="diff-label">{pinnedLabel}</span>
      {/if}
    </div>
    {#if responseA && hasChanges}
      <div class="diff-stats">
        <span class="diff-stat added">+{addedCount}</span>
        <span class="diff-stat removed">-{removedCount}</span>
      </div>
    {/if}
  </div>

  {#if !responseA}
    <div class="diff-empty">
      <p>Pin a response (A) first, then send another request to compare.</p>
      <p class="diff-hint">The current response becomes "B" and is compared against the pinned "A".</p>
    </div>
  {:else if !hasChanges}
    <div class="diff-empty">
      <p>Responses are identical — no differences found.</p>
    </div>
  {:else}
    <div class="diff-output">
      {#each diffLines as line}
        <div class="diff-line {line.type}">
          <span class="diff-gutter">{line.type === 'removed' ? line.lineNumA ?? '' : line.type === 'added' ? '' : line.lineNumA ?? ''}</span>
          <span class="diff-gutter">{line.type === 'added' ? line.lineNumB ?? '' : line.type === 'removed' ? '' : line.lineNumB ?? ''}</span>
          <span class="diff-marker">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
          <span class="diff-text">{line.text}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .diff-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .diff-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    gap: 8px;
  }
  .diff-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .diff-btn {
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .diff-btn:hover {
    background: var(--bg-tertiary, #3a3d44);
    color: var(--text-primary);
  }
  .diff-clear {
    color: #ed4245;
    border-color: #ed4245;
  }
  .diff-label {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .diff-stats {
    display: flex;
    gap: 8px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .diff-stat.added { color: #57f287; }
  .diff-stat.removed { color: #ed4245; }
  .diff-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-muted);
    font-size: 0.85rem;
    gap: 4px;
    padding: 32px;
    text-align: center;
  }
  .diff-empty p { margin: 0; }
  .diff-hint {
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .diff-output {
    flex: 1;
    overflow: auto;
    font-family: 'Consolas', 'Fira Code', monospace;
    font-size: 0.78rem;
    line-height: 1.6;
  }
  .diff-line {
    display: flex;
    white-space: pre;
  }
  .diff-line.added {
    background: rgba(87, 242, 135, 0.1);
  }
  .diff-line.removed {
    background: rgba(237, 66, 69, 0.1);
  }
  .diff-gutter {
    width: 36px;
    text-align: right;
    padding-right: 6px;
    color: var(--text-muted, #72767d);
    opacity: 0.5;
    user-select: none;
    flex-shrink: 0;
  }
  .diff-marker {
    width: 16px;
    text-align: center;
    flex-shrink: 0;
    user-select: none;
    font-weight: bold;
  }
  .diff-line.added .diff-marker { color: #57f287; }
  .diff-line.removed .diff-marker { color: #ed4245; }
  .diff-text {
    flex: 1;
    padding-right: 12px;
  }
</style>
