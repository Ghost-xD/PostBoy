<script lang="ts">
  import { tick } from 'svelte';
  import { createBubbler, stopPropagation } from 'svelte/legacy';

  const bubble = createBubbler();
  import { db, http } from '$lib/api/tauri';
  import { variables, flattenJsonPaths } from '$lib/stores/variableStore';
  import { addLog } from '$lib/stores/consoleStore';
  import {
    executeChain, executeStep, loadChains, saveChains, suggestVariableName, getAvailableVarsForStep,
    type Chain, type ChainStep, type ChainExtraction, type StepResult,
  } from '$lib/utils/chainRunner';
  import { pickChainRunEnvironment, applyChainRunEnvironment } from '$lib/utils/chainEnvironmentPicker';
  import { chainGenerators, buildChainCodegenInput } from '$lib/utils/chainCodeGenerator';

  interface Props {
    collectionId: number;
    collections: any[];
    onClose: () => void;
    initialChainId?: string | null;
    initialResults?: StepResult[] | null;
    /** Open directly into the results view and start executing immediately. */
    autoRun?: boolean;
    /** Environment was already chosen before opening (e.g. sidebar play button). */
    environmentPreselected?: boolean;
  }

  let {
    collectionId,
    collections,
    onClose,
    initialChainId = null,
    initialResults = null,
    autoRun = false,
    environmentPreselected = false,
  }: Props = $props();

  let skipEnvPickerOnce = $state(false);

  let chains: Chain[] = $state([]);
  let selectedChainId: string | null = $state(null);
  let isRunning = $state(false);
  let stepResults: StepResult[] = $state([]);
  let editingName = $state(false);
  let nameInput = $state('');

  let testingStepId: string | null = $state(null);
  let stepPaths: Map<string, Array<{ path: string; value: string }>> = $state(new Map());
  let showResults = $state(false);
  let expandedBodies = $state<Record<number, boolean>>({});
  let copiedIdx: number | null = $state(null);
  let activeResultTab = $state<Record<number, 'body' | 'headers'>>({});

  let showChainCodeGenModal = $state(false);
  let chainCodeGenLanguage = $state('fetch');

  let chainCodegenInput = $derived.by(() => {
    if (!currentChain) return null;
    return buildChainCodegenInput(currentChain, requests);
  });

  let generatedChainCode = $derived.by(() => {
    if (!showChainCodeGenModal || !chainCodegenInput) return '';
    return chainGenerators[chainCodeGenLanguage]?.generate(chainCodegenInput) || '';
  });

  function highlightCode(code: string, lang: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escaped = esc(code);
    const keywords: Record<string, string[]> = {
      javascript: ['const','let','var','async','await','function','return','import','require','new','if','else','true','false','null','undefined','typeof','console'],
      python: ['import','from','def','return','class','if','else','elif','True','False','None','print','async','await','with','as','not','in','and','or'],
      bash: ['curl'],
    };
    let result = escaped;
    result = result.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, '<span class="hl-str">$&</span>');
    result = result.replace(/(`)(?:(?=(\\?))\2.)*?\1/g, '<span class="hl-str">$&</span>');
    result = result.replace(/(\/\/.*$|#.*$)/gm, '<span class="hl-cmt">$&</span>');
    result = result.replace(/\b(\d+)\b/g, '<span class="hl-num">$1</span>');
    const kws = keywords[lang] || keywords.javascript || [];
    if (kws.length > 0) {
      const kwPattern = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
      result = result.replace(kwPattern, (match) => `<span class="hl-kw">${match}</span>`);
    }
    if (lang === 'bash') {
      result = result.replace(/(\s)(--?\w[\w-]*)/g, '$1<span class="hl-flag">$2</span>');
    }
    return result;
  }

  let highlightedChainCode = $derived(
    showChainCodeGenModal
      ? highlightCode(generatedChainCode, chainGenerators[chainCodeGenLanguage]?.language || 'javascript')
      : ''
  );

  async function copyGeneratedChainCode() {
    if (!generatedChainCode) return;
    try {
      await navigator.clipboard.writeText(generatedChainCode);
      addLog('✓ Copied chain code snippet', 'system');
    } catch {}
  }

  function openChainCodeGen() {
    if (!chainCodegenInput) {
      addLog('Add at least one step with a valid request before generating code', 'error');
      return;
    }
    showChainCodeGenModal = true;
  }

  function toggleBody(idx: number) {
    expandedBodies = { ...expandedBodies, [idx]: !expandedBodies[idx] };
  }

  function expandAllBodies() {
    expandedBodies = Object.fromEntries(stepResults.map((_, i) => [i, true]));
  }

  function collapseAllBodies() {
    expandedBodies = {};
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
    return activeResultTab[idx] || 'body';
  }

  function setResultTab(idx: number, tab: 'body' | 'headers') {
    activeResultTab = { ...activeResultTab, [idx]: tab };
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
      expandedBodies = {};
    } else if (autoRun && selectedChainId) {
      skipEnvPickerOnce = environmentPreselected;
      await tick();
      await runChain();
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

  async function ensureChainEnvironment(): Promise<boolean> {
    if (skipEnvPickerOnce) {
      skipEnvPickerOnce = false;
      return true;
    }

    const chainName = currentChain?.name ?? 'Chain';
    const picked = await pickChainRunEnvironment(chainName);
    if (picked === undefined) return false;

    const envName = await applyChainRunEnvironment(picked);
    addLog(`▶ Chain "${chainName}" → ${envName}`, 'system');
    return true;
  }

  async function runChain() {
    if (!currentChain || isRunning) return;
    if (!(await ensureChainEnvironment())) return;
    isRunning = true;
    showResults = true;
    expandedBodies = {};
    stepResults = currentChain.steps.map((_, i) => ({
      stepIndex: i, requestName: '', requestMethod: '', requestUrl: '',
      status: 'pending' as const, extractedValues: [],
    }));

    const chainName = currentChain.name;

    const results = await executeChain(currentChain, collectionId, {
      onStepStart(idx) {
        const step = currentChain!.steps[idx];
        const req = requests.find((r: any) => r.id === step.requestId);
        stepResults[idx] = {
          ...stepResults[idx],
          status: 'running',
          requestName: req?.name || '',
          requestMethod: req?.method || '',
          requestUrl: req?.url || '',
        };
        stepResults = [...stepResults];
      },
      onStepComplete(result) {
        stepResults[result.stepIndex] = result;
        stepResults = [...stepResults];
      },
      onLog(msg, level) {
        addLog(`[Chain: ${chainName}] ${msg}`, level);
      },
    });

    stepResults = results;
    isRunning = false;
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
      <div class="cm-header-actions">
        {#if currentChain && currentChain.steps.length > 0}
          <button
            class="action-icon-btn"
            onclick={openChainCodeGen}
            title="Generate Code"
            disabled={!chainCodegenInput}
            aria-label="Generate Code"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
        {/if}
        <button class="cm-close" onclick={onClose}>×</button>
      </div>
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
          <span class="cr-topbar-icon" class:pass={!isRunning && resultsFailed === 0} class:fail={!isRunning && resultsFailed > 0} class:running={isRunning}>
            {isRunning ? '⟳' : resultsFailed > 0 ? '✗' : '✓'}
          </span>
          <span class="cr-topbar-title">{isRunning ? 'Running chain…' : resultsFailed > 0 ? 'Chain Failed' : 'Chain Passed'}</span>
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
            <div class="cr-card" class:cr-card-ok={result.status === 'success'} class:cr-card-err={result.status === 'error'} class:cr-card-skip={result.status === 'skipped'} class:cr-card-running={result.status === 'running'} class:cr-card-pending={result.status === 'pending'}>
              <!-- Step header row — always visible -->
              <div class="cr-card-head">
                <span class="cr-card-status">
                  {#if result.status === 'success'}✓
                  {:else if result.status === 'error'}✗
                  {:else if result.status === 'running'}⟳
                  {:else if result.status === 'pending'}○
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
                {:else if result.status === 'running'}
                  <span class="cr-card-runningtext">running…</span>
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
                    {expandedBodies[idx] ? '▼' : '▶'} Response
                  </button>
                  {#if expandedBodies[idx]}
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
                {#if expandedBodies[idx]}
                  <pre class="cr-card-body">{#if getResultTab(idx) === 'body'}{formatBody(result.response?.body || '') || result.error || '(empty response body)'}{:else}{#each Object.entries(result.response?.headers || {}) as [k, v]}{k}: {v}
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

{#if showChainCodeGenModal && chainCodegenInput}
  <div class="codegen-overlay" use:portal role="dialog" tabindex="-1" onclick={() => showChainCodeGenModal = false} onkeydown={(e) => { if (e.key === 'Escape') showChainCodeGenModal = false; }}>
    <div class="codegen-modal" role="presentation" onclick={stopPropagation(bubble('click'))} onkeypress={stopPropagation(bubble('keypress'))}>
      <div class="codegen-header">
        <h3>Generate Code — {currentChain?.name || 'Chain'}</h3>
        <button class="codegen-close" onclick={() => showChainCodeGenModal = false}>×</button>
      </div>
      <div class="codegen-tabs">
        {#each Object.entries(chainGenerators) as [key, gen]}
          <button class="codegen-tab {chainCodeGenLanguage === key ? 'active' : ''}" onclick={() => chainCodeGenLanguage = key}>
            {gen.label}
          </button>
        {/each}
      </div>
      <div class="codegen-body">
        <pre class="codegen-code">{@html highlightedChainCode}</pre>
      </div>
      <div class="codegen-footer">
        <button class="codegen-copy" onclick={copyGeneratedChainCode}>Copy</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .chain-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.7); display: flex;
    align-items: center; justify-content: center; z-index: 1000;
  }
  .chain-modal {
    background: var(--bg-primary); border-radius: 8px;
    width: 680px; max-width: 94vw; max-height: 92vh;
    display: flex; flex-direction: column;
    box-shadow: var(--shadow);
    border: 1px solid var(--border-color);
  }
  .chain-modal:has(:global(.cr-results-body)) {
    width: 860px; height: 85vh;
  }

  .cm-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 20px; border-bottom: 1px solid var(--border-color);
  }
  .cm-header h3 { margin: 0; color: var(--text-primary); font-size: 15px; }
  .cm-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .action-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary, #b0b0b0);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .action-icon-btn:hover:not(:disabled) {
    background: var(--bg-tertiary, #404040);
    color: var(--text-primary, #fff);
  }
  .action-icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .cm-close {
    background: none; border: none; color: var(--text-secondary);
    font-size: 20px; cursor: pointer; padding: 0 4px;
  }
  .cm-close:hover { color: var(--text-primary); }

  .cm-selector {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 20px; border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
  }
  .cm-selector select {
    flex: 1; padding: 7px 10px; background: var(--bg-primary);
    border: 1px solid var(--border-color); border-radius: 4px;
    color: var(--text-primary); font-size: 13px;
  }
  .cm-selector select:focus { outline: none; border-color: var(--accent-color); }
  .cm-name-input {
    width: 120px; padding: 6px 8px; background: var(--bg-primary);
    border: 1px solid var(--accent-color); border-radius: 4px;
    color: var(--text-primary); font-size: 13px; outline: none;
  }

  .cm-btn {
    padding: 5px 12px; background: var(--bg-tertiary); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px;
    cursor: pointer; white-space: nowrap;
  }
  .cm-btn:hover:not(.primary):not(.run) { background: var(--bg-secondary); border-color: var(--accent-color); }
  .cm-btn:disabled { opacity: 0.4; cursor: default; }
  .cm-btn.primary { background: var(--accent-color); color: #fff; border-color: var(--accent-color); }
  .cm-btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }
  .cm-btn.danger { background: var(--bg-tertiary); color: var(--error-color); }
  .cm-btn.danger:hover { background: var(--bg-secondary); }
  .cm-btn.run { background: var(--success-color); color: #fff; border-color: var(--success-color); }
  .cm-btn.run:hover { filter: brightness(0.92); }
  .cm-btn.sm { padding: 3px 8px; font-size: 11px; }

  .cm-body {
    flex: 1; overflow-y: auto; padding: 16px 20px;
    display: flex; flex-direction: column; align-items: center; gap: 0;
    background: var(--bg-primary);
  }
  .cm-empty {
    color: var(--text-muted); font-size: 13px; font-style: italic;
    text-align: center; padding: 32px 0;
  }

  .cm-step {
    width: 100%; background: var(--bg-secondary); border: 1px solid var(--border-color);
    border-radius: 6px; padding: 12px 14px;
    transition: border-color 0.15s;
  }
  .cm-step.success { border-color: var(--success-color); }
  .cm-step.error { border-color: var(--error-color); }

  .cm-step-header {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  }
  .cm-step-num {
    font-size: 11px; font-weight: 700; color: var(--text-secondary);
    text-transform: uppercase; letter-spacing: 0.03em; min-width: 44px;
  }
  .cm-step-header select {
    flex: 1; padding: 6px 8px; background: var(--bg-primary);
    border: 1px solid var(--border-color); border-radius: 4px;
    color: var(--text-primary); font-size: 12px;
  }
  .cm-step-header select:focus { outline: none; border-color: var(--accent-color); }
  .cm-step-actions { display: flex; gap: 2px; margin-left: auto; }

  .cm-step-url {
    font-size: 11px; color: var(--text-muted); font-family: monospace;
    margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .cm-step-uses {
    display: flex; align-items: center; gap: 4px;
    flex-wrap: wrap; margin-bottom: 8px;
  }
  .cm-uses-label { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; }
  .cm-var-badge {
    font-size: 10px; padding: 2px 6px; background: var(--bg-tertiary);
    border-radius: 3px; color: var(--accent-color); font-family: monospace;
  }

  .cm-extractions { margin-top: 4px; }
  .cm-ext-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 6px;
  }
  .cm-ext-label { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; }
  .cm-ext-row {
    display: flex; align-items: center; gap: 4px; margin-bottom: 5px;
  }
  .cm-ext-input {
    flex: 1; padding: 5px 7px; background: var(--bg-primary);
    border: 1px solid var(--border-color); border-radius: 3px;
    color: var(--text-primary); font-size: 11px; font-family: monospace;
  }
  .cm-ext-input:focus { outline: none; border-color: var(--accent-color); }
  .cm-ext-input.var { max-width: 120px; color: var(--accent-color); }
  .cm-ext-arrow { color: var(--text-secondary); font-size: 12px; flex-shrink: 0; }
  .cm-ext-brace { color: var(--accent-color); font-size: 12px; font-family: monospace; flex-shrink: 0; }
  .cm-ext-rm {
    background: none; border: none; color: var(--error-color); font-size: 14px;
    cursor: pointer; padding: 2px 4px; opacity: 0.6;
  }
  .cm-ext-rm:hover { opacity: 1; }
  .cm-ext-empty { font-size: 11px; color: var(--text-muted); font-style: italic; padding: 4px 0; }

  .cm-paths { margin-top: 8px; }
  .cm-paths-label { font-size: 10px; color: var(--text-secondary); display: block; margin-bottom: 4px; }
  .cm-paths-list {
    display: flex; flex-wrap: wrap; gap: 4px;
    max-height: 100px; overflow-y: auto;
  }
  .cm-path-btn {
    display: flex; gap: 6px; padding: 3px 8px;
    background: var(--bg-primary); border: 1px solid var(--border-color);
    border-radius: 3px; cursor: pointer; font-size: 10px;
    color: var(--text-primary); transition: border-color 0.1s;
  }
  .cm-path-btn:hover { border-color: var(--accent-color); }
  .cm-path-name { color: var(--warning-color); font-family: monospace; }
  .cm-path-val { color: var(--text-muted); }
  .cm-paths-more { font-size: 10px; color: var(--text-muted); padding: 3px 8px; }

  .cm-step-result {
    margin-top: 8px; padding: 5px 8px; border-radius: 3px;
    font-size: 11px;
  }
  .cm-step-result.pending { color: var(--text-secondary); background: var(--bg-tertiary); }
  .cm-step-result.running { color: var(--warning-color); background: var(--bg-tertiary); }
  .cm-step-result.success { color: var(--success-color); background: var(--bg-tertiary); }
  .cm-step-result.error { color: var(--error-color); background: var(--bg-tertiary); }
  .cm-step-result.skipped { color: var(--text-secondary); background: var(--bg-tertiary); font-style: italic; }

  .cm-connector {
    display: flex; justify-content: center; padding: 2px 0;
    color: var(--border-color);
  }

  .cm-add-step {
    margin-top: 12px; padding: 8px 20px; background: var(--bg-secondary);
    border: 1px dashed var(--border-color); border-radius: 6px;
    color: var(--text-secondary); font-size: 12px; cursor: pointer;
    width: 100%; transition: all 0.1s;
  }
  .cm-add-step:hover { border-color: var(--accent-color); color: var(--accent-color); }

  .cm-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 20px; border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
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
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .cr-topbar-icon {
    font-size: 16px;
    font-weight: 700;
  }
  .cr-topbar-icon.pass { color: var(--success-color); }
  .cr-topbar-icon.fail { color: var(--error-color); }
  .cr-topbar-icon.running { color: var(--accent-color, #5865f2); }
  .cr-topbar-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-right: 6px;
  }
  .cr-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 10px;
  }
  .cr-pill.pass { color: var(--success-color); background: color-mix(in srgb, var(--success-color) 12%, transparent); }
  .cr-pill.fail { color: var(--error-color); background: color-mix(in srgb, var(--error-color) 12%, transparent); }
  .cr-pill.skip { color: var(--text-secondary); background: var(--bg-tertiary); }
  .cr-pill.time { color: var(--text-muted); background: var(--bg-tertiary); }
  .cr-topbar-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .cr-link-btn {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    padding: 3px 10px;
    border-radius: 3px;
  }
  .cr-link-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

  .cr-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    background: var(--bg-primary);
  }

  .cr-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .cr-card.cr-card-ok { border-left: 3px solid var(--success-color); }
  .cr-card.cr-card-err { border-left: 3px solid var(--error-color); }
  .cr-card.cr-card-skip { border-left: 3px solid var(--border-color); }
  .cr-card.cr-card-running { border-left: 3px solid var(--accent-color, #5865f2); }
  .cr-card.cr-card-pending { border-left: 3px solid var(--border-color); opacity: 0.72; }

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
  .cr-card-ok .cr-card-status { color: var(--success-color); }
  .cr-card-err .cr-card-status { color: var(--error-color); }
  .cr-card-skip .cr-card-status { color: var(--text-muted); }
  .cr-card-num {
    font-weight: 700;
    color: var(--text-secondary);
    font-size: 12px;
    flex-shrink: 0;
    min-width: 46px;
  }
  .cr-card-method {
    font-weight: 700;
    font-size: 10px;
    padding: 2px 7px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    color: var(--text-primary);
    font-family: monospace;
    flex-shrink: 0;
    text-transform: uppercase;
  }
  .cr-card-name {
    font-size: 14px;
    color: var(--text-primary);
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
  .cr-card-code.ok { color: var(--success-color); background: color-mix(in srgb, var(--success-color) 12%, transparent); }
  .cr-card-code.err { color: var(--error-color); background: color-mix(in srgb, var(--error-color) 12%, transparent); }
  .cr-card-time {
    color: var(--text-muted);
    font-size: 11px;
    font-family: monospace;
    flex-shrink: 0;
  }
  .cr-card-skiptext { color: var(--text-muted); font-size: 11px; font-style: italic; }
  .cr-card-runningtext { color: var(--accent-color, #5865f2); font-size: 11px; font-style: italic; }
  .cr-card-running .cr-card-status { color: var(--accent-color, #5865f2); }
  .cr-card-errtext { color: var(--error-color); font-size: 11px; font-weight: 600; }

  .cr-card-url {
    padding: 0 16px 10px;
    font-size: 12px;
    color: var(--text-muted);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    word-break: break-all;
  }

  .cr-card-error {
    margin: 0 16px 10px;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--error-color) 8%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--error-color) 25%, var(--border-color));
    border-radius: 4px;
    color: var(--error-color);
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
    background: var(--bg-primary);
    border-radius: 4px;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    overflow: hidden;
  }
  .cr-ext-var { color: var(--accent-color); font-weight: 600; flex-shrink: 0; }
  .cr-ext-eq { color: var(--text-muted); flex-shrink: 0; }
  .cr-ext-val {
    color: var(--success-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .cr-card-skipmsg {
    padding: 6px 16px 12px;
    font-size: 12px;
    color: var(--text-muted);
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
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 8px 8px 8px 0;
    flex-shrink: 0;
  }
  .cr-card-toggle:hover { color: var(--text-primary); }

  .cr-card-tabs {
    display: flex;
    gap: 0;
    margin-left: 12px;
  }
  .cr-tab {
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .cr-tab:hover { color: var(--text-primary); }
  .cr-tab.active { color: var(--text-primary); border-bottom-color: var(--accent-color); }

  .cr-copy-btn {
    margin-left: auto;
    padding: 4px 12px;
    border: 1px solid var(--border-color);
    background: none;
    color: var(--text-secondary);
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .cr-copy-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

  .cr-card-body {
    margin: 0;
    padding: 12px 16px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    max-height: 300px;
    overflow: auto;
    background: var(--bg-primary);
    border-top: 1px solid var(--border-color);
  }

  .codegen-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex; align-items: center; justify-content: center;
    z-index: 1100;
  }
  .codegen-modal {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    width: 720px; max-width: 94vw; max-height: 85vh;
    display: flex; flex-direction: column;
    box-shadow: var(--shadow);
  }
  .codegen-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 18px; border-bottom: 1px solid var(--border-color);
  }
  .codegen-header h3 { margin: 0; font-size: 15px; color: var(--text-primary); }
  .codegen-close {
    background: none; border: none; color: var(--text-secondary);
    font-size: 20px; cursor: pointer;
  }
  .codegen-tabs {
    display: flex; gap: 4px; padding: 10px 14px;
    border-bottom: 1px solid var(--border-color); flex-wrap: wrap;
  }
  .codegen-tab {
    padding: 6px 12px; border: none; border-radius: 4px;
    background: var(--bg-secondary); color: var(--text-secondary);
    font-size: 12px; cursor: pointer;
  }
  .codegen-tab.active {
    background: var(--accent-color); color: #fff;
  }
  .codegen-tab.active:hover {
    background: var(--accent-hover); color: #fff;
  }
  .codegen-body {
    flex: 1; overflow: auto; padding: 0;
  }
  .codegen-code {
    margin: 0; padding: 16px 18px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px; line-height: 1.55; white-space: pre-wrap;
    color: var(--text-primary);
  }
  .codegen-footer {
    padding: 12px 18px; border-top: 1px solid var(--border-color);
    display: flex; justify-content: flex-end;
  }
  .codegen-copy {
    padding: 8px 16px; border: none; border-radius: 4px;
    background: var(--accent-color); color: #fff;
    font-size: 13px; cursor: pointer;
  }
  .codegen-code :global(.hl-kw) { color: #c678dd; }
  .codegen-code :global(.hl-str) { color: #98c379; }
  .codegen-code :global(.hl-num) { color: #d19a66; }
  .codegen-code :global(.hl-cmt) { color: #5c6370; font-style: italic; }
  .codegen-code :global(.hl-flag) { color: #56b6c2; }
</style>
