import { writable, get, derived } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import {
  mcp,
  type McpServerView,
  type McpServerInput,
  type McpConnectionStatus,
} from '$lib/api/tauri';

/**
 * Tiny snapshot of the MCP backend, mirrored client-side. Reactive consumers
 * (the panel, the chat composer) subscribe to these stores rather than
 * polling — the Rust side emits `mcp-status` events whenever a connection
 * changes and we just patch the relevant entry.
 */
export const mcpServers = writable<McpServerView[]>([]);
export const mcpToolCap = writable<{ cap: number; defaultCap: number }>({
  cap: 40,
  defaultCap: 40,
});
export const mcpReady = writable<boolean>(false);

/** Aggregate count of enabled tools across all connected servers, used by
 * the chat panel to render an "MCP: 12 tools" hint and the over-cap
 * warning. We compute it client-side off `mcpServers` so the badge stays
 * in sync without an extra round-trip. */
export const mcpEnabledToolCount = derived(mcpServers, ($servers) =>
  $servers
    .filter((s) => s.config.enabled && isConnected(s.status))
    .reduce((acc, s) => acc + s.tools.filter((t) => t.enabled).length, 0),
);

export function isConnected(status: McpConnectionStatus): boolean {
  return status === 'connected';
}

export function isFailed(status: McpConnectionStatus): { error: string } | null {
  if (typeof status === 'object' && status !== null && 'failed' in status) {
    return status.failed;
  }
  return null;
}

/** Render-friendly text label for the small status dot. */
export function statusLabel(status: McpConnectionStatus): string {
  if (status === 'connected') return 'Connected';
  if (status === 'connecting') return 'Connecting…';
  if (status === 'disconnected') return 'Disconnected';
  return `Failed: ${isFailed(status)?.error ?? 'unknown error'}`;
}

let initialized = false;
let unlisten: (() => void) | null = null;

/**
 * One-time bootstrap. Pulls the persisted server list from Rust and starts
 * listening for `mcp-status` events. Safe to call repeatedly — subsequent
 * calls are no-ops.
 */
export async function initMcpStore(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    await Promise.all([refreshServers(), refreshToolCap()]);
    mcpReady.set(true);
  } catch (e) {
    // Surfacing this as a console warn instead of throwing so a bad MCP
    // table can't brick the entire chat UI on launch.
    // eslint-disable-next-line no-console
    console.warn('[mcp] init failed:', e);
  }

  // Patch the affected row when the backend emits a status update so the
  // panel reflects "Connecting" → "Connected" without re-listing.
  unlisten = await listen<McpServerView>('mcp-status', (event) => {
    const updated = event.payload;
    mcpServers.update((list) => {
      const idx = list.findIndex((s) => s.config.id === updated.config.id);
      if (idx === -1) return [...list, updated];
      const next = [...list];
      next[idx] = updated;
      return next;
    });
  });
}

export async function teardownMcpStore(): Promise<void> {
  initialized = false;
  mcpReady.set(false);
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

export async function refreshServers(): Promise<void> {
  mcpServers.set(await mcp.list());
}

export async function refreshToolCap(): Promise<void> {
  const c = await mcp.getToolCap();
  mcpToolCap.set({ cap: c.cap, defaultCap: c.default_cap });
}

export async function addServer(input: McpServerInput): Promise<McpServerView> {
  const created = await mcp.add(input);
  await refreshServers();
  return created;
}

export async function updateServer(input: McpServerInput): Promise<McpServerView> {
  const updated = await mcp.update(input);
  await refreshServers();
  return updated;
}

export async function deleteServer(id: string): Promise<void> {
  await mcp.delete(id);
  await refreshServers();
}

export async function setServerEnabled(id: string, enabled: boolean): Promise<void> {
  await mcp.setEnabled(id, enabled);
  await refreshServers();
}

export async function setToolEnabled(
  id: string,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  await mcp.setToolEnabled(id, toolName, enabled);
  // Patch in place — calling refreshServers() would also work but blinks the UI.
  mcpServers.update((list) =>
    list.map((s) => {
      if (s.config.id !== id) return s;
      const tools = s.tools.map((t) =>
        t.name === toolName ? { ...t, enabled } : t,
      );
      const tool_overrides = { ...s.config.tool_overrides, [toolName]: enabled };
      return { ...s, tools, config: { ...s.config, tool_overrides } };
    }),
  );
}

export async function connect(id: string): Promise<void> {
  // Optimistic: flip the status dot before the round-trip lands so the UI
  // never feels like it ate the click.
  mcpServers.update((list) =>
    list.map((s) => (s.config.id === id ? { ...s, status: 'connecting' as const } : s)),
  );
  try {
    const view = await mcp.connect(id);
    mcpServers.update((list) =>
      list.map((s) => (s.config.id === id ? view : s)),
    );
  } catch (e) {
    // The Rust side already wrote `Failed { error }` into the manager
    // before bouncing the error to us; refresh so we pick that up
    // instead of fabricating a generic failure status here.
    await refreshServers();
    throw e;
  }
}

export async function disconnect(id: string): Promise<void> {
  await mcp.disconnect(id);
  await refreshServers();
}

export async function authorize(id: string, scopes?: string[]): Promise<McpServerView> {
  const view = await mcp.authorize(id, scopes);
  await refreshServers();
  return view;
}

export async function clearOAuth(id: string): Promise<void> {
  await mcp.clearOAuth(id);
  await refreshServers();
}

export async function importJson(json: string): Promise<McpServerView[]> {
  const created = await mcp.importJson(json);
  await refreshServers();
  return created;
}

export async function setToolCap(cap: number): Promise<void> {
  await mcp.setToolCap(cap);
  await refreshToolCap();
}

/** Quick-add catalog entries shown in the panel. Each is a partial input
 * the form can prefill with sensible defaults so the user doesn't have to
 * remember `npx @modelcontextprotocol/server-filesystem` from memory. */
export interface CatalogEntry {
  id: string;
  label: string;
  description: string;
  input: McpServerInput;
}

export const QUICK_ADD_CATALOG: CatalogEntry[] = [
  {
    id: 'filesystem',
    label: 'Filesystem',
    description:
      'Local filesystem browsing/editing — give the model read access to a folder.',
    input: {
      name: 'Filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '<PATH>'],
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Search code, list issues/PRs, and create comments via the GitHub API.',
    input: {
      name: 'GitHub',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${env:GITHUB_TOKEN}' },
    },
  },
  {
    id: 'atlassian',
    label: 'Atlassian (remote OAuth)',
    description:
      'Jira + Confluence via Atlassian\'s hosted MCP endpoint. Click "Sign in" after adding.',
    input: {
      name: 'Atlassian',
      transport: 'remote',
      url: 'https://mcp.atlassian.com/v1/sse',
    },
  },
  {
    id: 'playwright',
    label: 'Playwright',
    description: 'Drive a browser via Playwright — navigation, screenshots, DOM queries.',
    input: {
      name: 'Playwright',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    },
  },
];
