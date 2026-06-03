import { writable, get } from 'svelte/store';
import { ai } from '$lib/api/tauri';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Epoch ms; assigned when the message is added to the conversation. */
  timestamp: number;
}

export interface ActionLogEntry {
  timestamp: string;
  tool: string;
  arguments: any;
  result: any;
  error: string | null;
}

export interface ModelEntry {
  id: string;
  displayName: string;
  filename: string;
  sizeBytes: number;
  contextSize: number;
  supportsTools: boolean;
  downloads: Array<{ source: string; url: string }>;
}

export interface ChatbotStatus {
  supported: boolean;
  engineLoaded: boolean;
  activeModelId: string | null;
  installedModelIds: string[];
}

const DEFAULT_STATUS: ChatbotStatus = {
  supported: false,
  engineLoaded: false,
  activeModelId: null,
  installedModelIds: [],
};

export const chatbotSupported = writable<boolean | null>(null);
export const chatbotStatus = writable<ChatbotStatus>(DEFAULT_STATUS);
export const messages = writable<ChatMessage[]>([]);
export const streamingAssistant = writable<string>('');
export const isStreaming = writable<boolean>(false);
export const actionLog = writable<ActionLogEntry[]>([]);
export const availableModels = writable<ModelEntry[]>([]);

// Downloads currently in flight, keyed by model id. Value is bytes downloaded
// out of total. (Tauri emits source name + downloaded/total.)
export const downloadProgress = writable<Record<string, { downloaded: number; total: number; source: string }>>({});

// Models that are currently paused mid-download. Keyed by model id.
export const pausedDownloads = writable<Set<string>>(new Set());

// Chat-history sessions persisted in `ripple.db` (table `chat_sessions`).
export interface ChatSessionSummary {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}
export const chatHistory = writable<ChatSessionSummary[]>([]);

// Id of the session the live `messages` array is bound to. `null` until the
// user sends the first message of a fresh chat (at which point a row is
// created and the id is recorded here).
export const currentSessionId = writable<number | null>(null);

export async function refreshStatus() {
  try {
    const s = await ai.getStatus();
    chatbotStatus.set({
      supported: s.supported,
      engineLoaded: s.engine_loaded,
      activeModelId: s.active_model_id,
      installedModelIds: s.installed_model_ids,
    });
  } catch {
    chatbotStatus.set(DEFAULT_STATUS);
  }
}

export async function refreshModels() {
  try {
    const r = await ai.listModels();
    availableModels.set(r.models as any);
  } catch {
    availableModels.set([]);
  }
}

export async function refreshActionLog() {
  try {
    actionLog.set(await ai.getActionLog());
  } catch {
    actionLog.set([]);
  }
}

export async function initChatbotFeature() {
  if (get(chatbotSupported) !== null) return;
  const ok = await ai.isSupported();
  chatbotSupported.set(ok);
  if (ok) {
    await refreshStatus();
    await refreshModels();
    // Fire-and-forget: kick off the default model load in the background as
    // soon as we know the feature is supported and a model is installed.
    // The Rust side dispatches model loading onto `tokio::task::spawn_blocking`,
    // so the heavy native work never touches the JS event loop or blocks the
    // Tauri runtime. The user can interact with the rest of the app while
    // the engine warms up; the chatbot panel observes `chatbotStatus`
    // and unblocks the composer once `engineLoaded` flips to true.
    void loadDefaultModel().then((res) => {
      if (res.kind === 'error') {
        // Surface a quiet console message; we don't want a toast on every
        // launch when e.g. the user simply hasn't downloaded a model yet.
        // eslint-disable-next-line no-console
        console.warn(`[chatbot] background load failed: ${res.message}`);
      }
    });
  }
}

/**
 * Mark the chatbot feature as not-supported from the JS side and unload any
 * llama-cpp engine the process is currently holding. Used when the user
 * disables Anton via Settings: we want immediate RAM reclamation, not a
 * "reload to apply" toast. `initChatbotFeature` will re-run from scratch
 * if the user toggles it back on (we reset the supported sentinel so the
 * guard at the top of init lets us back in).
 */
export async function teardownChatbotFeature() {
  chatbotSupported.set(null);
  chatbotStatus.set(DEFAULT_STATUS);
  resetConversation();
  try {
    await ai.unloadEngine();
  } catch {
    // unload is best-effort; if the engine was never loaded the call
    // succeeds anyway, and any other failure shouldn't block the toggle.
  }
}

export function resetConversation() {
  messages.set([]);
  streamingAssistant.set('');
  isStreaming.set(false);
  currentSessionId.set(null);
}

// ---------------------------------------------------------------------------
// Chat history persistence
// ---------------------------------------------------------------------------

function deriveTitle(msgs: ChatMessage[]): string {
  const firstUser = msgs.find((m) => m.role === 'user');
  if (!firstUser) return 'New chat';
  const t = firstUser.content.trim().replace(/\s+/g, ' ');
  return t.length > 60 ? t.slice(0, 57) + '…' : t || 'New chat';
}

export async function refreshHistory() {
  try {
    chatHistory.set(await ai.listChats());
  } catch {
    chatHistory.set([]);
  }
}

/**
 * Persist the current `messages` array to SQLite. Called automatically after
 * each completed assistant turn (see ChatbotPanel.finalizeAssistant). Creates
 * a new session row on first save and remembers its id in
 * `currentSessionId` for subsequent upserts.
 */
export async function saveCurrentChat(): Promise<void> {
  const msgs = get(messages);
  if (msgs.length === 0) return;
  const sid = get(currentSessionId);
  const id = await ai.saveChat(sid, deriveTitle(msgs), msgs.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
  })));
  if (sid === null) currentSessionId.set(id);
  // Refresh the sidebar so the new/updated row bubbles to the top.
  void refreshHistory();
}

/** Replace the live conversation with the saved session. */
export async function loadChat(sessionId: number): Promise<void> {
  const detail = await ai.getChat(sessionId);
  messages.set(
    detail.messages.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
      timestamp: m.timestamp,
    })),
  );
  streamingAssistant.set('');
  isStreaming.set(false);
  currentSessionId.set(detail.id);
}

/** Wipe the live conversation without touching SQLite. Use for "New chat". */
export function newChat() {
  messages.set([]);
  streamingAssistant.set('');
  isStreaming.set(false);
  currentSessionId.set(null);
}

export async function deleteChat(sessionId: number): Promise<void> {
  await ai.deleteChat(sessionId);
  if (get(currentSessionId) === sessionId) newChat();
  await refreshHistory();
}

export async function deleteAllChats(): Promise<void> {
  await ai.deleteAllChats();
  newChat();
  await refreshHistory();
}

/** Result of a `loadDefaultModel()` attempt; lets callers surface a toast/log. */
export type LoadDefaultResult =
  | { kind: 'already-loaded'; modelId: string }
  | { kind: 'no-models' }
  | { kind: 'loading'; modelId: string }
  | { kind: 'error'; modelId: string; message: string };

let inflightLoad: Promise<LoadDefaultResult> | null = null;

/**
 * Pick a sensible default model and load it. Idempotent — concurrent calls
 * share the same in-flight promise, so binding this to a keyboard shortcut
 * is safe.
 *
 * Selection rules:
 *   - 0 models installed → `no-models` (caller should prompt the user).
 *   - 1 installed       → that one.
 *   - 2+ installed      → first entry of `availableModels` (registry order =
 *                          our intentional ordering) that is installed.
 */
export function loadDefaultModel(): Promise<LoadDefaultResult> {
  if (inflightLoad) return inflightLoad;

  const status = get(chatbotStatus);
  if (status.engineLoaded && status.activeModelId) {
    return Promise.resolve({ kind: 'already-loaded', modelId: status.activeModelId });
  }

  const installed = status.installedModelIds;
  if (installed.length === 0) {
    return Promise.resolve({ kind: 'no-models' });
  }

  const registryOrder = get(availableModels).map((m) => m.id);
  const modelId =
    installed.length === 1
      ? installed[0]
      : registryOrder.find((id) => installed.includes(id)) ?? installed[0];

  inflightLoad = (async () => {
    try {
      await ai.loadEngine(modelId);
      await refreshStatus();
      return { kind: 'loading', modelId } as const;
    } catch (e: any) {
      return {
        kind: 'error',
        modelId,
        message: e?.message ?? String(e),
      } as const;
    } finally {
      inflightLoad = null;
    }
  })();

  return inflightLoad;
}
