<script lang="ts">
  import { decodeJwt, getJwtExpiry, type JwtDecodeResult, type JwtExpiryInfo } from '$lib/utils/encodingUtils';

  let input = '';
  let result: JwtDecodeResult | null = null;
  let expiry: JwtExpiryInfo | null = null;
  let copied = '';

  $: {
    if (input.trim()) {
      result = decodeJwt(input);
      expiry = result.valid ? getJwtExpiry(result.payload) : null;
    } else {
      result = null;
      expiry = null;
    }
  }

  function formatJson(obj: any): string {
    return JSON.stringify(obj, null, 2);
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    copied = label;
    setTimeout(() => copied = '', 1500);
  }
</script>

<div class="jwt-panel">
  <div class="panel-input-area">
    <label class="input-label" for="jwt-input">Paste JWT Token</label>
    <textarea
      id="jwt-input"
      bind:value={input}
      placeholder="eyJhbGciOiJIUzI1NiIs... (Bearer prefix auto-stripped)"
      rows="4"
      spellcheck="false"
    ></textarea>
  </div>

  {#if result}
    {#if result.valid}
      <div class="jwt-sections">
        {#if expiry}
          <div class="jwt-expiry" class:expired={expiry.isExpired} class:valid={!expiry.isExpired && expiry.expiresAt}>
            <span class="expiry-dot"></span>
            {#if expiry.expiresAt}
              <span class="expiry-label">{expiry.expiresIn}</span>
              <span class="expiry-date">{expiry.expiresAt.toLocaleString()}</span>
            {:else}
              <span class="expiry-label">{expiry.expiresIn}</span>
            {/if}
          </div>
        {/if}

        <div class="jwt-section">
          <div class="section-header">
            <span class="section-tag header-tag">HEADER</span>
            <span class="section-alg">{result.header?.alg || '?'}</span>
            <button class="copy-btn" on:click={() => copyToClipboard(formatJson(result?.header), 'header')}>
              {copied === 'header' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre class="section-code">{formatJson(result.header)}</pre>
        </div>

        <div class="jwt-section">
          <div class="section-header">
            <span class="section-tag payload-tag">PAYLOAD</span>
            <span class="section-claims">{Object.keys(result.payload || {}).length} claims</span>
            <button class="copy-btn" on:click={() => copyToClipboard(formatJson(result?.payload), 'payload')}>
              {copied === 'payload' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre class="section-code">{formatJson(result.payload)}</pre>
          <div class="claims-grid">
            {#each Object.entries(result.payload || {}) as [key, value]}
              <button class="claim" on:click={() => copyToClipboard(String(value), key)} title="Click to copy value">
                <span class="claim-key">{key}</span>
                <span class="claim-value">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="jwt-section">
          <div class="section-header">
            <span class="section-tag sig-tag">SIGNATURE</span>
            <button class="copy-btn" on:click={() => copyToClipboard(result?.signature || '', 'sig')}>
              {copied === 'sig' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre class="section-code sig-code">{result.signature}</pre>
        </div>
      </div>
    {:else}
      <div class="jwt-error">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0Zm.75 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>
        {result.error}
      </div>
    {/if}
  {:else}
    <div class="jwt-empty">Paste a JWT token above to decode it</div>
  {/if}
</div>

<style>
  .jwt-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    overflow-y: auto;
    padding: 16px;
  }

  .input-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    margin-bottom: 4px;
    display: block;
  }

  textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }

  textarea:focus { border-color: var(--accent-color); }

  .jwt-sections {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .jwt-expiry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    background: rgba(67, 181, 129, 0.08);
    border: 1px solid rgba(67, 181, 129, 0.2);
  }

  .jwt-expiry.expired {
    background: rgba(240, 71, 71, 0.08);
    border-color: rgba(240, 71, 71, 0.2);
  }

  .jwt-expiry.valid {
    background: rgba(67, 181, 129, 0.08);
    border-color: rgba(67, 181, 129, 0.2);
  }

  .expiry-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #43b581;
    flex-shrink: 0;
  }

  .expired .expiry-dot { background: #f04747; }

  .expiry-label { font-weight: 600; color: var(--text-primary); }
  .expiry-date { color: var(--text-secondary); margin-left: auto; font-size: 11px; }

  .jwt-section {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: hidden;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
  }

  .section-tag {
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  .header-tag { background: rgba(88, 101, 242, 0.15); color: #5865f2; }
  .payload-tag { background: rgba(250, 166, 26, 0.15); color: #faa61a; }
  .sig-tag { background: rgba(114, 118, 125, 0.15); color: #b5bac1; }

  .section-alg, .section-claims {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .copy-btn {
    margin-left: auto;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .copy-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

  .section-code {
    margin: 0;
    padding: 10px 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    color: #e8c479;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .sig-code { color: var(--text-secondary); }

  .claims-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-color);
  }

  .claim {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.1s;
    color: inherit;
  }

  .claim:hover { background: var(--bg-tertiary); border-color: var(--accent-color); }

  .claim-key { color: #5865f2; font-weight: 600; }
  .claim-value { color: var(--text-secondary); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .jwt-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(240, 71, 71, 0.08);
    border: 1px solid rgba(240, 71, 71, 0.2);
    border-radius: 6px;
    color: #f04747;
    font-size: 13px;
  }

  .jwt-empty {
    color: var(--text-secondary);
    font-size: 13px;
    font-style: italic;
    text-align: center;
    padding: 24px;
  }
</style>
