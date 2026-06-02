<script lang="ts">
  import { run, preventDefault } from 'svelte/legacy';

  import { onMount, onDestroy, tick } from 'svelte';
  import { ai } from '$lib/api/tauri';
  import {
    chatbotStatus,
    messages,
    streamingAssistant,
    isStreaming,
    actionLog,
    availableModels,
    downloadProgress,
    pausedDownloads,
    initChatbotFeature,
    refreshStatus,
    refreshModels,
    refreshActionLog,
    resetConversation,
    chatHistory,
    currentSessionId,
    refreshHistory,
    saveCurrentChat,
    loadChat,
    newChat,
    deleteChat,
    deleteAllChats,
  } from '$lib/stores/chatbotStore';
  import type { ChatMessage } from '$lib/stores/chatbotStore';
  import { addLog } from '$lib/stores/consoleStore';
  import { toolsFullscreen } from '$lib/stores/uiStore';

  type SubTab = 'chat' | 'log' | 'history' | 'models';
  let subTab: SubTab = $state('chat');

  let inputText = $state('');
  let inputEl: HTMLTextAreaElement | null = $state(null);
  let messageListEl: HTMLDivElement | null = $state(null);

  // ---- Composer autocomplete -------------------------------------------------
  // Suggestion source loaded once (and refreshed after each saved turn). The
  // filtered list is recomputed reactively from `inputText`.
  type Suggestion = {
    text: string;
    label: string;
    kind: 'phrase' | 'request' | 'collection' | 'template';
    score: number;
  };

  let corpusPhrases: Array<{ text: string; frequency: number }> = [];
  let corpusRequests: Array<{ name: string; collection: string | null }> = [];
  let corpusCollections: string[] = [];
  let suggestions: Suggestion[] = $state([]);
  let suggestionIndex = $state(-1);
  let showSuggestions = $state(false);

  // Starter templates the model is good at answering. Mirrors the
  // PATTERN_TEMPLATES idea from HealthCheckServer but tuned to PostBoy.
  const TEMPLATE_SUGGESTIONS: string[] = [
    'list my collections',
    'list requests in ',
    'hit ',
    'run ',
    'get me the access token from ',
    'what was the last request',
    'what was the error',
    'show me the last response body',
    'inspect ',
  ];

  async function loadSuggestionCorpus() {
    try {
      const c = await ai.getSuggestionCorpus();
      corpusPhrases = c.phrases ?? [];
      corpusRequests = c.requests ?? [];
      corpusCollections = c.collections ?? [];
    } catch (e) {
      console.warn('[chatbot] failed to load suggestion corpus', e);
    }
  }

  function computeSuggestions(raw: string): Suggestion[] {
    const prefix = raw.toLowerCase().trim();
    if (!prefix) return [];

    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const push = (s: Suggestion) => {
      const key = s.text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    };

    // 1. Past user phrases — highest priority, weighted by frequency.
    for (const p of corpusPhrases) {
      if (p.text.toLowerCase().startsWith(prefix)) {
        push({
          text: p.text,
          label: p.text,
          kind: 'phrase',
          score: 1000 + p.frequency,
        });
      }
    }

    // 2. Saved request names — "hit Get IRP Token", "run Get IRP Token", etc.
    //    We expand each saved request into a few action-prefixed completions
    //    so the user can type "h" and find "hit Get IRP Token".
    const verbs = ['hit', 'run', 'inspect', 'get'];
    for (const r of corpusRequests) {
      const variants = [r.name, ...verbs.map((v) => `${v} ${r.name}`)];
      for (const text of variants) {
        if (text.toLowerCase().startsWith(prefix)) {
          push({
            text,
            label: r.collection ? `${text}  ·  ${r.collection}` : text,
            kind: 'request',
            score: 500,
          });
        }
      }
    }

    // 3. Collection names — used after "list requests in ", etc.
    for (const c of corpusCollections) {
      const variants = [c, `list requests in ${c}`];
      for (const text of variants) {
        if (text.toLowerCase().startsWith(prefix)) {
          push({ text, label: text, kind: 'collection', score: 300 });
        }
      }
    }

    // 4. Built-in templates.
    for (const t of TEMPLATE_SUGGESTIONS) {
      if (t.toLowerCase().startsWith(prefix)) {
        push({ text: t, label: t, kind: 'template', score: 100 });
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 8);
  }

  run(() => {
    suggestions = inputText ? computeSuggestions(inputText) : [];
  });
  run(() => {
    if (suggestions.length === 0) {
      showSuggestions = false;
      suggestionIndex = -1;
    }
  });

  function pickSuggestion(s: Suggestion) {
    inputText = s.text;
    showSuggestions = false;
    suggestionIndex = -1;
    tick().then(() => {
      inputEl?.focus();
      // Place caret at the end so users can continue typing.
      if (inputEl) inputEl.setSelectionRange(inputText.length, inputText.length);
    });
  }

  function onInputChange() {
    showSuggestions = inputText.length > 0;
    suggestionIndex = -1;
  }

  // Tauri event listener handles
  let unlistenDelta: (() => void) | null = null;
  let unlistenTool: (() => void) | null = null;
  let unlistenError: (() => void) | null = null;
  let unlistenDone: (() => void) | null = null;
  let unlistenDownload: (() => void) | null = null;
  let unlistenDownloadSource: (() => void) | null = null;
  let unlistenDownloadPaused: (() => void) | null = null;
  let unlistenEngineLoaded: (() => void) | null = null;

  let activeDownloadSource: Record<string, string> = {};
  let streamingStartTs: number | null = $state(null);

  // For deriving "is model picked but not loaded?" callouts
  let hasEngine = $derived($chatbotStatus.engineLoaded);
  let installedCount = $derived($chatbotStatus.installedModelIds.length);

  onMount(async () => {
    await initChatbotFeature();
    await refreshActionLog();
    await refreshHistory();
    void loadSuggestionCorpus();

    const { listen } = await import('@tauri-apps/api/event');

    unlistenDelta = await listen<string>('ai-chat-delta', (event) => {
      if (streamingStartTs === null) streamingStartTs = Date.now();
      streamingAssistant.update((s) => s + event.payload);
      scrollToBottom();
    });

    unlistenTool = await listen<any>('ai-tool-call', () => {
      refreshActionLog();
    });

    unlistenError = await listen<string>('ai-chat-error', (event) => {
      addLog(`AI: ${event.payload}`, 'error');
      finalizeAssistant('');
    });

    unlistenDone = await listen<string>('ai-chat-done', () => {
      finalizeAssistant('');
    });

    unlistenDownload = await listen<any>('ai-download-progress', (event) => {
      const p = event.payload as { modelId: string; downloaded: number; total: number; source: string };
      downloadProgress.update((map) => ({
        ...map,
        [p.modelId]: { downloaded: p.downloaded, total: p.total, source: p.source },
      }));
    });

    unlistenDownloadSource = await listen<any>('ai-download-source', (event) => {
      const p = event.payload as { modelId: string; source: string };
      activeDownloadSource = { ...activeDownloadSource, [p.modelId]: p.source };
    });

    unlistenDownloadPaused = await listen<any>('ai-download-paused', (event) => {
      const p = event.payload as { modelId: string; downloaded: number; total: number };
      pausedDownloads.update((set) => {
        const next = new Set(set);
        next.add(p.modelId);
        return next;
      });
      // Keep progress visible while paused.
      downloadProgress.update((map) => ({
        ...map,
        [p.modelId]: {
          downloaded: p.downloaded,
          total: p.total,
          source: activeDownloadSource[p.modelId] || (map[p.modelId]?.source ?? ''),
        },
      }));
    });

    unlistenEngineLoaded = await listen<string>('ai-engine-loaded', async () => {
      await refreshStatus();
    });
  });

  onDestroy(() => {
    unlistenDelta?.();
    unlistenTool?.();
    unlistenError?.();
    unlistenDone?.();
    unlistenDownload?.();
    unlistenDownloadSource?.();
    unlistenDownloadPaused?.();
    unlistenEngineLoaded?.();
  });

  async function scrollToBottom() {
    await tick();
    if (messageListEl) {
      messageListEl.scrollTop = messageListEl.scrollHeight;
    }
  }

  function finalizeAssistant(_extra: string) {
    const partial = $streamingAssistant;
    if (partial) {
      const ts = streamingStartTs ?? Date.now();
      messages.update((m) => [...m, { role: 'assistant', content: partial, timestamp: ts }]);
    }
    streamingAssistant.set('');
    streamingStartTs = null;
    isStreaming.set(false);
    scrollToBottom();
    refreshActionLog();
    // Persist the conversation now that the assistant turn is complete.
    // Errors here are non-fatal — chats just won't show up in history.
    void saveCurrentChat()
      .then(() => loadSuggestionCorpus())
      .catch((e) => console.warn('[chatbot] saveCurrentChat failed', e));
  }

  // Suggested prompts shown on the empty state. Clicking one fires `send`
  // directly with the prompt text — no need to put it in the composer first.
  // Each entry has an inline Lucide-style SVG; we render via {@html} since
  // the markup is fully controlled here.
  type StarterPrompt = {
    prompt: string;
    subtitle: string;
    iconSvg: string;
  };
  const ICON_BASE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  const STARTER_PROMPTS: StarterPrompt[] = [
    {
      prompt: 'list my collections',
      subtitle: 'See every saved request grouped by folder',
      iconSvg: `${ICON_BASE}<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    },
    {
      prompt: 'hit get IRP token',
      subtitle: 'Run the auth request and grab a fresh token',
      iconSvg: `${ICON_BASE}<circle cx="8" cy="15" r="4"/><line x1="10.85" y1="12.15" x2="19" y2="4"/><line x1="18" y1="5" x2="20" y2="7"/><line x1="15" y1="8" x2="17" y2="10"/></svg>`,
    },
    {
      prompt: 'why did my last request fail?',
      subtitle: 'Debug the previous call from the action log',
      iconSvg: `${ICON_BASE}<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    },
    {
      prompt: 'summarize the last response',
      subtitle: 'Quick TL;DR of the most recent API call',
      iconSvg: `${ICON_BASE}<path d="M12 3 9.7 8.5 4 10.7l5.7 2.2L12 18.5l2.3-5.6L20 10.7l-5.7-2.2z"/><path d="m19 3 .8 1.7L21.5 5.5l-1.7.8L19 8l-.8-1.7L16.5 5.5l1.7-.8z"/><path d="m5 17 .6 1.3L7 19l-1.4.7L5 21l-.6-1.3L3 19l1.4-.7z"/></svg>`,
    },
  ];

  async function send(overrideText?: string) {
    const text = (overrideText ?? inputText).trim();
    if (!text || $isStreaming) return;

    if (!$chatbotStatus.engineLoaded) {
      const installed = $chatbotStatus.installedModelIds;
      if (installed.length === 0) {
        addLog('AI: No model installed yet — pick one from the Models tab.', 'warn');
        subTab = 'models';
      } else {
        addLog('AI: model not loaded — press Ctrl+Shift+M to load the default model.', 'warn');
      }
      return;
    }

    isStreaming.set(true);

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    messages.update((m) => [...m, userMsg]);
    inputText = '';
    streamingAssistant.set('');
    streamingStartTs = null;
    scrollToBottom();

    try {
      const conv: Array<{ role: string; content: string }> = $messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      await ai.chatSend(conv);
      // Streaming + done events handle the rest
    } catch (e: any) {
      addLog(`AI: ${e?.message || e}`, 'error');
      isStreaming.set(false);
    }
  }

  async function cancel() {
    try {
      await ai.chatCancel();
    } catch {}
    finalizeAssistant('');
  }

  async function downloadModel(modelId: string) {
    // Optimistically show progress immediately so the button row swaps to
    // [Pause] [Cancel] right away. Real progress events overwrite this within
    // a few hundred ms once the HTTP body starts streaming.
    const model = $availableModels.find((m) => m.id === modelId);
    downloadProgress.update((m) => ({
      ...m,
      [modelId]: {
        downloaded: 0,
        total: model?.sizeBytes ?? 0,
        source: 'connecting…',
      },
    }));

    try {
      await ai.downloadModel(modelId);
      downloadProgress.update((m) => {
        const c = { ...m };
        delete c[modelId];
        return c;
      });
      pausedDownloads.update((set) => {
        const next = new Set(set);
        next.delete(modelId);
        return next;
      });
      await refreshStatus();
    } catch (e: any) {
      const msg = e?.message || e || '';
      // Pause/Cancel surface as Err on the Rust side; that's expected.
      if (msg !== 'Paused' && msg !== 'Cancelled') {
        addLog(`AI: download failed — ${msg}`, 'error');
      }
      if (msg !== 'Paused') {
        downloadProgress.update((m) => {
          const c = { ...m };
          delete c[modelId];
          return c;
        });
        pausedDownloads.update((set) => {
          const next = new Set(set);
          next.delete(modelId);
          return next;
        });
      }
    }
  }

  async function pauseDownload(modelId: string) {
    pausedDownloads.update((set) => {
      const next = new Set(set);
      next.add(modelId);
      return next;
    });
    try {
      await ai.pauseDownload(modelId);
    } catch (e: any) {
      addLog(`AI: pause failed — ${e?.message || e}`, 'error');
      pausedDownloads.update((set) => {
        const next = new Set(set);
        next.delete(modelId);
        return next;
      });
    }
  }

  async function resumeDownload(modelId: string) {
    pausedDownloads.update((set) => {
      const next = new Set(set);
      next.delete(modelId);
      return next;
    });
    // Keep the existing progress entry (so the bar stays where it was) but
    // mark the source as reconnecting so the label reflects the in-flight state.
    downloadProgress.update((m) => {
      const cur = m[modelId];
      if (!cur) return m;
      return { ...m, [modelId]: { ...cur, source: 'reconnecting…' } };
    });
    try {
      await ai.resumeDownload(modelId);
      downloadProgress.update((m) => {
        const c = { ...m };
        delete c[modelId];
        return c;
      });
      await refreshStatus();
    } catch (e: any) {
      const msg = e?.message || e || '';
      if (msg !== 'Paused' && msg !== 'Cancelled') {
        addLog(`AI: resume failed — ${msg}`, 'error');
      }
      if (msg !== 'Paused') {
        downloadProgress.update((m) => {
          const c = { ...m };
          delete c[modelId];
          return c;
        });
      }
    }
  }

  async function cancelDownload(modelId: string) {
    try {
      await ai.cancelDownload(modelId);
    } catch (e: any) {
      addLog(`AI: cancel failed — ${e?.message || e}`, 'error');
    }
    downloadProgress.update((m) => {
      const c = { ...m };
      delete c[modelId];
      return c;
    });
    pausedDownloads.update((set) => {
      const next = new Set(set);
      next.delete(modelId);
      return next;
    });
  }

  async function deleteModel(modelId: string) {
    try {
      if ($chatbotStatus.activeModelId === modelId) {
        await ai.unloadEngine();
      }
      await ai.deleteModel(modelId);
      await refreshStatus();
    } catch (e: any) {
      addLog(`AI: delete failed — ${e?.message || e}`, 'error');
    }
  }

  async function loadEngine(modelId: string) {
    try {
      await ai.loadEngine(modelId);
      await refreshStatus();
    } catch (e: any) {
      addLog(`AI: load failed — ${e?.message || e}`, 'error');
    }
  }

  async function unloadEngine() {
    try {
      await ai.unloadEngine();
      await refreshStatus();
    } catch (e: any) {
      addLog(`AI: unload failed — ${e?.message || e}`, 'error');
    }
  }

  async function clearActionLogHandler() {
    try {
      await ai.clearActionLog();
      actionLog.set([]);
    } catch {}
  }

  // ---- Chat history handlers --------------------------------------------------

  function newChatHandler() {
    if ($isStreaming) return;
    newChat();
  }

  async function openChatHandler(id: number) {
    if ($isStreaming) return;
    try {
      await loadChat(id);
      subTab = 'chat';
      await tick();
      scrollToBottom();
    } catch (e) {
      addLog(`AI: failed to open chat — ${e}`, 'error');
    }
  }

  async function deleteChatHandler(id: number, ev: MouseEvent) {
    ev.stopPropagation();
    try {
      await deleteChat(id);
    } catch (e) {
      addLog(`AI: failed to delete chat — ${e}`, 'error');
    }
  }

  async function deleteAllChatsHandler() {
    if (!confirm('Delete all saved chats? This cannot be undone.')) return;
    try {
      await deleteAllChats();
    } catch (e) {
      addLog(`AI: failed to clear chat history — ${e}`, 'error');
    }
  }

  function formatChatRowDate(iso: string) {
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    if (isNaN(d.getTime())) return iso;
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function handleInputKeydown(e: KeyboardEvent) {
    const hasSuggestions = showSuggestions && suggestions.length > 0;

    if (hasSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        suggestionIndex =
          suggestionIndex < suggestions.length - 1 ? suggestionIndex + 1 : 0;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        suggestionIndex =
          suggestionIndex > 0 ? suggestionIndex - 1 : suggestions.length - 1;
        return;
      }
      if (e.key === 'Tab' && suggestionIndex >= 0) {
        e.preventDefault();
        pickSuggestion(suggestions[suggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        showSuggestions = false;
        suggestionIndex = -1;
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && suggestionIndex >= 0) {
        // Highlighted suggestion present → accept it instead of sending.
        e.preventDefault();
        pickSuggestion(suggestions[suggestionIndex]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Auto-resize the composer textarea up to a hard cap as the user types.
  function autoResize(node: HTMLTextAreaElement) {
    const MAX_PX = 200;
    const grow = () => {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, MAX_PX)}px`;
    };
    node.addEventListener('input', grow);
    grow();
    return {
      destroy() {
        node.removeEventListener('input', grow);
      },
    };
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatTime(ts: number | undefined) {
    if (!ts) return '';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // The currently "confirmed" copy button. Keys are semantic strings so the
  // single piece of state can drive feedback for the whole-message copy
  // (`msg-<ts>`), a code block (`code-<ts>-<idx>`), a JSON body
  // (`body-<ts>-<idx>`), or a single JSON field (`field-<ts>-<idx>-<key>`).
  let copiedKey: string | null = $state(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyToKey(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        copiedKey = null;
      }, 1400);
    } catch (e) {
      addLog(`Copy failed: ${e}`, 'error');
    }
  }

  // Minimal markdown -> HTML renderer for chat bubbles.
  // Handles the subset we actually emit from the backend:
  //   - ```lang\n...\n```  fenced code blocks
  //   - `inline code`
  //   - **bold**
  //   - line breaks preserved (we wrap in white-space: pre-wrap)
  // Everything else is escaped to text. Deliberately tiny — pulling in
  // marked / markdown-it for this is overkill.
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInlineMd(text: string): string {
    let work = escapeHtml(text);
    work = work.replace(/`([^`\n]+)`/g, (_m, code) => `<code class="cb-code-inline">${code}</code>`);
    work = work.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    return work;
  }

  // Legacy path used by the in-flight streaming bubble (where structured
  // JSON rendering would just flicker until the body completes).
  function renderChatMarkdown(text: string): string {
    if (!text) return '';
    const blocks: string[] = [];
    let work = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = blocks.length;
      const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
      blocks.push(`<pre class="cb-code"><code${langClass}>${escapeHtml(code)}</code></pre>`);
      return `\u0000${idx}\u0000`;
    });
    work = renderInlineMd(work);
    work = work.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
    return work;
  }

  // Segmented parser used for *finalized* assistant messages so we can mix
  // structured Svelte components (the JSON viewer with per-field copy
  // buttons) with the inline-markdown text segments.
  type AssistantSegment =
    | { kind: 'html'; html: string }
    | { kind: 'json'; raw: string; parsed: any }
    | { kind: 'code'; lang: string; content: string };

  function parseAssistantSegments(text: string): AssistantSegment[] {
    if (!text) return [];
    const out: AssistantSegment[] = [];
    const fence = /```(\w*)\n([\s\S]*?)```/g;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = fence.exec(text)) !== null) {
      const before = text.slice(lastEnd, m.index);
      if (before) out.push({ kind: 'html', html: renderInlineMd(before) });
      const lang = (m[1] || '').toLowerCase();
      const content = m[2];
      if (lang === 'json') {
        let parsed: any = undefined;
        try {
          parsed = JSON.parse(content);
        } catch {
          parsed = undefined;
        }
        if (parsed !== undefined) {
          out.push({ kind: 'json', raw: content, parsed });
        } else {
          out.push({ kind: 'code', lang, content });
        }
      } else {
        out.push({ kind: 'code', lang, content });
      }
      lastEnd = m.index + m[0].length;
    }
    if (lastEnd < text.length) {
      out.push({ kind: 'html', html: renderInlineMd(text.slice(lastEnd)) });
    }
    return out;
  }

  // Helpers for the JSON viewer ---------------------------------------------

  function isPlainObject(v: any): boolean {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** What we show inline in the field row (cheap visual rendering, may truncate). */
  function jsonDisplayValue(v: any): string {
    if (v === null) return 'null';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      return `[ ${v.length} ${v.length === 1 ? 'item' : 'items'} ]`;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      const preview = keys.slice(0, 3).join(', ');
      return `{ ${preview}${keys.length > 3 ? ', …' : ''} }`;
    }
    return String(v);
  }

  /** What lands on the clipboard. Strings copy unquoted (so JWTs paste cleanly),
   *  primitives copy as their string form, nested values copy as pretty JSON. */
  function jsonCopyValue(v: any): string {
    if (v === null) return 'null';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  /** Render a JSON value as keyed rows when possible (top-level object/array). */
  function jsonRows(v: any): Array<{ key: string; value: any }> {
    if (isPlainObject(v)) {
      return Object.entries(v).map(([k, val]) => ({ key: k, value: val }));
    }
    if (Array.isArray(v)) {
      return v.map((val, i) => ({ key: String(i), value: val }));
    }
    return [];
  }

  function copyMessage(text: string, ts: number) {
    return copyToKey(`msg-${ts}`, text);
  }
</script>

<div class="chatbot-panel" class:fullscreen={$toolsFullscreen}>
  <div class="cb-toolbar">
    <div class="cb-tabs">
      <button class="cb-tab" class:active={subTab === 'chat'} onclick={() => (subTab = 'chat')}>
        Chat
      </button>
      <button class="cb-tab" class:active={subTab === 'history'} onclick={() => (subTab = 'history')}>
        History {$chatHistory.length > 0 ? `(${$chatHistory.length})` : ''}
      </button>
      <button class="cb-tab" class:active={subTab === 'log'} onclick={() => (subTab = 'log')}>
        Action Log {$actionLog.length > 0 ? `(${$actionLog.length})` : ''}
      </button>
      <button class="cb-tab" class:active={subTab === 'models'} onclick={() => (subTab = 'models')}>
        Models
      </button>
    </div>
    <div class="cb-toolbar-actions">
      <button
        class="cb-toolbar-btn"
        onclick={newChatHandler}
        disabled={$isStreaming}
        title="New chat — saves the current chat to history and starts fresh"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        New chat
      </button>
      <div class="cb-status">
        {#if hasEngine}
          <span class="status-dot ready" title="Model loaded"></span>
          <span class="status-text">{$chatbotStatus.activeModelId}</span>
        {:else if installedCount > 0}
          <span class="status-dot warn" title="Model downloaded, not loaded"></span>
          <span class="status-text">Not loaded</span>
        {:else}
          <span class="status-dot off" title="No model"></span>
          <span class="status-text">No model</span>
        {/if}
      </div>
    </div>
  </div>

  {#if subTab === 'chat'}
    <div class="cb-chat">
      <div class="cb-messages" bind:this={messageListEl}>
        {#if $messages.length === 0 && !$streamingAssistant && !$isStreaming}
          <div class="cb-empty">
            <div class="cb-empty-title">Son of Anton</div>
            <div class="cb-empty-sub">
              {$chatbotStatus.engineLoaded
                ? 'Try one of these to start, or just type your own question below.'
                : 'Press Ctrl+Shift+M to load the model, then pick a starter prompt below.'}
            </div>
            <div class="cb-empty-prompts">
              {#each STARTER_PROMPTS as item, i}
                <button
                  type="button"
                  class="cb-empty-prompt"
                  style="animation-delay: {i * 60}ms"
                  onclick={() => send(item.prompt)}
                  disabled={!$chatbotStatus.engineLoaded || $isStreaming}
                  title={!$chatbotStatus.engineLoaded ? 'Load a model first (Ctrl+Shift+M)' : 'Send this prompt'}
                >
                  <span class="cb-empty-prompt-icon" aria-hidden="true">{@html item.iconSvg}</span>
                  <span class="cb-empty-prompt-body">
                    <span class="cb-empty-prompt-label">{item.prompt}</span>
                    <span class="cb-empty-prompt-sub">{item.subtitle}</span>
                  </span>
                  <span class="cb-empty-prompt-arrow" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
        {#each $messages as msg}
          <div class="cb-msg cb-msg-{msg.role}">
            <div class="cb-avatar" aria-hidden="true">{msg.role === 'user' ? 'U' : 'A'}</div>
            <div class="cb-bubble-wrap">
              {#if msg.role === 'assistant'}
                <div class="cb-msg-body">
                  {#each parseAssistantSegments(msg.content) as seg, segIdx}
                    {#if seg.kind === 'html'}
                      <div class="cb-seg-text">{@html seg.html}</div>
                    {:else if seg.kind === 'json'}
                      {@const rows = jsonRows(seg.parsed)}
                      <div class="cb-json-block">
                        <div class="cb-json-header">
                          <span class="cb-json-label">JSON</span>
                          <button
                            type="button"
                            class="cb-copy-btn"
                            class:done={copiedKey === `body-${msg.timestamp}-${segIdx}`}
                            onclick={() => copyToKey(`body-${msg.timestamp}-${segIdx}`, seg.raw.trim())}
                            title={copiedKey === `body-${msg.timestamp}-${segIdx}` ? 'Copied' : 'Copy entire body'}
                            aria-label="Copy entire body"
                          >
                            {#if copiedKey === `body-${msg.timestamp}-${segIdx}`}
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            {:else}
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            {/if}
                          </button>
                        </div>
                        {#if rows.length > 0}
                          <div class="cb-json-rows">
                            {#each rows as row (row.key)}
                              <div class="cb-json-row">
                                <span class="cb-json-key">{row.key}</span>
                                <span class="cb-json-val" title={jsonDisplayValue(row.value)}>{jsonDisplayValue(row.value)}</span>
                                <button
                                  type="button"
                                  class="cb-copy-btn"
                                  class:done={copiedKey === `field-${msg.timestamp}-${segIdx}-${row.key}`}
                                  onclick={() => copyToKey(`field-${msg.timestamp}-${segIdx}-${row.key}`, jsonCopyValue(row.value))}
                                  title={copiedKey === `field-${msg.timestamp}-${segIdx}-${row.key}` ? 'Copied' : `Copy ${row.key}`}
                                  aria-label={`Copy ${row.key}`}
                                >
                                  {#if copiedKey === `field-${msg.timestamp}-${segIdx}-${row.key}`}
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                  {:else}
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                  {/if}
                                </button>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <pre class="cb-code"><code>{seg.raw}</code></pre>
                        {/if}
                      </div>
                    {:else}
                      <div class="cb-code-block">
                        <div class="cb-code-header">
                          <span class="cb-code-lang">{seg.lang || 'text'}</span>
                          <button
                            type="button"
                            class="cb-copy-btn"
                            class:done={copiedKey === `code-${msg.timestamp}-${segIdx}`}
                            onclick={() => copyToKey(`code-${msg.timestamp}-${segIdx}`, seg.content)}
                            title={copiedKey === `code-${msg.timestamp}-${segIdx}` ? 'Copied' : 'Copy block'}
                            aria-label="Copy block"
                          >
                            {#if copiedKey === `code-${msg.timestamp}-${segIdx}`}
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            {:else}
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            {/if}
                          </button>
                        </div>
                        <pre class="cb-code"><code>{seg.content}</code></pre>
                      </div>
                    {/if}
                  {/each}
                </div>
              {:else}
                <div class="cb-msg-body">{msg.content}</div>
              {/if}
              <div class="cb-msg-foot">
                {#if msg.timestamp}<span class="cb-msg-meta">{formatTime(msg.timestamp)}</span>{/if}
                {#if msg.role === 'assistant' && msg.content}
                  <button
                    type="button"
                    class="cb-copy-btn"
                    class:done={copiedKey === `msg-${msg.timestamp}`}
                    onclick={() => copyMessage(msg.content, msg.timestamp ?? 0)}
                    title={copiedKey === `msg-${msg.timestamp}` ? 'Copied' : 'Copy response'}
                    aria-label={copiedKey === `msg-${msg.timestamp}` ? 'Copied' : 'Copy response'}
                  >
                    {#if copiedKey === `msg-${msg.timestamp}`}
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    {:else}
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    {/if}
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
        {#if $streamingAssistant || $isStreaming}
          <div class="cb-msg cb-msg-assistant">
            <div class="cb-avatar" aria-hidden="true">A</div>
            <div class="cb-bubble-wrap">
              <div class="cb-msg-body">
                {#if $streamingAssistant}{@html renderChatMarkdown($streamingAssistant)}{:else}<span class="cb-typing"><i></i><i></i><i></i></span>{/if}
              </div>
              {#if streamingStartTs}<div class="cb-msg-meta">{formatTime(streamingStartTs)}</div>{/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="cb-composer-area">
        {#if showSuggestions && suggestions.length > 0}
          <div class="cb-suggestions" role="listbox" aria-label="Suggestions">
            {#each suggestions as s, i}
              <button
                type="button"
                class="cb-sugg-row"
                class:active={suggestionIndex === i}
                role="option"
                aria-selected={suggestionIndex === i}
                onmousedown={preventDefault(() => pickSuggestion(s))}
                onmouseenter={() => (suggestionIndex = i)}
              >
                <span class="cb-sugg-kind cb-sugg-kind-{s.kind}" title={s.kind}>
                  {#if s.kind === 'phrase'}
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {:else if s.kind === 'request'}
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  {:else if s.kind === 'collection'}
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
                  {/if}
                </span>
                <span class="cb-sugg-text">
                  <span class="cb-sugg-match">{s.label.slice(0, inputText.length)}</span><span>{s.label.slice(inputText.length)}</span>
                </span>
                <span class="cb-sugg-meta">{s.kind}</span>
              </button>
            {/each}
            <div class="cb-sugg-hint">↑ ↓ to navigate · Tab / Enter to accept · Esc to dismiss</div>
          </div>
        {/if}

        <div class="cb-composer" class:disabled={installedCount === 0}>
          <button
            class="cb-icon-btn ghost"
            onclick={resetConversation}
            disabled={$messages.length === 0 && !$streamingAssistant}
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7"/>
              <path d="M3 4v5h5"/>
            </svg>
          </button>
          <textarea
            bind:this={inputEl}
            bind:value={inputText}
            oninput={onInputChange}
            onkeydown={handleInputKeydown}
            onfocus={() => { if (inputText) showSuggestions = true; }}
            onblur={() => setTimeout(() => (showSuggestions = false), 120)}
            use:autoResize
            placeholder={installedCount > 0
              ? 'Ask the assistant…'
              : 'Download a model in the Models tab first.'}
            rows="1"
            disabled={$isStreaming}
          ></textarea>
        {#if $isStreaming}
          <button class="cb-icon-btn primary stop" onclick={cancel} aria-label="Stop">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1.5"/>
            </svg>
          </button>
        {:else}
          <button
            class="cb-icon-btn primary"
            onclick={() => send()}
            disabled={!inputText.trim() || installedCount === 0}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 19V5"/>
              <path d="M5 12l7-7 7 7"/>
            </svg>
          </button>
        {/if}
        </div>
      </div>
    </div>
  {:else if subTab === 'log'}
    <div class="cb-log">
      <div class="cb-log-header">
        <span class="cb-log-title">Tool calls in this session</span>
        <button class="cb-clear" onclick={clearActionLogHandler} disabled={$actionLog.length === 0}>
          Clear
        </button>
      </div>
      <div class="cb-log-list">
        {#if $actionLog.length === 0}
          <div class="cb-empty-hint">No tools have been executed yet.</div>
        {/if}
        {#each $actionLog as entry}
          <details class="cb-log-entry" class:err={entry.error}>
            <summary>
              <span class="cb-log-tool">{entry.tool}</span>
              {#if entry.error}<span class="cb-log-err-pill">error</span>{/if}
              <span class="cb-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            </summary>
            <div class="cb-log-block">
              <div class="cb-log-sub">arguments</div>
              <pre>{JSON.stringify(entry.arguments, null, 2)}</pre>
              <div class="cb-log-sub">result</div>
              <pre>{JSON.stringify(entry.result, null, 2)}</pre>
            </div>
          </details>
        {/each}
      </div>
    </div>
  {:else if subTab === 'history'}
    <div class="cb-log">
      <div class="cb-log-header">
        <span class="cb-log-title">Saved chats</span>
        <button class="cb-clear" onclick={deleteAllChatsHandler} disabled={$chatHistory.length === 0}>
          Delete all
        </button>
      </div>
      <div class="cb-log-list">
        {#if $chatHistory.length === 0}
          <div class="cb-empty-hint">No saved chats yet. Send a message and your conversation will be saved automatically.</div>
        {/if}
        {#each $chatHistory as row (row.id)}
          <div class="cb-history-row" class:active={$currentSessionId === row.id}>
            <button
              type="button"
              class="cb-history-open"
              onclick={() => openChatHandler(row.id)}
              disabled={$isStreaming}
              title={row.title}
            >
              <div class="cb-history-title">{row.title || 'Untitled chat'}</div>
              <div class="cb-history-meta">
                {row.message_count} {row.message_count === 1 ? 'msg' : 'msgs'} · {formatChatRowDate(row.updated_at)}
              </div>
            </button>
            <button
              type="button"
              class="cb-history-del"
              title="Delete this chat"
              aria-label="Delete chat"
              onclick={(e) => deleteChatHandler(row.id, e)}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="cb-models">
      <div class="cb-models-header">
        <div>
          <div class="cb-models-title">Models</div>
          <div class="cb-models-hint">
            Downloaded to <code>&lt;app data&gt;/ai/models/</code>. Sources: Hugging Face first, Kaggle fallback.
          </div>
        </div>
        <button class="cb-clear" onclick={() => { refreshModels(); refreshStatus(); }}>Refresh</button>
      </div>
      <div class="cb-model-list">
        {#each $availableModels as model}
          {@const installed = $chatbotStatus.installedModelIds.includes(model.id)}
          {@const isActive = $chatbotStatus.activeModelId === model.id}
          {@const progress = $downloadProgress[model.id]}
          {@const isPaused = $pausedDownloads.has(model.id)}
          {@const isDownloading = !!progress && !isPaused && !installed}
          <div class="cb-model" class:active={isActive}>
            <div class="cb-model-head">
              <div class="cb-model-name">{model.displayName}</div>
              <div class="cb-model-size">{formatBytes(model.sizeBytes)}</div>
            </div>
            <div class="cb-model-meta">
              ctx {model.contextSize} · tools {model.supportsTools ? 'yes' : 'no'}
            </div>
            {#if progress && !installed}
              <div class="cb-progress" class:paused={isPaused}>
                <div class="cb-progress-bar" style="width: {progress.total > 0 ? (progress.downloaded / progress.total) * 100 : 0}%"></div>
                <div class="cb-progress-label">
                  {#if isPaused}Paused · {/if}{formatBytes(progress.downloaded)} / {formatBytes(progress.total)}{progress.source ? ` from ${progress.source}` : ''}
                </div>
              </div>
            {/if}
            <div class="cb-model-actions">
              {#if installed && isActive}
                <span class="cb-active-pill">Active</span>
                <button class="cb-btn" onclick={unloadEngine}>Unload</button>
              {:else if installed}
                <button class="cb-btn primary" onclick={() => loadEngine(model.id)}>Load</button>
                <button class="cb-btn danger" onclick={() => deleteModel(model.id)}>Delete</button>
              {:else if isDownloading}
                <button class="cb-btn" onclick={() => pauseDownload(model.id)}>Pause</button>
                <button class="cb-btn danger" onclick={() => cancelDownload(model.id)}>Cancel</button>
              {:else if isPaused}
                <button class="cb-btn primary" onclick={() => resumeDownload(model.id)}>Resume</button>
                <button class="cb-btn danger" onclick={() => cancelDownload(model.id)}>Cancel</button>
              {:else}
                <button class="cb-btn primary" onclick={() => downloadModel(model.id)}>Download</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .chatbot-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    /* Pitch-black canvas. Surfaces stacked on top (toolbar, code blocks,
       composer) are slightly lifted off black with very dark greys + thin
       borders so the depth hierarchy stays readable without leaving the
       black-on-black aesthetic. */
    background: #000;
    color: #f2f3f5;
  }

  /* Surface overrides — keep them lightweight and scoped to the panel
     so they only affect the chatbot, not the rest of the tools modal. */
  .chatbot-panel .cb-toolbar {
    background: #000;
    border-bottom-color: #1a1a1a;
  }
  .chatbot-panel .cb-composer {
    background: #0a0a0a;
    border-color: #1f1f1f;
  }
  .chatbot-panel .cb-msg-assistant .cb-msg-body {
    background: #0a0a0a;
    border-color: #1f1f1f;
  }
  .chatbot-panel :global(.cb-code),
  .chatbot-panel .cb-code-block,
  .chatbot-panel .cb-json-block {
    background: #050505;
    border-color: #1f1f1f;
  }
  .chatbot-panel .cb-code-block .cb-code-header,
  .chatbot-panel .cb-json-block .cb-json-header {
    background: #0a0a0a;
    border-bottom-color: #1f1f1f;
  }
  .chatbot-panel .cb-suggestions {
    background: #0a0a0a;
    border-color: #1f1f1f;
  }
  .chatbot-panel .cb-sugg-hint {
    background: #000;
    border-top-color: #1f1f1f;
  }
  .chatbot-panel .cb-sugg-meta,
  .chatbot-panel .cb-toolbar-btn {
    background: #0a0a0a;
    border-color: #1f1f1f;
  }
  .chatbot-panel .cb-log-entry,
  .chatbot-panel .cb-history-row {
    background: #0a0a0a;
    border-color: #1f1f1f;
  }
  .chatbot-panel .cb-log-block pre {
    background: #050505;
  }

  .cb-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #3f4147);
    gap: 12px;
  }

  .cb-tabs {
    display: flex;
    gap: 4px;
  }

  .cb-tab {
    padding: 5px 14px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text-secondary, #8a94a6);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    transition: all 0.15s;
  }

  .cb-tab.active {
    background: color-mix(in srgb, var(--accent-color, #4d8df6) 14%, transparent);
    color: var(--accent-color, #4d8df6);
    border-color: color-mix(in srgb, var(--accent-color, #4d8df6) 40%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-color, #4d8df6) 18%, transparent) inset;
  }

  .cb-tab:hover:not(.active) {
    color: var(--text-primary, #e6ecf5);
    background: color-mix(in srgb, var(--accent-color, #4d8df6) 6%, transparent);
  }

  .cb-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary, #b5bac1);
  }

  .cb-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .cb-toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color, #3f4147);
    background: var(--bg-secondary, #2b2d31);
    color: var(--text-primary, #f2f3f5);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .cb-toolbar-btn:hover:not(:disabled) {
    background: var(--bg-tertiary, #36373d);
    border-color: var(--accent-color, #5865f2);
    color: var(--accent-color, #5865f2);
  }

  .cb-toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6d6f78;
  }

  .status-dot.ready { background: #57f287; }
  .status-dot.warn { background: #f0b132; }
  .status-dot.off { background: #6d6f78; }

  .status-text {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 11px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Chat tab */
  .cb-chat {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .cb-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .cb-empty {
    margin: auto;
    text-align: center;
    width: 100%;
    max-width: 720px;
    color: var(--text-secondary, #b5bac1);
    padding: 40px 16px;
  }

  .cb-empty-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 8px;
    background: linear-gradient(135deg, #ffffff 0%, var(--accent-color) 110%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .cb-empty-sub {
    font-size: 13px;
    color: var(--text-secondary, #8a94a6);
    margin-bottom: 26px;
    opacity: 0.75;
  }

  /* Hint text in the action-log and history tabs still uses this class. */
  .cb-empty-hint {
    font-size: 13px;
    line-height: 1.6;
  }

  .cb-empty-prompts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
    text-align: left;
  }

  .cb-empty-prompt {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    background: #0a0a0a;
    border: 1px solid #1f1f1f;
    border-radius: 14px;
    padding: 16px 18px;
    font-family: inherit;
    color: var(--text-primary, #f2f3f5);
    cursor: pointer;
    text-align: left;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      transform 0.18s ease,
      box-shadow 0.18s ease;
    animation: cbPromptIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) backwards;
    position: relative;
    overflow: hidden;
  }

  /* Subtle conic-gradient glow that fades in on hover. Positioned behind
     the content so the icon/label/arrow stay crisp. */
  .cb-empty-prompt::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, var(--accent-color) 60%, transparent) 50%, transparent 100%);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
            mask-composite: exclude;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }

  .cb-empty-prompt:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-color) 8%, #050505);
    transform: translateY(-1px);
    box-shadow: 0 10px 28px var(--accent-glow);
  }

  .cb-empty-prompt:hover:not(:disabled)::before {
    opacity: 1;
  }

  .cb-empty-prompt:hover:not(:disabled) .cb-empty-prompt-arrow {
    transform: translateX(2px);
    color: var(--accent-color);
  }

  .cb-empty-prompt:hover:not(:disabled) .cb-empty-prompt-icon {
    background: color-mix(in srgb, var(--accent-color) 22%, transparent);
  }

  .cb-empty-prompt:active:not(:disabled) {
    transform: translateY(0);
  }

  .cb-empty-prompt:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .cb-empty-prompt-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent-color) 13%, transparent);
    color: var(--accent-color);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.18s ease;
  }

  .cb-empty-prompt-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .cb-empty-prompt-label {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary, #f2f3f5);
    line-height: 1.3;
  }

  .cb-empty-prompt-sub {
    font-size: 12px;
    color: var(--text-secondary, #8a94a6);
    line-height: 1.45;
    opacity: 0.8;
  }

  .cb-empty-prompt-arrow {
    flex-shrink: 0;
    color: var(--text-secondary, #8a94a6);
    opacity: 0.5;
    align-self: center;
    transition: transform 0.18s ease, color 0.18s ease, opacity 0.18s ease;
  }

  .cb-empty-prompt:hover:not(:disabled) .cb-empty-prompt-arrow {
    opacity: 1;
  }

  @keyframes cbPromptIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Messages use a responsive readable column.
     - On narrow panels: fills the available width (max-width yields to
       width: 100%), so no awkward gutters next to the full-width toolbar.
     - On wide panels: caps at a comfortable reading width so lines don't
       stretch unreadably. Fullscreen mode below removes the cap entirely. */
  .cb-msg {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
    animation: cb-msg-in 0.18s ease-out both;
  }

  /* Fullscreen mode: use the full viewport width. No artificial column
     cap — the user explicitly went fullscreen, they want the screen
     real estate. Horizontal padding on the message list provides the
     only breathing room. */
  .chatbot-panel.fullscreen .cb-messages {
    padding-left: 32px;
    padding-right: 32px;
  }
  .chatbot-panel.fullscreen .cb-msg {
    max-width: none;
  }
  .chatbot-panel.fullscreen .cb-composer {
    margin-left: 32px;
    margin-right: 32px;
  }
  .chatbot-panel.fullscreen .cb-suggestions {
    left: 32px;
    right: 32px;
  }
  .chatbot-panel.fullscreen .cb-empty {
    max-width: 720px;
  }

  @keyframes cb-msg-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .cb-msg-user {
    flex-direction: row-reverse;
  }

  .cb-avatar {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    background: var(--bg-tertiary, #2b2d31);
    color: var(--text-primary, #f2f3f5);
    border: 1px solid var(--border-color, #3f4147);
    user-select: none;
  }

  .cb-msg-user .cb-avatar {
    background: var(--accent-color, #5865f2);
    color: white;
    border-color: transparent;
  }

  .cb-bubble-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: calc(100% - 38px);
  }

  .cb-msg-user .cb-bubble-wrap {
    align-items: flex-end;
  }

  .cb-msg-body {
    padding: 10px 14px;
    border-radius: 16px;
    background: var(--bg-tertiary, #2b2d31);
    border: 1px solid var(--border-color, #3f4147);
    color: var(--text-primary, #f2f3f5);
    font-size: 13.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .cb-msg-assistant .cb-msg-body {
    border-top-left-radius: 4px;
  }

  .cb-msg-user .cb-msg-body {
    background: var(--accent-color, #5865f2);
    color: white;
    border-color: transparent;
    border-top-right-radius: 4px;
  }

  /* Markdown elements inside assistant bubbles. We keep the bubble's
     pre-wrap behavior but reset margins on inline elements introduced
     by renderChatMarkdown so they don't double-space the text. */
  .cb-msg-body :global(strong) {
    font-weight: 600;
    color: var(--text-primary, #f2f3f5);
  }

  .cb-msg-body :global(.cb-code-inline) {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12.5px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color, #3f4147);
    padding: 1px 5px;
    border-radius: 4px;
    word-break: break-all;
  }

  /* Shared between template-rendered code blocks (final assistant bubbles)
     and HTML injected by renderChatMarkdown (the in-flight streaming bubble).
     We use :global() so the same rule covers both. */
  .cb-msg-body :global(.cb-code) {
    margin: 6px 0;
    padding: 10px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 8px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre;
    color: #e3e5e8;
  }

  .cb-msg-body :global(.cb-code code) {
    background: transparent;
    border: none;
    padding: 0;
    font-size: inherit;
    color: inherit;
  }

  /* Inside the structured code/JSON wrappers we strip the standalone
     margin/border so the pre slots cleanly under the header bar. */
  .cb-code-block .cb-code,
  .cb-json-block .cb-code {
    margin: 0;
    border: none;
    border-radius: 0;
  }

  .cb-seg-text {
    /* Inline text segments preserve newlines but don't add their own margin —
       the surrounding markdown decides spacing via blank-line gaps. */
    white-space: pre-wrap;
  }

  /* Plain (non-JSON) code blocks: top bar with language label + copy button. */
  .cb-code-block {
    margin: 6px 0;
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-secondary);
  }
  .cb-code-block .cb-code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 4px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color, #3f4147);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary, #b5bac1);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }
  /* Structured JSON viewer with per-field copy. */
  .cb-json-block {
    margin: 6px 0;
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-secondary);
  }
  .cb-json-block .cb-json-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 4px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color, #3f4147);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary, #b5bac1);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }
  .cb-json-block .cb-json-rows {
    display: flex;
    flex-direction: column;
  }
  .cb-json-block .cb-json-row {
    display: grid;
    grid-template-columns: minmax(120px, auto) 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 6px 10px 6px 12px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 12.5px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }
  .cb-json-block .cb-json-row:first-child {
    border-top: none;
  }
  .cb-json-block .cb-json-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .cb-json-block .cb-json-key {
    color: #c9b3ff;
    font-weight: 500;
    white-space: nowrap;
  }
  .cb-json-block .cb-json-val {
    color: #e3e5e8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .cb-msg-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
    /* Reveal the copy affordance on hover for a cleaner default state, but
       always leave it accessible to keyboard focus via :focus-within. */
    opacity: 0.55;
    transition: opacity 0.12s;
  }
  .cb-msg:hover .cb-msg-foot,
  .cb-msg-foot:focus-within {
    opacity: 1;
  }
  .cb-msg-user .cb-msg-foot {
    flex-direction: row-reverse;
  }

  .cb-msg-meta {
    font-size: 10px;
    color: var(--text-secondary, #b5bac1);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }

  .cb-copy-btn {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--text-secondary, #b5bac1);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .cb-copy-btn:hover {
    background: var(--bg-tertiary, #36373d);
    border-color: var(--border-color, #3f4147);
    color: var(--text-primary, #f2f3f5);
  }
  .cb-copy-btn.done {
    color: #57f287;
  }

  .cb-typing {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
  }

  .cb-typing i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-secondary, #b5bac1);
    opacity: 0.4;
    animation: cb-typing-bounce 1.2s ease-in-out infinite;
  }

  .cb-typing i:nth-child(2) { animation-delay: 0.15s; }
  .cb-typing i:nth-child(3) { animation-delay: 0.3s; }

  @keyframes cb-typing-bounce {
    0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
    30%           { opacity: 1; transform: translateY(-3px); }
  }

  /* Composer area = suggestion dropdown (floats above) + composer.
     Position: relative so the dropdown can anchor to its bottom edge. */
  .cb-composer-area {
    position: relative;
  }

  .cb-suggestions {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(100% - 4px);
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    z-index: 20;
    display: flex;
    flex-direction: column;
    max-height: 340px;
  }

  .cb-sugg-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--text-primary, #f2f3f5);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .cb-sugg-row.active,
  .cb-sugg-row:hover {
    background: rgba(88, 101, 242, 0.16);
  }

  .cb-sugg-kind {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    color: var(--text-secondary, #b5bac1);
  }
  .cb-sugg-kind-phrase { color: #c9b3ff; }
  .cb-sugg-kind-request { color: #57f287; }
  .cb-sugg-kind-collection { color: #f0b132; }
  .cb-sugg-kind-template { color: #5865f2; }

  .cb-sugg-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cb-sugg-match {
    color: var(--accent-color, #5865f2);
    font-weight: 600;
  }

  .cb-sugg-meta {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-secondary, #b5bac1);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--bg-tertiary, #36373d);
  }

  .cb-sugg-hint {
    padding: 6px 12px;
    font-size: 10.5px;
    color: var(--text-secondary, #b5bac1);
    background: var(--bg-tertiary, #2b2d31);
    border-top: 1px solid var(--border-color, #3f4147);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }

  .cb-composer {
    margin: 12px 16px 16px;
    padding: 6px 6px 6px 8px;
    display: flex;
    align-items: flex-end;
    gap: 6px;
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 22px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .cb-composer:focus-within {
    border-color: var(--accent-color, #5865f2);
    box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.18);
  }

  .cb-composer textarea {
    flex: 1;
    min-height: 32px;
    max-height: 200px;
    padding: 8px 4px;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    color: var(--text-primary, #f2f3f5);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    box-sizing: border-box;
  }

  .cb-composer textarea::placeholder {
    color: var(--text-secondary, #b5bac1);
    opacity: 0.7;
  }

  .cb-icon-btn {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--text-secondary, #b5bac1);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.05s, filter 0.15s;
  }

  .cb-icon-btn.ghost:hover:not(:disabled) {
    background: var(--bg-tertiary, #2b2d31);
    color: var(--text-primary, #f2f3f5);
  }

  .cb-icon-btn.primary {
    background: var(--accent-color, #5865f2);
    color: white;
  }

  .cb-icon-btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .cb-icon-btn.primary:active:not(:disabled) {
    transform: scale(0.96);
  }

  .cb-icon-btn.primary.stop {
    background: #f04747;
  }

  .cb-icon-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* Small ghost text button — used by Action Log "Clear" and Models "Refresh". */
  .cb-clear {
    margin-left: auto;
    padding: 2px 10px;
    background: transparent;
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 3px;
    color: var(--text-secondary, #b5bac1);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .cb-clear:hover:not(:disabled) {
    background: var(--bg-tertiary, #2b2d31);
    color: var(--text-primary, #f2f3f5);
  }

  .cb-clear:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Action log tab */
  .cb-log {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .cb-log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-color, #3f4147);
  }

  .cb-log-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #f2f3f5);
  }

  .cb-log-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cb-log-entry {
    background: var(--bg-primary, #1e1f22);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 4px;
    padding: 6px 10px;
  }

  .cb-log-entry.err {
    border-color: rgba(240, 71, 71, 0.3);
  }

  .cb-log-entry summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--text-primary, #f2f3f5);
  }

  .cb-log-tool {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-weight: 600;
  }

  .cb-log-err-pill {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(240, 71, 71, 0.15);
    color: #f04747;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .cb-log-time {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-secondary, #b5bac1);
  }

  .cb-log-block {
    margin-top: 8px;
  }

  .cb-log-sub {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary, #b5bac1);
    margin-top: 6px;
    margin-bottom: 3px;
  }

  .cb-log-block pre {
    background: var(--bg-tertiary, #2b2d31);
    border-radius: 4px;
    padding: 6px 8px;
    margin: 0;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-primary, #f2f3f5);
    overflow-x: auto;
    max-height: 220px;
  }

  /* History tab */
  .cb-history-row {
    display: flex;
    align-items: stretch;
    gap: 0;
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 8px;
    background: var(--bg-secondary, #2b2d31);
    overflow: hidden;
    transition: border-color 0.12s, background 0.12s;
  }
  .cb-history-row:hover {
    border-color: var(--accent-color, #5865f2);
    background: var(--bg-tertiary, #36373d);
  }
  .cb-history-row.active {
    border-color: var(--accent-color, #5865f2);
    background: rgba(88, 101, 242, 0.12);
  }

  .cb-history-open {
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 10px 12px;
    border: none;
    background: transparent;
    color: var(--text-primary, #f2f3f5);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cb-history-open:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .cb-history-title {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cb-history-meta {
    font-size: 11px;
    color: var(--text-secondary, #b5bac1);
  }

  .cb-history-del {
    flex-shrink: 0;
    width: 36px;
    display: grid;
    place-items: center;
    border: none;
    border-left: 1px solid var(--border-color, #3f4147);
    background: transparent;
    color: var(--text-secondary, #b5bac1);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .cb-history-del:hover {
    background: rgba(237, 66, 69, 0.15);
    color: #ed4245;
  }

  /* Models tab */
  .cb-models {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .cb-models-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color, #3f4147);
    gap: 12px;
  }

  .cb-models-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #f2f3f5);
  }

  .cb-models-hint {
    font-size: 11px;
    color: var(--text-secondary, #b5bac1);
    margin-top: 2px;
  }

  .cb-models-hint code {
    background: var(--bg-tertiary, #2b2d31);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 10px;
  }

  .cb-model-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cb-model {
    background: var(--bg-primary, #1e1f22);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cb-model.active {
    border-color: var(--accent-color, #5865f2);
  }

  .cb-model-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }

  .cb-model-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #f2f3f5);
  }

  .cb-model-size {
    font-size: 11px;
    color: var(--text-secondary, #b5bac1);
  }

  .cb-model-meta {
    font-size: 11px;
    color: var(--text-secondary, #b5bac1);
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }

  .cb-progress {
    position: relative;
    height: 18px;
    background: var(--bg-tertiary, #2b2d31);
    border-radius: 3px;
    overflow: hidden;
  }

  .cb-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-color, #5865f2);
    opacity: 0.35;
    transition: width 0.2s ease;
  }

  .cb-progress.paused .cb-progress-bar {
    background: #f0b132;
    opacity: 0.5;
  }

  .cb-progress-label {
    position: relative;
    z-index: 1;
    font-size: 10px;
    color: var(--text-primary, #f2f3f5);
    text-align: center;
    line-height: 18px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }

  .cb-model-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .cb-btn {
    padding: 4px 12px;
    background: transparent;
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 3px;
    color: var(--text-secondary, #b5bac1);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .cb-btn:hover:not(:disabled) {
    background: var(--bg-tertiary, #2b2d31);
    color: var(--text-primary, #f2f3f5);
  }

  .cb-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .cb-btn.primary {
    background: var(--accent-color, #5865f2);
    color: white;
    border-color: var(--accent-color, #5865f2);
  }

  .cb-btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .cb-btn.danger {
    color: #f04747;
    border-color: rgba(240, 71, 71, 0.3);
  }

  .cb-btn.danger:hover:not(:disabled) {
    background: rgba(240, 71, 71, 0.1);
  }

  .cb-active-pill {
    font-size: 10px;
    padding: 2px 8px;
    background: rgba(87, 242, 135, 0.15);
    color: #57f287;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }
</style>
