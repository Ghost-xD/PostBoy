import { writable, get } from 'svelte/store';

// Sidebar state
export const activeSidebarTab = writable<'collections' | 'history'>('collections');
export const leftSidebarCollapsed = writable<boolean>(false);
export const rightSidebarCollapsed = writable<boolean>(false);
export const leftSidebarWidth = writable<number>(280);
export const rightSidebarWidth = writable<number>(450);

// Response panel layout
export const responseLayout = writable<'right' | 'bottom'>('bottom');
export const responsePanelHeight = writable<number>(560);

// Request/Response tabs within the main area
export const activeRequestTab = writable<'params' | 'body' | 'auth' | 'headers' | 'scripts' | 'docs'>('body');
export const activeResponseTab = writable<'preview' | 'headers' | 'console' | 'diff'>('preview');

// Modals and overlays
export const showShortcuts = writable<boolean>(false);
export const showToolsPanel = writable<false | 'jwt' | 'encoder' | 'sql' | 'diagnostics' | 'settings' | 'cookies' | 'mcp'>(false);
// Tools panel fullscreen toggle. Exposed as a store so any component
// (e.g. ChatbotPanel) can react to it for layout adjustments, and the
// global keyboard handler can flip it without poking component state.
export const toolsFullscreen = writable<boolean>(false);

// Diff Tool has its own dedicated modal (not part of the tools panel)
export const showDiffTool = writable<boolean>(false);

// Load Test Lab — a full-screen surface that stands on its own (not part of
// the Tools modal). `false` = closed; an object = open and seeded with the
// collection the user picked. The collection id can be `null` so the screen
// can also be opened from the footer/menu without a pre-selected collection.
export const showLoadTest = writable<false | { collectionId: number | null }>(false);

// Son of Anton (AI chatbot) — a full-screen surface of its own, opened with
// Ctrl+Shift+M. Kept separate from the Tools modal so it gets the whole
// viewport like the Load Test Lab.
export const showChatbot = writable<boolean>(false);

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

// Hook every layout-affecting store up to a save callback so user resizes
// and layout toggles survive a restart even if the app is killed before
// `beforeunload` fires. The caller (typically +page.svelte) passes a
// debounced save fn — drag events fire on every mousemove, so the save
// should coalesce. Idempotent: a second call is a no-op.
let uiPersistenceWired = false;
export function enableUIPersistence(save: () => void) {
  if (uiPersistenceWired) return;
  uiPersistenceWired = true;

  // Svelte stores fire their subscriber synchronously on subscribe with
  // the current value. Skip that initial burst so we don't write to disk
  // immediately on app start.
  let ready = false;
  const fire = () => { if (ready) save(); };

  leftSidebarCollapsed.subscribe(fire);
  rightSidebarCollapsed.subscribe(fire);
  leftSidebarWidth.subscribe(fire);
  rightSidebarWidth.subscribe(fire);
  responseLayout.subscribe(fire);
  responsePanelHeight.subscribe(fire);

  ready = true;
}
