<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/api/tauri';
  import { isExpired } from '$lib/stores/cookieStore';

  interface CookieRow {
    id: number;
    collection_id: number;
    domain: string;
    path: string;
    name: string;
    value: string;
    expires: string | null;
    secure: boolean;
    http_only: boolean;
    same_site: string;
    created_at: string;
    updated_at: string;
  }

  interface Collection {
    id: number;
    name: string;
  }

  let collections: Collection[] = $state([]);
  let selectedCollectionId: number | null = $state(null);
  let cookies: CookieRow[] = $state([]);
  let searchFilter = $state('');
  let editingCookie: Partial<CookieRow> | null = $state(null);
  let showAddForm = $state(false);

  let filteredCookies = $derived(searchFilter
    ? cookies.filter(c =>
        c.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        c.domain.toLowerCase().includes(searchFilter.toLowerCase()) ||
        c.value.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : cookies);

  onMount(async () => {
    try {
      collections = (await db.getCollections()) as any[];
      if (collections.length > 0) {
        selectedCollectionId = collections[0].id;
        await loadCookies();
      }
    } catch { /* no-op on load failure */ }
  });

  async function loadCookies() {
    if (!selectedCollectionId) { cookies = []; return; }
    try {
      cookies = (await db.getCookies(selectedCollectionId)) as CookieRow[];
    } catch {
      cookies = [];
    }
  }

  async function handleCollectionChange() {
    await loadCookies();
  }

  async function deleteCookie(cookie: CookieRow) {
    if (!selectedCollectionId) return;
    try {
      await db.deleteCookie(selectedCollectionId, cookie.id);
      await loadCookies();
    } catch { /* ignore */ }
  }

  async function clearAll() {
    if (!selectedCollectionId) return;
    try {
      await db.clearCookies(selectedCollectionId);
      await loadCookies();
    } catch { /* ignore */ }
  }

  function startAdd() {
    editingCookie = {
      domain: '',
      path: '/',
      name: '',
      value: '',
      expires: null,
      secure: false,
      http_only: false,
      same_site: 'Lax',
    };
    showAddForm = true;
  }

  function startEdit(cookie: CookieRow) {
    editingCookie = { ...cookie };
    showAddForm = true;
  }

  async function saveCookie() {
    if (!selectedCollectionId || !editingCookie || !editingCookie.name || !editingCookie.domain) return;
    try {
      await db.setCookie(selectedCollectionId, {
        domain: editingCookie.domain!,
        path: editingCookie.path || '/',
        name: editingCookie.name!,
        value: editingCookie.value || '',
        expires: editingCookie.expires || null,
        secure: editingCookie.secure || false,
        httpOnly: editingCookie.http_only || false,
        sameSite: editingCookie.same_site || 'Lax',
      });
      showAddForm = false;
      editingCookie = null;
      await loadCookies();
    } catch { /* ignore */ }
  }

  function cancelEdit() {
    showAddForm = false;
    editingCookie = null;
  }

  function formatExpiry(expires: string | null): string {
    if (!expires) return 'Session';
    try {
      const d = new Date(expires);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return expires;
    }
  }
</script>

<div class="cookie-panel">
  <div class="cookie-header">
    <div class="header-left">
      <select class="collection-select" bind:value={selectedCollectionId} onchange={handleCollectionChange}>
        {#each collections as col}
          <option value={col.id}>{col.name}</option>
        {/each}
      </select>
      <span class="cookie-count">{cookies.length} cookie{cookies.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="header-actions">
      <input
        type="text"
        class="search-input"
        bind:value={searchFilter}
        placeholder="Filter cookies..."
      />
      <button class="action-btn add-btn" onclick={startAdd} title="Add cookie">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/></svg>
        Add
      </button>
      <button class="action-btn clear-btn" onclick={clearAll} disabled={cookies.length === 0} title="Clear all cookies">
        Clear All
      </button>
    </div>
  </div>

  {#if showAddForm && editingCookie}
    <div class="cookie-form">
      <div class="form-row">
        <label>
          <span>Name</span>
          <input type="text" bind:value={editingCookie.name} placeholder="cookie_name" />
        </label>
        <label>
          <span>Value</span>
          <input type="text" bind:value={editingCookie.value} placeholder="cookie_value" />
        </label>
      </div>
      <div class="form-row">
        <label>
          <span>Domain</span>
          <input type="text" bind:value={editingCookie.domain} placeholder=".example.com" />
        </label>
        <label>
          <span>Path</span>
          <input type="text" bind:value={editingCookie.path} placeholder="/" />
        </label>
      </div>
      <div class="form-row">
        <label>
          <span>Same-Site</span>
          <select bind:value={editingCookie.same_site}>
            <option value="Lax">Lax</option>
            <option value="Strict">Strict</option>
            <option value="None">None</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={editingCookie.secure} />
          <span>Secure</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={editingCookie.http_only} />
          <span>HttpOnly</span>
        </label>
      </div>
      <div class="form-actions">
        <button class="save-btn" onclick={saveCookie}>Save</button>
        <button class="cancel-btn" onclick={cancelEdit}>Cancel</button>
      </div>
    </div>
  {/if}

  <div class="cookie-table-wrapper">
    {#if filteredCookies.length === 0}
      <div class="empty-state">
        {#if cookies.length === 0}
          No cookies stored for this collection. Cookies will be auto-captured from responses.
        {:else}
          No cookies match the filter.
        {/if}
      </div>
    {:else}
      <table class="cookie-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
            <th>Domain</th>
            <th>Path</th>
            <th>Expires</th>
            <th>Flags</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredCookies as cookie (cookie.id)}
            <tr class:expired={isExpired(cookie.expires)}>
              <td class="name-cell" title={cookie.name}>{cookie.name}</td>
              <td class="value-cell" title={cookie.value}>{cookie.value}</td>
              <td class="domain-cell" title={cookie.domain}>{cookie.domain}</td>
              <td class="path-cell">{cookie.path}</td>
              <td class="expires-cell" class:session={!cookie.expires}>
                {formatExpiry(cookie.expires)}
              </td>
              <td class="flags-cell">
                {#if cookie.secure}
                  <span class="flag secure-flag" title="Secure">S</span>
                {/if}
                {#if cookie.http_only}
                  <span class="flag httponly-flag" title="HttpOnly">H</span>
                {/if}
                <span class="flag samesite-flag" title="SameSite: {cookie.same_site}">{cookie.same_site[0]}</span>
              </td>
              <td class="actions-cell">
                <button class="icon-btn" onclick={() => startEdit(cookie)} title="Edit">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.249.249 0 0 0 .108-.064l6.286-6.286Z"/></svg>
                </button>
                <button class="icon-btn delete-btn" onclick={() => deleteCookie(cookie)} title="Delete">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75v1.25h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM3.613 5.5l.7 8.39a1.5 1.5 0 0 0 1.494 1.36h4.386a1.5 1.5 0 0 0 1.494-1.36l.7-8.39Z"/></svg>
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .cookie-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary, #1e1f22);
    color: #dbdee1;
    overflow: hidden;
  }

  .cookie-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    gap: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .collection-select {
    padding: 5px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 13px;
    outline: none;
    min-width: 160px;
  }

  .cookie-count {
    font-size: 12px;
    color: #72767d;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .search-input {
    padding: 5px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 12px;
    outline: none;
    width: 160px;
  }

  .search-input:focus { border-color: #5865f2; }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: transparent;
    color: #b5bac1;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover { background: #383a40; color: #dbdee1; }
  .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .add-btn { color: #43b581; border-color: #43b581; }
  .add-btn:hover { background: rgba(67, 181, 129, 0.15); }

  .cookie-form {
    padding: 12px 14px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }

  .form-row {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }

  .form-row label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    font-size: 11px;
    color: #b5bac1;
  }

  .form-row label span { font-weight: 500; }

  .form-row input[type="text"],
  .form-row select {
    padding: 5px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #dbdee1;
    font-size: 12px;
    outline: none;
  }

  .form-row input:focus,
  .form-row select:focus { border-color: #5865f2; }

  .checkbox-label {
    flex-direction: row !important;
    align-items: center !important;
    gap: 5px !important;
    flex: 0 !important;
    white-space: nowrap;
  }

  .checkbox-label input { accent-color: #5865f2; }

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .save-btn {
    padding: 5px 14px;
    background: #5865f2;
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .save-btn:hover { background: #4752c4; }

  .cancel-btn {
    padding: 5px 14px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: #b5bac1;
    font-size: 12px;
    cursor: pointer;
  }

  .cancel-btn:hover { background: #383a40; }

  .cookie-table-wrapper {
    flex: 1;
    overflow: auto;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #72767d;
    font-size: 13px;
    font-style: italic;
    padding: 20px;
    text-align: center;
  }

  .cookie-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .cookie-table thead th {
    position: sticky;
    top: 0;
    background: var(--bg-tertiary);
    padding: 6px 10px;
    text-align: left;
    font-weight: 600;
    font-size: 11px;
    color: #b5bac1;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 1px solid var(--border-color);
  }

  .cookie-table tbody tr {
    border-bottom: 1px solid rgba(62, 64, 69, 0.5);
    transition: background 0.1s;
  }

  .cookie-table tbody tr:hover { background: rgba(88, 101, 242, 0.06); }
  .cookie-table tbody tr.expired { opacity: 0.5; }

  .cookie-table td {
    padding: 6px 10px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name-cell { font-weight: 500; color: #f0b232; }
  .value-cell { font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; color: #b5bac1; }
  .domain-cell { color: #5bc0eb; }
  .path-cell { color: #72767d; }
  .expires-cell { color: #b5bac1; font-size: 11px; }
  .expires-cell.session { color: #43b581; font-style: italic; }

  .flags-cell {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .flag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
  }

  .secure-flag { background: rgba(67, 181, 129, 0.2); color: #43b581; }
  .httponly-flag { background: rgba(88, 101, 242, 0.2); color: #5865f2; }
  .samesite-flag { background: rgba(250, 166, 26, 0.15); color: #faa61a; }

  .actions-cell {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  tr:hover .actions-cell { opacity: 1; }

  .icon-btn {
    background: none;
    border: none;
    color: #72767d;
    cursor: pointer;
    padding: 3px;
    border-radius: 3px;
    display: flex;
    align-items: center;
  }

  .icon-btn:hover { color: #dbdee1; background: #383a40; }
  .delete-btn:hover { color: #f04747; background: rgba(240, 71, 71, 0.1); }
</style>
