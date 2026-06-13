<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { db, fileOps, loadTest } from '$lib/api/tauri';
  import { showLoadTest } from '$lib/stores/uiStore';
  import { addLog } from '$lib/stores/consoleStore';
  import { renderMarkdown } from '$lib/utils/markdownRenderer';
  import { userCollections } from '$lib/utils/collectionFilters';
  import {
    phase,
    config,
    draftPlan,
    planLoading,
    planError,
    liveProgress,
    finalResult,
    aiAnalysis,
    aiAnalysisLoading,
    runError,
    probeRunning,
    probeError,
    probeResults,
    discoveredVars,
    defaultConfig,
    loadConfigFor,
    saveConfigFor,
    resetForNewRun,
    type LoadConfig,
    type DraftPlan,
    type PlanStep,
    type ProgressEvent,
    type DoneEvent,
    type StepAggregate,
    type ProbeResult,
  } from '$lib/stores/loadTestStore';
  import { analyzeResults } from '$lib/utils/loadTestAI';
  import { compilePlan, computeDataFlow } from '$lib/utils/loadTestPlanCompiler';
  import { generateLoadTestReport } from '$lib/utils/loadTestReport';
  import {
    buildProbeSelection,
    runProbe,
    probePlanToDraft,
    type ProbeSelection,
    type ProbeProgressEvent,
  } from '$lib/utils/loadTestProbe';

  // ---------------------------------------------------------------------------
  // Boot: load collections, restore previous config for the selected collection
  // ---------------------------------------------------------------------------

  let collections: Array<{ id: number; name: string; parent_id?: number | null }> = $state([]);
  let collectionsLoading = $state(true);

  // Build a "Parent ▸ Child" label so the user can tell sub-collections
  // (which appear flat here) apart from their root counterparts in the sidebar.
  function collectionLabel(c: { id: number; name: string; parent_id?: number | null }): string {
    const parts: string[] = [c.name];
    let cur = c;
    let guard = 0;
    while (cur.parent_id != null && guard++ < 10) {
      const parent = collections.find((p) => p.id === cur.parent_id);
      if (!parent) break;
      parts.unshift(parent.name);
      cur = parent;
    }
    return parts.join(' ▸ ');
  }
  let initialCollectionId: number | null = null;
  // Capture the initial collectionId from the showLoadTest store ONCE at
  // mount. Re-reading it inside an effect would loop because we mutate
  // `config.collectionId` below.
  {
    const v = get(showLoadTest);
    initialCollectionId = v && typeof v === 'object' ? v.collectionId : null;
  }

  let unlistenProgress: (() => void) | null = null;
  let unlistenDone: (() => void) | null = null;
  let unlistenError: (() => void) | null = null;
  let unlistenProbe: (() => void) | null = null;

  // Probe-phase state: the request selection table (toggled per row) and a
  // small loading flag while we fetch it from the DB. Live per-step results
  // live in the `probeResults` store so multiple components can render them.
  let probeSelection: ProbeSelection[] = $state([]);
  let probeSelectionLoading = $state(false);

  onMount(async () => {
    // Reset transient state in case the user re-opens the screen mid-run-finished.
    if (get(phase) !== 'running') {
      resetForNewRun(true);
    }
    try {
      const cols = (await db.getCollections()) as Array<{ id: number; name: string; parent_id?: number | null }>;
      collections = userCollections(cols || []);
    } catch (e: any) {
      collections = [];
      addLog(`Load Test: failed to load collections — ${e?.message || e}`, 'error');
    }
    collectionsLoading = false;

    // Resolve the working collection id: prefer the one passed via showLoadTest,
    // otherwise the existing config, otherwise the first collection.
    let targetId: number | null = initialCollectionId;
    if (targetId == null) targetId = get(config).collectionId;
    if (targetId == null && collections.length > 0) targetId = collections[0].id;

    if (targetId != null) {
      const saved = await loadConfigFor(targetId);
      if (saved) config.set(saved);
      else config.set({ ...defaultConfig(targetId) });
    }

    // Subscribe to Tauri events for live progress + completion.
    const { listen } = await import('@tauri-apps/api/event');
    unlistenProgress = await listen<ProgressEvent>('loadtest-progress', (event) => {
      liveProgress.set(event.payload);
    });
    unlistenDone = await listen<DoneEvent>('loadtest-done', async (event) => {
      finalResult.set(event.payload);
      phase.set('results');
      addLog(
        `✓ Load test finished — ${event.payload.total_count} req, ${event.payload.total_err} err, ${event.payload.rps_overall.toFixed(1)} rps`,
        'system',
      );
      await runAiAnalysis(event.payload);
    });
    unlistenError = await listen<string>('loadtest-error', (event) => {
      runError.set(event.payload);
      addLog(`✗ Load test error: ${event.payload}`, 'error');
    });
    // Live probe execution stream — Rust emits one per request as it
    // completes (or fails). We merge into `probeResults` keyed by index
    // so the discovery view can render incremental rows.
    unlistenProbe = await listen<ProbeProgressEvent>('probe-progress', (event) => {
      const p = event.payload;
      probeResults.update((m) => ({ ...m, [p.index]: p.result }));
    });
  });

  onDestroy(() => {
    unlistenProgress?.();
    unlistenDone?.();
    unlistenError?.();
    unlistenProbe?.();
  });

  // Persist config edits (debounced via simple timer).
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const cfg = $config;
    if (cfg.collectionId == null) return;
    if (saveTimer) clearTimeout(saveTimer);
    const id = cfg.collectionId;
    saveTimer = setTimeout(() => { void saveConfigFor(id, cfg); }, 600);
  });

  // ---------------------------------------------------------------------------
  // Phase 0: Configure
  // ---------------------------------------------------------------------------

  async function pickUploadFile(idx: number) {
    const path = (await fileOps.showOpenDialog({ title: 'Pick upload file' })) as any;
    const real = Array.isArray(path) ? path[0] : path;
    if (!real) return;
    config.update((c) => {
      c.uploadFiles[idx].path = real;
      return c;
    });
  }

  function addUploadFile() {
    config.update((c) => {
      c.uploadFiles = [...c.uploadFiles, { variableName: '', path: '', asBase64: false }];
      return c;
    });
  }

  function removeUploadFile(idx: number) {
    config.update((c) => {
      c.uploadFiles = c.uploadFiles.filter((_, i) => i !== idx);
      return c;
    });
  }

  async function pickDataFile() {
    const path = (await fileOps.showOpenDialog({ title: 'Pick data file (CSV or JSON)', filters: ['.csv', '.json'] })) as any;
    const real = Array.isArray(path) ? path[0] : path;
    if (!real) return;
    const fmt = real.toLowerCase().endsWith('.json') ? 'json' : 'csv';
    config.update((c) => { c.dataFile = { path: real, format: fmt }; return c; });
  }

  async function pickEnvFile() {
    const path = (await fileOps.showOpenDialog({ title: 'Pick env file (JSON {key:value})', filters: ['.json'] })) as any;
    const real = Array.isArray(path) ? path[0] : path;
    if (!real) return;
    config.update((c) => { c.envFile = { path: real }; return c; });
  }

  async function onCollectionChange(idStr: string) {
    const id = Number(idStr);
    const saved = await loadConfigFor(id);
    if (saved) config.set(saved);
    else config.set({ ...defaultConfig(id) });
  }

  // ---------------------------------------------------------------------------
  // Phase 0.5: Probe / Discovery
  // ---------------------------------------------------------------------------
  //
  // Enter the probe phase by loading the current collection's request list
  // into the include-selection table. GETs are pre-checked; mutating verbs
  // (POST/PUT/PATCH/DELETE) start unchecked but with a one-click toggle —
  // the user explicitly opts in to side effects.

  async function enterProbePhase() {
    const collectionId = $config.collectionId;
    if (collectionId == null) return;
    planError.set(null);
    probeError.set(null);
    probeResults.set({});
    discoveredVars.set([]);
    probeSelectionLoading = true;
    try {
      probeSelection = await buildProbeSelection(collectionId);
      phase.set('probe');
    } catch (e: any) {
      planError.set(`Failed to load requests: ${e?.message || e}`);
    } finally {
      probeSelectionLoading = false;
    }
  }

  function toggleProbeRow(idx: number) {
    probeSelection = probeSelection.map((r, i) =>
      i === idx ? { ...r, included: !r.included } : r,
    );
  }
  function setAllProbeRows(value: boolean) {
    probeSelection = probeSelection.map((r) => ({ ...r, included: value }));
  }

  async function runDiscovery() {
    const collectionId = $config.collectionId;
    if (collectionId == null) return;
    probeError.set(null);
    probeResults.set({});
    discoveredVars.set([]);
    probeRunning.set(true);
    try {
      // Pre-populate placeholder rows so the user sees the full list with
      // pending statuses the moment the run starts; Rust then overwrites
      // each row as it completes.
      const placeholders: Record<number, ProbeResult> = {};
      probeSelection
        .filter((s) => s.included)
        .forEach((s, i) => {
          placeholders[i] = {
            index: i,
            requestId: s.requestId,
            name: s.name,
            method: s.method,
            url: s.url,
            statusCode: 0,
            timeMs: 0,
            bodyPreview: '',
            headers: {},
            error: null,
            ok: false,
            detectedVars: [],
          };
        });
      probeResults.set(placeholders);

      const probe = await runProbe(collectionId, probeSelection);
      discoveredVars.set(probe.discoveredVars);
      const draft = probePlanToDraft(probe, $config);
      draftPlan.set(draft);
      addLog(
        `✓ Discovery complete — ${probe.results.length} probed, ${probe.discoveredVars.length} var(s) detected.`,
        'system',
      );
      const anyFailed = probe.results.some((r) => !r.ok);
      // Auto-advance to review when everything succeeded; otherwise leave
      // the user on the probe screen so they can decide whether to
      // continue with partial data or fix the failing request first.
      if (!anyFailed) {
        phase.set('review');
      }
    } catch (e: any) {
      probeError.set(e?.message || String(e));
      addLog(`✗ Discovery failed: ${e?.message || e}`, 'error');
    } finally {
      probeRunning.set(false);
    }
  }

  function continueToReview() {
    if ($draftPlan) {
      phase.set('review');
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Plan Review
  // ---------------------------------------------------------------------------

  function moveStep(idx: number, dir: -1 | 1) {
    draftPlan.update((p) => {
      if (!p) return p;
      const target = idx + dir;
      if (target < 0 || target >= p.steps.length) return p;
      const next = [...p.steps];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...p, steps: next };
    });
  }

  function removeStep(idx: number) {
    draftPlan.update((p) => {
      if (!p) return p;
      const next = p.steps.filter((_, i) => i !== idx);
      return { ...p, steps: next };
    });
  }

  function addExtraction(stepIdx: number) {
    draftPlan.update((p) => {
      if (!p) return p;
      const next = [...p.steps];
      next[stepIdx] = {
        ...next[stepIdx],
        extractions: [...next[stepIdx].extractions, { jsonPath: '', variableName: '' }],
      };
      return { ...p, steps: next };
    });
  }

  function removeExtraction(stepIdx: number, extIdx: number) {
    draftPlan.update((p) => {
      if (!p) return p;
      const next = [...p.steps];
      next[stepIdx] = {
        ...next[stepIdx],
        extractions: next[stepIdx].extractions.filter((_, i) => i !== extIdx),
      };
      return { ...p, steps: next };
    });
  }

  function updateExtraction(stepIdx: number, extIdx: number, field: 'jsonPath' | 'variableName', value: string) {
    draftPlan.update((p) => {
      if (!p) return p;
      const next = [...p.steps];
      const exts = [...next[stepIdx].extractions];
      exts[extIdx] = { ...exts[extIdx], [field]: value };
      next[stepIdx] = { ...next[stepIdx], extractions: exts };
      return { ...p, steps: next };
    });
  }

  // initialVars are edited as a list of {k,v} pairs so the user can rename
  // keys without React-style key-prop pain.
  let varRows: Array<{ k: string; v: string }> = $state([]);
  $effect(() => {
    const p = $draftPlan;
    if (!p) { varRows = []; return; }
    const next = Object.entries(p.initialVars).map(([k, v]) => ({ k, v }));
    if (next.length === 0) next.push({ k: '', v: '' });
    varRows = next;
  });

  function syncVarRowsToPlan() {
    draftPlan.update((p) => {
      if (!p) return p;
      const next: Record<string, string> = {};
      for (const r of varRows) {
        if (r.k.trim()) next[r.k.trim()] = r.v;
      }
      return { ...p, initialVars: next };
    });
  }

  function addVarRow() {
    varRows = [...varRows, { k: '', v: '' }];
  }
  function removeVarRow(i: number) {
    varRows = varRows.filter((_, idx) => idx !== i);
    syncVarRowsToPlan();
  }

  async function startRun() {
    runError.set(null);
    const draft = $draftPlan;
    if (!draft) return;
    syncVarRowsToPlan();
    const updated = get(draftPlan)!;

    let compiled;
    try {
      compiled = await compilePlan(updated, $config);
    } catch (e: any) {
      runError.set(`Compile failed: ${e?.message || e}`);
      return;
    }
    for (const w of compiled.warnings) {
      addLog(`Load Test (warning): ${w.message}`, 'warn');
    }

    liveProgress.set(null);
    finalResult.set(null);
    aiAnalysis.set('');
    phase.set('running');

    try {
      await loadTest.start(compiled.plan);
      addLog(`▶ Load test started — ${compiled.plan.concurrency} VUs, ${compiled.plan.mode}`, 'system');
    } catch (e: any) {
      runError.set(`Start failed: ${e?.message || e}`);
      phase.set('review');
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Running
  // ---------------------------------------------------------------------------

  async function cancelRun() {
    try { await loadTest.cancel(); } catch (e: any) { addLog(`Cancel failed: ${e?.message || e}`, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Results
  // ---------------------------------------------------------------------------

  async function runAiAnalysis(result: DoneEvent) {
    aiAnalysisLoading.set(true);
    try {
      const text = await analyzeResults(result);
      aiAnalysis.set(text);
    } catch (e: any) {
      aiAnalysis.set(`_AI analysis failed: ${e?.message || e}_`);
    } finally {
      aiAnalysisLoading.set(false);
    }
  }

  async function saveReport() {
    const res = $finalResult;
    if (!res) return;
    const collectionName = collections.find((c) => c.id === $config.collectionId)?.name || 'collection';
    const html = generateLoadTestReport({
      collectionName,
      mode: $config.mode,
      config: {
        concurrency: $config.concurrency,
        durationSecs: $config.durationSecs,
        totalRequests: $config.totalRequests,
        rampUpSecs: $config.rampUpSecs,
        targetRps: $config.targetRps,
      },
      result: res,
      aiAnalysis: $aiAnalysis,
    });
    const slug = collectionName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const filePath = (await fileOps.showSaveDialog({
      title: 'Save Load Test Report',
      defaultPath: `${slug}-loadtest-${Date.now()}.html`,
    })) as string | null;
    if (!filePath) return;
    await fileOps.writeFile(filePath, html);
    addLog('✓ Saved load test HTML report', 'system');
  }

  function runAgain() {
    resetForNewRun(true);
  }

  function backToConfigure() {
    phase.set('configure');
  }

  function backToProbe() {
    phase.set('probe');
  }

  function close() {
    if ($phase === 'running') {
      // Background the run; the user can re-open via the entry point. We
      // don't auto-cancel here because long runs can take a while and the
      // user may just want to peek at something else.
      addLog('Load test still running in the background.', 'system');
    }
    showLoadTest.set(false);
  }

  // ---------------------------------------------------------------------------
  // Derived / view-state
  // ---------------------------------------------------------------------------

  let stepsSortedByP95: StepAggregate[] = $derived.by(() => {
    const lp = $liveProgress;
    const fr = $finalResult;
    const steps = (fr?.per_step ?? lp?.per_step ?? []).slice();
    steps.sort((a, b) => b.p95_ms - a.p95_ms || b.error_rate - a.error_rate);
    return steps;
  });

  // Data-flow summary for the review screen: which steps produce/consume
  // which variables. Drives the top-of-review summary and the per-step
  // Provides/Uses badges. Recomputed whenever the plan changes (extractions
  // added, steps reordered, etc.).
  let dataFlow = $derived.by(() => {
    const p = $draftPlan;
    if (!p) return null;
    return computeDataFlow(p.steps, p.initialVars);
  });

  let probeResultsList: ProbeResult[] = $derived.by(() => {
    const map = $probeResults;
    return Object.values(map).sort((a, b) => a.index - b.index);
  });

  // Stable lookup so we can render "from Step N: <request name>" in the
  // data-flow summary without re-scanning the steps array for each badge.
  function producerStepName(idx: number | null): string {
    if (idx == null) return '';
    const p = $draftPlan;
    if (!p || !p.steps[idx]) return '';
    return p.steps[idx].name;
  }

  // Scroll a step card into view + give it a brief highlight ring when the
  // user clicks a producer/consumer node in the data-flow diagram. Lets
  // the diagram act as a table of contents into the chain editor below.
  function scrollToStep(idx: number) {
    const el = document.getElementById(`lt-step-${idx}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('lt-step-flash');
    setTimeout(() => el.classList.remove('lt-step-flash'), 1400);
  }

  function fmtMs(n: number): string {
    if (!n) return '—';
    return n >= 1000 ? (n / 1000).toFixed(2) + 's' : Math.round(n) + 'ms';
  }
  function fmtNum(n: number | undefined): string {
    if (n == null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
    return String(n);
  }
  function methodColor(m: string): string {
    const colors: Record<string, string> = {
      GET: '#4caf50', POST: '#ff9800', PUT: '#2196f3',
      PATCH: '#9c27b0', DELETE: '#f44336', HEAD: '#607d8b', OPTIONS: '#795548',
    };
    return colors[(m || '').toUpperCase()] || '#90a4ae';
  }

  function liveSparkline(series: number[] | undefined, w = 240, h = 36): string {
    if (!series || series.length < 2) return '';
    const max = Math.max(1, ...series);
    const step = w / (series.length - 1);
    const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
    return pts;
  }
</script>

<div
  class="lt-screen"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onkeydown={(e) => { if (e.key === 'Escape') close(); }}
>
  <!-- Top bar -->
  <header class="lt-header">
    <div class="lt-brand">
      <div class="lt-icon">L</div>
      <div>
        <div class="lt-title">Load Test Lab</div>
        <div class="lt-sub">
          {#if $phase === 'configure'}Configure run
          {:else if $phase === 'probe'}Discover &amp; probe APIs
          {:else if $phase === 'review'}Review chain plan
          {:else if $phase === 'running'}Running…
          {:else}Results
          {/if}
        </div>
      </div>
    </div>

    <div class="lt-steps">
      {#each [['configure','Configure'], ['probe','Discover'], ['review','Plan'], ['running','Run'], ['results','Results']] as s, i}
        <div class="lt-step {$phase === s[0] ? 'active' : ''} {['configure','probe','review','running','results'].indexOf($phase) > i ? 'done' : ''}">
          <span class="lt-step-dot">{i + 1}</span>
          <span class="lt-step-label">{s[1]}</span>
        </div>
      {/each}
    </div>

    <button class="lt-close" onclick={close} title="Close (Esc)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
    </button>
  </header>

  <div class="lt-body">
    <!-- ================================================================== -->
    <!-- PHASE 0: CONFIGURE                                                  -->
    <!-- ================================================================== -->
    {#if $phase === 'configure'}
      <div class="lt-section">
        <div class="lt-section-title">Collection &amp; mode</div>
        <div class="lt-row">
          <label class="lt-field">
            <span class="lt-label">Collection</span>
            {#if collectionsLoading}
              <div class="lt-hint">Loading…</div>
            {:else if collections.length === 0}
              <div class="lt-hint lt-warn">No collections found. Create one first.</div>
            {:else}
              <select
                class="lt-input"
                value={$config.collectionId ?? ''}
                onchange={(e) => onCollectionChange((e.target as HTMLSelectElement).value)}
              >
                {#each collections as c}
                  <option value={c.id}>{collectionLabel(c)}</option>
                {/each}
              </select>
            {/if}
          </label>

          <label class="lt-field">
            <span class="lt-label">Mode</span>
            <select class="lt-input" bind:value={$config.mode}>
              <option value="chain">Chain per VU (realistic scenarios)</option>
              <option value="per_endpoint">Per-endpoint hammer (each VU cycles steps)</option>
            </select>
          </label>
        </div>
      </div>

      <div class="lt-section">
        <div class="lt-section-title">Load parameters</div>
        <div class="lt-grid">
          <label class="lt-field">
            <span class="lt-label">Concurrency (VUs)</span>
            <input type="number" class="lt-input" min="1" max="500" bind:value={$config.concurrency} />
          </label>
          <label class="lt-field">
            <span class="lt-label">Duration (s)</span>
            <input type="number" class="lt-input" min="0" max="3600" bind:value={$config.durationSecs} />
            <span class="lt-hint">0 = use Total request cap</span>
          </label>
          <label class="lt-field">
            <span class="lt-label">Total request cap</span>
            <input type="number" class="lt-input" min="0" bind:value={$config.totalRequests} />
            <span class="lt-hint">0 = no cap</span>
          </label>
          <label class="lt-field">
            <span class="lt-label">Ramp-up (s)</span>
            <input type="number" class="lt-input" min="0" max="600" bind:value={$config.rampUpSecs} />
            <span class="lt-hint">Spread VU spawns over this window</span>
          </label>
          <label class="lt-field">
            <span class="lt-label">Target RPS</span>
            <input type="number" class="lt-input" min="0" max="100000" bind:value={$config.targetRps} />
            <span class="lt-hint">0 = uncapped</span>
          </label>
          <label class="lt-field">
            <span class="lt-label">Per-request timeout (s)</span>
            <input type="number" class="lt-input" min="1" max="300" bind:value={$config.timeoutSecs} />
          </label>
        </div>
      </div>

      <div class="lt-section">
        <div class="lt-section-title">
          Files
          <span class="lt-section-hint">Resolved locally before the run starts</span>
        </div>

        <div class="lt-subtitle">Upload files (any kind — bound to a variable as text or base64)</div>
        {#each $config.uploadFiles as f, i}
          <div class="lt-row lt-row-tight">
            <input class="lt-input lt-input-narrow" placeholder="variable name (e.g. avatar)" bind:value={f.variableName} />
            <input class="lt-input" placeholder="file path" bind:value={f.path} readonly />
            <button class="lt-btn lt-btn-ghost" onclick={() => pickUploadFile(i)}>Browse…</button>
            <label class="lt-checkbox">
              <input type="checkbox" bind:checked={f.asBase64} />
              <span>base64</span>
            </label>
            <button class="lt-btn lt-btn-danger" onclick={() => removeUploadFile(i)}>×</button>
          </div>
        {/each}
        <button class="lt-btn lt-btn-ghost" onclick={addUploadFile}>+ Add file</button>

        <div class="lt-subtitle" style="margin-top:14px">Data file (CSV/JSON — one row per iteration variation)</div>
        <div class="lt-row lt-row-tight">
          <input class="lt-input" placeholder="(none)" value={$config.dataFile?.path || ''} readonly />
          <button class="lt-btn lt-btn-ghost" onclick={pickDataFile}>Browse…</button>
          {#if $config.dataFile}
            <span class="lt-pill">{$config.dataFile.format.toUpperCase()}</span>
            <button class="lt-btn lt-btn-danger" onclick={() => config.update((c) => { c.dataFile = null; return c; })}>×</button>
          {/if}
        </div>

        <div class="lt-subtitle" style="margin-top:14px">Env file (JSON object of variables)</div>
        <div class="lt-row lt-row-tight">
          <input class="lt-input" placeholder="(none)" value={$config.envFile?.path || ''} readonly />
          <button class="lt-btn lt-btn-ghost" onclick={pickEnvFile}>Browse…</button>
          {#if $config.envFile}
            <button class="lt-btn lt-btn-danger" onclick={() => config.update((c) => { c.envFile = null; return c; })}>×</button>
          {/if}
        </div>
      </div>

      <div class="lt-section">
        <div class="lt-section-title">
          Notes for the AI <span class="lt-section-hint">Optional</span>
        </div>
        <textarea
          class="lt-input lt-textarea"
          placeholder={'e.g. POST /auth/login returns { data: { access_token } } — reuse the token for everything else.'}
          bind:value={$config.notes}
        ></textarea>
      </div>

      {#if $planError}
        <div class="lt-error">{$planError}</div>
      {/if}
    {/if}

    <!-- ================================================================== -->
    <!-- PHASE 0.5: PROBE / DISCOVERY                                        -->
    <!-- ================================================================== -->
    {#if $phase === 'probe'}
      <div class="lt-section">
        <div class="lt-section-title">
          Pick requests to probe
          <span class="lt-section-hint">Each runs once; tokens detected in responses are chained into later calls.</span>
        </div>

        {#if probeSelection.length === 0}
          <div class="lt-hint lt-warn">This collection has no saved requests yet.</div>
        {:else}
          <div class="lt-row lt-row-tight" style="margin-bottom:8px">
            <button class="lt-btn lt-btn-ghost lt-btn-small" onclick={() => setAllProbeRows(true)}>Select all</button>
            <button class="lt-btn lt-btn-ghost lt-btn-small" onclick={() => setAllProbeRows(false)}>Select none</button>
            <span class="lt-section-hint" style="margin-left:auto">
              GETs auto-selected · mutating verbs opt-in
            </span>
          </div>
          <div class="lt-probe-list">
            {#each probeSelection as row, i}
              <label class="lt-probe-row {row.isMutating ? 'mutating' : ''} {row.isAuth ? 'auth' : ''}">
                <input type="checkbox" checked={row.included} onchange={() => toggleProbeRow(i)} />
                <span class="lt-method" style="background:{methodColor(row.method)}">{row.method}</span>
                <span class="lt-probe-name">{row.name}</span>
                <span class="lt-probe-url" title={row.url}>{row.url}</span>
                {#if row.isAuth}
                  <span class="lt-pill lt-pill-var" title="Auto-included and promoted to run first so its token can chain into later steps">auth · runs first</span>
                {:else if row.isMutating}
                  <span class="lt-pill lt-pill-warn" title="Mutating request — included only when explicitly checked">side-effect</span>
                {/if}
              </label>
            {/each}
          </div>
        {/if}
      </div>

      {#if $probeError}
        <div class="lt-error">{$probeError}</div>
      {/if}

      {#if probeResultsList.length > 0}
        <div class="lt-section">
          <div class="lt-section-title">
            Live execution
            <span class="lt-section-hint">
              {#if $probeRunning}Running…{:else}Done.{/if}
            </span>
          </div>
          <div class="lt-probe-exec">
            {#each probeResultsList as r}
              {@const stillPending = $probeRunning && r.statusCode === 0 && !r.error}
              <details class="lt-probe-exec-row">
                <summary>
                  <span class="lt-probe-exec-idx">{r.index + 1}</span>
                  <span class="lt-method" style="background:{methodColor(r.method)}">{r.method}</span>
                  <span class="lt-probe-name">{r.name}</span>
                  <span class="lt-probe-status">
                    {#if stillPending}
                      <span class="lt-pill lt-pill-pending">pending</span>
                    {:else if r.error}
                      <span class="lt-pill lt-pill-err">error</span>
                    {:else if r.ok}
                      <span class="lt-pill lt-pill-ok">{r.statusCode}</span>
                    {:else}
                      <span class="lt-pill lt-pill-err">{r.statusCode || 'failed'}</span>
                    {/if}
                    {#if r.timeMs > 0}<span class="lt-probe-time">{fmtMs(r.timeMs)}</span>{/if}
                  </span>
                  {#if r.detectedVars.length > 0}
                    <span class="lt-probe-vars">
                      {#each r.detectedVars as v}<span class="lt-pill lt-pill-var">{v}</span>{/each}
                    </span>
                  {/if}
                </summary>
                <div class="lt-probe-exec-body">
                  <div class="lt-probe-exec-url" title={r.url}>{r.url}</div>
                  {#if r.error}
                    <pre class="lt-probe-exec-pre lt-error-text">{r.error}</pre>
                  {:else if r.bodyPreview}
                    <pre class="lt-probe-exec-pre">{r.bodyPreview}</pre>
                  {:else if !stillPending}
                    <div class="lt-hint">(empty body)</div>
                  {/if}
                </div>
              </details>
            {/each}
          </div>
        </div>
      {/if}

      {#if $discoveredVars.length > 0}
        <div class="lt-section">
          <div class="lt-section-title">Discovered variables</div>
          <div class="lt-probe-vars-list">
            {#each $discoveredVars as v}
              <div class="lt-probe-var-row">
                <span class="lt-pill lt-pill-var">{v.variableName}</span>
                <span class="lt-subtle">from</span>
                <span>Step {v.sourceStepIndex + 1}: {v.sourceRequestName}</span>
                <span class="lt-subtle">→ <code>{v.jsonPath}</code></span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

    {/if}

    <!-- ================================================================== -->
    <!-- PHASE 1: REVIEW                                                     -->
    <!-- ================================================================== -->
    {#if $phase === 'review' && $draftPlan}
      {@const dp = $draftPlan}
      {@const flow = dataFlow}

      <!-- Plan summary spans the full width so the data-flow story is the
           first thing the user reads. Keeps the rest of the screen for the
           dense two-column editor. -->
      <div class="lt-section lt-plan-summary">
        <div class="lt-section-title">
          Plan summary
          <span class="lt-section-hint">{dp.steps.length} step{dp.steps.length === 1 ? '' : 's'} · from discovery probe</span>
        </div>
        {#if dp.rationale}
          <div class="lt-narrative lt-narrative-compact">{@html renderMarkdown(dp.rationale)}</div>
        {/if}
        {#if flow && flow.producers.size > 0}
          <div class="lt-flow-grid">
            {#each Array.from(flow.producers.entries()) as [varName, srcIdx]}
              {@const consumerSteps = flow.consumers.get(varName) || []}
              <div class="lt-flow-card">
                <div class="lt-flow-var">
                  <span class="lt-flow-var-icon" aria-hidden="true">⌬</span>
                  <span class="lt-flow-var-name">{varName}</span>
                  <span class="lt-flow-var-meta">
                    1 producer · {consumerSteps.length} consumer{consumerSteps.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div class="lt-flow-chain">
                  <button
                    type="button"
                    class="lt-flow-node lt-flow-node-producer"
                    title="Step {srcIdx + 1}: {producerStepName(srcIdx)}"
                    onclick={() => scrollToStep(srcIdx)}
                  >
                    <span class="lt-flow-node-num">{srcIdx + 1}</span>
                    <span class="lt-flow-node-name">{producerStepName(srcIdx) || `Step ${srcIdx + 1}`}</span>
                  </button>
                  <span class="lt-flow-line" aria-hidden="true">
                    <span class="lt-flow-line-fill"></span>
                    <span class="lt-flow-line-tip">▶</span>
                  </span>
                  {#if consumerSteps.length > 0}
                    <div class="lt-flow-consumers">
                      {#each consumerSteps as ci}
                        <button
                          type="button"
                          class="lt-flow-node lt-flow-node-consumer"
                          title="Step {ci + 1}: {producerStepName(ci)}"
                          onclick={() => scrollToStep(ci)}
                        >
                          <span class="lt-flow-node-num">{ci + 1}</span>
                          <span class="lt-flow-node-name">{producerStepName(ci) || `Step ${ci + 1}`}</span>
                        </button>
                      {/each}
                    </div>
                  {:else}
                    <div class="lt-flow-empty">No consumer yet</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if flow && flow.unresolved.length > 0}
          <div class="lt-warn-box lt-warn-box-flow">
            <span class="lt-warn-icon" aria-hidden="true">⚠</span>
            <div>
              <strong>{flow.unresolved.length} unresolved variable{flow.unresolved.length === 1 ? '' : 's'}</strong>
              <div class="lt-warn-detail">
                {#each flow.unresolved as name, i}
                  <code>{name}</code>{#if i < flow.unresolved.length - 1}, {/if}
                {/each}
                — add an extraction to an earlier step or seed an initial variable.
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Two-column workspace: small sidebar for knobs + vars, big right
           pane for the request chain (the heaviest content). Collapses to
           a single column under 1100px so narrow windows stay usable. -->
      <div class="lt-plan-layout">
        <aside class="lt-plan-sidebar">
          <div class="lt-section lt-section-compact">
            <div class="lt-section-title">Load knobs</div>
            <div class="lt-knobs-grid">
              <label class="lt-field">
                <span class="lt-label">Mode</span>
                <select class="lt-input" value={dp.mode} onchange={(e) => draftPlan.update((p) => p ? { ...p, mode: (e.target as HTMLSelectElement).value as any } : p)}>
                  <option value="chain">Chain per VU</option>
                  <option value="per_endpoint">Per-endpoint</option>
                </select>
              </label>
              <label class="lt-field">
                <span class="lt-label">Concurrency</span>
                <input type="number" class="lt-input" min="1" max="500" value={dp.concurrency} oninput={(e) => draftPlan.update((p) => p ? { ...p, concurrency: Number((e.target as HTMLInputElement).value) } : p)} />
              </label>
              <label class="lt-field">
                <span class="lt-label">Duration (s)</span>
                <input type="number" class="lt-input" min="0" max="3600" value={dp.durationSecs} oninput={(e) => draftPlan.update((p) => p ? { ...p, durationSecs: Number((e.target as HTMLInputElement).value) } : p)} />
              </label>
              <label class="lt-field">
                <span class="lt-label">Total cap</span>
                <input type="number" class="lt-input" min="0" value={dp.totalRequests} oninput={(e) => draftPlan.update((p) => p ? { ...p, totalRequests: Number((e.target as HTMLInputElement).value) } : p)} />
              </label>
              <label class="lt-field">
                <span class="lt-label">Ramp-up (s)</span>
                <input type="number" class="lt-input" min="0" max="600" value={dp.rampUpSecs} oninput={(e) => draftPlan.update((p) => p ? { ...p, rampUpSecs: Number((e.target as HTMLInputElement).value) } : p)} />
              </label>
              <label class="lt-field">
                <span class="lt-label">Target RPS</span>
                <input type="number" class="lt-input" min="0" max="100000" value={dp.targetRps} oninput={(e) => draftPlan.update((p) => p ? { ...p, targetRps: Number((e.target as HTMLInputElement).value) } : p)} />
              </label>
            </div>
          </div>

          <div class="lt-section lt-section-compact">
            <div class="lt-section-title">
              Initial variables
              <span class="lt-section-hint">{`{{name}}`}</span>
            </div>
            {#each varRows as row, i}
              <div class="lt-var-row">
                <input class="lt-input lt-input-tight" placeholder="name" bind:value={row.k} onblur={syncVarRowsToPlan} />
                <input class="lt-input lt-input-tight" placeholder="value" bind:value={row.v} onblur={syncVarRowsToPlan} />
                <button class="lt-btn lt-btn-icon lt-btn-danger" onclick={() => removeVarRow(i)} title="Remove">×</button>
              </div>
            {/each}
            <button class="lt-btn lt-btn-ghost lt-btn-small" onclick={addVarRow}>+ Add variable</button>
          </div>
        </aside>

        <section class="lt-plan-main">
          <div class="lt-section lt-section-compact">
            <div class="lt-section-title">
              Request chain
              <span class="lt-section-hint">{dp.steps.length} step{dp.steps.length === 1 ? '' : 's'} · drag order with ↑↓</span>
            </div>
            <div class="lt-step-grid">
              {#each dp.steps as step, i (step.id)}
                {@const stepFlow = flow ? flow.perStep[i] : null}
                <article class="lt-step-card lt-step-card-compact" id="lt-step-{i}">
                  <header class="lt-step-card-head">
                    <span class="lt-step-card-pos">{i + 1}</span>
                    <span class="lt-method" style="background:{methodColor(step.method)}">{step.method}</span>
                    <span class="lt-step-card-name" title={step.name}>{step.name}</span>
                    <span class="lt-step-card-actions">
                      <button class="lt-btn lt-btn-ghost lt-btn-icon" disabled={i === 0} onclick={() => moveStep(i, -1)} title="Move up">↑</button>
                      <button class="lt-btn lt-btn-ghost lt-btn-icon" disabled={i === dp.steps.length - 1} onclick={() => moveStep(i, 1)} title="Move down">↓</button>
                      <button class="lt-btn lt-btn-danger lt-btn-icon" onclick={() => removeStep(i)} title="Remove">×</button>
                    </span>
                  </header>

                  <div class="lt-step-card-url" title={step.url}>{step.url}</div>

                  {#if stepFlow && (stepFlow.provides.length > 0 || stepFlow.uses.length > 0)}
                    <div class="lt-step-card-badges">
                      {#each stepFlow.provides as p}
                        <span class="lt-pill lt-pill-provides" title="Extracted from this response into {p}">
                          ↑ <code>{p}</code>
                        </span>
                      {/each}
                      {#each stepFlow.uses as u}
                        {#if u.fromStep != null}
                          <span class="lt-pill lt-pill-uses" title="Resolved from Step {u.fromStep + 1}">
                            ↓ <code>{u.name}</code> <span class="lt-subtle">·{u.fromStep + 1}</span>
                          </span>
                        {:else if stepFlow.warnings.includes(u.name)}
                          <span class="lt-pill lt-pill-warn" title="No earlier step provides {u.name}">
                            ⚠ <code>{u.name}</code>
                          </span>
                        {:else}
                          <span class="lt-pill lt-pill-uses" title="Resolved from initial variables">
                            ↓ <code>{u.name}</code> <span class="lt-subtle">·init</span>
                          </span>
                        {/if}
                      {/each}
                    </div>
                  {/if}

                  <div class="lt-extractions-compact">
                    {#each step.extractions as ext, ei}
                      <div class="lt-extraction-row">
                        <input
                          class="lt-input lt-input-tight"
                          placeholder="data.access_token"
                          value={ext.jsonPath}
                          oninput={(e) => updateExtraction(i, ei, 'jsonPath', (e.target as HTMLInputElement).value)}
                        />
                        <span class="lt-arrow">→</span>
                        <input
                          class="lt-input lt-input-tight lt-input-var"
                          placeholder="varName"
                          value={ext.variableName}
                          oninput={(e) => updateExtraction(i, ei, 'variableName', (e.target as HTMLInputElement).value)}
                        />
                        <button class="lt-btn lt-btn-icon lt-btn-danger" onclick={() => removeExtraction(i, ei)} title="Remove">×</button>
                      </div>
                    {/each}
                    <button class="lt-btn lt-btn-ghost lt-btn-small" onclick={() => addExtraction(i)}>+ extraction</button>
                  </div>
                </article>
              {/each}
            </div>
          </div>
        </section>
      </div>

      {#if $runError}
        <div class="lt-error">{$runError}</div>
      {/if}
    {/if}

    <!-- ================================================================== -->
    <!-- PHASE 2: RUNNING                                                    -->
    <!-- ================================================================== -->
    {#if $phase === 'running'}
      {@const lp = $liveProgress}
      <div class="lt-running-banner">
        <div class="lt-pulse"></div>
        <span>Load test running…</span>
        {#if lp?.duration_ms}
          <span class="lt-running-progress">{Math.min(100, (lp.elapsed_ms / lp.duration_ms * 100)).toFixed(0)}% of {(lp.duration_ms / 1000).toFixed(0)}s</span>
        {/if}
      </div>

      <div class="lt-cards">
        <div class="lt-card">
          <div class="lt-card-label">Elapsed</div>
          <div class="lt-card-value">{lp ? (lp.elapsed_ms / 1000).toFixed(1) + 's' : '—'}</div>
        </div>
        <div class="lt-card">
          <div class="lt-card-label">Active VUs</div>
          <div class="lt-card-value">{lp?.active_workers ?? '—'}</div>
        </div>
        <div class="lt-card">
          <div class="lt-card-label">Total req</div>
          <div class="lt-card-value">{fmtNum(lp?.requests_total)}</div>
          <div class="lt-card-sub">{fmtNum(lp?.requests_ok)} ok · {fmtNum(lp?.requests_err)} err</div>
        </div>
        <div class="lt-card">
          <div class="lt-card-label">RPS (rolling)</div>
          <div class="lt-card-value">{lp ? lp.rps_rolling.toFixed(1) : '—'}</div>
        </div>
        <div class="lt-card">
          <div class="lt-card-label">p95 (rolling)</div>
          <div class="lt-card-value" style="color:{lp && lp.p95_rolling_ms > 1000 ? '#f44336' : lp && lp.p95_rolling_ms > 500 ? '#d19a66' : '#4caf50'}">
            {lp ? fmtMs(lp.p95_rolling_ms) : '—'}
          </div>
        </div>
        <div class="lt-card">
          <div class="lt-card-label">Error rate</div>
          <div class="lt-card-value" style="color:{lp && lp.requests_total > 0 && (lp.requests_err / lp.requests_total) > 0.05 ? '#f44336' : '#dcddde'}">
            {lp && lp.requests_total > 0 ? ((lp.requests_err / lp.requests_total) * 100).toFixed(1) + '%' : '0%'}
          </div>
        </div>
      </div>

      {#if lp && lp.throughput_series && lp.throughput_series.length > 1}
        <div class="lt-section">
          <div class="lt-section-title">Throughput</div>
          <div class="lt-spark">
            <svg viewBox="0 0 240 36" preserveAspectRatio="none" width="100%" height="80">
              <polyline points={liveSparkline(lp.throughput_series, 240, 36)} fill="none" stroke="#5865f2" stroke-width="1.5" />
            </svg>
          </div>
        </div>
      {/if}

      <div class="lt-section">
        <div class="lt-section-title">Per-endpoint live metrics (sorted by p95)</div>
        <div class="lt-table-wrap">
          <table class="lt-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint</th>
                <th class="num">Calls</th>
                <th class="num">Err %</th>
                <th class="num">Avg</th>
                <th class="num">p95</th>
                <th class="num">p99</th>
                <th class="num">Max</th>
              </tr>
            </thead>
            <tbody>
              {#each stepsSortedByP95 as s, idx}
                <tr class={idx === 0 && s.p95_ms > 0 ? 'top' : ''}>
                  <td><span class="lt-method" style="background:{methodColor(s.method)}">{s.method}</span></td>
                  <td>
                    <div class="lt-step-name">{s.name}</div>
                    <div class="lt-step-url">{s.url}</div>
                  </td>
                  <td class="num">{fmtNum(s.count)}</td>
                  <td class="num">{(s.error_rate * 100).toFixed(1)}%</td>
                  <td class="num">{fmtMs(s.avg_ms)}</td>
                  <td class="num"><b>{fmtMs(s.p95_ms)}</b></td>
                  <td class="num">{fmtMs(s.p99_ms)}</td>
                  <td class="num">{fmtMs(s.max_ms)}</td>
                </tr>
              {:else}
                <tr><td colspan="8" class="lt-empty">Waiting for first samples…</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      {#if $runError}
        <div class="lt-error">{$runError}</div>
      {/if}
    {/if}

    <!-- ================================================================== -->
    <!-- PHASE 3: RESULTS                                                    -->
    <!-- ================================================================== -->
    {#if $phase === 'results' && $finalResult}
      {@const fr = $finalResult}
      <div class="lt-cards">
        <div class="lt-card">
          <div class="lt-card-label">Total requests</div>
          <div class="lt-card-value">{fmtNum(fr.total_count)}</div>
          <div class="lt-card-sub">{fmtNum(fr.total_ok)} ok · {fmtNum(fr.total_err)} err</div>
        </div>
        <div class="lt-card">
          <div class="lt-card-label">Throughput</div>
          <div class="lt-card-value">{fr.rps_overall.toFixed(1)} rps</div>
          <div class="lt-card-sub">over {(fr.elapsed_ms / 1000).toFixed(1)}s</div>
        </div>
        <div class="lt-card">
          <div class="lt-card-label">Success rate</div>
          <div class="lt-card-value" style="color:{fr.total_err === 0 ? '#4caf50' : '#d19a66'}">
            {fr.total_count > 0 ? ((fr.total_ok / fr.total_count) * 100).toFixed(1) + '%' : '—'}
          </div>
        </div>
        {#if fr.cancelled}
          <div class="lt-card lt-card-warn">
            <div class="lt-card-label">Status</div>
            <div class="lt-card-value">Cancelled</div>
          </div>
        {/if}
      </div>

      <div class="lt-section">
        <div class="lt-section-title">What to optimize <span class="lt-section-hint">AI analysis</span></div>
        {#if $aiAnalysisLoading}
          <div class="lt-narrative lt-narrative-loading">Analyzing results…</div>
        {:else if $aiAnalysis}
          <div class="lt-narrative">{@html renderMarkdown($aiAnalysis)}</div>
        {:else}
          <div class="lt-narrative lt-narrative-loading">No analysis available.</div>
        {/if}
      </div>

      <div class="lt-section">
        <div class="lt-section-title">Per-endpoint metrics (sorted by p95)</div>
        <div class="lt-table-wrap">
          <table class="lt-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint</th>
                <th class="num">Calls</th>
                <th class="num">Err %</th>
                <th class="num">Avg</th>
                <th class="num">p50</th>
                <th class="num">p95</th>
                <th class="num">p99</th>
                <th class="num">Max</th>
              </tr>
            </thead>
            <tbody>
              {#each stepsSortedByP95 as s, idx}
                <tr class={idx === 0 && s.p95_ms > 0 ? 'top' : ''}>
                  <td><span class="lt-method" style="background:{methodColor(s.method)}">{s.method}</span></td>
                  <td>
                    <div class="lt-step-name">{s.name}</div>
                    <div class="lt-step-url">{s.url}</div>
                  </td>
                  <td class="num">{fmtNum(s.count)}</td>
                  <td class="num">{(s.error_rate * 100).toFixed(1)}%</td>
                  <td class="num">{fmtMs(s.avg_ms)}</td>
                  <td class="num">{fmtMs(s.p50_ms)}</td>
                  <td class="num"><b>{fmtMs(s.p95_ms)}</b></td>
                  <td class="num">{fmtMs(s.p99_ms)}</td>
                  <td class="num">{fmtMs(s.max_ms)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

    {/if}
  </div>

  <!-- Sticky footer that lives OUTSIDE the scrollable body, so action
       buttons are always pinned at the bottom of the viewport regardless
       of phase content length. (Position-sticky inside .lt-body only
       worked when content overflowed — short phases like the Discover
       request list left the buttons floating mid-screen.) -->
  <footer class="lt-footer">
    {#if $phase === 'configure'}
      <div class="lt-actions lt-actions-spread">
        <div class="lt-actions-hint">
          We'll probe each request once, detect tokens, and draft a chain plan.
        </div>
        <button
          class="lt-btn lt-btn-primary lt-btn-large"
          onclick={enterProbePhase}
          disabled={probeSelectionLoading || !$config.collectionId}
        >
          {#if probeSelectionLoading}Loading requests…{:else}Discover &amp; Plan →{/if}
        </button>
      </div>
    {:else if $phase === 'probe'}
      <div class="lt-actions lt-actions-spread">
        <button class="lt-btn lt-btn-ghost" onclick={backToConfigure}>← Back</button>
        <div class="lt-actions-right">
          <button
            class="lt-btn lt-btn-secondary"
            onclick={runDiscovery}
            disabled={$probeRunning || probeSelection.filter((s) => s.included).length === 0}
          >
            {#if $probeRunning}Probing…{:else if probeResultsList.length > 0}↻ Re-run discovery{:else}▶ Run discovery{/if}
          </button>
          <button
            class="lt-btn lt-btn-primary lt-btn-large"
            onclick={continueToReview}
            disabled={!$draftPlan || $probeRunning}
          >
            Continue to plan →
          </button>
        </div>
      </div>
    {:else if $phase === 'review' && $draftPlan}
      <div class="lt-actions lt-actions-spread">
        <button class="lt-btn lt-btn-ghost" onclick={backToProbe}>← Back to Discover</button>
        <button class="lt-btn lt-btn-primary lt-btn-large" onclick={startRun} disabled={$draftPlan.steps.length === 0}>
          Approve &amp; Run ▶
        </button>
      </div>
    {:else if $phase === 'running'}
      {@const lp = $liveProgress}
      <div class="lt-actions lt-actions-spread">
        <button class="lt-btn lt-btn-danger lt-btn-large" onclick={cancelRun}>■ Cancel run</button>
        <div class="lt-actions-live">
          {#if lp}
            <span><strong>{fmtNum(lp.requests_total)}</strong> req</span>
            <span class="lt-actions-live-sep">·</span>
            <span><strong>{lp.rps_rolling.toFixed(1)}</strong> rps</span>
            <span class="lt-actions-live-sep">·</span>
            <span>p95 <strong>{fmtMs(lp.p95_rolling_ms)}</strong></span>
          {:else}
            <span class="lt-subtle">Spinning up workers…</span>
          {/if}
        </div>
      </div>
    {:else if $phase === 'results' && $finalResult}
      <div class="lt-actions lt-actions-spread">
        <button class="lt-btn lt-btn-ghost" onclick={runAgain}>↻ Run again</button>
        <button class="lt-btn lt-btn-primary lt-btn-large" onclick={saveReport}>↓ Save HTML report</button>
      </div>
    {/if}
  </footer>
</div>

<style>
  /* Full-screen surface. Sits at a higher z than the tools modal so it
     visually replaces the workspace when open. */
  .lt-screen {
    position: fixed;
    inset: 0;
    background: var(--bg-primary, #1a1b1e);
    color: var(--text-primary, #e4e6eb);
    z-index: 9700;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: lt-fade 180ms ease-out;
  }
  @keyframes lt-fade { from { opacity: 0; } to { opacity: 1; } }

  .lt-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border-color, #2e3035);
    background: var(--bg-secondary, #2b2d31);
  }
  .lt-brand { display: flex; align-items: center; gap: 12px; }
  .lt-icon {
    width: 32px; height: 32px;
    background: linear-gradient(135deg, #5865f2 0%, #8776d5 100%);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; color: #fff;
  }
  .lt-title { font-size: 14px; font-weight: 700; }
  .lt-sub { font-size: 11px; color: var(--text-secondary, #b0b5bc); }

  .lt-steps { display: flex; align-items: center; gap: 18px; }
  .lt-step { display: flex; align-items: center; gap: 6px; opacity: 0.45; font-size: 12px; }
  .lt-step.done { opacity: 0.85; }
  .lt-step.active { opacity: 1; color: var(--accent-color, #5865f2); }
  .lt-step-dot {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%;
    background: var(--bg-tertiary, #3f4147); font-size: 11px; font-weight: 600;
  }
  .lt-step.active .lt-step-dot { background: var(--accent-color, #5865f2); color: #fff; }
  .lt-step.done .lt-step-dot { background: #4caf50; color: #fff; }

  .lt-close {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; background: none; border: none;
    border-radius: 6px; color: var(--text-secondary, #b0b5bc); cursor: pointer;
    transition: all 0.15s;
  }
  .lt-close:hover { background: var(--bg-tertiary, #3f4147); color: var(--text-primary, #fff); }

  .lt-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 28px 32px;
    width: 100%;
  }

  .lt-section {
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 14px;
  }
  .lt-section-title {
    font-size: 12px; font-weight: 600; color: var(--text-secondary, #b0b5bc);
    text-transform: uppercase; letter-spacing: 0.06em;
    margin-bottom: 12px;
    display: flex; align-items: baseline; gap: 10px;
  }
  .lt-section-hint { font-weight: 400; text-transform: none; letter-spacing: normal; font-size: 11px; color: var(--text-secondary, #72767d); opacity: 0.8; }
  .lt-subtitle { font-size: 11px; color: var(--text-secondary, #b0b5bc); margin-bottom: 6px; }
  .lt-subtle { font-size: 10.5px; color: var(--text-secondary, #72767d); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }

  .lt-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
  .lt-row-tight { align-items: center; margin-bottom: 6px; }
  .lt-row .lt-field { flex: 1; min-width: 220px; }

  .lt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .lt-field { display: flex; flex-direction: column; gap: 4px; }
  .lt-label { font-size: 11px; color: var(--text-secondary, #b0b5bc); font-weight: 500; }
  .lt-hint { font-size: 10.5px; color: var(--text-secondary, #72767d); }
  .lt-hint.lt-warn { color: #d19a66; }
  .lt-input {
    background: var(--bg-tertiary, #1e1f22);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 6px;
    padding: 7px 10px;
    color: var(--text-primary, #e4e6eb);
    font-size: 12.5px;
    font-family: inherit;
    width: 100%;
    transition: border-color 0.15s;
  }
  .lt-input:focus { outline: none; border-color: var(--accent-color, #5865f2); }
  .lt-input-narrow { max-width: 200px; }
  .lt-textarea { min-height: 70px; font-family: 'SF Mono', Consolas, monospace; font-size: 12px; resize: vertical; }
  .lt-checkbox { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--text-secondary, #b0b5bc); white-space: nowrap; }

  .lt-pill {
    padding: 2px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600;
    background: var(--bg-tertiary, #3f4147); color: var(--text-secondary, #b0b5bc);
  }

  .lt-btn {
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
    white-space: nowrap;
  }
  .lt-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .lt-btn-primary {
    background: var(--accent-color, #5865f2); color: #fff; border-color: var(--accent-color, #5865f2);
  }
  .lt-btn-primary:not(:disabled):hover { filter: brightness(1.1); }
  .lt-btn-ghost {
    background: var(--bg-tertiary, #3f4147); color: var(--text-primary, #e4e6eb);
    border-color: var(--border-color, #3e4045);
  }
  .lt-btn-ghost:not(:disabled):hover { background: var(--bg-primary, #1a1b1e); }
  .lt-btn-danger {
    background: transparent; color: #f44336; border-color: transparent;
  }
  .lt-btn-danger:not(:disabled):hover { background: rgba(244,67,54,0.12); }
  .lt-btn-icon { padding: 4px 8px; min-width: 28px; }
  .lt-btn-small { padding: 4px 10px; font-size: 11px; }
  /* Larger primary CTA used in sticky action bars so the next-step button
     is visually distinct from secondary actions to its left. */
  .lt-btn-large {
    padding: 9px 20px;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 1px 0 rgba(0,0,0,0.18);
  }
  /* Secondary action — used for "Run discovery" sitting next to the
     primary "Continue to plan" CTA on the probe page. Less prominent
     than primary, more affordance than ghost. */
  .lt-btn-secondary {
    background: rgba(88,101,242,0.16);
    color: #aab4fa;
    border-color: rgba(88,101,242,0.35);
  }
  .lt-btn-secondary:not(:disabled):hover { background: rgba(88,101,242,0.24); }

  /* The action bar itself is a flex row of buttons. Layout-only — sticking
     to the viewport bottom is the .lt-footer's responsibility. */
  .lt-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  /* Spread variant: Back on left, primary on right (or hint + primary on
     the configure screen). Reads "where I came from ← → where I'm going". */
  .lt-actions-spread {
    justify-content: space-between;
  }
  .lt-actions-right {
    display: flex; gap: 10px; align-items: center;
  }
  .lt-actions-hint {
    color: var(--text-secondary, #949ba4);
    font-size: 12px;
    font-style: italic;
  }
  /* Live counters shown alongside the Cancel button on the Running phase. */
  .lt-actions-live {
    display: flex; align-items: center; gap: 8px;
    font-size: 12.5px;
    color: var(--text-secondary, #b0b5bc);
    font-variant-numeric: tabular-nums;
  }
  .lt-actions-live strong { color: var(--text-primary, #f2f3f5); font-weight: 600; }
  .lt-actions-live-sep { opacity: 0.4; }

  /* Sticky footer lives at the bottom of the screen's flex column,
     OUTSIDE the scrollable body. Always pinned regardless of how short
     the phase content is (the old position-sticky-inside-overflow trick
     only worked when content overflowed, so short phases like Discover
     left buttons floating mid-screen). */
  .lt-footer {
    flex-shrink: 0;
    padding: 14px 28px;
    background: var(--bg-primary, #1a1b1e);
    border-top: 1px solid var(--border-color, #2e3035);
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
    z-index: 5;
  }
  .lt-footer:empty { display: none; }

  .lt-error {
    padding: 10px 14px;
    background: rgba(244,67,54,0.1);
    border: 1px solid rgba(244,67,54,0.4);
    border-radius: 6px;
    color: #f44336;
    font-size: 12.5px;
    margin: 12px 0;
  }

  .lt-narrative {
    font-size: 13.5px; line-height: 1.65; color: var(--text-primary, #e4e6eb);
  }
  .lt-narrative-loading { opacity: 0.6; font-style: italic; }

  /* Markdown rendered via {@html} bypasses Svelte's scoped styles, so these
     child selectors must be :global to take effect. */
  .lt-narrative :global(p) { margin: 0 0 8px; }
  .lt-narrative :global(p:last-child) { margin-bottom: 0; }
  .lt-narrative :global(h1),
  .lt-narrative :global(h2),
  .lt-narrative :global(h3),
  .lt-narrative :global(h4),
  .lt-narrative :global(h5),
  .lt-narrative :global(h6) {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.01em;
    margin: 14px 0 6px;
    color: var(--text-primary, #fff);
  }
  .lt-narrative :global(:first-child) { margin-top: 0; }
  .lt-narrative :global(ul),
  .lt-narrative :global(ol) { margin: 4px 0 8px; padding-left: 20px; }
  .lt-narrative :global(li) { margin: 3px 0; }
  .lt-narrative :global(strong) { font-weight: 700; color: var(--text-primary, #fff); }
  .lt-narrative :global(em) { font-style: italic; }
  .lt-narrative :global(a) { color: var(--accent-color, #5865f2); }
  .lt-narrative :global(code) { background: var(--bg-tertiary, #1e1f22); padding: 1px 5px; border-radius: 3px; color: #d19a66; font-size: 12.5px; }
  .lt-narrative :global(pre) { background: var(--bg-tertiary, #1e1f22); padding: 10px 12px; border-radius: 6px; overflow-x: auto; margin: 6px 0 10px; }
  .lt-narrative :global(pre code) { background: none; padding: 0; color: var(--text-primary, #e4e6eb); }

  /* Step cards (review phase)
     The compact variant is used by the new two-column Plan page and packs
     header + URL + badges + extractions into ~5 inline rows so 2 steps
     fit side-by-side on a standard 1440px screen. */
  .lt-step-card {
    background: var(--bg-tertiary, #1e1f22);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
  }
  .lt-step-card-head {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px;
    background: var(--bg-secondary, #2b2d31);
  }
  .lt-step-card-pos {
    width: 22px; height: 22px;
    border-radius: 50%; background: var(--bg-tertiary, #3f4147);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; color: var(--text-secondary, #b0b5bc);
    flex-shrink: 0;
  }
  .lt-step-card-name {
    font-size: 13px; font-weight: 500; color: var(--text-primary, #e4e6eb);
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .lt-step-card-url {
    font-size: 11px; color: var(--text-secondary, #72767d);
    font-family: 'SF Mono', Consolas, monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    padding: 6px 10px 4px;
  }
  .lt-step-card-actions { display: flex; gap: 2px; flex-shrink: 0; }
  .lt-arrow { color: var(--text-secondary, #72767d); padding: 0 2px; }

  /* Compact step card variant — used in the 2-col Plan grid. */
  .lt-step-card-compact { margin-bottom: 0; }
  .lt-step-card-compact .lt-step-card-badges {
    padding: 4px 10px;
    background: transparent;
    border-bottom: 1px solid var(--border-color, #2e3035);
  }
  .lt-extractions-compact {
    padding: 6px 10px 8px;
    display: flex; flex-direction: column; gap: 3px;
  }
  .lt-extraction-row {
    display: flex; align-items: center; gap: 4px;
  }
  .lt-extraction-row .lt-input { font-size: 11.5px; padding: 4px 6px; }
  .lt-input-tight { padding: 4px 6px !important; font-size: 11.5px !important; }
  .lt-input-var { max-width: 110px; }

  /* Plan page two-column layout. Collapses to single column on smaller
     widths so the chain stays readable when the user shrinks the window. */
  .lt-plan-layout {
    display: grid;
    grid-template-columns: minmax(260px, 320px) 1fr;
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 1100px) {
    .lt-plan-layout { grid-template-columns: 1fr; }
  }
  .lt-plan-sidebar { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .lt-plan-main { min-width: 0; }

  .lt-section-compact { margin-bottom: 0; }
  .lt-narrative-compact { font-size: 12.5px; line-height: 1.5; margin-bottom: 10px; }

  /* Compact 2-col knobs grid for the sidebar. */
  .lt-knobs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .lt-knobs-grid .lt-input { padding: 5px 8px; font-size: 12px; }
  .lt-knobs-grid .lt-label { font-size: 10.5px; }

  /* Initial-var rows: name | value | × — three columns instead of stacked. */
  .lt-var-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
    gap: 4px;
    margin-bottom: 4px;
  }

  /* Request chain grid — two cards side-by-side on wide screens. */
  .lt-step-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 10px;
  }

  /* ---- Visual flow diagram for the Plan summary ----------------------
     Each variable becomes a card with a producer node on the left, a
     stylized arrow, and a wrapping row of consumer nodes on the right.
     Nodes are buttons so the diagram doubles as a table of contents:
     clicking one scrolls/flashes the target step in the editor below. */
  .lt-flow-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 10px;
    margin-top: 10px;
  }
  .lt-flow-card {
    background: linear-gradient(135deg, rgba(88,101,242,0.08), rgba(88,101,242,0.02));
    border: 1px solid rgba(88,101,242,0.25);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .lt-flow-var {
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px dashed rgba(88,101,242,0.25);
  }
  .lt-flow-var-icon {
    width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(88,101,242,0.25);
    color: #aab4fa;
    border-radius: 6px;
    font-size: 13px;
    flex-shrink: 0;
  }
  .lt-flow-var-name {
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 13.5px; font-weight: 600;
    color: #e4e8ff;
  }
  .lt-flow-var-meta {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--text-secondary, #949ba4);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .lt-flow-chain {
    display: flex; align-items: center; gap: 10px;
    flex-wrap: wrap;
  }
  .lt-flow-node {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 4px 4px 4px;
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 999px;
    font-family: inherit; font-size: 11.5px;
    color: var(--text-primary, #e4e6eb);
    cursor: pointer;
    transition: transform 0.12s, border-color 0.12s, background 0.12s;
    max-width: 180px;
  }
  .lt-flow-node:hover {
    transform: translateY(-1px);
    border-color: var(--accent-color, #5865f2);
    background: var(--bg-tertiary, #1e1f22);
  }
  .lt-flow-node-num {
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
    background: var(--accent-color, #5865f2); color: #fff;
    border-radius: 50%; font-size: 11px; font-weight: 700;
    flex-shrink: 0;
  }
  .lt-flow-node-name {
    padding-right: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    min-width: 0;
  }
  .lt-flow-node-producer .lt-flow-node-num { background: #4caf50; }
  .lt-flow-node-consumer .lt-flow-node-num { background: var(--accent-color, #5865f2); }

  /* Stylized arrow: thin gradient line with a triangular tip. */
  .lt-flow-line {
    flex: 0 1 40px;
    display: flex; align-items: center;
    min-width: 24px;
  }
  .lt-flow-line-fill {
    flex: 1;
    height: 2px;
    background: linear-gradient(to right, #4caf50, var(--accent-color, #5865f2));
    border-radius: 1px;
  }
  .lt-flow-line-tip {
    color: var(--accent-color, #5865f2);
    font-size: 10px;
    margin-left: -2px;
    line-height: 1;
  }

  .lt-flow-consumers {
    display: flex; gap: 6px; flex-wrap: wrap;
    flex: 1; min-width: 0;
  }
  .lt-flow-empty {
    color: var(--text-secondary, #72767d);
    font-style: italic;
    font-size: 11.5px;
  }

  /* Beefier warning box for unresolved vars — gets its own icon column. */
  .lt-warn-box-flow {
    margin-top: 12px;
    display: flex; align-items: flex-start; gap: 12px;
    padding: 12px 14px;
  }
  .lt-warn-icon {
    width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(217,154,102,0.20);
    color: #d19a66;
    border-radius: 50%;
    font-size: 14px;
    flex-shrink: 0;
  }
  .lt-warn-detail { font-size: 12px; margin-top: 4px; color: var(--text-primary, #e4e6eb); }
  .lt-warn-detail code {
    background: rgba(217,154,102,0.18); color: #d19a66;
    padding: 1px 5px; border-radius: 3px;
    font-family: 'SF Mono', Consolas, monospace; font-size: 11.5px;
  }

  /* Brief highlight when the user clicks a flow node and we scroll to a step. */
  @keyframes lt-step-flash {
    0%   { box-shadow: 0 0 0 0 rgba(88,101,242,0.55); border-color: var(--accent-color, #5865f2); }
    100% { box-shadow: 0 0 0 8px rgba(88,101,242,0);   border-color: var(--border-color, #3e4045); }
  }
  /* Added dynamically by scrollToStep() — use :global so Svelte's static
     analysis doesn't strip it as an unused selector. */
  :global(.lt-step-flash) {
    animation: lt-step-flash 1.4s ease-out;
    border-color: var(--accent-color, #5865f2) !important;
  }

  .lt-method {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 3px;
    color: #fff;
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  /* Running banner */
  .lt-running-banner {
    display: flex; align-items: center; gap: 12px;
    background: rgba(88,101,242,0.1);
    border: 1px solid rgba(88,101,242,0.4);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 14px;
    font-size: 13px;
  }
  .lt-pulse {
    width: 8px; height: 8px; border-radius: 50%; background: #5865f2;
    animation: lt-pulse 1.2s ease-in-out infinite;
  }
  @keyframes lt-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.4); }
  }
  .lt-running-progress { margin-left: auto; margin-right: 12px; color: var(--text-secondary, #b0b5bc); font-size: 12px; }

  .lt-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .lt-card {
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .lt-card-warn { border-color: #d19a66; }
  .lt-card-label { font-size: 10.5px; color: var(--text-secondary, #949ba4); text-transform: uppercase; letter-spacing: 0.06em; }
  .lt-card-value { font-size: 20px; font-weight: 700; color: var(--text-primary, #f2f3f5); margin-top: 4px; }
  .lt-card-sub { font-size: 10.5px; color: var(--text-secondary, #72767d); margin-top: 2px; }

  .lt-spark { padding: 4px; background: var(--bg-tertiary, #1e1f22); border-radius: 6px; }

  /* Table */
  .lt-table-wrap { overflow-x: auto; }
  .lt-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .lt-table thead th {
    text-align: left; padding: 8px 10px; font-size: 10.5px; font-weight: 600;
    color: var(--text-secondary, #949ba4); text-transform: uppercase;
    letter-spacing: 0.05em; border-bottom: 1px solid var(--border-color, #3e4045);
  }
  .lt-table thead th.num { text-align: right; }
  .lt-table tbody td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-color, #2e3035);
    vertical-align: top;
  }
  .lt-table tbody td.num { text-align: right; font-family: 'SF Mono', Consolas, monospace; }
  .lt-table tbody tr.top td { background: rgba(244,67,54,0.06); }
  .lt-step-name { color: var(--text-primary, #f2f3f5); font-weight: 500; }
  .lt-step-url {
    color: var(--text-secondary, #72767d);
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
  }
  .lt-empty { padding: 24px; text-align: center; color: var(--text-secondary, #72767d); font-style: italic; }

  /* ---- Probe / discovery phase --------------------------------------- */
  .lt-probe-list {
    display: flex; flex-direction: column; gap: 4px;
    background: var(--bg-tertiary, #1e1f22);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 8px;
    padding: 6px;
    max-height: 360px;
    overflow-y: auto;
  }
  .lt-probe-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .lt-probe-row:hover { background: rgba(255,255,255,0.04); }
  .lt-probe-row.mutating { background: rgba(217,154,102,0.06); }
  .lt-probe-row.auth { background: rgba(88,101,242,0.08); }
  .lt-probe-name {
    color: var(--text-primary, #f2f3f5);
    font-weight: 500;
    flex-shrink: 0;
  }
  .lt-probe-url {
    color: var(--text-secondary, #949ba4);
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .lt-probe-exec {
    display: flex; flex-direction: column; gap: 6px;
  }
  .lt-probe-exec-row {
    background: var(--bg-tertiary, #1e1f22);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 8px;
    overflow: hidden;
  }
  .lt-probe-exec-row > summary {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    list-style: none;
  }
  .lt-probe-exec-row > summary::-webkit-details-marker { display: none; }
  .lt-probe-exec-idx {
    width: 22px; height: 22px;
    border-radius: 50%; background: var(--bg-secondary, #2b2d31);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600;
    color: var(--text-secondary, #949ba4);
    flex-shrink: 0;
  }
  .lt-probe-status { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .lt-probe-time { font-size: 11px; color: var(--text-secondary, #72767d); font-family: 'SF Mono', Consolas, monospace; }
  .lt-probe-vars { display: flex; gap: 4px; }
  .lt-probe-exec-body { padding: 10px 14px 14px; border-top: 1px solid var(--border-color, #2e3035); }
  .lt-probe-exec-url {
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 11px;
    color: var(--text-secondary, #949ba4);
    margin-bottom: 8px;
    word-break: break-all;
  }
  .lt-probe-exec-pre {
    background: var(--bg-primary, #1a1b1e);
    border: 1px solid var(--border-color, #2e3035);
    border-radius: 4px;
    padding: 8px 10px;
    margin: 0;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 11px;
    color: var(--text-primary, #e4e6eb);
    max-height: 240px; overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .lt-error-text { color: #f44336; }

  .lt-probe-vars-list { display: flex; flex-direction: column; gap: 6px; }
  .lt-probe-var-row {
    display: flex; align-items: center; gap: 8px;
    font-size: 12.5px;
  }
  .lt-probe-var-row code {
    background: var(--bg-tertiary, #1e1f22);
    padding: 1px 5px; border-radius: 3px; color: #d19a66; font-size: 11.5px;
  }

  /* Status / variable pills */
  .lt-pill-ok    { background: rgba(76,175,80,0.18);  color: #4caf50; }
  .lt-pill-err   { background: rgba(244,67,54,0.18);  color: #f44336; }
  .lt-pill-pending { background: rgba(149,165,166,0.18); color: #b0b5bc; }
  .lt-pill-warn  { background: rgba(217,154,102,0.18); color: #d19a66; }
  .lt-pill-var   { background: rgba(88,101,242,0.18); color: #aab4fa; }
  .lt-pill-provides { background: rgba(76,175,80,0.18); color: #4caf50; }
  .lt-pill-uses     { background: rgba(88,101,242,0.18); color: #aab4fa; }
  .lt-pill code     { background: transparent; padding: 0; color: inherit; font-family: 'SF Mono', Consolas, monospace; font-size: 11px; }

  /* ---- Review phase warnings + per-step badges ---------------------- */
  .lt-warn-box {
    margin-top: 10px;
    padding: 8px 12px;
    background: rgba(217,154,102,0.10);
    border: 1px solid rgba(217,154,102,0.35);
    border-radius: 6px;
    color: #d19a66;
    font-size: 12px;
  }
  .lt-step-card-badges {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 8px 12px;
    background: rgba(255,255,255,0.02);
    border-bottom: 1px solid var(--border-color, #2e3035);
  }
</style>
