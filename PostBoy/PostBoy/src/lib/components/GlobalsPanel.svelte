<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { globalVariables } from '$lib/stores/globalVariableStore';
  import { addLog } from '$lib/stores/consoleStore';
  import * as modalManager from '$lib/utils/modalManager.svelte';
  import type { Variable } from '$lib/stores/variableStore';

  let vars = $state<Variable[]>([]);
  let addingVar = $state(false);
  let newVarKey = $state('');
  let newVarValue = $state('');
  let editingKey = $state<string | null>(null);
  let editValue = $state('');

  function focusInput(node: HTMLInputElement, selectAll = false) {
    tick().then(() => {
      node.focus();
      if (selectAll) node.select();
    });
    return {};
  }

  function focusNewKey(node: HTMLInputElement) {
    return focusInput(node, false);
  }

  onMount(() => {
    void loadVars();
    const unsub = globalVariables.subscribe(() => {
      vars = globalVariables.getAll();
    });
    return unsub;
  });

  async function loadVars() {
    await globalVariables.load();
    vars = globalVariables.getAll();
  }

  function startAdd() {
    editingKey = null;
    addingVar = true;
    newVarKey = '';
    newVarValue = '';
  }

  async function saveNewVar() {
    const key = newVarKey.trim();
    if (!key) return;
    await globalVariables.set(key, newVarValue);
    addingVar = false;
    newVarKey = '';
    newVarValue = '';
    vars = globalVariables.getAll();
    addLog(`✓ Added global variable {{${key}}}`, 'system');
  }

  function startEdit(v: Variable) {
    addingVar = false;
    editingKey = v.key;
    editValue = v.value;
  }

  async function saveEdit() {
    if (!editingKey) return;
    await globalVariables.set(editingKey, editValue);
    editingKey = null;
    vars = globalVariables.getAll();
    addLog(`✓ Updated global variable {{${editingKey}}}`, 'system');
  }

  async function deleteVar(key: string) {
    const confirmed = await modalManager.confirm(
      'Delete global variable',
      `Delete {{${key}}}?`,
      'This cannot be undone.'
    );
    if (!confirmed) return;
    await globalVariables.delete(key);
    vars = globalVariables.getAll();
    addLog(`✗ Deleted global variable {{${key}}}`, 'system');
  }

  async function clearAll() {
    if (vars.length === 0) return;
    const confirmed = await modalManager.confirm(
      'Clear all globals',
      'Delete every global variable?',
      'This cannot be undone.'
    );
    if (!confirmed) return;
    for (const v of [...vars]) {
      await globalVariables.delete(v.key);
    }
    vars = globalVariables.getAll();
    addLog('✗ Cleared all global variables', 'system');
  }
</script>

<div class="globals-panel">
  <header class="panel-header">
    <div>
      <h3>Global Variables</h3>
      <p class="subtitle">
        App-wide names for URLs and other values. Use <code>{'{{name}}'}</code> in any request — e.g.
        <code>{'{{npeApi}}'}</code> for a base URL you reuse everywhere.
      </p>
    </div>
    <div class="header-actions">
      <button class="action-btn primary" onclick={startAdd}>Add variable</button>
      <button class="action-btn" onclick={clearAll} disabled={vars.length === 0}>Clear all</button>
    </div>
  </header>

  <div class="vars-table-wrap">
    <table class="vars-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#if addingVar}
          <tr class="edit-row">
            <td>
              <input
                bind:value={newVarKey}
                placeholder="npeApi"
                use:focusNewKey
                onkeydown={(e) => e.key === 'Enter' && saveNewVar()}
              />
            </td>
            <td>
              <input
                bind:value={newVarValue}
                placeholder="https://api-euw1.rms-npe.com"
                onkeydown={(e) => e.key === 'Enter' && saveNewVar()}
              />
            </td>
            <td class="row-actions">
              <button class="action-btn primary" onclick={saveNewVar}>Save</button>
              <button class="action-btn muted" onclick={() => (addingVar = false)}>Cancel</button>
            </td>
          </tr>
        {/if}
        {#each vars as v (v.key)}
          {#if editingKey === v.key}
            <tr class="edit-row">
              <td><code>{'{{' + v.key + '}}'}</code></td>
              <td>
                <input
                  bind:value={editValue}
                  use:focusNewKey
                  onkeydown={(e) => {
                    if (e.key === 'Enter') void saveEdit();
                    if (e.key === 'Escape') editingKey = null;
                  }}
                />
              </td>
              <td class="row-actions">
                <button class="action-btn primary" onclick={saveEdit}>Save</button>
                <button class="action-btn muted" onclick={() => (editingKey = null)}>Cancel</button>
              </td>
            </tr>
          {:else}
            <tr>
              <td><code>{'{{' + v.key + '}}'}</code></td>
              <td class="value-cell">{v.value || '—'}</td>
              <td class="row-actions">
                <button class="action-btn muted" onclick={() => startEdit(v)}>Edit</button>
                <button class="action-btn danger" onclick={() => deleteVar(v.key)}>Delete</button>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
    {#if vars.length === 0 && !addingVar}
      <p class="empty-vars">
        No global variables yet. Add one to store a memorable name for a URL or other value you use across collections.
      </p>
    {/if}
  </div>

  <p class="scope-hint">
    Priority when names collide: <strong>environment</strong> → <strong>collection</strong> → <strong>global</strong>.
  </p>
</div>

<style>
  .globals-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 420px;
    padding: 16px 18px;
    gap: 12px;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  h3 {
    margin: 0 0 6px;
    font-size: 1.05rem;
  }

  .subtitle {
    margin: 0;
    max-width: 560px;
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .subtitle code {
    font-size: 0.78rem;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .action-btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .action-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
  }

  .action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .action-btn.primary {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
  }

  .action-btn.muted {
    background: transparent;
    color: var(--text-secondary);
  }

  .action-btn.danger {
    color: var(--error-color, #ef4444);
    border-color: transparent;
    background: transparent;
  }

  .vars-table-wrap {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
  }

  .vars-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  .vars-table th {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-weight: 500;
    position: sticky;
    top: 0;
    background: var(--bg-secondary);
  }

  .vars-table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
  }

  .vars-table tr:last-child td {
    border-bottom: none;
  }

  .edit-row input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--accent-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 0.82rem;
    box-sizing: border-box;
  }

  .value-cell {
    word-break: break-all;
    color: var(--text-secondary);
  }

  .row-actions {
    white-space: nowrap;
    text-align: right;
  }

  .empty-vars {
    padding: 24px 16px;
    margin: 0;
    text-align: center;
    color: var(--text-muted, #6d6f78);
    font-size: 0.82rem;
  }

  .scope-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted, #6d6f78);
  }
</style>
