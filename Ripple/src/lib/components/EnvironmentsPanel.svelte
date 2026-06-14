<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { fileOps } from '$lib/api/tauri';
  import {
    environments,
    envVariables,
    activeEnvironmentId,
    setActiveEnvironment,
    type Environment,
    type EnvironmentVariable,
  } from '$lib/stores/environmentStore';
  import { exportPostmanEnvironment, importPostmanEnvironment } from '$lib/utils/environmentImporter';
  import { addLog } from '$lib/stores/consoleStore';
  import * as modalManager from '$lib/utils/modalManager.svelte';
  import { registerEditEscapeCancel } from '$lib/utils/editEscape';

  let selectedId = $state<number | null>(null);
  let envList = $state<Environment[]>([]);
  let vars = $state<EnvironmentVariable[]>([]);
  let renamingSidebarId = $state<number | null>(null);
  let sidebarNameDraft = $state('');
  let addingVar = $state(false);
  let newVarKey = $state('');
  let newVarInitial = $state('');
  let newVarCurrent = $state('');
  let newVarSecret = $state(false);
  let editingVarKey = $state<string | null>(null);
  let editVarInitial = $state('');
  let editVarCurrent = $state('');
  let editVarSecret = $state(false);
  let revealedSecrets = $state<Set<string>>(new Set());
  let rev = $state(0);
  let activeId = $state<number | null>(null);

  const selectedEnv = $derived(envList.find((e) => e.id === selectedId) ?? null);

  function focusInput(node: HTMLInputElement, selectAll = false) {
    tick().then(() => {
      node.focus();
      if (selectAll) node.select();
    });
    return {};
  }

  function focusRenameInput(node: HTMLInputElement) {
    return focusInput(node, true);
  }

  function focusNewVarKeyInput(node: HTMLInputElement) {
    return focusInput(node, false);
  }

  onMount(() => {
    void (async () => {
      await refreshList();
      const active = get(activeEnvironmentId);
      if (active && envList.some((e) => e.id === active)) {
        selectedId = active;
      } else if (envList.length > 0) {
        selectedId = envList[0].id;
      }
      await loadVars();
    })();

    const unsubEnv = environments.subscribe(() => {
      rev++;
      envList = environments.getAll();
    });
    const unsubVars = envVariables.subscribe(() => {
      rev++;
      if (selectedId) vars = envVariables.getForEnvironment(selectedId);
    });
    const unsubActive = activeEnvironmentId.subscribe((id) => {
      activeId = id;
      if (id && !selectedId) {
        selectedId = id;
        void loadVars();
      }
    });

    return () => {
      unsubEnv();
      unsubVars();
      unsubActive();
    };
  });

  async function refreshList() {
    await environments.loadAll();
    envList = environments.getAll();
    rev++;
  }

  async function loadVars() {
    if (!selectedId) {
      vars = [];
      return;
    }
    await envVariables.load(selectedId);
    vars = envVariables.getForEnvironment(selectedId);
    rev++;
  }

  async function selectEnvironment(id: number) {
    selectedId = id;
    renamingSidebarId = null;
    addingVar = false;
    editingVarKey = null;
    revealedSecrets.clear();
    revealedSecrets = new Set();
    await loadVars();
  }

  async function createEnvironment() {
    const name = await modalManager.prompt('New Environment', 'Environment name:', 'My Environment');
    if (!name?.trim()) return;
    const id = await environments.create(name.trim());
    if (id) {
      await refreshList();
      selectedId = id;
      await loadVars();
      addLog(`✓ Created environment "${name.trim()}"`, 'system');
    }
  }

  function startRename() {
    if (!selectedEnv || !selectedId) return;
    sidebarNameDraft = selectedEnv.name;
    renamingSidebarId = selectedId;
  }

  function startSidebarRename(env: Environment, e: MouseEvent) {
    e.stopPropagation();
    selectedId = env.id;
    void loadVars();
    sidebarNameDraft = env.name;
    renamingSidebarId = env.id;
  }

  function cancelRename() {
    renamingSidebarId = null;
  }

  function cancelInlineEdits() {
    addingVar = false;
    editingVarKey = null;
    cancelRename();
  }

  const isInlineEditing = $derived(
    addingVar || editingVarKey !== null || renamingSidebarId !== null
  );

  $effect(() => {
    if (!isInlineEditing) return;
    return registerEditEscapeCancel(cancelInlineEdits);
  });

  async function saveSidebarRename(envId: number) {
    if (!sidebarNameDraft.trim()) {
      cancelRename();
      return;
    }
    const ok = await environments.update(envId, sidebarNameDraft.trim());
    if (ok) {
      await refreshList();
      addLog(`✓ Renamed environment to "${sidebarNameDraft.trim()}"`, 'system');
    }
    cancelRename();
  }

  async function deleteEnvironment() {
    if (!selectedId || !selectedEnv) return;
    const confirmed = await modalManager.confirm(
      'Delete Environment',
      `Delete "${selectedEnv.name}" and all its variables?`,
      'This action cannot be undone.'
    );
    if (!confirmed) return;
    await environments.delete(selectedId);
    await refreshList();
    selectedId = envList[0]?.id ?? null;
    await loadVars();
    addLog(`✗ Deleted environment "${selectedEnv.name}"`, 'system');
  }

  async function duplicateEnvironment() {
    if (!selectedId) return;
    const newId = await environments.duplicate(selectedId);
    if (newId) {
      await refreshList();
      selectedId = newId;
      await loadVars();
      addLog('✓ Duplicated environment', 'system');
    }
  }

  async function setAsActive() {
    if (!selectedId) return;
    await setActiveEnvironment(selectedId);
    addLog(`✓ Active environment: ${selectedEnv?.name}`, 'system');
  }

  async function clearActive() {
    await setActiveEnvironment(null);
    addLog('✓ Cleared active environment', 'system');
  }

  async function saveNewVar() {
    if (!selectedId || !newVarKey.trim()) return;
    const key = newVarKey.trim();
    const initial = newVarInitial;
    const current = newVarCurrent || initial;
    await envVariables.set(selectedId, key, current, initial, newVarSecret);
    await loadVars();
    addingVar = false;
    newVarKey = '';
    newVarInitial = '';
    newVarCurrent = '';
    newVarSecret = false;
    addLog(`✓ Added env variable {{${key}}}`, 'system');
  }

  function startEditVar(v: EnvironmentVariable) {
    editingVarKey = v.key;
    editVarInitial = v.initial_value;
    editVarCurrent = v.value;
    editVarSecret = v.is_secret;
  }

  async function saveEditVar() {
    if (!selectedId || !editingVarKey) return;
    const key = editingVarKey;
    await envVariables.set(selectedId, key, editVarCurrent, editVarInitial, editVarSecret);
    await loadVars();
    editingVarKey = null;
    addLog(`✓ Updated env variable {{${key}}}`, 'system');
  }

  async function deleteVar(key: string) {
    if (!selectedId) return;
    const confirmed = await modalManager.confirm('Delete Variable', `Delete "{{${key}}}" from this environment?`);
    if (!confirmed) return;
    await envVariables.delete(selectedId, key);
    await loadVars();
    addLog(`✗ Deleted env variable {{${key}}}`, 'system');
  }

  async function resetAllValues() {
    if (!selectedId || !selectedEnv) return;
    const confirmed = await modalManager.confirm(
      'Reset Values',
      `Reset all current values in "${selectedEnv.name}" to their initial values?`
    );
    if (!confirmed) return;
    await envVariables.resetToInitial(selectedId);
    await loadVars();
    addLog(`✓ Reset environment values for "${selectedEnv.name}"`, 'system');
  }

  async function importEnvironment() {
    const result = await fileOps.showOpenDialog({
      title: 'Import Postman Environment',
      filters: ['.json'],
    });
    const filePath = Array.isArray(result) ? result[0] : result;
    if (!filePath) return;

    const fileResult = await fileOps.readFile(filePath) as any;
    const raw = typeof fileResult === 'string' ? fileResult : fileResult?.data;
    if (!raw) return;

    const parsed = importPostmanEnvironment(raw);
    if (parsed.errors.length && parsed.variables.length === 0) {
      await modalManager.showInfo('Import Failed', parsed.errors.join('\n'));
      return;
    }

    const id = await environments.create(parsed.name);
    if (!id) return;

    for (const v of parsed.variables) {
      await envVariables.set(id, v.key, v.value, v.initial_value, false);
    }

    await refreshList();
    selectedId = id;
    await setActiveEnvironment(id);
    await loadVars();

    const warnings = parsed.errors.length ? `\n\nWarnings:\n${parsed.errors.join('\n')}` : '';
    await modalManager.showInfo(
      'Environment Imported',
      `Imported "${parsed.name}" with ${parsed.variables.length} variable(s).${warnings}`
    );
    addLog(`✓ Imported environment "${parsed.name}"`, 'system');
  }

  async function exportEnvironment() {
    if (!selectedId || !selectedEnv) return;
    const json = exportPostmanEnvironment(selectedEnv.name, vars);
    const savePath = await fileOps.showSaveDialog({
      title: 'Export Environment',
      defaultPath: `${selectedEnv.name.replace(/[^a-z0-9-_]/gi, '_')}.postman_environment.json`,
      filters: ['.json'],
    });
    if (!savePath || typeof savePath !== 'string') return;
    await fileOps.writeFile(savePath, json);
    addLog(`✓ Exported environment "${selectedEnv.name}"`, 'system');
  }

  function toggleRevealSecret(key: string) {
    if (revealedSecrets.has(key)) {
      revealedSecrets.delete(key);
    } else {
      revealedSecrets.add(key);
    }
    revealedSecrets = new Set(revealedSecrets);
  }

  function formatSecretValue(value: string, isSecret: boolean, key: string, isEditing = false) {
    if (!isSecret || isEditing || revealedSecrets.has(key)) {
      return value || '—';
    }
    return value ? '••••••••' : '—';
  }
</script>

<div class="env-panel">
  <aside class="env-sidebar">
    <div class="sidebar-header">
      <h4>Environments</h4>
      <button class="icon-btn" onclick={createEnvironment} title="New environment">+</button>
    </div>
    <ul class="env-list" role="listbox">
      {#each envList as env (env.id)}
        <li>
          {#if renamingSidebarId === env.id}
            <div class="env-rename-row">
              <input
                class="sidebar-name-input"
                bind:value={sidebarNameDraft}
                use:focusRenameInput
                onkeydown={(e) => {
                  if (e.key === 'Enter') void saveSidebarRename(env.id);
                  if (e.key === 'Escape') cancelRename();
                }}
              />
              <button class="icon-btn" onclick={() => saveSidebarRename(env.id)} title="Save name">✓</button>
            </div>
          {:else}
            <div
              class="env-item-wrap"
              class:selected={env.id === selectedId}
              class:active-env={env.id === activeId}
            >
              <button
                class="env-item"
                class:selected={env.id === selectedId}
                class:active-env={env.id === activeId}
                onclick={() => selectEnvironment(env.id)}
                ondblclick={(e) => startSidebarRename(env, e)}
                role="option"
                aria-selected={env.id === selectedId}
                title="Double-click to rename"
              >
                <span class="env-name">{env.name}</span>
                {#if env.id === activeId}
                  <span class="active-badge" title="Active environment">●</span>
                {/if}
              </button>
              <button
                class="env-rename-btn"
                onclick={(e) => startSidebarRename(env, e)}
                title="Rename environment"
                aria-label="Rename {env.name}"
              >✎</button>
            </div>
          {/if}
        </li>
      {/each}
      {#if envList.length === 0}
        <li class="empty-hint">No environments yet</li>
      {/if}
    </ul>
  </aside>

  <main class="env-main">
    {#if selectedEnv}
      <div class="main-header">
        <div class="title-row">
          <h3>{selectedEnv.name}</h3>
        </div>
        <div class="header-actions">
          {#if selectedId === activeId}
            <button class="action-btn" onclick={clearActive}>Deactivate</button>
          {:else}
            <button class="action-btn primary" onclick={setAsActive}>Set as active</button>
          {/if}
          <button class="action-btn" onclick={startRename} title="Rename environment">Rename</button>
          <button class="action-btn" onclick={duplicateEnvironment} title="Duplicate">Duplicate</button>
          <button class="action-btn" onclick={importEnvironment} title="Import Postman JSON">Import</button>
          <button class="action-btn" onclick={exportEnvironment} title="Export Postman JSON">Export</button>
          <button class="action-btn" onclick={resetAllValues} disabled={vars.length === 0}>Reset values</button>
          <button class="action-btn danger" onclick={deleteEnvironment}>Delete</button>
        </div>
      </div>

      <div class="vars-toolbar">
        <span class="var-count">{vars.length} variable{vars.length !== 1 ? 's' : ''}</span>
        <button class="action-btn primary" onclick={() => { addingVar = true; editingVarKey = null; }}>
          Add variable
        </button>
      </div>

      <div class="vars-table-wrap">
        <table class="vars-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Initial value</th>
              <th>Current value</th>
              <th>Secret</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#if addingVar}
              <tr class="edit-row">
                <td><input bind:value={newVarKey} placeholder="variable_name" use:focusNewVarKeyInput /></td>
                <td><input bind:value={newVarInitial} placeholder="initial" /></td>
                <td><input bind:value={newVarCurrent} placeholder="current (defaults to initial)" /></td>
                <td class="secret-cell">
                  <label class="secret-toggle">
                    <input type="checkbox" bind:checked={newVarSecret} />
                    <span class="secret-icon" title={newVarSecret ? 'Secret variable' : 'Make secret'}>🔒</span>
                  </label>
                </td>
                <td class="row-actions">
                  <button class="action-btn primary" onclick={saveNewVar}>Save</button>
                  <button class="action-btn muted" onclick={() => (addingVar = false)}>Cancel</button>
                </td>
              </tr>
            {/if}
            {#each vars as v (v.key)}
              {#if editingVarKey === v.key}
                <tr class="edit-row">
                  <td><code>{v.key}</code></td>
                  <td><input bind:value={editVarInitial} use:focusNewVarKeyInput /></td>
                  <td><input bind:value={editVarCurrent} /></td>
                  <td class="secret-cell">
                    <label class="secret-toggle">
                      <input type="checkbox" bind:checked={editVarSecret} />
                      <span class="secret-icon" title={editVarSecret ? 'Secret variable' : 'Make secret'}>🔒</span>
                    </label>
                  </td>
                  <td class="row-actions">
                    <button class="action-btn primary" onclick={saveEditVar}>Save</button>
                    <button class="action-btn muted" onclick={() => (editingVarKey = null)}>Cancel</button>
                  </td>
                </tr>
              {:else}
                <tr>
                  <td><code>{v.key}</code></td>
                  <td class="value-cell" class:secret-value={v.is_secret && !revealedSecrets.has(v.key)}>
                    {#if v.is_secret && !revealedSecrets.has(v.key)}
                      <button 
                        class="masked-value" 
                        onclick={() => toggleRevealSecret(v.key)} 
                        onkeydown={(e) => e.key === 'Enter' && toggleRevealSecret(v.key)}
                        title="Click to reveal"
                        aria-label="Reveal secret value"
                      >
                        {formatSecretValue(v.initial_value, v.is_secret, v.key)}
                      </button>
                    {:else}
                      <span>
                        {formatSecretValue(v.initial_value, v.is_secret, v.key)}
                      </span>
                    {/if}
                  </td>
                  <td class="value-cell" class:secret-value={v.is_secret && !revealedSecrets.has(v.key)}>
                    {#if v.is_secret && !revealedSecrets.has(v.key)}
                      <button 
                        class="masked-value" 
                        onclick={() => toggleRevealSecret(v.key)} 
                        onkeydown={(e) => e.key === 'Enter' && toggleRevealSecret(v.key)}
                        title="Click to reveal"
                        aria-label="Reveal secret value"
                      >
                        {formatSecretValue(v.value, v.is_secret, v.key)}
                      </button>
                    {:else}
                      <span>
                        {formatSecretValue(v.value, v.is_secret, v.key)}
                      </span>
                    {/if}
                  </td>
                  <td class="secret-cell">
                    <span class="secret-indicator" class:active={v.is_secret} title={v.is_secret ? 'Secret variable' : 'Regular variable'}>
                      🔒
                    </span>
                  </td>
                  <td class="row-actions">
                    <button class="action-btn muted" onclick={() => startEditVar(v)}>Edit</button>
                    <button class="action-btn danger" onclick={() => deleteVar(v.key)}>Delete</button>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
        {#if vars.length === 0 && !addingVar}
          <p class="empty-vars">No variables in this environment. Add one or import a Postman environment file.</p>
        {/if}
      </div>

      <p class="scope-hint">
        Environment variables override collection variables with the same name. Use <code>{'{{key}}'}</code> in URLs, headers, and bodies.
      </p>
    {:else}
      <div class="empty-main">
        <p>Select or create an environment to manage variables.</p>
        <button class="action-btn primary" onclick={createEnvironment}>Create environment</button>
      </div>
    {/if}
  </main>
</div>

<style>
  .env-panel {
    display: flex;
    height: 100%;
    min-height: 420px;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .env-sidebar {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-color);
  }

  .sidebar-header h4 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
  }

  .icon-btn:hover {
    background: var(--bg-tertiary);
  }

  .env-list {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    flex: 1;
  }

  .env-item-wrap {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 6px;
  }

  .env-item-wrap.selected {
    background: var(--bg-secondary);
  }

  .env-item-wrap:hover {
    background: var(--bg-tertiary);
  }

  .env-item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    font-size: 0.82rem;
  }

  .env-item:hover {
    background: transparent;
    color: var(--text-primary);
  }

  .env-item.selected {
    background: transparent;
    color: var(--text-primary);
    font-weight: 500;
  }

  .env-item.active-env .env-name {
    padding-left: 2px;
  }

  .env-rename-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
  }

  .sidebar-name-input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--accent-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 0.82rem;
  }

  .env-rename-btn {
    opacity: 0;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--text-muted, #6d6f78);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .env-item-wrap:hover .env-rename-btn,
  .env-item-wrap.selected .env-rename-btn {
    opacity: 1;
  }

  .env-rename-btn:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .active-badge {
    color: var(--success-color, #22c55e);
    font-size: 0.6rem;
    flex-shrink: 0;
  }

  .empty-hint {
    padding: 12px;
    font-size: 0.78rem;
    color: var(--text-muted, #6d6f78);
  }

  .env-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 18px;
    overflow: hidden;
  }

  .main-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title-row h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }


  .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .action-btn {
    padding: 5px 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .action-btn:hover:not(:disabled):not(.primary) {
    background: var(--bg-tertiary);
  }

  .action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .action-btn.primary {
    background: var(--accent-color, #5865f2);
    border-color: var(--accent-color, #5865f2);
    color: #fff;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: #fff;
  }

  .action-btn.danger {
    color: var(--error-color, #ef4444);
    border-color: rgba(239, 68, 68, 0.35);
  }

  .action-btn.muted {
    color: var(--text-secondary);
  }

  .vars-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .var-count {
    font-size: 0.78rem;
    color: var(--text-secondary);
  }

  .vars-table-wrap {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 8px;
  }

  .vars-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }

  .vars-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    font-weight: 600;
    color: var(--text-secondary);
    position: sticky;
    top: 0;
  }

  .vars-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
  }

  .vars-table tr:last-child td {
    border-bottom: none;
  }

  .value-cell {
    font-family: 'SF Mono', 'Consolas', monospace;
    font-size: 0.78rem;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .edit-row input {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 0.78rem;
    box-sizing: border-box;
  }

  .row-actions {
    white-space: nowrap;
    text-align: right;
  }

  .row-actions .action-btn {
    margin-left: 4px;
  }

  .empty-vars {
    padding: 24px;
    text-align: center;
    color: var(--text-muted, #6d6f78);
    font-size: 0.82rem;
  }

  .scope-hint {
    margin: 12px 0 0;
    font-size: 0.72rem;
    color: var(--text-muted, #6d6f78);
  }

  .scope-hint code {
    font-family: 'SF Mono', 'Consolas', monospace;
  }

  .empty-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-secondary);
  }

  .secret-cell {
    width: 60px;
    text-align: center;
  }

  .secret-toggle {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    position: relative;
  }

  .secret-toggle input {
    opacity: 0;
    position: absolute;
    width: 0;
    height: 0;
  }

  .secret-icon {
    font-size: 14px;
    opacity: 0.4;
    transition: opacity 0.15s;
    user-select: none;
  }

  .secret-toggle:hover .secret-icon {
    opacity: 0.7;
  }

  .secret-toggle input:checked + .secret-icon {
    opacity: 1;
  }

  .secret-indicator {
    font-size: 12px;
    opacity: 0.25;
    transition: opacity 0.15s;
  }

  .secret-indicator.active {
    opacity: 1;
  }

  .masked-value {
    cursor: pointer;
    font-family: monospace;
    letter-spacing: 1px;
    opacity: 0.6;
    user-select: none;
    background: transparent;
    border: none;
    padding: 0;
    font-size: inherit;
    color: inherit;
    text-align: left;
  }

  .masked-value:hover {
    opacity: 0.8;
  }

  .masked-value:focus {
    opacity: 0.8;
    outline: 1px dotted var(--accent-color);
    outline-offset: 2px;
  }

  .secret-value {
    position: relative;
  }

  .secret-value .masked-value::after {
    content: ' 👁';
    opacity: 0;
    font-size: 10px;
    margin-left: 4px;
    transition: opacity 0.15s;
  }

  .secret-value:hover .masked-value::after {
    opacity: 0.5;
  }
</style>
