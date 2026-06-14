<script lang="ts">
  import { activeTab, updateActiveTab } from '$lib/stores/tabStore';
  import { isStreamMethod } from '$lib/utils/streamConfig';
  import ScriptEditor from './ScriptEditor.svelte';

  let preRequestScript = $derived($activeTab.preRequestScript || '');
  let testScript = $derived($activeTab.testScript || '');
  let wsOnMessageScript = $derived($activeTab.wsOnMessageScript || '');
  let sseOnMessageScript = $derived($activeTab.sseOnMessageScript || '');
  let method = $derived($activeTab.method);
  let isStream = $derived(isStreamMethod(method));
  let isWs = $derived(method === 'WS' || method === 'WSS');
  let isSse = $derived(method === 'SSE');
  let scriptSection: 'pre' | 'test' | 'onmessage' = $state('pre');

  const preRequestExample = `// Set a variable used in the URL or headers
pm.variables.set('timestamp', Date.now().toString());
pm.request.headers.upsert({ key: 'X-Request-Id', value: pm.variables.get('timestamp') || '' });`;

  const testExample = `pm.test('Status is 200', () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test('Response has JSON body', () => {
  const json = pm.response.json();
  pm.expect(json).to.be.ok();
});`;

  const onMessageExample = `pm.test('Message is JSON with ok flag', () => {
  const json = pm.response.json();
  pm.expect(json.ok).to.equal(true);
});

pm.console.log('Event:', pm.message.eventType, pm.message.data);`;
</script>

<div class="scripts-section">
  <div class="scripts-tabs">
    <button type="button" class="scripts-tab {scriptSection === 'pre' ? 'active' : ''}" onclick={() => (scriptSection = 'pre')}>
      Pre-request
    </button>
    {#if isStream}
      <button type="button" class="scripts-tab {scriptSection === 'onmessage' ? 'active' : ''}" onclick={() => (scriptSection = 'onmessage')}>
        On message
      </button>
    {:else}
      <button type="button" class="scripts-tab {scriptSection === 'test' ? 'active' : ''}" onclick={() => (scriptSection = 'test')}>
        Tests
      </button>
    {/if}
  </div>

  {#if scriptSection === 'pre'}
    <p class="scripts-hint">
      Runs before connect{isStream ? '' : ' and send'}. Use <code>pm.request</code>, <code>pm.variables</code>, <code>pm.console.log</code>.
    </p>
    <ScriptEditor
      value={preRequestScript}
      placeholder={preRequestExample}
      oninput={(v) => updateActiveTab('preRequestScript', v)}
    />
  {:else if scriptSection === 'onmessage' && isStream}
    <p class="scripts-hint">
      Runs on each incoming {isWs ? 'WebSocket' : 'SSE'} message. Use <code>pm.message</code>, <code>pm.response</code>, <code>pm.test</code>, <code>pm.expect</code>.
    </p>
    <ScriptEditor
      value={isWs ? wsOnMessageScript : sseOnMessageScript}
      placeholder={onMessageExample}
      oninput={(v) => updateActiveTab(isWs ? 'wsOnMessageScript' : 'sseOnMessageScript', v)}
    />
  {:else}
    <p class="scripts-hint">Runs after the response. Use <code>pm.response</code>, <code>pm.test</code>, <code>pm.expect</code>.</p>
    <ScriptEditor
      value={testScript}
      placeholder={testExample}
      oninput={(v) => updateActiveTab('testScript', v)}
    />
  {/if}
</div>

<style>
  .scripts-section {
    padding: 1rem;
  }

  .scripts-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .scripts-tab {
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .scripts-tab.active {
    border-color: var(--accent-color);
    background: var(--bg-primary);
  }

  .scripts-hint {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .scripts-hint code {
    font-size: 0.8rem;
  }
</style>
