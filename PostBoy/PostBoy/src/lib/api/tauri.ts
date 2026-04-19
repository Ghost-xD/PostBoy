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
export const sql = {
  connect: async (dbType: string, host: string, port: number, database: string, username: string, password: string): Promise<string> => {
    return await invoke('sql_connect', { dbType, host, port, database, username, password }) as string;
  },
  query: async (connectionId: string, sql: string): Promise<any> => {
    return await invoke('sql_query', { connectionId, sql });
  },
  disconnect: async (connectionId: string) => {
    return await invoke('sql_disconnect', { connectionId });
  }
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
