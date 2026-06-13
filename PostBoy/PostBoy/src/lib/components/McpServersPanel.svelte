<script lang="ts">
  // MCP server management panel — mirrors Cursor's settings UX:
  //   - One row per registered server with a status dot, a toggle, and
  //     drill-down for per-tool overrides.
  //   - Add/edit form supporting both stdio and remote transports.
  //   - "Sign in" entry point for remote servers that advertise OAuth.
  //   - Raw `mcp.json` paste-and-import for users who keep their config
  //     in source control or are migrating from Cursor.
  //   - Quick-add catalog so users don't have to memorise CLI invocations.
  //
  // Everything is reactive against `mcpStore`, which Rust also pushes
  // updates into via `mcp-status` events — so a connect that takes 10s
  // doesn't freeze the UI.

  import { onMount } from 'svelte';
  import {
    mcpServers,
    mcpToolCap,
    mcpReady,
    mcpEnabledToolCount,
    initMcpStore,
    refreshServers,
    addServer,
    updateServer,
    deleteServer,
    setServerEnabled,
    setToolEnabled,
    connect,
    disconnect,
    authorize,
    clearOAuth,
    importJson,
    setToolCap,
    statusLabel,
    isConnected,
    isFailed,
    QUICK_ADD_CATALOG,
  } from '$lib/stores/mcpStore';
  import type { McpServerInput, McpServerView } from '$lib/api/tauri';
  import type { CatalogEntry } from '$lib/stores/mcpStore';

  // ---------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------
  let expanded = $state<Set<string>>(new Set());
  let editingId = $state<string | null>(null);
  let showAddForm = $state(false);
  let showImportForm = $state(false);
  let importText = $state('');
  let importError = $state('');
  let toolCapDraft = $state('');
  let toolCapMessage = $state('');
  let busyMap = $state<Record<string, string>>({}); // server id -> action
  let globalError = $state('');

  // Form model. Single object reused for "Add" and "Edit" — `editingId`
  // discriminates which one we're saving into. Keeping fields separate
  // for stdio vs remote (rather than a discriminated union) so the form
  // template doesn't have to thrash refs when the user toggles
  // transport mid-edit.
  type FormState = {
    transport: 'stdio' | 'remote';
    name: string;
    command: string;
    argsText: string;
    envText: string;
    cwd: string;
    url: string;
    headersText: string;
    manualToken: string;
    enabled: boolean;
  };
  const EMPTY_FORM: FormState = {
    transport: 'stdio',
    name: '',
    command: '',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
    manualToken: '',
    enabled: true,
  };
  let form = $state<FormState>({ ...EMPTY_FORM });
  let formError = $state('');

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  onMount(async () => {
    try {
      await initMcpStore();
      toolCapDraft = String($mcpToolCap.cap);
    } catch (e: any) {
      globalError = e?.message ?? String(e);
    }
  });

  $effect(() => {
    if ($mcpReady && !toolCapDraft) {
      toolCapDraft = String($mcpToolCap.cap);
    }
  });

  // ---------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------
  function openAdd(prefill?: McpServerInput) {
    showAddForm = true;
    editingId = null;
    form = formFromInput(prefill);
    formError = '';
  }

  function openEdit(server: McpServerView) {
    showAddForm = true;
    editingId = server.config.id;
    form = formFromServer(server);
    formError = '';
  }

  function closeForm() {
    showAddForm = false;
    editingId = null;
    form = { ...EMPTY_FORM };
    formError = '';
  }

  function formFromInput(input?: McpServerInput): FormState {
    if (!input) return { ...EMPTY_FORM };
    return {
      transport: input.transport,
      name: input.name ?? '',
      command: input.command ?? '',
      argsText: (input.args ?? []).join('\n'),
      envText: stringifyEntries(input.env),
      cwd: input.cwd ?? '',
      url: input.url ?? '',
      headersText: stringifyEntries(input.headers),
      manualToken: '',
      enabled: input.enabled ?? true,
    };
  }

  function formFromServer(s: McpServerView): FormState {
    const t = s.config.transport;
    if (t.kind === 'stdio') {
      return {
        transport: 'stdio',
        name: s.config.name,
        command: t.command,
        argsText: t.args.join('\n'),
        envText: stringifyEntries(t.env),
        cwd: t.cwd ?? '',
        url: '',
        headersText: '',
        manualToken: '',
        enabled: s.config.enabled,
      };
    }
    return {
      transport: 'remote',
      name: s.config.name,
      command: '',
      argsText: '',
      envText: '',
      cwd: '',
      url: t.url,
      headersText: stringifyEntries(t.headers),
      manualToken: '',
      enabled: s.config.enabled,
    };
  }

  function stringifyEntries(rec?: Record<string, string>): string {
    if (!rec) return '';
    return Object.entries(rec)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
  }

  function parseEntries(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  }

  function buildInput(): McpServerInput | null {
    formError = '';
    if (!form.name.trim()) {
      formError = 'Name is required';
      return null;
    }
    const base = {
      id: editingId ?? undefined,
      name: form.name.trim(),
      enabled: form.enabled,
      manualToken: form.manualToken.trim() || undefined,
    };
    if (form.transport === 'stdio') {
      if (!form.command.trim()) {
        formError = 'Command is required for stdio servers';
        return null;
      }
      const args = form.argsText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        ...base,
        transport: 'stdio',
        command: form.command.trim(),
        args,
        env: parseEntries(form.envText),
        cwd: form.cwd.trim() || null,
      };
    }
    if (!form.url.trim()) {
      formError = 'URL is required for remote servers';
      return null;
    }
    return {
      ...base,
      transport: 'remote',
      url: form.url.trim(),
      headers: parseEntries(form.headersText),
    };
  }

  async function saveForm() {
    const input = buildInput();
    if (!input) return;
    try {
      if (editingId) {
        await updateServer(input);
      } else {
        await addServer(input);
      }
      closeForm();
    } catch (e: any) {
      formError = e?.message ?? String(e);
    }
  }

  // ---------------------------------------------------------------------
  // Row actions
  // ---------------------------------------------------------------------
  async function withBusy<T>(id: string, action: string, fn: () => Promise<T>): Promise<T | null> {
    busyMap = { ...busyMap, [id]: action };
    globalError = '';
    try {
      return await fn();
    } catch (e: any) {
      globalError = `${action} failed: ${e?.message ?? String(e)}`;
      return null;
    } finally {
      const { [id]: _, ...rest } = busyMap;
      busyMap = rest;
    }
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  async function handleConnect(s: McpServerView) {
    await withBusy(s.config.id, 'Connect', () => connect(s.config.id));
  }
  async function handleDisconnect(s: McpServerView) {
    await withBusy(s.config.id, 'Disconnect', () => disconnect(s.config.id));
  }
  async function handleEnabledToggle(s: McpServerView) {
    await withBusy(s.config.id, 'Toggle', () => setServerEnabled(s.config.id, !s.config.enabled));
  }
  async function handleDelete(s: McpServerView) {
    if (!confirm(`Delete MCP server "${s.config.name}"? Stored credentials will be cleared.`)) return;
    await withBusy(s.config.id, 'Delete', () => deleteServer(s.config.id));
  }
  async function handleSignIn(s: McpServerView) {
    await withBusy(s.config.id, 'Sign in', () => authorize(s.config.id));
  }
  async function handleSignOut(s: McpServerView) {
    if (!confirm(`Clear OAuth credentials for "${s.config.name}"?`)) return;
    await withBusy(s.config.id, 'Sign out', () => clearOAuth(s.config.id));
  }
  async function handleToolToggle(server: McpServerView, toolName: string, enabled: boolean) {
    await withBusy(server.config.id, 'Tool toggle', () =>
      setToolEnabled(server.config.id, toolName, enabled),
    );
  }

  // ---------------------------------------------------------------------
  // Import + cap
  // ---------------------------------------------------------------------
  async function handleImport() {
    importError = '';
    if (!importText.trim()) {
      importError = 'Paste an mcp.json snippet first';
      return;
    }
    try {
      await importJson(importText);
      importText = '';
      showImportForm = false;
    } catch (e: any) {
      importError = e?.message ?? String(e);
    }
  }

  async function applyToolCap() {
    toolCapMessage = '';
    const n = Number(toolCapDraft);
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      toolCapMessage = 'Cap must be between 1 and 200';
      return;
    }
    try {
      await setToolCap(Math.floor(n));
      toolCapMessage = 'Saved';
      setTimeout(() => (toolCapMessage = ''), 1500);
    } catch (e: any) {
      toolCapMessage = e?.message ?? String(e);
    }
  }

  function statusKind(s: McpServerView): 'ok' | 'wait' | 'idle' | 'err' {
    if (isConnected(s.status)) return 'ok';
    if (s.status === 'connecting') return 'wait';
    if (isFailed(s.status)) return 'err';
    return 'idle';
  }

  let showCapWarning = $derived($mcpEnabledToolCount > $mcpToolCap.cap);

  // Sort by status (connected first), then by name. Done client-side so
  // the panel feels alive even when only the in-memory store changes.
  let sortedServers = $derived(
    [...$mcpServers].sort((a, b) => {
      const rank = (s: McpServerView) =>
        isConnected(s.status) ? 0 : s.status === 'connecting' ? 1 : isFailed(s.status) ? 2 : 3;
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.config.name.localeCompare(b.config.name);
    }),
  );
</script>

<div class="mcp-panel">
  <header class="mcp-header">
    <div>
      <h2>MCP servers</h2>
      <p class="mcp-sub">
        Connect Model Context Protocol servers to expose extra tools to the
        chatbot. Tools are namespaced as <code>mcp__&lt;server&gt;__&lt;tool&gt;</code>.
      </p>
    </div>
    <div class="mcp-header-actions">
      <button class="mcp-btn primary" onclick={() => openAdd()}>+ Add server</button>
      <button class="mcp-btn" onclick={() => (showImportForm = !showImportForm)}>
        Import mcp.json
      </button>
      <button class="mcp-btn" onclick={() => refreshServers()}>Refresh</button>
    </div>
  </header>

  {#if globalError}
    <div class="mcp-alert err">{globalError}</div>
  {/if}

  <!-- Tool cap row + over-cap warning -->
  <section class="mcp-cap-row">
    <label class="mcp-cap-label">
      Tool cap:
      <input
        class="mcp-input small"
        type="number"
        min="1"
        max="200"
        bind:value={toolCapDraft}
      />
    </label>
    <button class="mcp-btn" onclick={applyToolCap}>Save</button>
    <span class="mcp-cap-hint">
      Built-ins + MCP tools combined. Default {$mcpToolCap.defaultCap}.
      Currently enabled: <strong>{$mcpEnabledToolCount}</strong>.
    </span>
    {#if toolCapMessage}<span class="mcp-cap-msg">{toolCapMessage}</span>{/if}
  </section>

  {#if showCapWarning}
    <div class="mcp-alert warn">
      You have {$mcpEnabledToolCount} enabled MCP tools but the cap is {$mcpToolCap.cap}.
      Tools beyond the cap are silently dropped from the model's prompt.
      Disable some, raise the cap, or expect the model to occasionally miss
      a tool that should be available.
    </div>
  {/if}

  <!-- mcp.json import -->
  {#if showImportForm}
    <section class="mcp-import">
      <h3>Paste mcp.json</h3>
      <p class="mcp-sub">
        Same format Cursor's <code>mcp.json</code> uses. Each server entry
        becomes a row below.
      </p>
      <textarea
        class="mcp-textarea"
        rows="8"
        placeholder={'{\n  "mcpServers": {\n    "my-server": { "command": "npx", "args": ["-y", "..."] }\n  }\n}'}
        bind:value={importText}
      ></textarea>
      {#if importError}<div class="mcp-alert err inline">{importError}</div>{/if}
      <div class="mcp-form-actions">
        <button class="mcp-btn primary" onclick={handleImport}>Import</button>
        <button class="mcp-btn" onclick={() => (showImportForm = false)}>Cancel</button>
      </div>
    </section>
  {/if}

  <!-- Add / edit form -->
  {#if showAddForm}
    <section class="mcp-form">
      <h3>{editingId ? 'Edit server' : 'Add server'}</h3>
      <div class="mcp-field">
        <label for="mcp-name">Display name</label>
        <input id="mcp-name" class="mcp-input" type="text" bind:value={form.name} />
      </div>
      <div class="mcp-field">
        <label for="mcp-transport">Transport</label>
        <select id="mcp-transport" class="mcp-input" bind:value={form.transport}>
          <option value="stdio">stdio (local subprocess)</option>
          <option value="remote">remote (HTTP / SSE)</option>
        </select>
      </div>

      {#if form.transport === 'stdio'}
        <div class="mcp-field">
          <label for="mcp-command">Command</label>
          <input
            id="mcp-command"
            class="mcp-input mono"
            placeholder="npx"
            bind:value={form.command}
          />
        </div>
        <div class="mcp-field">
          <label for="mcp-args">Args (one per line)</label>
          <textarea
            id="mcp-args"
            class="mcp-textarea mono"
            rows="4"
            placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir'}
            bind:value={form.argsText}
          ></textarea>
        </div>
        <div class="mcp-field">
          <label for="mcp-env">Environment (KEY=VALUE per line)</label>
          <textarea
            id="mcp-env"
            class="mcp-textarea mono"
            rows="3"
            placeholder={'GITHUB_TOKEN=${env:GITHUB_TOKEN}'}
            bind:value={form.envText}
          ></textarea>
        </div>
        <div class="mcp-field">
          <label for="mcp-cwd">Working directory (optional)</label>
          <input id="mcp-cwd" class="mcp-input mono" bind:value={form.cwd} />
        </div>
      {:else}
        <div class="mcp-field">
          <label for="mcp-url">URL</label>
          <input
            id="mcp-url"
            class="mcp-input mono"
            placeholder="https://mcp.example.com/sse"
            bind:value={form.url}
          />
        </div>
        <div class="mcp-field">
          <label for="mcp-headers">Headers (Header-Name=value per line)</label>
          <textarea
            id="mcp-headers"
            class="mcp-textarea mono"
            rows="3"
            placeholder={'Authorization=Bearer ${secret:manual-token}\nX-Org-Id=42'}
            bind:value={form.headersText}
          ></textarea>
        </div>
        <div class="mcp-field">
          <label for="mcp-token">Bearer token / PAT (stored in keychain)</label>
          <input
            id="mcp-token"
            class="mcp-input"
            type="password"
            placeholder={editingId ? '(leave blank to keep existing)' : 'Optional'}
            bind:value={form.manualToken}
          />
          <p class="mcp-hint">
            Saving with a value here writes it to the OS keychain and inserts
            an <code>Authorization: Bearer ${'${secret:manual-token}'}</code>
            header if you didn't already define one. The DB only stores the
            placeholder, not the token.
          </p>
        </div>
      {/if}

      <label class="mcp-checkbox">
        <input type="checkbox" bind:checked={form.enabled} />
        Enabled
      </label>

      {#if formError}<div class="mcp-alert err inline">{formError}</div>{/if}

      <div class="mcp-form-actions">
        <button class="mcp-btn primary" onclick={saveForm}>
          {editingId ? 'Save changes' : 'Add server'}
        </button>
        <button class="mcp-btn" onclick={closeForm}>Cancel</button>
      </div>
    </section>
  {/if}

  <!-- Server list -->
  {#if sortedServers.length === 0}
    <section class="mcp-empty">
      <p>No MCP servers yet.</p>
      <div class="mcp-catalog">
        <h3>Quick add</h3>
        <p class="mcp-sub">Pre-filled forms for popular servers — edit before saving.</p>
        <div class="mcp-catalog-grid">
          {#each QUICK_ADD_CATALOG as entry (entry.id)}
            <button class="mcp-catalog-card" onclick={() => openAdd(entry.input)}>
              <strong>{entry.label}</strong>
              <span>{entry.description}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>
  {:else}
    <ul class="mcp-list">
      {#each sortedServers as server (server.config.id)}
        {@const id = server.config.id}
        {@const busyAction = busyMap[id]}
        {@const failed = isFailed(server.status)}
        {@const isOpen = expanded.has(id)}
        <li class="mcp-row" class:disabled={!server.config.enabled}>
          <div class="mcp-row-summary">
            <span class="mcp-status mcp-status-{statusKind(server)}" title={statusLabel(server.status)}></span>
            <button class="mcp-row-name" onclick={() => toggleExpanded(id)}>
              <span class="mcp-row-arrow" class:open={isOpen}>▸</span>
              <strong>{server.config.name}</strong>
              <span class="mcp-row-meta">
                {server.config.transport.kind === 'stdio' ? 'stdio' : 'remote'}
                · {server.tools.length} tools · {statusLabel(server.status)}
              </span>
            </button>
            <div class="mcp-row-actions">
              <label class="mcp-toggle" title="Enable / disable">
                <input
                  type="checkbox"
                  checked={server.config.enabled}
                  disabled={!!busyAction}
                  onchange={() => handleEnabledToggle(server)}
                />
                <span></span>
              </label>
              {#if isConnected(server.status)}
                <button
                  class="mcp-btn small"
                  disabled={!!busyAction}
                  onclick={() => handleDisconnect(server)}
                >
                  {busyAction === 'Disconnect' ? '…' : 'Disconnect'}
                </button>
              {:else}
                <button
                  class="mcp-btn small primary"
                  disabled={!server.config.enabled || !!busyAction}
                  onclick={() => handleConnect(server)}
                >
                  {busyAction === 'Connect' ? 'Connecting…' : 'Connect'}
                </button>
              {/if}
              {#if server.config.transport.kind === 'remote'}
                {#if server.config.oauth}
                  <button
                    class="mcp-btn small"
                    disabled={!!busyAction}
                    onclick={() => handleSignOut(server)}
                  >
                    Sign out
                  </button>
                {:else}
                  <button
                    class="mcp-btn small"
                    disabled={!!busyAction}
                    onclick={() => handleSignIn(server)}
                  >
                    {busyAction === 'Sign in' ? 'Authorizing…' : 'Sign in'}
                  </button>
                {/if}
              {/if}
              <button class="mcp-btn small" disabled={!!busyAction} onclick={() => openEdit(server)}>
                Edit
              </button>
              <button
                class="mcp-btn small danger"
                disabled={!!busyAction}
                onclick={() => handleDelete(server)}
              >
                Delete
              </button>
            </div>
          </div>

          {#if failed}
            <div class="mcp-alert err inline">{failed.error}</div>
          {/if}

          {#if isOpen}
            <div class="mcp-row-detail">
              {#if server.config.transport.kind === 'stdio'}
                <dl class="mcp-meta">
                  <dt>Command</dt>
                  <dd class="mono">
                    {server.config.transport.command} {server.config.transport.args.join(' ')}
                  </dd>
                  {#if server.config.transport.cwd}
                    <dt>cwd</dt>
                    <dd class="mono">{server.config.transport.cwd}</dd>
                  {/if}
                </dl>
              {:else}
                <dl class="mcp-meta">
                  <dt>URL</dt>
                  <dd class="mono">{server.config.transport.url}</dd>
                  {#if server.config.oauth}
                    <dt>OAuth scopes</dt>
                    <dd>
                      {server.config.oauth.scopes.length === 0
                        ? '(none granted)'
                        : server.config.oauth.scopes.join(', ')}
                    </dd>
                  {/if}
                </dl>
              {/if}

              <h4>Tools</h4>
              {#if server.tools.length === 0}
                <p class="mcp-sub">
                  {isConnected(server.status)
                    ? 'No tools advertised by this server.'
                    : 'Connect the server to discover its tools.'}
                </p>
              {:else}
                <ul class="mcp-tool-list">
                  {#each server.tools as tool (tool.name)}
                    <li>
                      <label class="mcp-tool">
                        <input
                          type="checkbox"
                          checked={tool.enabled}
                          onchange={(e) =>
                            handleToolToggle(server, tool.name, (e.currentTarget as HTMLInputElement).checked)}
                        />
                        <span class="mcp-tool-name mono">{tool.name}</span>
                        {#if tool.description}
                          <span class="mcp-tool-desc">{tool.description}</span>
                        {/if}
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <!-- Quick-add catalog at the bottom too, for users who already have at
         least one server but want to add another from the catalog. -->
    <details class="mcp-catalog-details">
      <summary>Quick-add catalog</summary>
      <div class="mcp-catalog-grid">
        {#each QUICK_ADD_CATALOG as entry (entry.id)}
          <button class="mcp-catalog-card" onclick={() => openAdd(entry.input)}>
            <strong>{entry.label}</strong>
            <span>{entry.description}</span>
          </button>
        {/each}
      </div>
    </details>
  {/if}
</div>

<style>
  .mcp-panel {
    padding: 20px 24px;
    color: var(--text-primary, #e6e6e6);
    overflow-y: auto;
    height: 100%;
  }
  .mcp-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
  }
  .mcp-header h2 {
    margin: 0 0 4px 0;
    font-size: 18px;
  }
  .mcp-sub {
    margin: 0;
    color: var(--text-secondary, #b0b0b0);
    font-size: 12px;
  }
  .mcp-header-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .mcp-btn {
    background: var(--bg-tertiary, #2a2a2a);
    color: var(--text-primary, #e6e6e6);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .mcp-btn:hover:not(.primary) { background: var(--bg-secondary, #333); }
  .mcp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mcp-btn.primary {
    background: #4d8df6;
    color: #fff;
    border-color: #4d8df6;
  }
  .mcp-btn.primary:hover { background: var(--accent-hover, #3a7be0); color: #fff; border-color: var(--accent-hover, #3a7be0); }
  .mcp-btn.small { padding: 3px 8px; font-size: 11px; }
  .mcp-btn.danger { color: #ff8080; border-color: #5a3030; }
  .mcp-btn.danger:hover { background: #3a1a1a; }

  .mcp-alert {
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
    margin: 12px 0;
  }
  .mcp-alert.err { background: #3a1a1a; color: #ff9090; border: 1px solid #5a3030; }
  .mcp-alert.warn { background: #3a2c10; color: #ffcb80; border: 1px solid #5a4520; }
  .mcp-alert.inline { margin: 6px 0 0 0; }

  .mcp-cap-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .mcp-cap-label { font-size: 12px; color: var(--text-secondary, #b0b0b0); display: flex; gap: 6px; align-items: center; }
  .mcp-cap-hint { font-size: 11px; color: var(--text-secondary, #b0b0b0); }
  .mcp-cap-msg { font-size: 11px; color: #4d8df6; }

  .mcp-input {
    background: var(--bg-secondary, #1f1f1f);
    color: var(--text-primary, #e6e6e6);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
  }
  .mcp-input.small { width: 80px; padding: 3px 6px; }
  .mcp-input.mono, .mcp-textarea.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }

  .mcp-textarea {
    background: var(--bg-secondary, #1f1f1f);
    color: var(--text-primary, #e6e6e6);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }

  .mcp-form, .mcp-import {
    background: var(--bg-secondary, #1f1f1f);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 8px;
    padding: 16px 18px;
    margin-bottom: 16px;
  }
  .mcp-form h3, .mcp-import h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
  }
  .mcp-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .mcp-field label { font-size: 11px; color: var(--text-secondary, #b0b0b0); }
  .mcp-hint { margin: 0; font-size: 11px; color: var(--text-secondary, #b0b0b0); }
  .mcp-checkbox { display: flex; gap: 8px; align-items: center; font-size: 12px; margin-bottom: 12px; }
  .mcp-form-actions { display: flex; gap: 8px; justify-content: flex-end; }

  .mcp-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .mcp-row {
    background: var(--bg-secondary, #1f1f1f);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 8px;
    padding: 10px 14px;
  }
  .mcp-row.disabled { opacity: 0.6; }
  .mcp-row-summary { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .mcp-row-name {
    flex: 1;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    min-width: 200px;
  }
  .mcp-row-arrow { display: inline-block; transition: transform 0.15s; font-size: 10px; }
  .mcp-row-arrow.open { transform: rotate(90deg); }
  .mcp-row-meta { color: var(--text-secondary, #b0b0b0); font-size: 11px; }
  .mcp-row-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

  .mcp-status { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .mcp-status-ok { background: #4ade80; box-shadow: 0 0 6px #4ade80aa; }
  .mcp-status-wait { background: #facc15; }
  .mcp-status-err { background: #ef4444; }
  .mcp-status-idle { background: #555; }

  .mcp-toggle { position: relative; display: inline-block; width: 28px; height: 14px; }
  .mcp-toggle input { opacity: 0; width: 0; height: 0; }
  .mcp-toggle span {
    position: absolute; cursor: pointer; inset: 0;
    background: #444; border-radius: 14px; transition: 0.2s;
  }
  .mcp-toggle span::before {
    content: ''; position: absolute; height: 10px; width: 10px;
    left: 2px; bottom: 2px; background: #ccc;
    border-radius: 50%; transition: 0.2s;
  }
  .mcp-toggle input:checked + span { background: #4d8df6; }
  .mcp-toggle input:checked + span::before { transform: translateX(14px); background: #fff; }

  .mcp-row-detail {
    margin-top: 10px;
    border-top: 1px solid var(--border-color, #3a3a3a);
    padding-top: 10px;
  }
  .mcp-meta {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 4px 12px;
    font-size: 12px;
    margin: 0 0 12px 0;
  }
  .mcp-meta dt { color: var(--text-secondary, #b0b0b0); }
  .mcp-meta dd { margin: 0; word-break: break-all; }

  .mcp-tool-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .mcp-tool {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .mcp-tool:hover { background: var(--bg-tertiary, #2a2a2a); }
  .mcp-tool-name { font-weight: 500; }
  .mcp-tool-desc { color: var(--text-secondary, #b0b0b0); font-size: 11px; }

  .mcp-empty { padding: 30px 20px; text-align: center; color: var(--text-secondary, #b0b0b0); }
  .mcp-catalog { margin-top: 24px; text-align: left; }
  .mcp-catalog h3 { margin: 0 0 6px 0; font-size: 14px; color: var(--text-primary, #e6e6e6); }
  .mcp-catalog-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
    margin-top: 10px;
  }
  .mcp-catalog-card {
    background: var(--bg-secondary, #1f1f1f);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 8px;
    padding: 12px 14px;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary, #e6e6e6);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mcp-catalog-card:hover { border-color: #4d8df6; }
  .mcp-catalog-card span { color: var(--text-secondary, #b0b0b0); font-size: 11px; }

  .mcp-catalog-details { margin-top: 16px; }
  .mcp-catalog-details summary {
    cursor: pointer;
    color: var(--text-secondary, #b0b0b0);
    font-size: 12px;
    padding: 6px 0;
  }

  code { font-family: ui-monospace, Menlo, Consolas, monospace; background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 3px; }
</style>
