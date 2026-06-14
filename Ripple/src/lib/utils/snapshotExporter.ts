import type { Tab } from '$lib/stores/tabStore';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(str: string): string {
  const bytes = new TextEncoder().encode(str).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function tryFormatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function syntaxHighlightJson(json: string): string {
  return escapeHtml(json).replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'sn-number';
      if (match.startsWith('"')) {
        cls = match.endsWith(':') ? 'sn-key' : 'sn-string';
      } else if (/true|false/.test(match)) {
        cls = 'sn-bool';
      } else if (match === 'null') {
        cls = 'sn-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
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
  return colors[method.toUpperCase()] || '#90a4ae';
}

export function generateSnapshotHtml(tab: Tab): string {
  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const reqHeaders = (tab.headers || []).filter(h => h.key);
  const reqParams = (tab.params || []).filter(p => p.key);
  const hasReqBody = tab.bodyContent && tab.bodyType !== 'none';
  const hasResponse = tab.responseStatus !== null;

  const respHeaders = tab.responseHeaders || {};
  const respHeaderEntries = Object.entries(respHeaders);
  const formattedRespBody = tab.responseBody ? tryFormatJson(tab.responseBody) : '';
  const isJsonResponse = (() => {
    try { JSON.parse(tab.responseBody); return true; } catch { return false; }
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(tab.method)} ${escapeHtml(tab.url)} — Ripple Snapshot</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
    background: #1a1b1e; color: #e4e6eb; line-height: 1.6;
    padding: 24px; min-height: 100vh;
  }
  .container { max-width: 900px; margin: 0 auto; }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 28px; padding-bottom: 16px;
    border-bottom: 1px solid #2e3035;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-icon {
    width: 32px; height: 32px; background: #5865f2; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 14px; color: #fff;
  }
  .brand-name { font-size: 18px; font-weight: 700; color: #f2f3f5; letter-spacing: -0.02em; }
  .brand-sub { font-size: 12px; color: #72767d; }
  .timestamp { font-size: 12px; color: #72767d; text-align: right; }
  .section {
    background: #2b2d31; border: 1px solid #3e4045; border-radius: 10px;
    margin-bottom: 20px; overflow: hidden;
  }
  .section-title {
    padding: 12px 18px; font-size: 13px; font-weight: 600; color: #b0b5bc;
    background: #232428; text-transform: uppercase; letter-spacing: 0.06em;
    border-bottom: 1px solid #3e4045;
  }
  .url-bar {
    display: flex; align-items: center; gap: 12px; padding: 16px 18px;
    background: #232428; flex-wrap: wrap;
  }
  .method-badge {
    padding: 4px 12px; border-radius: 4px; font-weight: 700; font-size: 13px;
    color: #fff; letter-spacing: 0.03em; flex-shrink: 0;
  }
  .url {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 14px; color: #e4e6eb; word-break: break-all; flex: 1;
  }
  .status-bar {
    display: flex; align-items: center; gap: 16px; padding: 14px 18px;
    background: #232428; flex-wrap: wrap;
  }
  .status-pill {
    padding: 4px 12px; border-radius: 4px; font-weight: 700; font-size: 13px;
    color: #fff;
  }
  .meta { font-size: 12px; color: #949ba4; display: flex; align-items: center; gap: 5px; }
  .meta svg { opacity: 0.7; }
  .kv-table { width: 100%; border-collapse: collapse; }
  .kv-table tr { border-bottom: 1px solid #3e4045; }
  .kv-table tr:last-child { border-bottom: none; }
  .kv-table td { padding: 8px 18px; font-size: 13px; vertical-align: top; }
  .kv-key {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    color: #7289da; width: 220px; font-weight: 500;
  }
  .kv-val {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    color: #dcddde; word-break: break-all;
  }
  .code-block {
    padding: 16px 18px; overflow-x: auto;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px; line-height: 1.65; white-space: pre-wrap;
    word-break: break-word; background: #1e1f22; color: #dcddde;
  }
  .sn-key { color: #7289da; }
  .sn-string { color: #57ab5a; }
  .sn-number { color: #d19a66; }
  .sn-bool { color: #c678dd; }
  .sn-null { color: #72767d; font-style: italic; }
  .empty-notice {
    padding: 24px 18px; text-align: center; color: #72767d; font-size: 13px;
    font-style: italic;
  }
  .footer {
    text-align: center; padding: 24px 0 8px; color: #4a4d52; font-size: 11px;
  }
  .footer a { color: #5865f2; text-decoration: none; }
  .body-type-badge {
    display: inline-block; padding: 2px 8px; border-radius: 3px;
    background: #383a40; color: #b0b5bc; font-size: 11px; font-weight: 500;
    margin-left: 8px; text-transform: uppercase;
  }
  @media (max-width: 640px) {
    body { padding: 12px; }
    .url-bar, .status-bar { padding: 12px; }
    .kv-key { width: 140px; }
  }
  @media print {
    body { background: #fff; color: #1a1b1e; padding: 12px; }
    .section { border-color: #d0d0d0; background: #fafafa; }
    .section-title { background: #f0f0f0; color: #555; border-color: #d0d0d0; }
    .url-bar, .status-bar { background: #f0f0f0; }
    .code-block { background: #f5f5f5; color: #1a1b1e; }
    .kv-table tr { border-color: #d0d0d0; }
    .url { color: #1a1b1e; }
    .kv-val { color: #333; }
    .sn-key { color: #0451a5; }
    .sn-string { color: #0a7e23; }
    .sn-number { color: #b5600f; }
    .sn-bool { color: #7c3aed; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">
      <div class="brand-icon">R</div>
      <div>
        <div class="brand-name">Ripple</div>
        <div class="brand-sub">Request Snapshot</div>
      </div>
    </div>
    <div class="timestamp">${escapeHtml(timestamp)}<br>${escapeHtml(tab.name || 'Untitled')}</div>
  </div>

  <!-- Request -->
  <div class="section">
    <div class="url-bar">
      <span class="method-badge" style="background:${getMethodColor(tab.method)}">${escapeHtml(tab.method)}</span>
      <span class="url">${escapeHtml(tab.url)}</span>
    </div>
  </div>

${reqParams.length > 0 ? `  <div class="section">
    <div class="section-title">Query Parameters</div>
    <table class="kv-table">
${reqParams.map(p => `      <tr><td class="kv-key">${escapeHtml(p.key)}</td><td class="kv-val">${escapeHtml(p.value)}</td></tr>`).join('\n')}
    </table>
  </div>
` : ''}
${reqHeaders.length > 0 ? `  <div class="section">
    <div class="section-title">Request Headers</div>
    <table class="kv-table">
${reqHeaders.map(h => `      <tr><td class="kv-key">${escapeHtml(h.key)}</td><td class="kv-val">${escapeHtml(h.value)}</td></tr>`).join('\n')}
    </table>
  </div>
` : ''}
${hasReqBody ? `  <div class="section">
    <div class="section-title">Request Body<span class="body-type-badge">${escapeHtml(tab.bodyType)}</span></div>
    <div class="code-block">${tab.bodyType === 'json' ? syntaxHighlightJson(tryFormatJson(tab.bodyContent)) : escapeHtml(tab.bodyContent)}</div>
  </div>
` : ''}
${hasResponse ? `  <!-- Response -->
  <div class="section">
    <div class="status-bar">
      <span class="status-pill" style="background:${getStatusColor(tab.responseStatus!)}">${tab.responseStatus} ${escapeHtml(tab.responseStatusText || '')}</span>
      <span class="meta">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>
        ${tab.responseTime ?? '—'}ms
      </span>
      <span class="meta">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 0a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z"/></svg>
        ${escapeHtml(tab.responseSize || formatBytes(tab.responseBody))}
      </span>
    </div>
  </div>

${respHeaderEntries.length > 0 ? `  <div class="section">
    <div class="section-title">Response Headers</div>
    <table class="kv-table">
${respHeaderEntries.map(([k, v]) => `      <tr><td class="kv-key">${escapeHtml(k)}</td><td class="kv-val">${escapeHtml(String(v))}</td></tr>`).join('\n')}
    </table>
  </div>
` : ''}
  <div class="section">
    <div class="section-title">Response Body</div>
${tab.responseBody
  ? `    <div class="code-block">${isJsonResponse ? syntaxHighlightJson(formattedRespBody) : escapeHtml(formattedRespBody)}</div>`
  : `    <div class="empty-notice">Empty response body</div>`}
  </div>
` : `  <div class="section">
    <div class="empty-notice">No response — request has not been sent yet</div>
  </div>
`}
  <div class="footer">
    Exported from <a href="https://github.com/moodysaroha/postboy">Ripple</a> &middot; ${escapeHtml(timestamp)}
  </div>
</div>
</body>
</html>`;
}
