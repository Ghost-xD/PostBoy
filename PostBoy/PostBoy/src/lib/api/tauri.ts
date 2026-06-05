import { invoke } from '@tauri-apps/api/core';

// Database API wrapper
export const db = {
  getCollections: async () => {
    return await invoke('db_get_collections');
  },
  createCollection: async (name: string, description: string) => {
    return await invoke('db_create_collection', { name, description });
  },
  getCollection: async (id: number) => {
    return await invoke('db_get_collection', { id });
  },
  updateCollection: async (id: number, name: string, description: string) => {
    return await invoke('db_update_collection', { id, name, description });
  },
  deleteCollection: async (id: number) => {
    return await invoke('db_delete_collection', { id });
  },
  getRequests: async (collectionId: number) => {
    return await invoke('db_get_requests', { collectionId });
  },
  createRequest: async (collectionId: number | null, requestData: any) => {
    return await invoke('db_create_request', { collectionId, requestData });
  },
  getRequest: async (id: number) => {
    return await invoke('db_get_request', { id });
  },
  updateRequest: async (id: number, requestData: any) => {
    return await invoke('db_update_request', { id, requestData });
  },
  deleteRequest: async (id: number) => {
    return await invoke('db_delete_request', { id });
  },
  getHistory: async (limit?: number) => {
    return await invoke('db_get_history', { limit });
  },
  addHistory: async (requestData: any, responseData: any) => {
    return await invoke('db_add_history', { requestData, responseData });
  },
  deleteHistory: async (id: number) => {
    return await invoke('db_delete_history', { id });
  },
  clearHistory: async () => {
    return await invoke('db_clear_history');
  },
  setSetting: async (key: string, value: any) => {
    return await invoke('db_set_setting', { key, value });
  },
  getSetting: async (key: string, defaultValue?: any) => {
    return await invoke('db_get_setting', { key, defaultValue });
  },
  getAllSettings: async () => {
    return await invoke('db_get_all_settings');
  },
  exportCollections: async (collectionIds: number[] | null, format: string) => {
    return await invoke('db_export_collections', { collectionIds, format });
  },
  importCollections: async (importData: string, overwrite: boolean) => {
    return await invoke('db_import_collections', { importData, overwrite });
  },
  getVariables: async (collectionId: number) => {
    return await invoke('db_get_variables', { collectionId });
  },
  setVariable: async (collectionId: number, key: string, value: string) => {
    return await invoke('db_set_variable', { collectionId, key, value });
  },
  deleteVariable: async (collectionId: number, key: string) => {
    return await invoke('db_delete_variable', { collectionId, key });
  },
  clearVariables: async (collectionId: number) => {
    return await invoke('db_clear_variables', { collectionId });
  },
  renameCollection: async (id: number, name: string) => {
    return await invoke('db_rename_collection', { id, name });
  },
  renameRequest: async (id: number, name: string) => {
    return await invoke('db_rename_request', { id, name });
  },
  reorderRequests: async (requestIds: number[]) => {
    return await invoke('db_reorder_requests', { requestIds });
  },
  moveRequest: async (requestId: number, targetCollectionId: number) => {
    return await invoke('db_move_request', { requestId, targetCollectionId });
  },
  exportSingleCollection: async (collectionId: number): Promise<string> => {
    return await invoke('db_export_single_collection', { collectionId }) as string;
  },
  importSingleCollection: async (jsonData: string): Promise<number> => {
    return await invoke('db_import_single_collection', { jsonData }) as number;
  },
  createFolder: async (name: string, parentId: number | null): Promise<number> => {
    return await invoke('db_create_folder', { name, parentId }) as number;
  },
  moveCollection: async (id: number, parentId: number | null) => {
    return await invoke('db_move_collection', { id, parentId });
  },
  getCookies: async (collectionId: number) => {
    return await invoke('db_get_cookies', { collectionId });
  },
  getCookiesForUrl: async (collectionId: number, url: string) => {
    return await invoke('db_get_cookies_for_url', { collectionId, url });
  },
  setCookie: async (collectionId: number, cookie: { domain: string; path: string; name: string; value: string; expires?: string | null; secure: boolean; httpOnly: boolean; sameSite?: string }) => {
    return await invoke('db_set_cookie', {
      collectionId,
      domain: cookie.domain,
      path: cookie.path,
      name: cookie.name,
      value: cookie.value,
      expires: cookie.expires ?? null,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite ?? 'Lax',
    });
  },
  deleteCookie: async (collectionId: number, cookieId: number) => {
    return await invoke('db_delete_cookie', { collectionId, cookieId });
  },
  clearCookies: async (collectionId: number) => {
    return await invoke('db_clear_cookies', { collectionId });
  },
  clearAllCookies: async () => {
    return await invoke('db_clear_all_cookies');
  },
};

// File operations
export const fileOps = {
  showSaveDialog: async (options: any) => {
    return await invoke('show_save_dialog', { options });
  },
  showOpenDialog: async (options: any) => {
    return await invoke('show_open_dialog', { options });
  },
  writeFile: async (filePath: string, data: string) => {
    return await invoke('write_file', { filePath, data });
  },
  readFile: async (filePath: string) => {
    return await invoke('read_file', { filePath });
  },
  readFileBase64: async (filePath: string): Promise<{ name: string; size: number; base64: string }> => {
    return await invoke('read_file_base64', { filePath }) as { name: string; size: number; base64: string };
  }
};

// App operations
export const app = {
  getVersion: async () => {
    return await invoke('get_version');
  }
};

// HTTP client
export const http = {
  executeRequest: async (
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: string,
    options?: { timeout?: number; proxyUrl?: string; sslVerification?: boolean; followRedirects?: boolean; maxRedirects?: number }
  ) => {
    return await invoke('execute_http_request', {
      method, url, headers, body,
      timeoutSecs: options?.timeout,
      proxyUrl: options?.proxyUrl,
      sslVerify: options?.sslVerification,
      followRedirects: options?.followRedirects,
      maxRedirects: options?.maxRedirects,
    });
  }
};

// SQL client
export interface SqlHistoryEntry {
  id: number;
  sql: string;
  executionTimeMs: number;
  rowCount: number;
  error: string | null;
  executedAt: number;
}

export const sql = {
  connect: async (dbType: string, host: string, port: number, database: string, username: string, password: string): Promise<string> => {
    return await invoke('sql_connect', { dbType, host, port, database, username, password }) as string;
  },
  query: async (connectionId: string, sql: string): Promise<any> => {
    return await invoke('sql_query', { connectionId, sql });
  },
  disconnect: async (connectionId: string) => {
    return await invoke('sql_disconnect', { connectionId });
  },
  historyAdd: async (
    profileKey: string,
    dbType: string,
    sql: string,
    executionTimeMs: number,
    rowCount: number,
    error: string | null,
  ): Promise<number> => {
    return await invoke('sql_history_add', {
      profileKey, dbType, sql, executionTimeMs, rowCount, error,
    }) as number;
  },
  historyList: async (profileKey: string, limit?: number): Promise<SqlHistoryEntry[]> => {
    return await invoke('sql_history_list', { profileKey, limit }) as SqlHistoryEntry[];
  },
  historyClear: async (profileKey: string): Promise<void> => {
    await invoke('sql_history_clear', { profileKey });
  },
  historyDelete: async (id: number): Promise<void> => {
    await invoke('sql_history_delete', { id });
  },
};

// Network diagnostics
export const net = {
  dnsResolve: async (hostname: string): Promise<{ hostname: string; addresses: string[]; duration_ms: number }> => {
    return await invoke('dns_resolve', { hostname }) as any;
  },
  portCheck: async (host: string, port: number, timeoutSecs?: number): Promise<{ host: string; port: number; open: boolean; duration_ms: number; error: string | null }> => {
    return await invoke('port_check', { host, port, timeoutSecs: timeoutSecs ?? 5 }) as any;
  },
  pingHost: async (host: string): Promise<{ host: string; ip: string; reachable: boolean; latency_ms: number | null; error: string | null }> => {
    return await invoke('ping_host', { host }) as any;
  },
  traceRoute: async (host: string): Promise<{ target: string; hops: Array<{ hop: number; ip: string | null; hostname: string | null; latency_ms: number | null; timed_out: boolean }>; duration_ms: number }> => {
    return await invoke('trace_route', { host }) as any;
  },
};

// SSE client
export const sse = {
  connect: async (id: string, url: string, headers?: Record<string, string>, autoReconnect?: boolean) => {
    return await invoke('sse_connect', { id, url, headers, autoReconnect });
  },
  disconnect: async (id: string) => {
    return await invoke('sse_disconnect', { id });
  }
};

// AI Chatbot — every command requires the `chatbot` Cargo feature except
// `aiSupported` which is always compiled.
export const ai = {
  isSupported: async (): Promise<boolean> => {
    try {
      return (await invoke('ai_supported')) as boolean;
    } catch {
      return false;
    }
  },
  getStatus: async (): Promise<{ supported: boolean; engine_loaded: boolean; active_model_id: string | null; installed_model_ids: string[] }> => {
    return (await invoke('ai_get_status')) as any;
  },
  listModels: async (): Promise<{ schemaVersion: number; models: Array<{ id: string; displayName: string; filename: string; sizeBytes: number; sha256: string | null; contextSize: number; recommendedThreads: number | null; supportsTools: boolean; toolCallStyle: string; downloads: Array<{ source: string; url: string }> }> }> => {
    return (await invoke('ai_list_models')) as any;
  },
  listInstalled: async (): Promise<Array<{ id: string; path: string; size_bytes: number }>> => {
    return (await invoke('ai_list_installed')) as any;
  },
  downloadModel: async (modelId: string): Promise<string> => {
    return (await invoke('ai_download_model', { modelId })) as string;
  },
  cancelDownload: async (modelId: string): Promise<void> => {
    return (await invoke('ai_cancel_download', { modelId })) as void;
  },
  pauseDownload: async (modelId: string): Promise<void> => {
    return (await invoke('ai_pause_download', { modelId })) as void;
  },
  resumeDownload: async (modelId: string): Promise<string> => {
    return (await invoke('ai_resume_download', { modelId })) as string;
  },
  deleteModel: async (modelId: string): Promise<void> => {
    return (await invoke('ai_delete_model', { modelId })) as void;
  },
  loadEngine: async (modelId: string, threads?: number, ctxSize?: number): Promise<void> => {
    return (await invoke('ai_load_engine', { modelId, threads, ctxSize })) as void;
  },
  unloadEngine: async (): Promise<void> => {
    return (await invoke('ai_unload_engine')) as void;
  },
  chatSend: async (
    messages: Array<{ role: string; content: string }>,
    opts?: { systemPrompt?: string; maxTokens?: number }
  ): Promise<string> => {
    return (await invoke('ai_chat_send', {
      messages,
      systemPrompt: opts?.systemPrompt,
      maxTokens: opts?.maxTokens,
    })) as string;
  },
  /**
   * Raw `system + user → text` completion. Bypasses the chatbot tool-calling
   * loop (no tool definitions injected, no `<tool_call>`/`{` hold-back, no
   * deterministic intercepts), so callers like Load Test plan/analysis get
   * the model's verbatim output.
   */
  complete: async (
    prompt: string,
    opts?: { systemPrompt?: string; maxTokens?: number }
  ): Promise<string> => {
    return (await invoke('ai_complete_text', {
      prompt,
      systemPrompt: opts?.systemPrompt,
      maxTokens: opts?.maxTokens,
    })) as string;
  },
  chatCancel: async (): Promise<void> => {
    return (await invoke('ai_chat_cancel')) as void;
  },
  getActionLog: async (): Promise<Array<{ timestamp: string; tool: string; arguments: any; result: any; error: string | null }>> => {
    return (await invoke('ai_get_action_log')) as any;
  },
  clearActionLog: async (): Promise<void> => {
    return (await invoke('ai_clear_action_log')) as void;
  },

  // Chat history
  listChats: async (): Promise<Array<{ id: number; title: string; created_at: string; updated_at: string; message_count: number }>> => {
    return (await invoke('ai_list_chats')) as any;
  },
  getChat: async (sessionId: number): Promise<{ id: number; title: string; messages: Array<{ role: string; content: string; timestamp: number }> }> => {
    return (await invoke('ai_get_chat', { sessionId })) as any;
  },
  saveChat: async (sessionId: number | null, title: string, messages: Array<{ role: string; content: string; timestamp: number }>): Promise<number> => {
    return (await invoke('ai_save_chat', { sessionId, title, messages })) as number;
  },
  deleteChat: async (sessionId: number): Promise<void> => {
    return (await invoke('ai_delete_chat', { sessionId })) as void;
  },
  deleteAllChats: async (): Promise<void> => {
    return (await invoke('ai_delete_all_chats')) as void;
  },

  // Composer autocomplete: returns the bundle of past user phrases + saved
  // request/collection names. The frontend builds a typeahead off this.
  getSuggestionCorpus: async (): Promise<{
    phrases: Array<{ text: string; frequency: number }>;
    requests: Array<{ name: string; collection: string | null }>;
    collections: string[];
  }> => {
    return (await invoke('ai_get_suggestion_corpus')) as any;
  },
};

// Load Test engine — Rust-side concurrency, streams `loadtest-progress` and
// `loadtest-done` Tauri events. The frontend should listen via
// `@tauri-apps/api/event#listen` before calling `start`.
export const loadTest = {
  start: async (plan: any): Promise<void> => {
    return (await invoke('load_test_start', { plan })) as void;
  },
  cancel: async (): Promise<void> => {
    return (await invoke('load_test_cancel')) as void;
  },
  running: async (): Promise<boolean> => {
    return (await invoke('load_test_running')) as boolean;
  },
};

// WebSocket client
export const ws = {
  connect: async (id: string, url: string, headers?: Record<string, string>) => {
    return await invoke('ws_connect', { id, url, headers });
  },
  send: async (id: string, message: string) => {
    return await invoke('ws_send', { id, message });
  },
  disconnect: async (id: string) => {
    return await invoke('ws_disconnect', { id });
  }
};
