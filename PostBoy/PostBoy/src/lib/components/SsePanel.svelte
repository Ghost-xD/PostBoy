<script lang="ts">
  import { activeTab } from '$lib/stores/tabStore';
  import { sseConnect, sseDisconnect, clearSseMessages } from '$lib/stores/sseStore';
  import { afterUpdate } from 'svelte';

  let autoScroll = true;
  let autoReconnect = true;
  let filterEventType = '';
  let messageLog: HTMLDivElement;

  $: tabId = $activeTab.id;
  $: sseStatus = $activeTab.sseStatus;
  $: sseMessages = $activeTab.sseMessages || [];
  $: url = $activeTab.url;
  $: headers = ($activeTab.headers || []).filter((h: any) => h.key && h.value);

  $: isConnected = sseStatus === 'connected';
  $: isConnecting = sseStatus === 'connecting';
  $: isReconnecting = sseStatus === 'reconnecting';
  $: isActive = isConnected || isConnecting || isReconnecting;

  $: eventTypes = [...new Set(sseMessages.map(m => m.eventType))].sort();
  $: filteredMessages = filterEventType
    ? sseMessages.filter(m => m.eventType === filterEventType)
    : sseMessages;

  afterUpdate(() => {
    if (autoScroll && messageLog) {
      messageLog.scrollTop = messageLog.scrollHeight;
    }
  });

  function handleConnect() {
    if (isActive) {
      sseDisconnect(tabId);
    } else {
      const hdrs: Record<string, string> = {};
      for (const h of headers) {
        hdrs[h.key] = h.value;
      }
      sseConnect(tabId, url, Object.keys(hdrs).length > 0 ? hdrs : undefined, autoReconnect);
    }
  }

  function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function tryFormatJson(data: string): { formatted: string; isJson: boolean } {
    try {
      const parsed = JSON.parse(data);
      return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { formatted: data, isJson: false };
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'connected': return '#43b581';
      case 'connecting': return '#faa61a';
      case 'reconnecting': return '#faa61a';
      case 'error': return '#f04747';
      default: return '#72767d';
    }
  }

  function getEventBadgeColor(eventType: string): string {
    const hash = eventType.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const colors = ['#5865f2', '#43b581', '#faa61a', '#f04747', '#eb459e', '#57f287', '#fee75c', '#5bc0eb'];
    return colors[hash % colors.length];
  }
</script>

<div class="sse-panel">
  <div class="sse-status-bar">
    <div class="sse-status-indicator">
      <span class="status-dot" style="background: {getStatusColor(sseStatus)}"></span>
      <span class="status-text">{sseStatus.charAt(0).toUpperCase() + sseStatus.slice(1)}</span>
    </div>
    <div class="sse-controls">
      <label class="reconnect-toggle" title="Auto-reconnect on connection loss">
        <input type="checkbox" bind:checked={autoReconnect} disabled={isActive} />
        Auto-reconnect
      </label>
      <button
        class="sse-connect-btn {isActive ? 'disconnect' : ''}"
        on:click={handleConnect}
        disabled={isConnecting || !url}
        title={isActive ? 'Disconnect (Ctrl+Enter)' : 'Connect (Ctrl+Enter)'}
      >
        {#if isConnecting}
          Connecting...
        {:else if isReconnecting}
          Reconnecting...
        {:else if isConnected}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>
          Disconnect
        {:else}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg>
          Connect
        {/if}
      </button>
    </div>
  </div>

  <div class="sse-toolbar">
    <div class="sse-stats">
      <span class="stat">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4v8m0 0l4-4m-4 4L4 8"/></svg>
        {sseMessages.length} events
      </span>
      {#if filterEventType}
        <span class="stat filtered-stat">{filteredMessages.length} shown</span>
      {/if}
    </div>
    <div class="sse-actions">
      {#if eventTypes.length > 1}
        <select class="event-filter" bind:value={filterEventType} title="Filter by event type">
          <option value="">All events</option>
          {#each eventTypes as et}
            <option value={et}>{et}</option>
          {/each}
        </select>
      {/if}
      <label class="auto-scroll-toggle" title="Auto-scroll to latest message">
        <input type="checkbox" bind:checked={autoScroll} />
        Auto-scroll
      </label>
      <button class="clear-btn" on:click={() => clearSseMessages(tabId)} title="Clear messages (Ctrl+L)">
        Clear
      </button>
    </div>
  </div>

  <div class="sse-message-log" bind:this={messageLog}>
    {#if filteredMessages.length === 0}
      <div class="empty-state">
        {#if isConnected}
          Connected. Waiting for events...
        {:else if isReconnecting}
          Reconnecting to server...
        {:else}
          Enter an SSE endpoint URL and click Connect to start.
        {/if}
      </div>
    {:else}
      {#each filteredMessages as msg (msg.id)}
        {@const { formatted, isJson } = tryFormatJson(msg.data)}
        <div class="sse-message">
          <div class="msg-meta">
            <svg class="msg-arrow" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4v8m0 0l4-4m-4 4L4 8"/></svg>
            <span class="msg-event-badge" style="background: {getEventBadgeColor(msg.eventType)}15; color: {getEventBadgeColor(msg.eventType)}">{msg.eventType}</span>
            <span class="msg-time">{formatTimestamp(msg.timestamp)}</span>
            <span class="msg-size">{formatSize(msg.size)}</span>
            {#if isJson}
              <span class="msg-badge json-badge">JSON</span>
            {/if}
            {#if msg.lastEventId}
              <span class="msg-event-id" title="Last Event ID">id: {msg.lastEventId}</span>
            {/if}
            <button class="msg-copy-btn" on:click={() => navigator.clipboard.writeText(msg.data)} title="Copy">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
            </button>
          </div>
          <pre class="msg-data {isJson ? 'json' : ''}">{isJson ? formatted : msg.data}</pre>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .sse-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary, #1e1f22);
    color: #dbdee1;
    overflow: hidden;
  }

  .sse-status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #2b2d31;
    border-bottom: 1px solid #3e4045;
    gap: 12px;
    flex-shrink: 0;
  }

  .sse-status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-text { color: #b5bac1; }

  .sse-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .reconnect-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #b5bac1;
    cursor: pointer;
    font-size: 12px;
  }

  .reconnect-toggle input { accent-color: #5865f2; }

  .sse-connect-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: #5865f2;
    color: white;
    transition: background 0.15s;
  }

  .sse-connect-btn:hover:not(:disabled) { background: #4752c4; }
  .sse-connect-btn.disconnect { background: #f04747; }
  .sse-connect-btn.disconnect:hover:not(:disabled) { background: #d83c3e; }
  .sse-connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .sse-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: #2b2d31;
    border-bottom: 1px solid #3e4045;
    font-size: 12px;
    flex-shrink: 0;
  }

  .sse-stats {
    display: flex;
    gap: 12px;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #b5bac1;
  }

  .stat svg { color: #43b581; }
  .filtered-stat { color: #faa61a; }

  .sse-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .event-filter {
    padding: 2px 6px;
    background: #1e1f22;
    border: 1px solid #3e4045;
    border-radius: 3px;
    color: #dbdee1;
    font-size: 11px;
    outline: none;
  }

  .auto-scroll-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #b5bac1;
    cursor: pointer;
    font-size: 12px;
  }

  .auto-scroll-toggle input { accent-color: #5865f2; }

  .clear-btn {
    padding: 3px 8px;
    background: transparent;
    border: 1px solid #3e4045;
    border-radius: 3px;
    color: #b5bac1;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .clear-btn:hover { background: #383a40; color: #dbdee1; }

  .sse-message-log {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #72767d;
    font-size: 13px;
    font-style: italic;
  }

  .sse-message {
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    border-left: 3px solid #43b581;
    background: rgba(67, 181, 129, 0.08);
  }

  .msg-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .msg-arrow { color: #43b581; }

  .msg-event-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .msg-time {
    color: #72767d;
    font-size: 11px;
    font-family: monospace;
  }

  .msg-size {
    color: #72767d;
    font-size: 11px;
  }

  .msg-badge {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .json-badge {
    background: rgba(250, 166, 26, 0.15);
    color: #faa61a;
  }

  .msg-event-id {
    color: #72767d;
    font-size: 10px;
    font-family: monospace;
  }

  .msg-copy-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: #72767d;
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .sse-message:hover .msg-copy-btn { opacity: 1; }
  .msg-copy-btn:hover { color: #dbdee1; }

  .msg-data {
    margin: 0;
    padding: 4px 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #dbdee1;
  }

  .msg-data.json { color: #e8c479; }
</style>
