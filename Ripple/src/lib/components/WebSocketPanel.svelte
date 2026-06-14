<script lang="ts">
  import { activeTab, updateActiveTab, type WsMessage } from '$lib/stores/tabStore';
  import { wsConnect, wsSend, wsSendBinary, wsDisconnect, clearWsMessages } from '$lib/stores/wsStore';
  import { fileOps } from '$lib/api/tauri';
  import { addLog } from '$lib/stores/consoleStore';

  let messageInput = $state('');
  let binaryFileName = $state('');
  let autoScroll = $state(true);
  let messageLog: HTMLDivElement | undefined = $state();

  const tabId = $derived($activeTab.id);
  const wsStatus = $derived($activeTab.wsStatus);
  const wsMessages = $derived($activeTab.wsMessages || []);
  const wsSendMode = $derived($activeTab.wsSendMode || 'text');
  const wsInitialMessage = $derived($activeTab.wsInitialMessage || '');
  const url = $derived($activeTab.url);
  const headers = $derived(($activeTab.headers || []).filter((h: { key: string; value: string }) => h.key && h.value));
  const sentCount = $derived(wsMessages.filter((m: WsMessage) => m.direction === 'sent').length);
  const receivedCount = $derived(wsMessages.filter((m: WsMessage) => m.direction === 'received').length);
  const isConnected = $derived(wsStatus === 'connected');
  const isConnecting = $derived(wsStatus === 'connecting');

  // Auto-scroll the log to the bottom whenever new messages arrive.
  // Reading `wsMessages.length` is what makes the effect re-run on each
  // new message; the previous Svelte-4 implementation used `afterUpdate`
  // which had the same effect implicitly.
  $effect(() => {
    void wsMessages.length;
    if (autoScroll && messageLog) {
      messageLog.scrollTop = messageLog.scrollHeight;
    }
  });

  function handleConnect() {
    if (isConnected || isConnecting) {
      wsDisconnect(tabId);
    } else {
      const hdrs: Record<string, string> = {};
      for (const h of headers) {
        hdrs[h.key] = h.value;
      }
      wsConnect(tabId, url, Object.keys(hdrs).length > 0 ? hdrs : undefined);
    }
  }

  function handleSend() {
    if (!isConnected) return;
    if (wsSendMode === 'binary') {
      if (!messageInput.trim()) return;
      wsSendBinary(tabId, messageInput.trim(), binaryFileName || undefined);
      messageInput = '';
      binaryFileName = '';
      return;
    }
    if (!messageInput.trim()) return;
    wsSend(tabId, messageInput);
    messageInput = '';
  }

  async function pickBinaryFile() {
    try {
      const result = await fileOps.showOpenDialog({ title: 'Select binary file to send' });
      const filePath = Array.isArray(result) ? result[0] : result;
      if (!filePath) return;
      const fileData = await fileOps.readFileBase64(filePath);
      messageInput = fileData.base64;
      binaryFileName = fileData.name;
      addLog(`Selected binary file: ${fileData.name} (${fileData.size} bytes)`, 'system');
    } catch (err: any) {
      addLog(`File selection failed: ${err}`, 'error');
    }
  }

  function setSendMode(mode: 'text' | 'binary') {
    updateActiveTab('wsSendMode', mode);
    messageInput = '';
    binaryFileName = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
      case 'error': return '#f04747';
      default: return '#72767d';
    }
  }
</script>

<div class="ws-panel">
  <div class="ws-status-bar">
    <div class="ws-status-indicator">
      <span class="status-dot" style="background: {getStatusColor(wsStatus)}"></span>
      <span class="status-text">{wsStatus.charAt(0).toUpperCase() + wsStatus.slice(1)}</span>
    </div>
    <button
      class="ws-connect-btn {isConnected ? 'disconnect' : ''}"
      onclick={handleConnect}
      disabled={isConnecting || !url}
      title={isConnected ? 'Disconnect (Ctrl+Enter)' : 'Connect (Ctrl+Enter)'}
    >
      {#if isConnecting}
        Connecting...
      {:else if isConnected}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>
        Disconnect
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg>
        Connect
      {/if}
    </button>
  </div>

  <div class="ws-toolbar">
    <div class="ws-stats">
      <span class="stat sent-stat" title="Messages sent">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12V4m0 0L4 8m4-4l4 4"/></svg>
        {sentCount}
      </span>
      <span class="stat received-stat" title="Messages received">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4v8m0 0l4-4m-4 4L4 8"/></svg>
        {receivedCount}
      </span>
      <span class="stat total-stat">{wsMessages.length} total</span>
    </div>
    <div class="ws-actions">
      <label class="auto-scroll-toggle" title="Auto-scroll to latest message">
        <input type="checkbox" bind:checked={autoScroll} />
        Auto-scroll
      </label>
      <button class="clear-btn" onclick={() => clearWsMessages(tabId)} title="Clear messages (Ctrl+L)">
        Clear
      </button>
    </div>
  </div>

  <div class="ws-message-log" bind:this={messageLog}>
    {#if wsMessages.length === 0}
      <div class="empty-state">
        {#if isConnected}
          Connected. Waiting for messages...
        {:else}
          Enter a WebSocket URL and click Connect to start.
        {/if}
      </div>
    {:else}
      {#each wsMessages as msg (msg.id)}
        {@const { formatted, isJson } = tryFormatJson(msg.data)}
        <div class="ws-message {msg.direction}">
          <div class="msg-meta">
            <span class="msg-direction" title={msg.direction === 'sent' ? 'Sent' : 'Received'}>
              {#if msg.direction === 'sent'}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12V4m0 0L4 8m4-4l4 4"/></svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4v8m0 0l4-4m-4 4L4 8"/></svg>
              {/if}
            </span>
            <span class="msg-time">{formatTimestamp(msg.timestamp)}</span>
            <span class="msg-size">{formatSize(msg.size)}</span>
            {#if isJson}
              <span class="msg-badge json-badge">JSON</span>
            {/if}
            {#if msg.type === 'binary'}
              <span class="msg-badge binary-badge">BIN</span>
            {/if}
            <button class="msg-copy-btn" onclick={() => navigator.clipboard.writeText(msg.data)} title="Copy">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
            </button>
          </div>
          <pre class="msg-data {isJson ? 'json' : ''}">{isJson ? formatted : msg.data}</pre>
        </div>
      {/each}
    {/if}
  </div>

  <div class="ws-composer" class:disabled={!isConnected}>
    <div class="ws-composer-toolbar">
      <div class="send-mode-toggle">
        <button
          type="button"
          class="mode-btn {wsSendMode === 'text' ? 'active' : ''}"
          onclick={() => setSendMode('text')}
          disabled={!isConnected}
        >Text</button>
        <button
          type="button"
          class="mode-btn {wsSendMode === 'binary' ? 'active' : ''}"
          onclick={() => setSendMode('binary')}
          disabled={!isConnected}
        >Binary</button>
        {#if wsSendMode === 'binary'}
          <button type="button" class="pick-file-btn" onclick={pickBinaryFile} disabled={!isConnected}>
            Pick file
          </button>
          {#if binaryFileName}
            <span class="binary-file-label">{binaryFileName}</span>
          {/if}
        {/if}
      </div>
      <label class="chain-initial-label" title="Optional message sent automatically in collection chains after connect">
        Chain initial:
        <input
          type="text"
          value={wsInitialMessage}
          oninput={(e) => updateActiveTab('wsInitialMessage', e.currentTarget.value)}
          placeholder="Optional initial send for chains"
          class="chain-initial-input"
        />
      </label>
    </div>
    <div class="ws-composer-row">
    <textarea
      bind:value={messageInput}
      onkeydown={handleKeydown}
      placeholder={isConnected
        ? (wsSendMode === 'binary'
          ? 'Base64 payload or use Pick file... (Enter to send)'
          : 'Type a message... (Enter to send, Shift+Enter for newline)')
        : 'Connect to send messages'}
      disabled={!isConnected}
      rows="3"
    ></textarea>
    <button
      class="ws-send-btn"
      onclick={handleSend}
      disabled={!isConnected || !messageInput.trim()}
      title="Send message (Enter)"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.315.037a.5.5 0 0 1 .539.11Z"/></svg>
    </button>
    </div>
  </div>
</div>

<style>
  .ws-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary, #1e1f22);
    color: #dbdee1;
    overflow: hidden;
  }

  .ws-status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    gap: 12px;
    flex-shrink: 0;
  }

  .ws-status-indicator {
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

  .status-text {
    color: #b5bac1;
  }

  .ws-connect-btn {
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

  .ws-connect-btn:hover:not(:disabled) {
    background: #4752c4;
  }

  .ws-connect-btn.disconnect {
    background: #f04747;
  }

  .ws-connect-btn.disconnect:hover:not(:disabled) {
    background: #d83c3e;
  }

  .ws-connect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ws-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    font-size: 12px;
    flex-shrink: 0;
  }

  .ws-stats {
    display: flex;
    gap: 12px;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #b5bac1;
  }

  .sent-stat svg { color: #5865f2; }
  .received-stat svg { color: #43b581; }

  .ws-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .auto-scroll-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #b5bac1;
    cursor: pointer;
    font-size: 12px;
  }

  .auto-scroll-toggle input {
    accent-color: #5865f2;
  }

  .clear-btn {
    padding: 3px 8px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    color: #b5bac1;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .clear-btn:hover {
    background: #383a40;
    color: #dbdee1;
  }

  .ws-message-log {
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

  .ws-message {
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    border-left: 3px solid transparent;
  }

  .ws-message.sent {
    background: rgba(88, 101, 242, 0.08);
    border-left-color: #5865f2;
  }

  .ws-message.received {
    background: rgba(67, 181, 129, 0.08);
    border-left-color: #43b581;
  }

  .msg-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .msg-direction {
    display: flex;
    align-items: center;
  }

  .sent .msg-direction { color: #5865f2; }
  .received .msg-direction { color: #43b581; }

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

  .binary-badge {
    background: rgba(114, 118, 125, 0.2);
    color: #b5bac1;
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

  .ws-message:hover .msg-copy-btn {
    opacity: 1;
  }

  .msg-copy-btn:hover {
    color: #dbdee1;
  }

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

  .msg-data.json {
    color: #e8c479;
  }

  .ws-composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .ws-composer-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }

  .send-mode-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mode-btn,
  .pick-file-btn {
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: #dbdee1;
    font-size: 12px;
    cursor: pointer;
  }

  .mode-btn.active {
    border-color: #5865f2;
    color: #fff;
    background: #5865f244;
  }

  .pick-file-btn:disabled,
  .mode-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .binary-file-label {
    font-size: 12px;
    color: #b5bac1;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chain-initial-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #b5bac1;
    flex: 1;
    min-width: 200px;
  }

  .chain-initial-input {
    flex: 1;
    min-width: 120px;
    padding: 4px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: #dbdee1;
    font-size: 12px;
  }

  .ws-composer-row {
    display: flex;
    gap: 8px;
  }

  .ws-composer-row textarea {
    flex: 1;
  }

  .ws-composer.disabled {
    opacity: 0.6;
  }

  .ws-composer textarea {
    flex: 1;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: #dbdee1;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 13px;
    resize: none;
    outline: none;
    transition: border-color 0.15s;
  }

  .ws-composer textarea:focus {
    border-color: #5865f2;
  }

  .ws-composer textarea:disabled {
    cursor: not-allowed;
  }

  .ws-send-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    background: #5865f2;
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    transition: background 0.15s;
    flex-shrink: 0;
  }

  .ws-send-btn:hover:not(:disabled) {
    background: #4752c4;
  }

  .ws-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
