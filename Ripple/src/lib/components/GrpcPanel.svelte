<script lang="ts">
  import { activeTab, updateActiveTab, updateActiveTabBatch } from '$lib/stores/tabStore';
  import { addLog } from '$lib/stores/consoleStore';
  import { grpc } from '$lib/api/tauri';
  import VariableInput from './VariableInput.svelte';
  import { get } from 'svelte/store';
  import { sendingTabIds, isSendingRequest } from '$lib/stores/uiStore';

  let url = $derived($activeTab.url);
  let grpcService = $derived($activeTab.grpcService);
  let grpcMethod = $derived($activeTab.grpcMethod);
  let bodyContent = $derived($activeTab.bodyContent);
  let headers = $derived($activeTab.headers);
  let collectionId = $derived($activeTab.collectionId);
  let tabId = $derived($activeTab.id);

  let services = $state<string[]>([]);
  let methods = $state<string[]>([]);
  let busy = $state(false);

  async function loadServices() {
    if (!url.trim()) {
      addLog('Enter a gRPC server address first (e.g. grpcb.in:9000)', 'error');
      return;
    }
    busy = true;
    try {
      services = await grpc.listServices(url.trim());
      addLog(`✓ Found ${services.length} gRPC service(s)`, 'system');
    } catch (e: any) {
      addLog(`✗ gRPC reflection failed: ${e.message || e}`, 'error');
    } finally {
      busy = false;
    }
  }

  async function loadMethods() {
    if (!url.trim() || !grpcService.trim()) return;
    busy = true;
    try {
      methods = await grpc.describeService(url.trim(), grpcService.trim());
    } catch (e: any) {
      addLog(`✗ Could not describe service: ${e.message || e}`, 'error');
      methods = [];
    } finally {
      busy = false;
    }
  }

  async function invokeGrpc() {
    if (!url.trim() || !grpcService.trim() || !grpcMethod.trim()) {
      addLog('Server, service, and method are required', 'error');
      return;
    }
    const sendingTabId = tabId;
    sendingTabIds.update((s) => { s.add(sendingTabId); return new Set(s); });
    isSendingRequest.set(true);
    busy = true;
    const start = Date.now();
    try {
      const metadata: Record<string, string> = {};
      headers.filter((h) => h.key && h.value).forEach((h) => { metadata[h.key] = h.value; });

      const response = await grpc.invoke(
        url.trim(),
        grpcService.trim(),
        grpcMethod.trim(),
        Object.keys(metadata).length ? metadata : undefined,
        bodyContent.trim() || '{}'
      );

      updateActiveTabBatch({
        responseStatus: response.status,
        responseStatusText: response.statusText || 'OK',
        responseTime: response.responseTime || (Date.now() - start),
        responseHeaders: response.headers || {},
        responseBody: response.body || '',
        responseContentType: 'application/json',
        responseIsBinary: false,
        responseSize: `${new Blob([response.body || '']).size} B`,
        responseTimestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
        }),
      });
      addLog(`✓ gRPC ${response.status} • ${response.responseTime}ms`, 'info');
    } catch (e: any) {
      updateActiveTabBatch({
        responseStatus: 0,
        responseStatusText: 'Error',
        responseTime: Date.now() - start,
        responseBody: `Error: ${e.message || e}`,
        responseSize: '',
      });
      addLog(`✗ gRPC failed: ${e.message || e}`, 'error');
    } finally {
      busy = false;
      sendingTabIds.update((s) => { s.delete(sendingTabId); return new Set(s); });
      isSendingRequest.set(get(sendingTabIds).size > 0);
    }
  }
</script>

<div class="grpc-panel">
  <p class="grpc-hint">
    Server address goes in the URL bar (e.g. <code>grpcb.in:9000</code>). Uses server reflection for schema discovery.
  </p>

  <div class="grpc-row">
    <button type="button" class="grpc-btn" disabled={busy} onclick={loadServices}>List Services</button>
    {#if services.length > 0}
      <select
        class="grpc-select"
        value={grpcService}
        onchange={(e) => {
          updateActiveTab('grpcService', e.currentTarget.value);
          void loadMethods();
        }}
      >
        <option value="">Select service…</option>
        {#each services as svc}
          <option value={svc}>{svc}</option>
        {/each}
      </select>
    {:else}
      <VariableInput
        value={grpcService}
        {collectionId}
        oninput={(v) => updateActiveTab('grpcService', v)}
        inputClass="grpc-input"
        placeholder="Service (e.g. helloworld.Greeter)"
      />
    {/if}
  </div>

  <div class="grpc-row">
    {#if methods.length > 0}
      <select
        class="grpc-select"
        value={grpcMethod}
        onchange={(e) => updateActiveTab('grpcMethod', e.currentTarget.value)}
      >
        <option value="">Select method…</option>
        {#each methods as m}
          <option value={m}>{m}</option>
        {/each}
      </select>
    {:else}
      <VariableInput
        value={grpcMethod}
        {collectionId}
        oninput={(v) => updateActiveTab('grpcMethod', v)}
        inputClass="grpc-input"
        placeholder="Method (e.g. SayHello)"
      />
    {/if}
    <button type="button" class="grpc-btn primary" disabled={busy} onclick={invokeGrpc}>Invoke</button>
  </div>

  <div class="grpc-body">
    <label for="grpc-body-json">Request JSON</label>
    <VariableInput
      id="grpc-body-json"
      multiline
      rows={10}
      value={bodyContent || '{}'}
      {collectionId}
      oninput={(v) => updateActiveTab('bodyContent', v)}
      inputClass="grpc-body-input"
      placeholder={'{"name": "World"}'}
    />
  </div>
</div>

<style>
  .grpc-panel {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .grpc-hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .grpc-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .grpc-btn {
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .grpc-btn.primary {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: #fff;
  }

  .grpc-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .grpc-select {
    flex: 1;
    min-width: 200px;
    padding: 0.45rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .grpc-body label {
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.9rem;
    font-weight: 500;
  }

  :global(.grpc-body-input) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.85rem;
  }
</style>
