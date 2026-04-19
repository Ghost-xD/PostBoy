<script lang="ts">
  import { settings, updateSetting, resetSettings } from '$lib/stores/settingsStore';

  let saved = false;
  let savedTimeout: ReturnType<typeof setTimeout>;

  function showSaved() {
    saved = true;
    if (savedTimeout) clearTimeout(savedTimeout);
    savedTimeout = setTimeout(() => { saved = false; }, 1200);
  }

  async function handleUpdate<K extends keyof typeof $settings>(key: K, value: (typeof $settings)[K]) {
    await updateSetting(key, value);
    showSaved();
  }

  async function handleReset() {
    await resetSettings();
    showSaved();
  }
</script>

<div class="settings-panel">
  <div class="settings-section">
    <h4>Request</h4>

    <div class="setting-row">
      <label for="timeout">Request Timeout</label>
      <div class="setting-control">
        <input
          id="timeout"
          type="number"
          min="1"
          max="300"
          value={$settings.requestTimeout}
          on:change={(e) => handleUpdate('requestTimeout', parseInt(e.currentTarget.value) || 30)}
        />
        <span class="setting-unit">seconds</span>
      </div>
    </div>

    <div class="setting-row">
      <label for="follow-redirects">Follow Redirects</label>
      <div class="setting-control">
        <input
          id="follow-redirects"
          type="checkbox"
          checked={$settings.followRedirects}
          on:change={(e) => handleUpdate('followRedirects', e.currentTarget.checked)}
        />
        {#if $settings.followRedirects}
          <input
            type="number"
            min="1"
            max="50"
            value={$settings.maxRedirects}
            on:change={(e) => handleUpdate('maxRedirects', parseInt(e.currentTarget.value) || 10)}
            class="small-input"
            title="Max redirects"
          />
          <span class="setting-unit">max</span>
        {/if}
      </div>
    </div>

    <div class="setting-row">
      <label for="ssl">SSL Certificate Verification</label>
      <div class="setting-control">
        <input
          id="ssl"
          type="checkbox"
          checked={$settings.sslVerification}
          on:change={(e) => handleUpdate('sslVerification', e.currentTarget.checked)}
        />
        <span class="setting-hint">{$settings.sslVerification ? 'Enabled' : 'Disabled (accepts self-signed)'}</span>
      </div>
    </div>
  </div>

  <div class="settings-section">
    <h4>Proxy</h4>

    <div class="setting-row">
      <label for="proxy-enabled">Use Proxy</label>
      <div class="setting-control">
        <input
          id="proxy-enabled"
          type="checkbox"
          checked={$settings.proxyEnabled}
          on:change={(e) => handleUpdate('proxyEnabled', e.currentTarget.checked)}
        />
      </div>
    </div>

    {#if $settings.proxyEnabled}
      <div class="setting-row">
        <label for="proxy-url">Proxy URL</label>
        <div class="setting-control">
          <input
            id="proxy-url"
            type="text"
            value={$settings.proxyUrl}
            on:change={(e) => handleUpdate('proxyUrl', e.currentTarget.value)}
            placeholder="http://proxy.example.com:8080"
            class="wide-input"
          />
        </div>
      </div>
    {/if}
  </div>

  <div class="settings-footer">
    <button class="reset-btn" on:click={handleReset}>Reset to Defaults</button>
    {#if saved}
      <span class="saved-indicator">Saved</span>
    {/if}
  </div>
</div>

<style>
  .settings-panel {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    height: 100%;
    overflow-y: auto;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .settings-section h4 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary, #f2f3f5);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border-color, #3f4147);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    gap: 16px;
  }

  .setting-row label {
    font-size: 0.82rem;
    color: var(--text-secondary, #b5bac1);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .setting-control {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .setting-control input[type="number"] {
    width: 64px;
    padding: 5px 8px;
    background: var(--bg-primary, #1e1f22);
    color: var(--text-primary, #f2f3f5);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 4px;
    font-size: 0.82rem;
    text-align: center;
  }

  .setting-control input[type="text"] {
    padding: 5px 10px;
    background: var(--bg-primary, #1e1f22);
    color: var(--text-primary, #f2f3f5);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 4px;
    font-size: 0.82rem;
  }

  .wide-input {
    width: 280px;
  }

  .small-input {
    width: 48px !important;
  }

  .setting-control input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent-color, #5865f2);
    cursor: pointer;
  }

  .setting-unit, .setting-hint {
    font-size: 0.75rem;
    color: var(--text-muted, #6d6f78);
  }

  .settings-footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--border-color, #3f4147);
  }

  .reset-btn {
    padding: 6px 14px;
    background: transparent;
    color: var(--text-secondary, #b5bac1);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 4px;
    font-size: 0.78rem;
    cursor: pointer;
    transition: all 0.15s;
  }
  .reset-btn:hover {
    background: rgba(255, 107, 107, 0.1);
    color: #ff6b6b;
    border-color: rgba(255, 107, 107, 0.3);
  }

  .saved-indicator {
    font-size: 0.78rem;
    color: #57f287;
    font-weight: 500;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  input[type="number"]:focus,
  input[type="text"]:focus {
    outline: none;
    border-color: var(--accent-color, #5865f2);
  }
</style>
