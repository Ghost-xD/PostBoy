<script lang="ts">
  import { createBubbler, stopPropagation } from 'svelte/legacy';

  const bubble = createBubbler();
  import { db, http } from '$lib/api/tauri';
  import { variables, flattenJsonPaths } from '$lib/stores/variableStore';
  import { addLog } from '$lib/stores/consoleStore';
  import {
    executeChain, executeStep, loadChains, saveChains, suggestVariableName, getAvailableVarsForStep,
    type Chain, type ChainStep, type ChainExtraction, type StepResult,
  } from '$lib/utils/chainRunner';

  interface Props {
    collectionId: number;
    collections: any[];
    onClose: () => void;
    initialChainId?: string | null;
    initialResults?: StepResult[] | null;
  }

  let {
    collectionId,
    collections,
    onClose,
    initialChainId = null,
    initialResults = null
  }: Props = $props();

  let chains: Chain[] = $state([]);
  let selectedChainId: string | null = $state(null);
  let isRunning = $state(false);
  let stepResults: StepResult[] = $state([]);
  let editingName = $state(false);
  let nameInput = $state('');

  let testingStepId: string | null = $state(null);
  let stepPaths: Map<string, Array<{ path: string; value: string }>> = $state(new Map());
  let showResults = $state(false);
  let expandedBodies = $state(new Set<number>());
  let copiedIdx: number | null = $state(null);
  let activeResultTab: Map<number, 'body' | 'headers'> = new Map();

  function toggleBody(idx: number) {
    if (expandedBodies.has(idx)) expandedBodies.delete(idx);
    else expandedBodies.add(idx);
    expandedBodies = new Set(expandedBodies);
  }

  function expandAllBodies() {
    expandedBodies = new Set(stepResults.map((_, i) => i));
  }

  function collapseAllBodies() {
    expandedBodies = new Set();
  }

  function formatBody(body: string): string {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  async function copyBody(idx: number) {
    const body = stepResults[idx]?.response?.body;
    if (!body) return;
    try {
      await navigator.clipboard.writeText(formatBody(body));
      copiedIdx = idx;
      setTimeout(() => { copiedIdx = null; }, 1500);
    } catch {}
  }

  function getResultTab(idx: number): 'body' | 'headers' {
    return activeResultTab.get(idx) || 'body';
  }

  function setResultTab(idx: number, tab: 'body' | 'headers') {
    activeResultTab.set(idx, tab);
    activeResultTab = new Map(activeResultTab);
  }

  let resultsPassed = $derived(stepResults.filter(r => r.status === 'success').length);
  let resultsFailed = $derived(stepResults.filter(r => r.status === 'error').length);
  let resultsSkipped = $derived(stepResults.filter(r => r.status === 'skipped').length);
  let resultsTotalTime = $derived(stepResults.reduce((sum, r) => sum + (r.response?.time || 0), 0));

  function backToBuilder() {
    showResults = false;
  }

  let collection = $derived(collections.find(c => c.id === collectionId));
  let requests = $derived(collection?.requests || []);
  let currentChain = $derived(chains.find(c => c.id === selectedChainId) || null);

  async function init() {
    chains = await loadChains(collectionId);
    if (initialChainId && chains.some(c => c.id === initialChainId)) {
      selectedChainId = initialChainId;
    } else if (chains.length > 0) {
      selectedChainId = chains[0].id;
    }
    if (initialResults) {
      stepResults = initialResults;
      showResults = true;
      expandedBodies = new Set();
    }
  }
  init();

  function newChain() {
    const chain: Chain = {
      id: crypto.randomUUID(),
      name: `Chain ${chains.length + 1}`,
      steps: [],
    };
    chains = [...chains, chain];
    selectedChainId = chain.id;
    stepResults = [];
  }

  async function deleteChain() {
    if (!selectedChainId) return;
    chains = chains.filter(c => c.id !== selectedChainId);
    selectedChainId = chains.length > 0 ? chains[0].id : null;
    stepResults = [];
    await persist();
  }

  function startRename() {
    if (!currentChain) return;
    nameInput = currentChain.name;
    editingName = true;
  }

  function finishRename() {
    if (!currentChain || !nameInput.trim()) { editingName = false; return; }
    currentChain.name = nameInput.trim();
    chains = [...chains];
    editingName = false;
  }

  function addStep() {
    if (!currentChain) return;
    const step: ChainStep = {
      id: crypto.randomUUID(),
      requestId: requests.length > 0 ? requests[0].id : 0,
      extractions: [],
    };
    currentChain.steps = [...currentChain.steps, step];
    chains = [...chains];
  }

  function removeStep(stepId: string) {
    if (!currentChain) return;
    currentChain.steps = currentChain.steps.filter(s => s.id !== stepId);
    chains = [...chains];
  }

  function moveStep(stepId: string, dir: -1 | 1) {
    if (!currentChain) return;
    const idx = currentChain.steps.findIndex(s => s.id === stepId);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= currentChain.steps.length) return;
    const steps = [...currentChain.steps];
    [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
    currentChain.steps = steps;
    chains = [...chains];
  }

  function addExtraction(stepId: string) {
    if (!currentChain) return;
    const step = currentChain.steps.find(s => s.id === stepId);
    if (!step) return;
    step.extractions = [...step.extractions, { jsonPath: '', variableName: '' }];
    chains = [...chains];
  }

  function removeExtraction(stepId: string, extIdx: number) {
    if (!currentChain) return;
    const step = currentChain.steps.find(s => s.id === stepId);
    if (!step) return;
    step.extractions = step.extractions.filter((_, i) => i !== extIdx);
    chains = [...chains];
  }

  function addPathAsExtraction(stepId: string, pathItem: { path: string; value: string }) {
    if (!currentChain) return;
    const step = currentChain.steps.find(s => s.id === stepId);
    if (!step) return;
    const varName = suggestVariableName(pathItem.path);
    step.extractions = [...step.extractions, { jsonPath: pathItem.path, variableName: varName }];
    chains = [...chains];
  }

  async function testStep(step: ChainStep) {
    if (!currentChain || testingStepId) return;
    testingStepId = step.id;
    try {
      await variables.load(collectionId);
      const stepIdx = currentChain.steps.findIndex(s => s.id === step.id);

      // Run all preceding steps first so their extractions populate variables
      for (let i = 0; i < stepIdx; i++) {
        const prev = currentChain.steps[i];
        addLog(`Chain test: running prerequisite step ${i + 1}…`, 'system');
        const preResult = await executeStep(prev.requestId, collectionId, prev.extractions);
        if (preResult.extractedValues.length > 0) {
          for (const ev of preResult.extractedValues) {
            addLog(`  Extracted: {{${ev.variableName}}} = ${ev.value.length > 20 ? ev.value.slice(0, 8) + '…' + ev.value.slice(-8) : ev.value}`, 'system');
          }
        }
        if (preResult.status === 'error') {
          addLog(`Chain test: prerequisite step ${i + 1} failed (${preResult.response?.status ?? '?'}) — aborting`, 'error');
          return;
        }
      }

      const result = await executeStep(step.requestId, collectionId, step.extractions);
      if (result.response?.body) {
        try {
          const parsed = JSON.parse(result.response.body);
          const paths = flattenJsonPaths(parsed);
          stepPaths.set(step.id, paths);
          stepPaths = new Map(stepPaths);
        } catch { /* not JSON */ }
      }
      addLog(`Chain test: ${result.requestMethod} ${result.requestUrl} — ${result.response?.status ?? '?'} (${result.response?.time ?? 0}ms)`, 'info');
    } catch (err: any) {
      addLog(`Chain test failed: ${err.message || err}`, 'error');
    } finally {
      testingStepId = null;
    }
  }

  async function persist() {
    await saveChains(collectionId, chains);
  }

  async function saveAndClose() {
    await persist();
    onClose();
  }

  async function runChain() {
    if (!currentChain || isRunning) return;
    isRunning = true;
    stepResults = currentChain.steps.map((_, i) => ({
      stepIndex: i, requestName: '', requestMethod: '', requestUrl: '',
      status: 'pending' as const, extractedValues: [],
    }));

    const results = await executeChain(currentChain, collectionId, {
      onStepStart(idx) {
        stepResults[idx] = { ...stepResults[idx], status: 'running' };
        stepResults = [...stepResults];
      },
      onStepComplete(result) {
        stepResults[result.stepIndex] = result;
        stepResults = [...stepResults];
      },
      onLog(msg, level) {
        addLog(`[Chain: ${currentChain!.name}] ${msg}`, level);
      },
    });

    stepResults = results;
    isRunning = false;
    showResults = true;
    expandedBodies = new Set();
  }

  function getRequestName(requestId: number): string {
    const req = requests.find((r: any) => r.id === requestId);
    return req ? `${req.method} ${req.name}` : 'Unknown';
  }

  function getRequestPreview(requestId: number): string {
    const req = requests.find((r: any) => r.id === requestId);
    return req?.url || '';
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    };
  }
</script>

<div class="chain-overlay" role="dialog" tabindex="-1" use:portal onclick={onClose} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
  <div class="chain-modal" role="presentation" onclick={stopPropagation(bubble('click'))} onkeypress={stopPropagation(bubble('keypress'))}>
    <!-- HEADER -->
    <div class="cm-header">
      <h3>Chain Builder — {collection?.name || 'Collection'}</h3>
      <button class="cm-close" onclick={onClose}>×</button>
    </div>

    <!-- CHAIN SELECTOR -->
    <div class="cm-selector">
      <select bind:value={selectedChainId} onchange={() => { stepResults = []; }}>
        {#if chains.length === 0}
          <option value={null}>-- No chains --</option>
        {/if}
        {#each chains as chain}
          <option value={chain.id}>{chain.name}</option>
        {/each}
      </select>
      <button class="cm-btn primary" onclick={newChain}>+ New</button>
      {#if currentChain}
        {#if editingName}
          <input class="cm-name-input" bind:value={nameInput} onkeydown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') editingName = false; }} onblur={finishRename} />
        {:else}
          <button class="cm-btn" onclick={startRename}>Rename</button>
        {/if}
        <button class="cm-btn danger" onclick={deleteChain}>Delete</button>
      {/if}
    </div>

    {#if showResults && stepResults.length > 0}
      <!-- RESULTS VIEW -->
      <div class="cm-body cr-results-body">
        <!-- Summary bar -->
        <div class="cr-topbar">
          <span class="cr-topbar-icon" class:pass={resultsFailed === 0} class:fail={resultsFailed > 0}>
            {resultsFailed > 0 ? '✗' : '✓'}
          </span>
          <span class="cr-topbar-title">{resultsFailed > 0 ? 'Chain Failed' : 'Chain Passed'}</span>
          <span class="cr-pill pass">{resultsPassed} passed</span>
          {#if resultsFailed > 0}<span class="cr-pill fail">{resultsFailed} failed</span>{/if}
          {#if resultsSkipped > 0}<span class="cr-pill skip">{resultsSkipped} skipped</span>{/if}
          <span class="cr-pill time">{resultsTotalTime < 1000 ? `${resultsTotalTime}ms` : `${(resultsTotalTime/1000).toFixed(2)}s`}</span>
          <span class="cr-topbar-actions">
            <button class="cr-link-btn" onclick={expandAllBodies}>Expand All</button>
            <button class="cr-link-btn" onclick={collapseAllBodies}>Collapse All</button>
          </span>
        </div>

        <!-- Scrollable step cards -->
        <div class="cr-scroll">
          {#each stepResults as result, idx}
            <div class="cr-card" class:cr-card-ok={result.status === 'success'} class:cr-card-err={result.status === 'error'} class:cr-card-skip={result.status === 'skipped'}>
              <!-- Step header row — always visible -->
              <div class="cr-card-head">
                <span class="cr-card-status">
                  {#if result.status === 'success'}✓
                  {:else if result.status === 'error'}✗
                  {:else}—{/if}
                </span>
                <span class="cr-card-num">Step {idx + 1}</span>
                <span class="cr-card-method">{result.requestMethod}</span>
                <span class="cr-card-name">{result.requestName || '—'}</span>
                {#if result.response}
                  <span class="cr-card-code" class:ok={result.response.status < 400} class:err={result.response.status >= 400}>{result.response.status}</span>
                  <span class="cr-card-time">{result.response.time}ms</span>
                {:else if result.status === 'skipped'}
                  <span class="cr-card-skiptext">skipped</span>
                {:else if result.error}
                  <span class="cr-card-errtext">error</span>
                {/if}
              </div>

              <!-- URL -->
              {#if result.requestUrl}
                <div class="cr-card-url">{result.requestUrl}</div>
              {/if}

              <!-- Error -->
              {#if result.error}
                <pre class="cr-card-error">{result.error}</pre>
              {/if}

              <!-- Extracted values — always visible -->
              {#if result.extractedValues.length > 0}
                <div class="cr-card-extractions">
                  {#each result.extractedValues as ev}
                    <div class="cr-ext-row">
                      <span class="cr-ext-var">{`{{${ev.variableName}}}`}</span>
                      <span class="cr-ext-eq">=</span>
                      <span class="cr-ext-val" title={ev.value}>{ev.value}</span>
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- Skipped message -->
              {#if result.status === 'skipped'}
                <div class="cr-card-skipmsg">Skipped — a preceding step failed.</div>
              {/if}

              <!-- Response body toggle -->
              {#if result.response?.body || result.response?.headers}
                <div class="cr-card-toggle-row">
                  <button class="cr-card-toggle" onclick={() => toggleBody(idx)}>
                    {expandedBodies.has(idx) ? '▼' : '▶'} Response
                  </button>
                  {#if expandedBodies.has(idx)}
                    <div class="cr-card-tabs">
                      <button class="cr-tab" class:active={getResultTab(idx) === 'body'} onclick={() => setResultTab(idx, 'body')}>Body</button>
                      {#if result.response?.headers}
                        <button class="cr-tab" class:active={getResultTab(idx) === 'headers'} onclick={() => setResultTab(idx, 'headers')}>Headers</button>
                      {/if}
                    </div>
                    <button class="cr-copy-btn" onclick={() => copyBody(idx)}>
                      {copiedIdx === idx ? '✓ Copied' : 'Copy'}
                    </button>
                  {/if}
                </div>
                {#if expandedBodies.has(idx)}
                  <pre class="cr-card-body">{#if getResultTab(idx) === 'body'}{formatBody(result.response?.body || '')}{:else}{#each Object.entries(result.response?.headers || {}) as [k, v]}{k}: {v}
{/each}{/if}</pre>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- RESULTS FOOTER -->
      <div class="cm-footer">
        <button class="cm-btn" onclick={backToBuilder}>← Back to Builder</button>
        <div class="cm-footer-right">
          <button class="cm-btn run" onclick={() => { showResults = false; runChain(); }} disabled={!currentChain || currentChain.steps.length === 0 || isRunning}>
            Re-run Chain
          </button>
          <button class="cm-btn" onclick={onClose}>Close</button>
        </div>
      </div>

    {:else}

    <!-- STEP BUILDER -->
    <div class="cm-body">
      {#if currentChain}
        {#if currentChain.steps.length === 0}
          <div class="cm-empty">No steps yet. Click "+ Add Step" to begin building your chain.</div>
        {/if}

        {#each currentChain.steps as step, idx (step.id)}
          {@const stepIdx = idx}
          {@const availVars = getAvailableVarsForStep(currentChain, stepIdx)}
          {@const paths = stepPaths.get(step.id) || []}
          {@const result = stepResults[stepIdx]}

          <div class="cm-step" class:error={result?.status === 'error'} class:success={result?.status === 'success'}>
            <div class="cm-step-header">
              <span class="cm-step-num">Step {stepIdx + 1}</span>
              <select bind:value={step.requestId} onchange={() => { stepPaths.delete(step.id); stepPaths = new Map(stepPaths); chains = [...chains]; }}>
                {#each requests as req}
                  <option value={req.id}>{req.method} {req.name}</option>
                {/each}
              </select>
              <button class="cm-btn sm" onclick={() => testStep(step)} disabled={testingStepId === step.id || isRunning}>
                {testingStepId === step.id ? '...' : '▶ Test'}
              </button>
              <div class="cm-step-actions">
                <button class="cm-btn sm" onclick={() => moveStep(step.id, -1)} disabled={stepIdx === 0} title="Move up">↑</button>
                <button class="cm-btn sm" onclick={() => moveStep(step.id, 1)} disabled={stepIdx === currentChain.steps.length - 1} title="Move down">↓</button>
                <button class="cm-btn sm danger" onclick={() => removeStep(step.id)} title="Remove step">×</button>
              </div>
            </div>

            <div class="cm-step-url">{getRequestPreview(step.requestId)}</div>

            {#if availVars.length > 0}
              <div class="cm-step-uses">
                <span class="cm-uses-label">Uses:</span>
                {#each availVars as v}
                  <span class="cm-var-badge">{`{{${v}}}`}</span>
                {/each}
              </div>
            {/if}

            <!-- Extractions -->
            <div class="cm-extractions">
              <div class="cm-ext-header">
                <span class="cm-ext-label">Extractions</span>
                <button class="cm-btn sm primary" onclick={() => addExtraction(step.id)}>+ Add</button>
              </div>
              {#each step.extractions as ext, extIdx}
                <div class="cm-ext-row">
                  <input class="cm-ext-input" placeholder="JSON path (e.g. data.token)" bind:value={ext.jsonPath} oninput={() => { chains = [...chains]; }} />
                  <span class="cm-ext-arrow">→</span>
                  <span class="cm-ext-brace">{`{{`}</span>
                  <input class="cm-ext-input var" placeholder="variableName" bind:value={ext.variableName} oninput={() => { chains = [...chains]; }} />
                  <span class="cm-ext-brace">{`}}`}</span>
                  <button class="cm-ext-rm" onclick={() => removeExtraction(step.id, extIdx)}>×</button>
                </div>
              {/each}
              {#if step.extractions.length === 0}
                <div class="cm-ext-empty">No extractions. Add one or click a discovered path below.</div>
              {/if}
            </div>

            <!-- Discovered paths (after test) -->
            {#if paths.length > 0}
              <div class="cm-paths">
                <span class="cm-paths-label">Discovered paths (click to add):</span>
                <div class="cm-paths-list">
                  {#each paths.slice(0, 40) as p}
                    <button class="cm-path-btn" onclick={() => addPathAsExtraction(step.id, p)} title={p.value}>
                      <span class="cm-path-name">{p.path}</span>
                      <span class="cm-path-val">{p.value.length > 25 ? p.value.slice(0, 25) + '...' : p.value}</span>
                    </button>
                  {/each}
                  {#if paths.length > 40}
                    <span class="cm-paths-more">...and {paths.length - 40} more</span>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Step result badge -->
            {#if result}
              <div class="cm-step-result {result.status}">
                {#if result.status === 'running'}
                  ⏳ Running...
                {:else if result.status === 'success'}
                  ✓ {result.response?.status} {result.response?.statusText} ({result.response?.time}ms)
                  {#if result.extractedValues.length > 0}
                    — extracted {result.extractedValues.length} value(s)
                  {/if}
                {:else if result.status === 'error'}
                  ✗ {result.error || 'Error'}
                {:else if result.status === 'skipped'}
                  ⊘ Skipped
                {:else if result.status === 'pending'}
                  ○ Pending
                {/if}
              </div>
            {/if}
          </div>

          <!-- Connector arrow between steps -->
          {#if stepIdx < currentChain.steps.length - 1}
            <div class="cm-connector">
              <svg width="16" height="24" viewBox="0 0 16 24"><path d="M8 0v18m-4-4l4 4 4-4" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            </div>
          {/if}
        {/each}

        <button class="cm-add-step" onclick={addStep}>+ Add Step</button>
      {:else}
        <div class="cm-empty">Select or create a chain to start.</div>
      {/if}
    </div>

    <!-- FOOTER -->
    <div class="cm-footer">
      <button class="cm-btn" onclick={onClose}>Cancel</button>
      <div class="cm-footer-right">
        <button class="cm-btn primary" onclick={saveAndClose} disabled={!currentChain}>Save</button>
        <button class="cm-btn run" onclick={runChain} disabled={!currentChain || currentChain.steps.length === 0 || isRunning}>
          {isRunning ? '⏳ Running...' : '▶ Run Chain'}
        </button>
      </div>
    </div>

    {/if}
  </div>
</div>

<style>
  .chain-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.7); display: flex;
    align-items: center; justify-content: center; z-index: 1000;
  }
  .chain-modal {
    background: var(--bg-tertiary); border-radius: 8px;
    width: 680px; max-width: 94vw; max-height: 92vh;
    display: flex; flex-direction: column;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  }
  .chain-modal:has(:global(.cr-results-body)) {
    width: 860px; height: 85vh;
  }

  .cm-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 20px; border-bottom: 1px solid var(--border-color);
  }
  .cm-header h3 { margin: 0; color: #f2f3f5; font-size: 15px; }
  .cm-close {
    background: none; border: none; color: #949ba4;
    font-size: 20px; cursor: pointer; padding: 0 4px;
  }
  .cm-close:hover { color: #f2f3f5; }

  .cm-selector {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 20px; border-bottom: 1px solid var(--border-color);
    background: #313338;
  }
  .cm-selector select {
    flex: 1; padding: 7px 10px; background: var(--bg-secondary);
    border: 1px solid var(--border-color); border-radius: 4px;
    color: #dbdee1; font-size: 13px;
  }
  .cm-selector select:focus { outline: none; border-color: #5865f2; }
  .cm-name-input {
    width: 120px; padding: 6px 8px; background: var(--bg-secondary);
    border: 1px solid #5865f2; border-radius: 4px;
    color: #dbdee1; font-size: 13px; outline: none;
  }

  .cm-btn {
    padding: 5px 12px; background: #4e5058; color: #dbdee1;
    border: none; border-radius: 4px; font-size: 12px;
    cursor: pointer; white-space: nowrap;
  }
  .cm-btn:hover { background: #5d5f69; }
  .cm-btn:disabled { opacity: 0.4; cursor: default; }
  .cm-btn.primary { background: #5865f2; color: #fff; }
  .cm-btn.primary:hover { background: #4752c4; }
  .cm-btn.danger { background: #4e5058; color: #f04747; }
  .cm-btn.danger:hover { background: #5d5f69; }
  .cm-btn.run { background: #248046; color: #fff; }
  .cm-btn.run:hover { background: #1a6334; }
  .cm-btn.sm { padding: 3px 8px; font-size: 11px; }

  .cm-body {
    flex: 1; overflow-y: auto; padding: 16px 20px;
    display: flex; flex-direction: column; align-items: center; gap: 0;
  }
  .cm-empty {
    color: #72767d; font-size: 13px; font-style: italic;
    text-align: center; padding: 32px 0;
  }

  .cm-step {
    width: 100%; background: #313338; border: 1px solid var(--border-color);
    border-radius: 6px; padding: 12px 14px;
    transition: border-color 0.15s;
  }
  .cm-step.success { border-color: #248046; }
  .cm-step.error { border-color: #f04747; }

  .cm-step-header {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  }
  .cm-step-num {
    font-size: 11px; font-weight: 700; color: #b5bac1;
    text-transform: uppercase; letter-spacing: 0.03em; min-width: 44px;
  }
  .cm-step-header select {
    flex: 1; padding: 6px 8px; background: var(--bg-secondary);
    border: 1px solid var(--border-color); border-radius: 4px;
    color: #dbdee1; font-size: 12px;
  }
  .cm-step-header select:focus { outline: none; border-color: #5865f2; }
  .cm-step-actions { display: flex; gap: 2px; margin-left: auto; }

  .cm-step-url {
    font-size: 11px; color: #72767d; font-family: monospace;
    margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .cm-step-uses {
    display: flex; align-items: center; gap: 4px;
    flex-wrap: wrap; margin-bottom: 8px;
  }
  .cm-uses-label { font-size: 10px; color: #949ba4; text-transform: uppercase; font-weight: 600; }
  .cm-var-badge {
    font-size: 10px; padding: 2px 6px; background: #3b3d44;
    border-radius: 3px; color: #5865f2; font-family: monospace;
  }

  .cm-extractions { margin-top: 4px; }
  .cm-ext-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 6px;
  }
  .cm-ext-label { font-size: 10px; color: #b5bac1; text-transform: uppercase; font-weight: 600; }
  .cm-ext-row {
    display: flex; align-items: center; gap: 4px; margin-bottom: 5px;
  }
  .cm-ext-input {
    flex: 1; padding: 5px 7px; background: var(--bg-secondary);
    border: 1px solid var(--border-color); border-radius: 3px;
    color: #dbdee1; font-size: 11px; font-family: monospace;
  }
  .cm-ext-input:focus { outline: none; border-color: #5865f2; }
  .cm-ext-input.var { max-width: 120px; color: #5865f2; }
  .cm-ext-arrow { color: #949ba4; font-size: 12px; flex-shrink: 0; }
  .cm-ext-brace { color: #5865f2; font-size: 12px; font-family: monospace; flex-shrink: 0; }
  .cm-ext-rm {
    background: none; border: none; color: #f04747; font-size: 14px;
    cursor: pointer; padding: 2px 4px; opacity: 0.6;
  }
  .cm-ext-rm:hover { opacity: 1; }
  .cm-ext-empty { font-size: 11px; color: #72767d; font-style: italic; padding: 4px 0; }

  .cm-paths { margin-top: 8px; }
  .cm-paths-label { font-size: 10px; color: #949ba4; display: block; margin-bottom: 4px; }
  .cm-paths-list {
    display: flex; flex-wrap: wrap; gap: 4px;
    max-height: 100px; overflow-y: auto;
  }
  .cm-path-btn {
    display: flex; gap: 6px; padding: 3px 8px;
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    border-radius: 3px; cursor: pointer; font-size: 10px;
    color: #dbdee1; transition: border-color 0.1s;
  }
  .cm-path-btn:hover { border-color: #5865f2; }
  .cm-path-name { color: #e8c56c; font-family: monospace; }
  .cm-path-val { color: #72767d; }
  .cm-paths-more { font-size: 10px; color: #72767d; padding: 3px 8px; }

  .cm-step-result {
    margin-top: 8px; padding: 5px 8px; border-radius: 3px;
    font-size: 11px;
  }
  .cm-step-result.pending { color: #949ba4; background: var(--bg-tertiary); }
  .cm-step-result.running { color: #e8c56c; background: #3a3520; }
  .cm-step-result.success { color: #57f287; background: #1a3322; }
  .cm-step-result.error { color: #ed4245; background: #3a1a1a; }
  .cm-step-result.skipped { color: #949ba4; background: var(--bg-tertiary); font-style: italic; }

  .cm-connector {
    display: flex; justify-content: center; padding: 2px 0;
    color: #4e5058;
  }

  .cm-add-step {
    margin-top: 12px; padding: 8px 20px; background: #313338;
    border: 1px dashed #4e5058; border-radius: 6px;
    color: #b5bac1; font-size: 12px; cursor: pointer;
    width: 100%; transition: all 0.1s;
  }
  .cm-add-step:hover { border-color: #5865f2; color: #5865f2; }

  .cm-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 20px; border-top: 1px solid var(--border-color);
  }
  .cm-footer-right { display: flex; gap: 8px; }

  /* ── Results View ── */
  .cr-results-body {
    padding: 0 !important;
    align-items: stretch !important;
    overflow: hidden !important;
  }

  .cr-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .cr-topbar-icon {
    font-size: 16px;
    font-weight: 700;
  }
  .cr-topbar-icon.pass { color: #57f287; }
  .cr-topbar-icon.fail { color: #f04747; }
  .cr-topbar-title {
    font-size: 14px;
    font-weight: 600;
    color: #f2f3f5;
    margin-right: 6px;
  }
  .cr-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 10px;
  }
  .cr-pill.pass { color: #57f287; background: rgba(87,242,135,0.1); }
  .cr-pill.fail { color: #f04747; background: rgba(240,71,71,0.1); }
  .cr-pill.skip { color: #949ba4; background: rgba(148,155,164,0.1); }
  .cr-pill.time { color: #72767d; background: rgba(114,118,125,0.1); }
  .cr-topbar-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .cr-link-btn {
    background: none;
    border: 1px solid #4e5058;
    color: #b5bac1;
    font-size: 11px;
    cursor: pointer;
    padding: 3px 10px;
    border-radius: 3px;
  }
  .cr-link-btn:hover { background: #383a40; color: #f2f3f5; }

  .cr-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .cr-card {
    background: #313338;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .cr-card.cr-card-ok { border-left: 3px solid #57f287; }
  .cr-card.cr-card-err { border-left: 3px solid #f04747; }
  .cr-card.cr-card-skip { border-left: 3px solid #4e5058; }

  .cr-card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
  }
  .cr-card-status {
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
    width: 18px;
    text-align: center;
  }
  .cr-card-ok .cr-card-status { color: #57f287; }
  .cr-card-err .cr-card-status { color: #f04747; }
  .cr-card-skip .cr-card-status { color: #72767d; }
  .cr-card-num {
    font-weight: 700;
    color: #949ba4;
    font-size: 12px;
    flex-shrink: 0;
    min-width: 46px;
  }
  .cr-card-method {
    font-weight: 700;
    font-size: 10px;
    padding: 2px 7px;
    background: #4e5058;
    border-radius: 3px;
    color: #dbdee1;
    font-family: monospace;
    flex-shrink: 0;
    text-transform: uppercase;
  }
  .cr-card-name {
    font-size: 14px;
    color: #f2f3f5;
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cr-card-code {
    font-weight: 700;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 3px;
    font-family: monospace;
    flex-shrink: 0;
  }
  .cr-card-code.ok { color: #57f287; background: rgba(87,242,135,0.12); }
  .cr-card-code.err { color: #f04747; background: rgba(240,71,71,0.12); }
  .cr-card-time {
    color: #72767d;
    font-size: 11px;
    font-family: monospace;
    flex-shrink: 0;
  }
  .cr-card-skiptext { color: #72767d; font-size: 11px; font-style: italic; }
  .cr-card-errtext { color: #f04747; font-size: 11px; font-weight: 600; }

  .cr-card-url {
    padding: 0 16px 10px;
    font-size: 12px;
    color: #72767d;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    word-break: break-all;
  }

  .cr-card-error {
    margin: 0 16px 10px;
    padding: 10px 12px;
    background: rgba(240,71,71,0.06);
    border: 1px solid rgba(240,71,71,0.2);
    border-radius: 4px;
    color: #f04747;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .cr-card-extractions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 16px 10px;
  }
  .cr-ext-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    overflow: hidden;
  }
  .cr-ext-var { color: #5865f2; font-weight: 600; flex-shrink: 0; }
  .cr-ext-eq { color: #72767d; flex-shrink: 0; }
  .cr-ext-val {
    color: #57f287;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .cr-card-skipmsg {
    padding: 6px 16px 12px;
    font-size: 12px;
    color: #72767d;
    font-style: italic;
  }

  .cr-card-toggle-row {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 16px;
    border-top: 1px solid var(--border-color);
    min-height: 36px;
  }
  .cr-card-toggle {
    background: none;
    border: none;
    color: #b5bac1;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 8px 8px 8px 0;
    flex-shrink: 0;
  }
  .cr-card-toggle:hover { color: #f2f3f5; }

  .cr-card-tabs {
    display: flex;
    gap: 0;
    margin-left: 12px;
  }
  .cr-tab {
    padding: 8px 12px;
    border: none;
    background: none;
    color: #949ba4;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .cr-tab:hover { color: #dbdee1; }
  .cr-tab.active { color: #f2f3f5; border-bottom-color: #5865f2; }

  .cr-copy-btn {
    margin-left: auto;
    padding: 4px 12px;
    border: 1px solid #4e5058;
    background: none;
    color: #b5bac1;
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .cr-copy-btn:hover { background: #383a40; color: #f2f3f5; }

  .cr-card-body {
    margin: 0;
    padding: 12px 16px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    color: #dbdee1;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    max-height: 300px;
    overflow: auto;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
  }
</style>
