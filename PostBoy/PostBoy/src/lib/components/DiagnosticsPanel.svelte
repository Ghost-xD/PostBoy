<script lang="ts">
  import { net } from '$lib/api/tauri';

  type DiagStatus = 'idle' | 'running' | 'success' | 'error';

  interface DnsResult {
    hostname: string;
    addresses: string[];
    duration_ms: number;
  }

  interface PortCheckResult {
    host: string;
    port: number;
    open: boolean;
    duration_ms: number;
    error: string | null;
  }

  interface PingResult {
    host: string;
    ip: string;
    reachable: boolean;
    latency_ms: number | null;
    error: string | null;
  }

  interface TraceHop {
    hop: number;
    ip: string | null;
    hostname: string | null;
    latency_ms: number | null;
    timed_out: boolean;
  }

  interface TraceResult {
    target: string;
    hops: TraceHop[];
    duration_ms: number;
  }

  let hostname = $state('');
  let port = $state('');

  let dnsStatus = $state<DiagStatus>('idle');
  let portStatus = $state<DiagStatus>('idle');
  let pingStatus = $state<DiagStatus>('idle');
  let traceStatus = $state<DiagStatus>('idle');

  let dnsResult: DnsResult | null = $state(null);
  let portResult: PortCheckResult | null = $state(null);
  let pingResult: PingResult | null = $state(null);
  let traceResult: TraceResult | null = $state(null);

  let dnsError = $state('');
  let portError = $state('');
  let pingError = $state('');
  let traceError = $state('');

  function extractHostname(input: string): string {
    let s = input.trim();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      try {
        const url = new URL(s);
        return url.hostname;
      } catch {
        s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
      }
    }
    s = s.split('/')[0].split('?')[0].split('#')[0];
    s = s.replace(/:\d+$/, '');
    return s.toLowerCase();
  }

  function extractPort(input: string): number | null {
    const trimmed = input.trim();
    try {
      const url = new URL(trimmed);
      if (url.port) return parseInt(url.port, 10);
      if (url.protocol === 'https:') return 443;
      if (url.protocol === 'http:') return 80;
    } catch { /* not a full URL */ }
    const portMatch = trimmed.match(/:(\d+)(\/|$)/);
    if (portMatch) return parseInt(portMatch[1], 10);
    return null;
  }

  function formatLatency(ms: number | null | undefined): string {
    if (ms == null) return '—';
    if (ms < 1) return '<1 ms';
    return `${Math.round(ms)} ms`;
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  }

  function getEffectiveHost(): string {
    return extractHostname(hostname) || hostname.trim();
  }

  function getEffectivePort(): number {
    if (port.trim()) return parseInt(port.trim(), 10) || 80;
    return extractPort(hostname) || 80;
  }

  let canRun = $derived(hostname.trim().length > 0);
  let anyRunning = $derived(dnsStatus === 'running' || portStatus === 'running' || pingStatus === 'running' || traceStatus === 'running');

  async function runDns() {
    const host = getEffectiveHost();
    if (!host) return;
    dnsStatus = 'running';
    dnsResult = null;
    dnsError = '';
    try {
      dnsResult = await net.dnsResolve(host);
      dnsStatus = 'success';
    } catch (e: any) {
      dnsError = e?.message || e || 'DNS resolution failed';
      dnsStatus = 'error';
    }
  }

  async function runPortCheck() {
    const host = getEffectiveHost();
    if (!host) return;
    portStatus = 'running';
    portResult = null;
    portError = '';
    try {
      portResult = await net.portCheck(host, getEffectivePort());
      portStatus = portResult.open ? 'success' : 'error';
    } catch (e: any) {
      portError = e?.message || e || 'Port check failed';
      portStatus = 'error';
    }
  }

  async function runPing() {
    const host = getEffectiveHost();
    if (!host) return;
    pingStatus = 'running';
    pingResult = null;
    pingError = '';
    try {
      pingResult = await net.pingHost(host);
      pingStatus = pingResult.reachable ? 'success' : 'error';
    } catch (e: any) {
      pingError = e?.message || e || 'Ping failed';
      pingStatus = 'error';
    }
  }

  async function runTrace() {
    const host = getEffectiveHost();
    if (!host) return;
    traceStatus = 'running';
    traceResult = null;
    traceError = '';
    try {
      traceResult = await net.traceRoute(host);
      traceStatus = 'success';
    } catch (e: any) {
      traceError = e?.message || e || 'Trace route failed';
      traceStatus = 'error';
    }
  }

  async function runAll() {
    if (!canRun) return;
    runDns();
    runPortCheck();
    runPing();
    runTrace();
  }

  function resetAll() {
    dnsStatus = portStatus = pingStatus = traceStatus = 'idle';
    dnsResult = portResult = pingResult = traceResult = null;
    dnsError = portError = pingError = traceError = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canRun && !anyRunning) {
      runAll();
    }
  }
</script>

<div class="diag-panel">
  <div class="diag-header">
    <div class="diag-title">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      Network Diagnostics
    </div>
  </div>

  <div class="diag-input-row">
    <div class="diag-input-group" style="flex:1">
      <label for="diag-host">Hostname / URL</label>
      <input
        id="diag-host"
        type="text"
        class="diag-input"
        bind:value={hostname}
        placeholder="e.g. api.example.com or https://example.com:8080/path"
        onkeydown={handleKeydown}
      />
    </div>
    <div class="diag-input-group" style="width:100px">
      <label for="diag-port">Port</label>
      <input
        id="diag-port"
        type="text"
        class="diag-input"
        bind:value={port}
        placeholder="auto"
        onkeydown={handleKeydown}
      />
    </div>
    <div class="diag-input-group diag-btn-group">
      <button class="diag-run-btn" onclick={runAll} disabled={!canRun || anyRunning}>
        {#if anyRunning}
          <svg class="diag-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
          Running…
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Run All
        {/if}
      </button>
      <button class="diag-reset-btn" onclick={resetAll} title="Clear results">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
    </div>
  </div>

  <div class="diag-cards">
    <!-- DNS Card -->
    <div class="diag-card" class:running={dnsStatus === 'running'} class:success={dnsStatus === 'success'} class:error={dnsStatus === 'error'}>
      <div class="card-header">
        <div class="card-title-row">
          <span class="card-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10H3"/><path d="M21 6H3"/><path d="M21 14H3"/><path d="M21 18H3"/></svg>
          </span>
          <span class="card-title">DNS Resolve</span>
          <span class="card-status status-{dnsStatus}">{dnsStatus}</span>
        </div>
        <button class="card-run-btn" onclick={runDns} disabled={!canRun || dnsStatus === 'running'}>Run</button>
      </div>
      <div class="card-body">
        {#if dnsStatus === 'idle'}
          <span class="card-placeholder">Resolve hostname to IP addresses</span>
        {:else if dnsStatus === 'running'}
          <span class="card-loading">Resolving…</span>
        {:else if dnsError}
          <span class="card-error">{dnsError}</span>
        {:else if dnsResult}
          <div class="card-result-list">
            {#each dnsResult.addresses as addr}
              <code class="ip-addr">{addr}</code>
            {/each}
          </div>
          <span class="card-timing">{formatDuration(dnsResult.duration_ms)}</span>
        {/if}
      </div>
    </div>

    <!-- Port Check Card -->
    <div class="diag-card" class:running={portStatus === 'running'} class:success={portStatus === 'success'} class:error={portStatus === 'error'}>
      <div class="card-header">
        <div class="card-title-row">
          <span class="card-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          </span>
          <span class="card-title">Port Check</span>
          <span class="card-status status-{portStatus}">{portStatus}</span>
        </div>
        <button class="card-run-btn" onclick={runPortCheck} disabled={!canRun || portStatus === 'running'}>Run</button>
      </div>
      <div class="card-body">
        {#if portStatus === 'idle'}
          <span class="card-placeholder">Test if a TCP port is open</span>
        {:else if portStatus === 'running'}
          <span class="card-loading">Checking port {getEffectivePort()}…</span>
        {:else if portError}
          <span class="card-error">{portError}</span>
        {:else if portResult}
          <div class="port-result">
            <span class="port-badge" class:open={portResult.open} class:closed={!portResult.open}>
              {portResult.open ? 'OPEN' : 'CLOSED'}
            </span>
            <span class="port-detail">{portResult.host}:{portResult.port}</span>
          </div>
          {#if portResult.error}
            <span class="card-error-detail">{portResult.error}</span>
          {/if}
          <span class="card-timing">{formatDuration(portResult.duration_ms)}</span>
        {/if}
      </div>
    </div>

    <!-- Ping Card -->
    <div class="diag-card" class:running={pingStatus === 'running'} class:success={pingStatus === 'success'} class:error={pingStatus === 'error'}>
      <div class="card-header">
        <div class="card-title-row">
          <span class="card-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          </span>
          <span class="card-title">Ping</span>
          <span class="card-status status-{pingStatus}">{pingStatus}</span>
        </div>
        <button class="card-run-btn" onclick={runPing} disabled={!canRun || pingStatus === 'running'}>Run</button>
      </div>
      <div class="card-body">
        {#if pingStatus === 'idle'}
          <span class="card-placeholder">ICMP ping with latency (TCP fallback)</span>
        {:else if pingStatus === 'running'}
          <span class="card-loading">Pinging…</span>
        {:else if pingError}
          <span class="card-error">{pingError}</span>
        {:else if pingResult}
          <div class="ping-result">
            <span class="ping-badge" class:reachable={pingResult.reachable} class:unreachable={!pingResult.reachable}>
              {pingResult.reachable ? 'REACHABLE' : 'UNREACHABLE'}
            </span>
            <span class="ping-detail">{pingResult.ip} — {formatLatency(pingResult.latency_ms)}</span>
          </div>
          {#if pingResult.error}
            <span class="card-error-detail">{pingResult.error}</span>
          {/if}
        {/if}
      </div>
    </div>

    <!-- Trace Route Card -->
    <div class="diag-card trace-card" class:running={traceStatus === 'running'} class:success={traceStatus === 'success'} class:error={traceStatus === 'error'}>
      <div class="card-header">
        <div class="card-title-row">
          <span class="card-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </span>
          <span class="card-title">Trace Route</span>
          <span class="card-status status-{traceStatus}">{traceStatus}</span>
        </div>
        <button class="card-run-btn" onclick={runTrace} disabled={!canRun || traceStatus === 'running'}>Run</button>
      </div>
      <div class="card-body">
        {#if traceStatus === 'idle'}
          <span class="card-placeholder">Trace network hops to destination</span>
        {:else if traceStatus === 'running'}
          <span class="card-loading">Tracing route (this may take a while)…</span>
        {:else if traceError}
          <span class="card-error">{traceError}</span>
        {:else if traceResult}
          <div class="trace-table-wrapper">
            <table class="trace-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>IP</th>
                  <th>Latency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {#each traceResult.hops as hop}
                  <tr class:timed-out={hop.timed_out}>
                    <td class="hop-num">{hop.hop}</td>
                    <td class="hop-ip">{hop.timed_out ? '*' : (hop.ip || '—')}</td>
                    <td class="hop-latency">{hop.timed_out ? '*' : formatLatency(hop.latency_ms)}</td>
                    <td class="hop-status">{hop.timed_out ? 'timeout' : 'ok'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <span class="card-timing">{formatDuration(traceResult.duration_ms)}</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="diag-footer">
    <span class="diag-hint">Ctrl+Enter to run all diagnostics</span>
  </div>
</div>

<style>
  .diag-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px 24px;
    gap: 16px;
    overflow-y: auto;
    background: var(--bg-primary);
  }

  .diag-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .diag-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .diag-title svg { color: var(--accent-color); }

  .diag-input-row {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    flex-shrink: 0;
  }

  .diag-input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .diag-input-group label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
  }

  .diag-input {
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }

  .diag-input:focus { border-color: var(--accent-color); }

  .diag-btn-group {
    flex-direction: row;
    gap: 6px;
    align-items: flex-end;
  }

  .diag-run-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    background: var(--accent-color);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .diag-run-btn:hover:not(:disabled) { opacity: 0.85; }
  .diag-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .diag-reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .diag-reset-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .diag-spinner { animation: spin 0.8s linear infinite; }

  .diag-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .diag-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .diag-card.running { border-color: var(--accent-color); }
  .diag-card.success { border-color: #43b581; }
  .diag-card.error { border-color: #f04747; }

  .trace-card {
    grid-column: 1 / -1;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-tertiary);
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card-icon { display: flex; color: var(--text-secondary); }
  .card-title { font-size: 12px; font-weight: 600; color: var(--text-primary); }

  .card-status {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .status-idle { color: var(--text-secondary); background: transparent; }
  .status-running { color: var(--accent-color); background: rgba(88, 101, 242, 0.1); }
  .status-success { color: #43b581; background: rgba(67, 181, 129, 0.1); }
  .status-error { color: #f04747; background: rgba(240, 71, 71, 0.1); }

  .card-run-btn {
    padding: 3px 10px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .card-run-btn:hover:not(:disabled) { background: var(--bg-primary); color: var(--text-primary); }
  .card-run-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .card-body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-height: 60px;
  }

  .card-placeholder {
    color: var(--text-secondary);
    font-size: 12px;
    font-style: italic;
  }

  .card-loading {
    color: var(--accent-color);
    font-size: 12px;
    font-weight: 500;
  }

  .card-error {
    color: #f04747;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    word-break: break-word;
  }

  .card-error-detail {
    color: var(--text-secondary);
    font-size: 11px;
    font-style: italic;
  }

  .card-timing {
    font-size: 10px;
    color: var(--text-secondary);
    align-self: flex-end;
    margin-top: auto;
  }

  .card-result-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ip-addr {
    padding: 3px 8px;
    background: rgba(67, 181, 129, 0.08);
    border: 1px solid rgba(67, 181, 129, 0.2);
    border-radius: 4px;
    color: #43b581;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
  }

  .port-result, .ping-result {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .port-badge, .ping-badge {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .port-badge.open, .ping-badge.reachable {
    background: rgba(67, 181, 129, 0.1);
    color: #43b581;
  }

  .port-badge.closed, .ping-badge.unreachable {
    background: rgba(240, 71, 71, 0.1);
    color: #f04747;
  }

  .port-detail, .ping-detail {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    color: var(--text-primary);
  }

  .trace-table-wrapper {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    max-height: 280px;
  }

  .trace-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }

  .trace-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .trace-table th {
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
  }

  .trace-table td {
    padding: 5px 12px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .trace-table tr.timed-out td {
    color: var(--text-secondary);
    opacity: 0.6;
  }

  .hop-num {
    width: 36px;
    text-align: right;
    color: var(--text-secondary);
    opacity: 0.5;
  }

  .diag-footer {
    flex-shrink: 0;
    text-align: center;
  }

  .diag-hint {
    font-size: 10px;
    color: var(--text-secondary);
    opacity: 0.6;
  }
</style>
