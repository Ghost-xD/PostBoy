import type { DoneEvent, StepAggregate } from '$lib/stores/loadTestStore';

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return '#4caf50';
  if (status >= 300 && status < 400) return '#ff9800';
  if (status >= 400 && status < 500) return '#f44336';
  if (status >= 500) return '#e91e63';
  return '#90a4ae';
}

function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '#4caf50', POST: '#ff9800', PUT: '#2196f3',
    PATCH: '#9c27b0', DELETE: '#f44336', HEAD: '#607d8b',
    OPTIONS: '#795548',
  };
  return colors[(method || '').toUpperCase()] || '#90a4ae';
}

function formatNumber(n: number): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(n < 10 ? 1 : 0);
}

function formatMs(n: number): string {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return (n / 1000).toFixed(2) + 's';
  return Math.round(n) + 'ms';
}

function formatBytes(n: number): string {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function buildThroughputSvg(series: number[]): string {
  if (!series || series.length === 0) {
    return '<div class="empty-notice">No throughput data.</div>';
  }
  const w = 760;
  const h = 160;
  const padX = 24;
  const padY = 14;
  const maxV = Math.max(1, ...series);
  const step = (w - 2 * padX) / Math.max(1, series.length - 1);
  const points = series
    .map((v, i) => {
      const x = padX + i * step;
      const y = h - padY - ((v / maxV) * (h - 2 * padY));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaPoints = `${padX},${h - padY} ${points} ${(padX + (series.length - 1) * step).toFixed(1)},${h - padY}`;

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart-svg">
    <polyline points="${padX},${h - padY} ${(w - padX).toFixed(1)},${h - padY}" stroke="#3e4045" stroke-width="1" fill="none"/>
    <polygon points="${areaPoints}" fill="url(#tpgrad)" opacity="0.35"/>
    <polyline points="${points}" stroke="#5865f2" stroke-width="1.75" fill="none"/>
    <defs>
      <linearGradient id="tpgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5865f2" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="#5865f2" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <text x="${padX}" y="12" fill="#72767d" font-size="10">${maxV} rps</text>
    <text x="${padX}" y="${h - 2}" fill="#72767d" font-size="10">0s</text>
    <text x="${w - padX}" y="${h - 2}" fill="#72767d" font-size="10" text-anchor="end">${series.length}s</text>
  </svg>`;
}

function buildLatencyDistSvg(steps: StepAggregate[]): string {
  if (!steps || steps.length === 0) return '<div class="empty-notice">No latency data.</div>';
  const w = 760;
  const rowH = 32;
  const padX = 200;
  const padY = 8;
  const h = padY * 2 + steps.length * rowH;
  const maxV = Math.max(1, ...steps.map((s) => s.p99_ms || s.max_ms || 0));

  const rows = steps
    .map((s, i) => {
      const y = padY + i * rowH + 8;
      const p50x = padX + (s.p50_ms / maxV) * (w - padX - 16);
      const p95x = padX + (s.p95_ms / maxV) * (w - padX - 16);
      const p99x = padX + (s.p99_ms / maxV) * (w - padX - 16);
      const maxx = padX + (s.max_ms / maxV) * (w - padX - 16);
      const label = `${s.method} ${s.name}`;
      const labelTrunc = label.length > 30 ? label.slice(0, 30) + '…' : label;
      return `
        <text x="${padX - 8}" y="${y + 10}" fill="#dcddde" font-size="11" text-anchor="end">${escapeHtml(labelTrunc)}</text>
        <line x1="${padX}" y1="${y + 8}" x2="${maxx.toFixed(1)}" y2="${y + 8}" stroke="#3e4045" stroke-width="1"/>
        <circle cx="${p50x.toFixed(1)}" cy="${y + 8}" r="3" fill="#57ab5a"/>
        <circle cx="${p95x.toFixed(1)}" cy="${y + 8}" r="3.5" fill="#d19a66"/>
        <circle cx="${p99x.toFixed(1)}" cy="${y + 8}" r="3.5" fill="#f44336"/>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg dist-svg">
    ${rows}
    <text x="${w - 16}" y="${h - 4}" fill="#72767d" font-size="10" text-anchor="end">max p99 ${Math.round(maxV)}ms</text>
  </svg>
  <div class="legend">
    <span><i style="background:#57ab5a"></i>p50</span>
    <span><i style="background:#d19a66"></i>p95</span>
    <span><i style="background:#f44336"></i>p99</span>
  </div>`;
}

function rankBottlenecks(steps: StepAggregate[]): StepAggregate[] {
  return steps.slice().sort((a, b) => b.p95_ms - a.p95_ms || b.error_rate - a.error_rate);
}

function renderMarkdownLite(md: string): string {
  // Very small markdown subset (paragraphs, lists, **bold**, `code`).
  // We deliberately avoid pulling in a markdown lib to keep snapshot exports
  // self-contained.
  if (!md) return '';
  const escaped = escapeHtml(md);
  const withCode = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = withBold.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>');
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<p>' + line + '</p>');
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

export interface ReportData {
  collectionName: string;
  mode: string;
  config: {
    concurrency: number;
    durationSecs: number;
    totalRequests: number;
    rampUpSecs: number;
    targetRps: number;
  };
  result: DoneEvent;
  aiAnalysis: string;
}

export function generateLoadTestReport(data: ReportData): string {
  const { result } = data;
  const now = new Date().toLocaleString();
  const sortedSteps = rankBottlenecks(result.per_step || []);
  const okPct = result.total_count > 0 ? ((result.total_ok / result.total_count) * 100).toFixed(2) : '0';
  const errPct = result.total_count > 0 ? ((result.total_err / result.total_count) * 100).toFixed(2) : '0';

  const stepRows = sortedSteps
    .map((s, idx) => `
      <tr class="${idx === 0 && s.p95_ms > 0 ? 'top-bottleneck' : ''}">
        <td><span class="method-badge" style="background:${getMethodColor(s.method)}">${escapeHtml(s.method)}</span></td>
        <td>
          <div class="step-name">${escapeHtml(s.name)}</div>
          <div class="step-url" title="${escapeHtml(s.url)}">${escapeHtml(s.url)}</div>
        </td>
        <td class="num">${formatNumber(s.count)}</td>
        <td class="num"><span class="err-pill" style="opacity:${s.error_rate > 0 ? 1 : 0.35}">${(s.error_rate * 100).toFixed(1)}%</span></td>
        <td class="num">${formatMs(s.avg_ms)}</td>
        <td class="num">${formatMs(s.p50_ms)}</td>
        <td class="num">${formatMs(s.p95_ms)}</td>
        <td class="num">${formatMs(s.p99_ms)}</td>
        <td class="num">${formatMs(s.max_ms)}</td>
        <td>${renderStatusCodes(s.status_codes)}</td>
      </tr>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Load Test — ${escapeHtml(data.collectionName)} — Ripple</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
    background: #1a1b1e; color: #e4e6eb; line-height: 1.55;
    padding: 24px; min-height: 100vh;
  }
  .container { max-width: 1100px; margin: 0 auto; }
  .header {
    display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: 24px; padding-bottom: 14px; border-bottom: 1px solid #2e3035;
    flex-wrap: wrap; gap: 16px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-icon { width: 36px; height: 36px; background: #5865f2; border-radius: 8px;
    display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; }
  .brand-name { font-size: 20px; font-weight: 700; }
  .brand-sub { font-size: 12px; color: #72767d; }
  .timestamp { font-size: 12px; color: #72767d; text-align: right; }

  .summary-cards {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px; margin-bottom: 22px;
  }
  .card { background: #2b2d31; border: 1px solid #3e4045; border-radius: 10px; padding: 14px 16px; }
  .card-label { font-size: 11px; color: #949ba4; text-transform: uppercase; letter-spacing: 0.06em; }
  .card-value { font-size: 22px; font-weight: 700; color: #f2f3f5; margin-top: 4px; }
  .card-sub { font-size: 11px; color: #72767d; margin-top: 2px; }

  .section { background: #2b2d31; border: 1px solid #3e4045; border-radius: 10px;
    margin-bottom: 20px; overflow: hidden; }
  .section-title {
    padding: 12px 18px; font-size: 13px; font-weight: 600; color: #b0b5bc;
    background: #232428; text-transform: uppercase; letter-spacing: 0.06em;
    border-bottom: 1px solid #3e4045;
    display: flex; align-items: center; justify-content: space-between;
  }
  .section-body { padding: 16px 18px; }

  .ai-narrative { padding: 16px 18px; font-size: 14px; color: #e4e6eb; line-height: 1.65; }
  .ai-narrative p { margin: 0 0 10px 0; }
  .ai-narrative ul { padding-left: 24px; margin: 6px 0 12px 0; }
  .ai-narrative li { margin-bottom: 4px; }
  .ai-narrative code { background: #1e1f22; padding: 1px 5px; border-radius: 3px; font-size: 13px; color: #d19a66; }
  .ai-narrative strong { color: #f2f3f5; }

  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  thead th {
    text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 600;
    color: #949ba4; text-transform: uppercase; letter-spacing: 0.05em;
    background: #232428; border-bottom: 1px solid #3e4045;
  }
  thead th.num { text-align: right; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #2e3035; vertical-align: top; }
  tbody td.num { text-align: right; font-family: 'SF Mono', Consolas, monospace; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr.top-bottleneck { background: rgba(244,67,54,0.06); }

  .method-badge { display: inline-block; padding: 2px 7px; border-radius: 3px;
    color: #fff; font-weight: 700; font-size: 10.5px; letter-spacing: 0.04em; }
  .step-name { color: #f2f3f5; font-weight: 500; }
  .step-url { color: #72767d; font-family: 'SF Mono', Consolas, monospace; font-size: 11px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
  .err-pill { display: inline-block; padding: 2px 7px; border-radius: 3px; background: #f44336; color: #fff; font-size: 11px; }
  .status-pills { display: flex; flex-wrap: wrap; gap: 4px; }
  .status-pill { padding: 2px 6px; border-radius: 3px; font-size: 10.5px; color: #fff; font-weight: 600; }

  .chart-svg { width: 100%; height: auto; display: block; background: #1e1f22; border-radius: 6px; }
  .chart-svg.dist-svg { background: transparent; }
  .legend { display: flex; gap: 14px; font-size: 11px; color: #b0b5bc; margin-top: 8px; padding-left: 8px; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .empty-notice { padding: 18px; text-align: center; color: #72767d; font-style: italic; font-size: 13px; }

  .meta-grid { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size: 13px; }
  .meta-key { color: #949ba4; }
  .meta-val { color: #dcddde; font-family: 'SF Mono', Consolas, monospace; }

  .footer { text-align: center; padding: 22px 0 8px; color: #4a4d52; font-size: 11px; }
  .footer a { color: #5865f2; text-decoration: none; }

  @media print {
    body { background: #fff; color: #1a1b1e; padding: 12px; }
    .card, .section { background: #fafafa; border-color: #d0d0d0; }
    .section-title { background: #f0f0f0; color: #555; }
    thead th { background: #f0f0f0; color: #555; }
    .chart-svg { background: #fff; }
    .step-url, .meta-key, .card-sub { color: #777; }
    .step-name, .card-value, .ai-narrative strong { color: #1a1b1e; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">
      <div class="brand-icon">R</div>
      <div>
        <div class="brand-name">Ripple Load Test Report</div>
        <div class="brand-sub">${escapeHtml(data.collectionName)} · ${escapeHtml(data.mode === 'chain' ? 'Chain per VU' : 'Per-endpoint hammer')}${result.cancelled ? ' · CANCELLED EARLY' : ''}</div>
      </div>
    </div>
    <div class="timestamp">${escapeHtml(now)}</div>
  </div>

  <div class="summary-cards">
    <div class="card">
      <div class="card-label">Total requests</div>
      <div class="card-value">${formatNumber(result.total_count)}</div>
      <div class="card-sub">${formatNumber(result.total_ok)} ok · ${formatNumber(result.total_err)} failed</div>
    </div>
    <div class="card">
      <div class="card-label">Throughput</div>
      <div class="card-value">${result.rps_overall.toFixed(1)} <span style="font-size:12px;color:#949ba4;">rps</span></div>
      <div class="card-sub">avg over ${(result.elapsed_ms / 1000).toFixed(1)}s</div>
    </div>
    <div class="card">
      <div class="card-label">Success rate</div>
      <div class="card-value" style="color:${result.total_err === 0 ? '#4caf50' : '#d19a66'}">${okPct}%</div>
      <div class="card-sub">${errPct}% errors</div>
    </div>
    <div class="card">
      <div class="card-label">Concurrency</div>
      <div class="card-value">${data.config.concurrency}</div>
      <div class="card-sub">${data.config.rampUpSecs > 0 ? `ramp ${data.config.rampUpSecs}s` : 'no ramp'}${data.config.targetRps > 0 ? ` · cap ${data.config.targetRps} rps` : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Data transferred</div>
      <div class="card-value">${formatBytes(result.bytes_total)}</div>
      <div class="card-sub">response bodies</div>
    </div>
  </div>

  <!-- AI narrative -->
  <div class="section">
    <div class="section-title">What to optimize <span style="text-transform:none;font-weight:400;color:#72767d;font-size:11px;">AI analysis</span></div>
    <div class="ai-narrative">${renderMarkdownLite(data.aiAnalysis) || '<div class="empty-notice">No analysis generated.</div>'}</div>
  </div>

  <!-- Per-endpoint table -->
  <div class="section">
    <div class="section-title">Per-endpoint metrics (sorted by p95)</div>
    <table>
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
          <th>Status codes</th>
        </tr>
      </thead>
      <tbody>
        ${stepRows || '<tr><td colspan="10" class="empty-notice">No completed requests.</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- Throughput chart -->
  <div class="section">
    <div class="section-title">Throughput over time</div>
    <div class="section-body">${buildThroughputSvg(result.throughput_series)}</div>
  </div>

  <!-- Latency distribution chart -->
  <div class="section">
    <div class="section-title">Latency distribution (p50 / p95 / p99)</div>
    <div class="section-body">${buildLatencyDistSvg(sortedSteps)}</div>
  </div>

  <!-- Run config -->
  <div class="section">
    <div class="section-title">Run configuration</div>
    <div class="section-body">
      <div class="meta-grid">
        <div class="meta-key">Mode</div><div class="meta-val">${escapeHtml(data.mode)}</div>
        <div class="meta-key">Concurrency</div><div class="meta-val">${data.config.concurrency}</div>
        <div class="meta-key">Duration</div><div class="meta-val">${data.config.durationSecs > 0 ? data.config.durationSecs + 's' : '—'}</div>
        <div class="meta-key">Total request cap</div><div class="meta-val">${data.config.totalRequests > 0 ? data.config.totalRequests : '—'}</div>
        <div class="meta-key">Ramp-up</div><div class="meta-val">${data.config.rampUpSecs > 0 ? data.config.rampUpSecs + 's' : '0 (instant)'}</div>
        <div class="meta-key">Target RPS</div><div class="meta-val">${data.config.targetRps > 0 ? data.config.targetRps : 'uncapped'}</div>
        <div class="meta-key">Elapsed</div><div class="meta-val">${(result.elapsed_ms / 1000).toFixed(2)}s${result.cancelled ? ' (cancelled)' : ''}</div>
        <div class="meta-key">Bottleneck ranking</div><div class="meta-val">${(result.bottlenecks || []).slice(0, 5).map((id) => {
          const s = sortedSteps.find((x) => x.step_id === id);
          return escapeHtml(s ? `${s.method} ${s.name}` : id);
        }).join(' &rsaquo; ') || '—'}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    Generated by <a href="https://github.com/moodysaroha/postboy">Ripple</a> · ${escapeHtml(now)}
  </div>
</div>
</body>
</html>`;
}

function renderStatusCodes(codes: Record<string, number> | undefined): string {
  if (!codes) return '<span style="color:#72767d">—</span>';
  const entries = Object.entries(codes).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<span style="color:#72767d">—</span>';
  return '<div class="status-pills">' +
    entries.slice(0, 6).map(([code, count]) =>
      `<span class="status-pill" style="background:${getStatusColor(Number(code))}">${escapeHtml(code)}: ${count}</span>`,
    ).join('') +
    '</div>';
}
