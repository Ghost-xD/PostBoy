<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { db, fileOps, loadTest } from '$lib/api/tauri';
  import { showLoadTest } from '$lib/stores/uiStore';
  import { addLog } from '$lib/stores/consoleStore';
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
  } from '$lib/stores/loadTestStore';
  import { draftPlan as runDraftPlan, analyzeResults } from '$lib/utils/loadTestAI';
  import { compilePlan } from '$lib/utils/loadTestPlanCompiler';
  import { generateLoadTestReport } from '$lib/utils/loadTestReport';

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

  onMount(async () => {
    // Reset transient state in case the user re-opens the screen mid-run-finished.
    if (get(phase) !== 'running') {
      resetForNewRun(true);
    }
    try {
      const cols = (await db.getCollections()) as Array<{ id: number; name: string; parent_id?: number | null }>;
      collections = cols || [];
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
  });

  onDestroy(() => {
    unlistenProgress?.();
    unlistenDone?.();
    unlistenError?.();
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

  async function generatePlan() {
    planError.set(null);
    planLoading.set(true);
    try {
      const draft = await runDraftPlan({ config: $config });
      draftPlan.set(draft);
      phase.set('review');
    } catch (e: any) {
      planError.set(e?.message || String(e));
      addLog(`✗ Plan generation failed: ${e?.message || e}`, 'error');
    } finally {
      planLoading.set(false);
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
          {:else if $phase === 'review'}Review AI plan
          {:else if $phase === 'running'}Running…
          {:else}Results
          {/if}
        </div>
      </div>
    </div>

    <div class="lt-steps">
      {#each [['configure','Configure'], ['review','Plan'], ['running','Run'], ['results','Results']] as s, i}
        <div class="lt-step {$phase === s[0] ? 'active' : ''} {['configure','review','running','results'].indexOf($phase) > i ? 'done' : ''}">
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

      <div class="lt-actions lt-actions-sticky">
        <button
          class="lt-btn lt-btn-primary"
          onclick={generatePlan}
          disabled={$planLoading || !$config.collectionId}
        >
          {#if $planLoading}Generating with AI…{:else}Generate plan with AI →{/if}
        </button>
      </div>
    {/if}

    <!-- ================================================================== -->
    <!-- PHASE 1: REVIEW                                                     -->
    <!-- ================================================================== -->
    {#if $phase === 'review' && $draftPlan}
      {@const dp = $draftPlan}
      <div class="lt-section">
        <div class="lt-section-title">
          AI rationale
          <span class="lt-section-hint">{dp.origin === 'ai' ? 'Generated by Son of Anton' : 'Fallback plan'}</span>
        </div>
        <div class="lt-narrative">{dp.rationale || '(no rationale provided)'}</div>
      </div>

      <div class="lt-section">
        <div class="lt-section-title">Knobs</div>
        <div class="lt-grid">
          <label class="lt-field">
            <span class="lt-label">Mode</span>
            <select class="lt-input" value={dp.mode} onchange={(e) => draftPlan.update((p) => p ? { ...p, mode: (e.target as HTMLSelectElement).value as any } : p)}>
              <option value="chain">Chain per VU</option>
              <option value="per_endpoint">Per-endpoint hammer</option>
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
            <span class="lt-label">Total request cap</span>
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

      <div class="lt-section">
        <div class="lt-section-title">Initial variables <span class="lt-section-hint">Available as <code>&#123;&#123;name&#125;&#125;</code> in every step</span></div>
        {#each varRows as row, i}
          <div class="lt-row lt-row-tight">
            <input class="lt-input lt-input-narrow" placeholder="variable" bind:value={row.k} onblur={syncVarRowsToPlan} />
            <input class="lt-input" placeholder="value" bind:value={row.v} onblur={syncVarRowsToPlan} />
            <button class="lt-btn lt-btn-danger" onclick={() => removeVarRow(i)}>×</button>
          </div>
        {/each}
        <button class="lt-btn lt-btn-ghost" onclick={addVarRow}>+ Add variable</button>
      </div>

      <div class="lt-section">
        <div class="lt-section-title">
          Request chain
          <span class="lt-section-hint">{dp.steps.length} step{dp.steps.length === 1 ? '' : 's'}</span>
        </div>
        {#each dp.steps as step, i (step.id)}
          <div class="lt-step-card">
            <div class="lt-step-card-head">
              <div class="lt-step-card-pos">{i + 1}</div>
              <span class="lt-method" style="background:{methodColor(step.method)}">{step.method}</span>
              <div class="lt-step-card-meta">
                <div class="lt-step-card-name">{step.name}</div>
                <div class="lt-step-card-url" title={step.url}>{step.url}</div>
              </div>
              <div class="lt-step-card-actions">
                <button class="lt-btn lt-btn-ghost lt-btn-icon" disabled={i === 0} onclick={() => moveStep(i, -1)} title="Move up">↑</button>
                <button class="lt-btn lt-btn-ghost lt-btn-icon" disabled={i === dp.steps.length - 1} onclick={() => moveStep(i, 1)} title="Move down">↓</button>
                <button class="lt-btn lt-btn-danger lt-btn-icon" onclick={() => removeStep(i)} title="Remove">×</button>
              </div>
            </div>
            <div class="lt-step-card-body">
              <div class="lt-extractions">
                <div class="lt-subtle">JSON-path extractions</div>
                {#each step.extractions as ext, ei}
                  <div class="lt-row lt-row-tight">
                    <input
                      class="lt-input"
                      placeholder="jsonPath (e.g. data.access_token)"
                      value={ext.jsonPath}
                      oninput={(e) => updateExtraction(i, ei, 'jsonPath', (e.target as HTMLInputElement).value)}
                    />
                    <span class="lt-arrow">→</span>
                    <input
                      class="lt-input lt-input-narrow"
                      placeholder="variableName"
                      value={ext.variableName}
                      oninput={(e) => updateExtraction(i, ei, 'variableName', (e.target as HTMLInputElement).value)}
                    />
                    <button class="lt-btn lt-btn-danger lt-btn-icon" onclick={() => removeExtraction(i, ei)}>×</button>
                  </div>
                {/each}
                <button class="lt-btn lt-btn-ghost lt-btn-small" onclick={() => addExtraction(i)}>+ extraction</button>
              </div>
            </div>
          </div>
        {/each}
      </div>

      {#if $runError}
        <div class="lt-error">{$runError}</div>
      {/if}

      <div class="lt-actions lt-actions-sticky">
        <button class="lt-btn lt-btn-ghost" onclick={backToConfigure}>← Back</button>
        <button class="lt-btn lt-btn-primary" onclick={startRun} disabled={dp.steps.length === 0}>Approve &amp; Run ▶</button>
      </div>
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
        <button class="lt-btn lt-btn-danger" onclick={cancelRun}>Cancel run</button>
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
          <div class="lt-narrative">{$aiAnalysis}</div>
        {:else}
          <div class="lt-narrative">_No analysis available._</div>
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

      <div class="lt-actions">
        <button class="lt-btn lt-btn-ghost" onclick={runAgain}>↻ Run again</button>
        <button class="lt-btn lt-btn-primary" onclick={saveReport}>↓ Save HTML report</button>
      </div>
    {/if}
  </div>
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

  .lt-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color, #2e3035);
  }

  /* Keep the configure-phase primary action (Generate Plan) pinned to the
     bottom of the scroll area so it's reachable on any screen height without
     scrolling. Negative margins cancel `.lt-body`'s padding so the bar spans
     full width and sits flush against the bottom edge; the solid background
     lets the form scroll underneath it. */
  .lt-actions-sticky {
    position: sticky;
    bottom: 0;
    margin-top: 16px;
    margin-left: -28px;
    margin-right: -28px;
    margin-bottom: -32px;
    padding: 14px 28px;
    background: var(--bg-primary, #1a1b1e);
    z-index: 5;
  }

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
    white-space: pre-wrap;
  }
  .lt-narrative-loading { opacity: 0.6; font-style: italic; }
  .lt-narrative code { background: var(--bg-tertiary, #1e1f22); padding: 1px 5px; border-radius: 3px; color: #d19a66; font-size: 12.5px; }

  /* Step cards (review phase) */
  .lt-step-card {
    background: var(--bg-tertiary, #1e1f22);
    border: 1px solid var(--border-color, #3e4045);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
  }
  .lt-step-card-head {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px;
    background: var(--bg-secondary, #2b2d31);
  }
  .lt-step-card-pos {
    width: 22px; height: 22px;
    border-radius: 50%; background: var(--bg-tertiary, #3f4147);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; color: var(--text-secondary, #b0b5bc);
  }
  .lt-step-card-meta { flex: 1; min-width: 0; }
  .lt-step-card-name { font-size: 13px; font-weight: 500; color: var(--text-primary, #e4e6eb); }
  .lt-step-card-url {
    font-size: 11px; color: var(--text-secondary, #72767d);
    font-family: 'SF Mono', Consolas, monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .lt-step-card-actions { display: flex; gap: 4px; }
  .lt-step-card-body { padding: 10px 12px; }
  .lt-extractions { display: flex; flex-direction: column; gap: 4px; }
  .lt-arrow { color: var(--text-secondary, #72767d); padding: 0 4px; }

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
</style>
