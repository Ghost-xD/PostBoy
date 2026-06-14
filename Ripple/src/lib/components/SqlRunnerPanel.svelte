<script lang="ts">
  import { stopPropagation } from 'svelte/legacy';

  import { onMount } from 'svelte';
  import { sql, db, type SqlHistoryEntry } from '$lib/api/tauri';

  type DbType = 'postgres' | 'mysql' | 'sqlite';
  type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

  interface ConnectionConfig {
    type: DbType;
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    name: string;
  }

  interface SavedProfile {
    id: string;
    config: ConnectionConfig;
    lastUsed: number;
  }

  // Stable identifier for "this database connection" used to bucket the
  // persisted query history. Deliberately excludes `password` (so rotating
  // a password keeps your history) and `name` (purely cosmetic). For sqlite
  // we key by absolute db file path.
  function profileKey(c: ConnectionConfig): string {
    if (c.type === 'sqlite') return `sqlite|${c.database}`;
    return `${c.type}|${c.host}|${c.port}|${c.database}|${c.username}`;
  }

  interface SqlColumn {
    name: string;
    type: string;
  }

  interface SqlQueryResult {
    columns: SqlColumn[];
    rows: Record<string, any>[];
    rowCount: number;
    executionTimeMs: number;
    isSelect: boolean;
    affectedRows?: number;
  }

  const DEFAULT_PORTS: Record<DbType, number> = { postgres: 5432, mysql: 3306, sqlite: 0 };

  let config: ConnectionConfig = $state({
    type: 'postgres', host: 'localhost', port: 5432,
    database: '', username: '', password: '', name: ''
  });
  let status: ConnectionStatus = $state('disconnected');
  let connectionId = '';
  let connectionError = $state('');
  let queryText = $state('');
  let result: SqlQueryResult | null = $state(null);
  let queryError = $state('');
  let executing = $state(false);
  let profiles: SavedProfile[] = $state([]);
  let queryHistory: SqlHistoryEntry[] = $state([]);
  let activeProfileKey = $state('');
  let showHistory = $state(false);
  let copied = $state('');
  let activeView: 'connection' | 'query' = $state('connection');

  function onTypeChange() {
    config.port = DEFAULT_PORTS[config.type];
    if (config.type === 'sqlite') {
      config.host = '';
      config.username = '';
      config.password = '';
    }
  }

  async function connect() {
    const errors = validateConfig();
    if (errors.length > 0) {
      connectionError = errors.join('. ');
      return;
    }

    status = 'connecting';
    connectionError = '';

    try {
      connectionId = await sql.connect(
        config.type, config.host, config.port,
        config.database, config.username, config.password
      );
      status = 'connected';
      activeView = 'query';
      activeProfileKey = profileKey(config);
      saveCurrentProfile();
      await loadHistory();
    } catch (e: any) {
      status = 'error';
      connectionError = typeof e === 'string' ? e : e?.message || 'Connection failed';
    }
  }

  async function loadHistory() {
    if (!activeProfileKey) {
      queryHistory = [];
      return;
    }
    try {
      queryHistory = await sql.historyList(activeProfileKey);
    } catch {
      queryHistory = [];
    }
  }

  async function clearHistory() {
    if (!activeProfileKey) return;
    if (!confirm('Clear the saved query history for this connection?')) return;
    try {
      await sql.historyClear(activeProfileKey);
      queryHistory = [];
    } catch {}
  }

  async function deleteHistoryEntry(id: number) {
    try {
      await sql.historyDelete(id);
      queryHistory = queryHistory.filter(h => h.id !== id);
    } catch {}
  }

  async function disconnect() {
    if (connectionId) {
      try { await sql.disconnect(connectionId); } catch {}
    }
    connectionId = '';
    status = 'disconnected';
    result = null;
    queryError = '';
    activeView = 'connection';
    activeProfileKey = '';
    queryHistory = [];
  }

  async function executeQuery() {
    if (!queryText.trim() || !connectionId) return;

    const danger = isDangerousQuery(queryText);
    if (danger.dangerous) {
      if (!confirm(`⚠ ${danger.reason}\n\nAre you sure you want to execute this query?`)) return;
    }

    executing = true;
    queryError = '';
    result = null;
    const sqlText = queryText.trim();

    try {
      result = await sql.query(connectionId, sqlText) as SqlQueryResult;
      await recordHistory(sqlText, result.executionTimeMs, result.rowCount, null);
    } catch (e: any) {
      queryError = typeof e === 'string' ? e : e?.message || 'Query failed';
      await recordHistory(sqlText, 0, 0, queryError);
    } finally {
      executing = false;
    }
  }

  async function recordHistory(
    sqlText: string,
    executionTimeMs: number,
    rowCount: number,
    error: string | null,
  ) {
    if (!activeProfileKey) return;
    try {
      const id = await sql.historyAdd(
        activeProfileKey, config.type, sqlText, executionTimeMs, rowCount, error,
      );
      // Optimistic prepend rather than full reload so the dropdown updates
      // instantly; the backend already enforced the 200-entry cap.
      queryHistory = [
        {
          id,
          sql: sqlText,
          executionTimeMs,
          rowCount,
          error,
          executedAt: Date.now(),
        },
        ...queryHistory,
      ];
    } catch {
      // History persistence failure must not break the query workflow.
    }
  }

  function validateConfig(): string[] {
    const errors: string[] = [];
    if (config.type === 'sqlite') {
      if (!config.database.trim()) errors.push('Database file path is required');
      return errors;
    }
    if (!config.host.trim()) errors.push('Host is required');
    if (!config.database.trim()) errors.push('Database name is required');
    if (config.port < 1 || config.port > 65535) errors.push('Port must be between 1 and 65535');
    if (!config.username.trim()) errors.push('Username is required');
    return errors;
  }

  function isDangerousQuery(s: string): { dangerous: boolean; reason?: string } {
    const upper = s.trim().toUpperCase();
    if (/DROP\s+(TABLE|DATABASE|SCHEMA)/i.test(s)) return { dangerous: true, reason: 'DROP operation will permanently delete data' };
    if (/TRUNCATE/i.test(s)) return { dangerous: true, reason: 'TRUNCATE will remove all rows from the table' };
    if (upper.startsWith('DELETE') && !/WHERE/i.test(s)) return { dangerous: true, reason: 'DELETE without WHERE clause will remove all rows' };
    if (upper.startsWith('UPDATE') && !/WHERE/i.test(s)) return { dangerous: true, reason: 'UPDATE without WHERE clause will modify all rows' };
    return { dangerous: false };
  }

  function formatValue(val: unknown): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  function copyCell(val: unknown) {
    const text = formatValue(val);
    navigator.clipboard.writeText(text);
    copied = text;
    setTimeout(() => copied = '', 1200);
  }

  function exportCsv() {
    if (!result || result.columns.length === 0) return;
    const header = result.columns.map(c => c.name).join(',');
    const body = result.rows.map(row =>
      result!.columns.map(c => {
        const val = formatValue(row[c.name]);
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(',')
    ).join('\n');
    const csv = `${header}\n${body}`;
    navigator.clipboard.writeText(csv);
    copied = 'csv';
    setTimeout(() => copied = '', 1500);
  }

  function exportJson() {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result.rows, null, 2));
    copied = 'json';
    setTimeout(() => copied = '', 1500);
  }

  function loadProfile(profile: SavedProfile) {
    config = { ...profile.config };
    activeView = 'connection';
  }

  function deleteProfile(id: string) {
    profiles = profiles.filter(p => p.id !== id);
    saveProfiles();
  }

  function loadHistoryQuery(entry: SqlHistoryEntry) {
    queryText = entry.sql;
    showHistory = false;
  }

  function formatHistoryTime(ms: number): string {
    const d = new Date(ms);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function saveCurrentProfile() {
    const existing = profiles.find(p =>
      p.config.type === config.type &&
      p.config.host === config.host &&
      p.config.port === config.port &&
      p.config.database === config.database
    );

    if (existing) {
      existing.lastUsed = Date.now();
      existing.config = { ...config };
    } else {
      profiles = [{
        id: `sql-${Date.now()}`,
        config: { ...config, name: config.name || `${config.type}://${config.host || config.database}` },
        lastUsed: Date.now()
      }, ...profiles];
    }
    saveProfiles();
  }

  async function saveProfiles() {
    try {
      await db.setSetting('sql_profiles', JSON.stringify(profiles));
    } catch {}
  }

  async function loadProfiles() {
    try {
      const raw = await db.getSetting('sql_profiles', '[]') as string;
      profiles = JSON.parse(raw);
    } catch {}
  }

  function handleQueryKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      executeQuery();
    }
  }

  onMount(() => {
    loadProfiles();
  });
</script>

<div class="sql-panel">
  <div class="sql-toolbar">
    <div class="sql-tabs">
      <button class="sql-tab" class:active={activeView === 'connection'} onclick={() => activeView = 'connection'}>
        Connection
      </button>
      <button class="sql-tab" class:active={activeView === 'query'} onclick={() => activeView = 'query'} disabled={status !== 'connected'}>
        Query
      </button>
    </div>
    <div class="connection-status" class:connected={status === 'connected'} class:error={status === 'error'} class:connecting={status === 'connecting'}>
      <span class="status-dot"></span>
      <span class="status-text">
        {#if status === 'connected'}Connected ({config.type})
        {:else if status === 'connecting'}Connecting...
        {:else if status === 'error'}Error
        {:else}Disconnected
        {/if}
      </span>
      {#if status === 'connected'}
        <button class="disconnect-btn" onclick={disconnect}>Disconnect</button>
      {/if}
    </div>
  </div>

  {#if activeView === 'connection'}
    <div class="connection-form">
      {#if profiles.length > 0}
        <div class="profiles-section">
          <span class="section-label">Saved Connections</span>
          <div class="profiles-list">
            {#each profiles as profile}
              <button class="profile-item" onclick={() => loadProfile(profile)}>
                <span class="profile-type" class:pg={profile.config.type === 'postgres'} class:my={profile.config.type === 'mysql'} class:sl={profile.config.type === 'sqlite'}>
                  {profile.config.type === 'postgres' ? 'PG' : profile.config.type === 'mysql' ? 'MY' : 'SL'}
                </span>
                <span class="profile-name">{profile.config.name || profile.config.database}</span>
                <span class="profile-delete" role="button" tabindex="0" onclick={stopPropagation(() => deleteProfile(profile.id))} onkeydown={stopPropagation((e: Event) => (e as KeyboardEvent).key === 'Enter' && deleteProfile(profile.id))} title="Remove">×</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="form-row">
        <span class="form-label">Database Type</span>
        <div class="db-type-selector">
          <button class="type-btn" class:active={config.type === 'postgres'} onclick={() => { config.type = 'postgres'; onTypeChange(); }}>
            <span class="type-badge pg">PG</span> PostgreSQL
          </button>
          <button class="type-btn" class:active={config.type === 'mysql'} onclick={() => { config.type = 'mysql'; onTypeChange(); }}>
            <span class="type-badge my">MY</span> MySQL
          </button>
          <button class="type-btn" class:active={config.type === 'sqlite'} onclick={() => { config.type = 'sqlite'; onTypeChange(); }}>
            <span class="type-badge sl">SL</span> SQLite
          </button>
        </div>
      </div>

      {#if config.type !== 'sqlite'}
        <div class="form-row-group">
          <div class="form-row flex-grow">
            <label class="form-label" for="sql-host">Host</label>
            <input id="sql-host" type="text" bind:value={config.host} placeholder="localhost" />
          </div>
          <div class="form-row port-field">
            <label class="form-label" for="sql-port">Port</label>
            <input id="sql-port" type="number" bind:value={config.port} />
          </div>
        </div>
      {/if}

      <div class="form-row">
        <label class="form-label" for="sql-database">{config.type === 'sqlite' ? 'Database File Path' : 'Database'}</label>
        <input id="sql-database" type="text" bind:value={config.database} placeholder={config.type === 'sqlite' ? '/path/to/database.db' : 'my_database'} />
      </div>

      {#if config.type !== 'sqlite'}
        <div class="form-row-group">
          <div class="form-row flex-grow">
            <label class="form-label" for="sql-user">Username</label>
            <input id="sql-user" type="text" bind:value={config.username} placeholder={config.type === 'postgres' ? 'postgres' : 'root'} />
          </div>
          <div class="form-row flex-grow">
            <label class="form-label" for="sql-pass">Password</label>
            <input id="sql-pass" type="password" bind:value={config.password} placeholder="••••••" />
          </div>
        </div>
      {/if}

      <div class="form-row">
        <label class="form-label" for="sql-name">Connection Name <span class="optional">(optional)</span></label>
        <input id="sql-name" type="text" bind:value={config.name} placeholder="My Database" />
      </div>

    </div>
    <div class="connection-footer">
      {#if connectionError}
        <div class="form-error">{connectionError}</div>
      {/if}
      <button class="connect-btn" onclick={connect} disabled={status === 'connecting'}>
        {#if status === 'connecting'}
          <span class="spinner"></span> Connecting...
        {:else}
          Connect
        {/if}
      </button>
    </div>

  {:else}
    <div class="query-area">
      <div class="query-editor-section">
        <div class="query-header">
          <span class="section-label">SQL Query</span>
          <div class="query-actions">
            <button class="query-action-btn" onclick={() => showHistory = !showHistory} title="Query History">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5Z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/></svg>
            </button>
            <button class="run-btn" onclick={executeQuery} disabled={executing || !queryText.trim()}>
              {#if executing}
                <span class="spinner small"></span> Running...
              {:else}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>
                Run <span class="shortcut-hint">Ctrl+Enter</span>
              {/if}
            </button>
          </div>
        </div>

        {#if showHistory}
          <div class="history-dropdown">
            <div class="history-header">
              <span class="history-title">Query history · {queryHistory.length}</span>
              {#if queryHistory.length > 0}
                <button class="history-clear-btn" onclick={clearHistory} title="Clear all history for this connection">
                  Clear all
                </button>
              {/if}
            </div>
            {#if queryHistory.length === 0}
              <div class="history-empty">No queries yet for this connection.</div>
            {:else}
              {#each queryHistory as entry (entry.id)}
                <div class="history-item" class:has-error={!!entry.error}>
                  <button class="history-item-body" onclick={() => loadHistoryQuery(entry)}>
                    <span class="history-sql">{entry.sql.length > 80 ? entry.sql.slice(0, 80) + '...' : entry.sql}</span>
                    <span class="history-meta">
                      <span class="history-time">{formatHistoryTime(entry.executedAt)}</span>
                      <span class="history-meta-sep">·</span>
                      {#if entry.error}
                        <span class="history-error">Error</span>
                      {:else}
                        <span>{entry.rowCount} row{entry.rowCount === 1 ? '' : 's'} · {entry.executionTimeMs}ms</span>
                      {/if}
                    </span>
                  </button>
                  <button class="history-delete-btn" onclick={stopPropagation(() => deleteHistoryEntry(entry.id))} title="Remove from history">×</button>
                </div>
              {/each}
            {/if}
          </div>
        {/if}

        <textarea
          class="query-input"
          bind:value={queryText}
          placeholder="SELECT * FROM users LIMIT 10;"
          spellcheck="false"
          rows="6"
          onkeydown={handleQueryKeydown}
        ></textarea>
      </div>

      {#if queryError}
        <div class="query-error">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0Zm.75 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>
          <span>{queryError}</span>
        </div>
      {/if}

      {#if result}
        <div class="result-section">
          <div class="result-header">
            <div class="result-stats">
              {#if result.isSelect}
                <span class="stat">{result.rowCount} row{result.rowCount !== 1 ? 's' : ''}</span>
                <span class="stat-sep">·</span>
                <span class="stat">{result.columns.length} column{result.columns.length !== 1 ? 's' : ''}</span>
              {:else}
                <span class="stat">{result.affectedRows ?? 0} row{(result.affectedRows ?? 0) !== 1 ? 's' : ''} affected</span>
              {/if}
              <span class="stat-sep">·</span>
              <span class="stat">{result.executionTimeMs}ms</span>
            </div>
            {#if result.isSelect && result.rows.length > 0}
              <div class="result-actions">
                <button class="result-action" onclick={exportCsv} title="Copy as CSV">
                  {copied === 'csv' ? 'Copied!' : 'CSV'}
                </button>
                <button class="result-action" onclick={exportJson} title="Copy as JSON">
                  {copied === 'json' ? 'Copied!' : 'JSON'}
                </button>
              </div>
            {/if}
          </div>

          {#if result.isSelect && result.columns.length > 0}
            <div class="result-table-wrapper">
              <table class="result-table">
                <thead>
                  <tr>
                    <th class="row-num">#</th>
                    {#each result.columns as col}
                      <th>
                        <span class="col-name">{col.name}</span>
                        <span class="col-type">{col.type}</span>
                      </th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each result.rows as row, idx}
                    <tr>
                      <td class="row-num">{idx + 1}</td>
                      {#each result.columns as col}
                        <td
                          class:null-val={row[col.name] === null}
                          onclick={() => copyCell(row[col.name])}
                          title="Click to copy"
                        >
                          {formatValue(row[col.name])}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else if !result.isSelect}
            <div class="mutation-result">
              Query executed successfully. {result.affectedRows ?? 0} row{(result.affectedRows ?? 0) !== 1 ? 's' : ''} affected.
            </div>
          {:else}
            <div class="empty-result">No rows returned</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if copied && copied !== 'csv' && copied !== 'json'}
    <div class="copy-toast">Copied to clipboard</div>
  {/if}
</div>

<style>
  .sql-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .sql-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .sql-tabs {
    display: flex;
    gap: 2px;
    background: var(--bg-primary);
    border-radius: 6px;
    padding: 2px;
    border: 1px solid var(--border-color);
  }

  .sql-tab {
    padding: 5px 14px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .sql-tab.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .sql-tab:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #72767d;
  }

  .connection-status.connected .status-dot { background: #43b581; }
  .connection-status.error .status-dot { background: #f04747; }
  .connection-status.connecting .status-dot { background: #faa61a; animation: pulse 1s infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .status-text { font-weight: 500; }

  .disconnect-btn {
    padding: 2px 8px;
    background: transparent;
    border: 1px solid rgba(240, 71, 71, 0.3);
    border-radius: 3px;
    color: #f04747;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .disconnect-btn:hover {
    background: rgba(240, 71, 71, 0.1);
  }

  /* ── Connection Form ── */
  .connection-form {
    padding: 16px;
    padding-bottom: 8px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }

  .connection-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .profiles-section {
    margin-bottom: 4px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    display: block;
    margin-bottom: 6px;
  }

  .profiles-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .profile-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-primary);
    transition: all 0.15s;
  }

  .profile-item:hover {
    border-color: var(--accent-color);
    background: var(--bg-tertiary);
  }

  .profile-type {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 2px;
    letter-spacing: 0.04em;
  }

  .profile-type.pg { background: rgba(88, 101, 242, 0.15); color: #5865f2; }
  .profile-type.my { background: rgba(250, 166, 26, 0.15); color: #faa61a; }
  .profile-type.sl { background: rgba(67, 181, 129, 0.15); color: #43b581; }

  .profile-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-delete {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .profile-item:hover .profile-delete { opacity: 1; }
  .profile-delete:hover { color: #f04747; }

  .form-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 4px;
    display: block;
  }

  .optional {
    font-weight: 400;
    opacity: 0.5;
  }

  .form-row {
    display: flex;
    flex-direction: column;
  }

  .form-row-group {
    display: flex;
    gap: 10px;
  }

  .flex-grow { flex: 1; }
  .port-field { width: 90px; flex-shrink: 0; }

  .db-type-selector {
    display: flex;
    gap: 6px;
  }

  .type-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .type-btn.active {
    border-color: var(--accent-color);
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .type-btn:hover:not(.active) {
    background: var(--bg-tertiary);
  }

  .type-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.04em;
  }

  .type-badge.pg { background: rgba(88, 101, 242, 0.2); color: #7289da; }
  .type-badge.my { background: rgba(250, 166, 26, 0.2); color: #faa61a; }
  .type-badge.sl { background: rgba(67, 181, 129, 0.2); color: #43b581; }

  input[type="text"], input[type="password"], input[type="number"] {
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }

  input:focus { border-color: var(--accent-color); }

  .form-error {
    padding: 8px 10px;
    background: rgba(240, 71, 71, 0.08);
    border: 1px solid rgba(240, 71, 71, 0.2);
    border-radius: 5px;
    color: #f04747;
    font-size: 12px;
  }

  .connect-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    background: var(--accent-color);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .connect-btn:hover:not(:disabled) { filter: brightness(1.1); }
  .connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .spinner.small {
    width: 10px;
    height: 10px;
    border-width: 1.5px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Query Area ── */
  .query-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 12px 16px;
    gap: 10px;
  }

  .query-editor-section {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    position: relative;
  }

  .query-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .query-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .query-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .query-action-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .run-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    background: #43b581;
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .run-btn:hover:not(:disabled) { background: #3ca374; }
  .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .shortcut-hint {
    font-size: 10px;
    opacity: 0.7;
    font-weight: 400;
  }

  .history-dropdown {
    position: absolute;
    top: 32px;
    right: 0;
    width: 360px;
    max-height: 240px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 100;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .history-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }

  .history-clear-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    color: var(--text-secondary);
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .history-clear-btn:hover { color: #f04747; border-color: rgba(240, 71, 71, 0.4); }

  .history-empty {
    padding: 16px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 11px;
    font-style: italic;
  }

  .history-item {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border-color);
    transition: background 0.1s;
  }

  .history-item:last-child { border-bottom: none; }
  .history-item:hover { background: var(--bg-tertiary); }

  .history-item-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
    overflow: hidden;
  }

  .history-delete-btn {
    flex: 0 0 24px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .history-item:hover .history-delete-btn { opacity: 1; }
  .history-delete-btn:hover { color: #f04747; }

  .history-sql {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 11px;
    color: #e8c479;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-meta {
    font-size: 10px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .history-time { font-weight: 500; }
  .history-meta-sep { opacity: 0.4; }
  .history-error { color: #f04747; font-weight: 600; }

  .query-input {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: #e8c479;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    min-height: 80px;
  }

  .query-input:focus { border-color: var(--accent-color); }

  .query-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(240, 71, 71, 0.08);
    border: 1px solid rgba(240, 71, 71, 0.2);
    border-radius: 6px;
    color: #f04747;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    flex-shrink: 0;
  }

  .query-error svg { flex-shrink: 0; margin-top: 1px; }

  /* ── Results ── */
  .result-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 6px;
    flex-shrink: 0;
  }

  .result-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .stat { font-weight: 500; }
  .stat-sep { opacity: 0.3; }

  .result-actions {
    display: flex;
    gap: 4px;
  }

  .result-action {
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .result-action:hover { background: var(--bg-tertiary); color: var(--text-primary); }

  .result-table-wrapper {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 6px;
  }

  .result-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }

  .result-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .result-table th {
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    font-weight: 600;
    white-space: nowrap;
    color: var(--text-primary);
  }

  .col-name { display: block; }
  .col-type { display: block; font-size: 9px; font-weight: 400; color: var(--text-secondary); opacity: 0.6; }

  .result-table td {
    padding: 5px 12px;
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    color: var(--text-primary);
    transition: background 0.1s;
  }

  .result-table td:hover { background: var(--bg-tertiary); }
  .result-table td.null-val { color: #72767d; font-style: italic; }

  .row-num {
    color: var(--text-secondary);
    opacity: 0.4;
    font-size: 10px;
    width: 36px;
    text-align: right;
    user-select: none;
  }

  .result-table tbody tr:hover td { background: rgba(88, 101, 242, 0.04); }

  .mutation-result {
    padding: 16px;
    background: rgba(67, 181, 129, 0.08);
    border: 1px solid rgba(67, 181, 129, 0.2);
    border-radius: 6px;
    color: #43b581;
    font-size: 13px;
    font-weight: 500;
    text-align: center;
  }

  .empty-result {
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 13px;
    font-style: italic;
  }

  .copy-toast {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 16px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    animation: fadeInUp 0.2s ease;
    pointer-events: none;
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
