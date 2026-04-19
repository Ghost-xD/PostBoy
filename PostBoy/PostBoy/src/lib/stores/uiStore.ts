import { writable, get } from 'svelte/store';

// Sidebar state
export const activeSidebarTab = writable<'collections' | 'history'>('collections');
export const leftSidebarCollapsed = writable<boolean>(false);
export const rightSidebarCollapsed = writable<boolean>(false);
export const leftSidebarWidth = writable<number>(280);
export const rightSidebarWidth = writable<number>(450);

// Response panel layout
export const responseLayout = writable<'right' | 'bottom'>('right');
export const responsePanelHeight = writable<number>(300);

// Request/Response tabs within the main area
export const activeRequestTab = writable<'params' | 'body' | 'auth' | 'headers' | 'docs'>('body');
export const activeResponseTab = writable<'preview' | 'headers' | 'console' | 'diff'>('preview');

// Modals and overlays
export const showShortcuts = writable<boolean>(false);
export const showToolsPanel = writable<false | 'jwt' | 'encoder' | 'sql' | 'diagnostics' | 'settings' | 'cookies'>(false);

// Diff Tool has its own dedicated modal (not part of the tools panel)
export const showDiffTool = writable<boolean>(false);

// Loading state for HTTP requests — tracks which tab IDs are currently sending
export const sendingTabIds = writable<Set<string>>(new Set());
export const isSendingRequest = writable<boolean>(false);

// Toggle response layout between right sidebar and bottom panel
export function toggleResponseLayout() {
  responseLayout.update(current => current === 'right' ? 'bottom' : 'right');
}

// Get all UI state for persistence
export function getUIState() {
  return {
    leftSidebarCollapsed: get(leftSidebarCollapsed),
    rightSidebarCollapsed: get(rightSidebarCollapsed),
    leftSidebarWidth: get(leftSidebarWidth),
    rightSidebarWidth: get(rightSidebarWidth),
    responseLayout: get(responseLayout),
    responsePanelHeight: get(responsePanelHeight)
  };
}

// Restore UI state from saved data
export function restoreUIState(data: {
  leftSidebarCollapsed?: boolean;
  rightSidebarCollapsed?: boolean;
  leftSidebarWidth?: number;
  rightSidebarWidth?: number;
  responseLayout?: 'right' | 'bottom';
  responsePanelHeight?: number;
}) {
  if (data.leftSidebarCollapsed !== undefined) leftSidebarCollapsed.set(data.leftSidebarCollapsed);
  if (data.rightSidebarCollapsed !== undefined) rightSidebarCollapsed.set(data.rightSidebarCollapsed);
  if (data.leftSidebarWidth !== undefined) leftSidebarWidth.set(data.leftSidebarWidth);
  if (data.rightSidebarWidth !== undefined) rightSidebarWidth.set(data.rightSidebarWidth);
  if (data.responseLayout !== undefined) responseLayout.set(data.responseLayout);
  if (data.responsePanelHeight !== undefined) responsePanelHeight.set(data.responsePanelHeight);
}
