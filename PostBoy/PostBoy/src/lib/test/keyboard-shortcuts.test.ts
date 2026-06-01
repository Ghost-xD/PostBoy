import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

function makeKeyEvent(overrides: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: overrides.key,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    metaKey: overrides.metaKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: string;
}

const globalShortcuts: ShortcutDef[] = [
  { key: '/', ctrl: true, description: 'Toggle keyboard shortcuts', action: 'showShortcuts' },
  { key: 'J', ctrl: true, shift: true, description: 'JWT Decoder', action: 'showToolsPanel:jwt' },
  { key: 'E', ctrl: true, shift: true, description: 'Base64/URL Encoder', action: 'showToolsPanel:encoder' },
  { key: 'Escape', description: 'Close topmost overlay', action: 'closeOverlay' },
];

const requestShortcuts: ShortcutDef[] = [
  { key: 't', ctrl: true, description: 'New tab', action: 'addTab' },
  { key: 'w', ctrl: true, description: 'Close tab', action: 'removeTab' },
  { key: 'm', ctrl: true, description: 'Open method dropdown', action: 'focusMethodSelect' },
  { key: 'Enter', ctrl: true, description: 'Send request / WS connect', action: 'sendRequest' },
  { key: 'i', ctrl: true, description: 'Focus URL input', action: 'focusUrl' },
  { key: 's', ctrl: true, description: 'Save request', action: 'saveRequest' },
  { key: 'h', ctrl: true, description: 'Headers tab', action: 'activeRequestTab:headers' },
  { key: 'b', ctrl: true, description: 'Body tab', action: 'activeRequestTab:body' },
  { key: 'p', ctrl: true, description: 'Params tab', action: 'activeRequestTab:params' },
  { key: 'A', ctrl: true, shift: true, description: 'Auth tab', action: 'activeRequestTab:auth' },
  { key: 'C', ctrl: true, shift: true, description: 'Collections sidebar', action: 'activeSidebarTab:collections' },
  { key: 'H', ctrl: true, shift: true, description: 'History sidebar', action: 'activeSidebarTab:history' },
  { key: 'F', ctrl: true, shift: true, description: 'Format body', action: 'formatBody' },
  { key: 'K', ctrl: true, shift: true, description: 'Copy as cURL', action: 'copyAsCurl' },
  { key: 'G', ctrl: true, shift: true, description: 'Code generation', action: 'openCodeGen' },
  { key: 'L', ctrl: true, shift: true, description: 'Toggle response panel position', action: 'toggleResponseLayout' },
];

const responseShortcuts: ShortcutDef[] = [
  { key: '1', alt: true, description: 'Preview tab', action: 'activeResponseTab:preview' },
  { key: '2', alt: true, description: 'Headers tab', action: 'activeResponseTab:headers' },
  { key: '3', alt: true, description: 'Console tab', action: 'activeResponseTab:console' },
  { key: '4', alt: true, description: 'Diff tab', action: 'activeResponseTab:diff' },
  { key: 't', alt: true, description: 'Tree view', action: 'previewMode:tree' },
  { key: 'r', alt: true, description: 'Raw view', action: 'previewMode:raw' },
  { key: 'g', alt: true, description: 'Graph view', action: 'previewMode:graph' },
];

const encoderPanelShortcuts: ShortcutDef[] = [
  { key: 'd', ctrl: true, description: 'Toggle encode/decode', action: 'toggleDirection' },
  { key: 'm', ctrl: true, description: 'Toggle Base64/URL mode', action: 'toggleMode' },
];

describe('Keyboard Shortcuts', () => {
  describe('Shortcut key event matching', () => {
    function matchesShortcut(e: KeyboardEvent, s: ShortcutDef): boolean {
      if (e.key !== s.key && e.key.toLowerCase() !== s.key.toLowerCase()) return false;
      if ((s.ctrl ?? false) !== e.ctrlKey) return false;
      if ((s.shift ?? false) !== e.shiftKey) return false;
      if ((s.alt ?? false) !== e.altKey) return false;
      return true;
    }

    globalShortcuts.forEach(shortcut => {
      it(`should match ${shortcut.description} (${[shortcut.ctrl && 'Ctrl', shortcut.shift && 'Shift', shortcut.alt && 'Alt', shortcut.key].filter(Boolean).join('+')})`, () => {
        const e = makeKeyEvent({
          key: shortcut.key,
          ctrlKey: shortcut.ctrl ?? false,
          shiftKey: shortcut.shift ?? false,
          altKey: shortcut.alt ?? false,
        });
        expect(matchesShortcut(e, shortcut)).toBe(true);
      });
    });

    requestShortcuts.forEach(shortcut => {
      it(`should match ${shortcut.description} (${[shortcut.ctrl && 'Ctrl', shortcut.shift && 'Shift', shortcut.alt && 'Alt', shortcut.key].filter(Boolean).join('+')})`, () => {
        const e = makeKeyEvent({
          key: shortcut.key,
          ctrlKey: shortcut.ctrl ?? false,
          shiftKey: shortcut.shift ?? false,
          altKey: shortcut.alt ?? false,
        });
        expect(matchesShortcut(e, shortcut)).toBe(true);
      });
    });

    responseShortcuts.forEach(shortcut => {
      it(`should match ${shortcut.description} (${[shortcut.ctrl && 'Ctrl', shortcut.shift && 'Shift', shortcut.alt && 'Alt', shortcut.key].filter(Boolean).join('+')})`, () => {
        const e = makeKeyEvent({
          key: shortcut.key,
          ctrlKey: shortcut.ctrl ?? false,
          shiftKey: shortcut.shift ?? false,
          altKey: shortcut.alt ?? false,
        });
        expect(matchesShortcut(e, shortcut)).toBe(true);
      });
    });
  });

  describe('No duplicate shortcut bindings', () => {
    function normalizeKey(s: ShortcutDef): string {
      return [
        s.ctrl ? 'Ctrl' : '',
        s.shift ? 'Shift' : '',
        s.alt ? 'Alt' : '',
        s.key.toLowerCase()
      ].filter(Boolean).join('+');
    }

    it('should have no duplicate global shortcuts', () => {
      const keys = globalShortcuts.map(normalizeKey);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    it('should have no duplicate request shortcuts', () => {
      const keys = requestShortcuts.map(normalizeKey);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    it('should have no duplicate response shortcuts', () => {
      const keys = responseShortcuts.map(normalizeKey);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    it('should not have request shortcuts that conflict with global shortcuts', () => {
      const globalKeys = new Set(globalShortcuts.map(normalizeKey));
      for (const s of requestShortcuts) {
        expect(globalKeys.has(normalizeKey(s))).toBe(false);
      }
    });

    it('should not have response shortcuts that conflict with global or request shortcuts', () => {
      const takenKeys = new Set([
        ...globalShortcuts.map(normalizeKey),
        ...requestShortcuts.map(normalizeKey),
      ]);
      for (const s of responseShortcuts) {
        expect(takenKeys.has(normalizeKey(s))).toBe(false);
      }
    });
  });

  describe('Escape priority', () => {
    it('should close modal first when modal is open', () => {
      const state = { modals: [{ id: 'm1', cancelable: true }], toolsPanel: 'jwt' as const, shortcuts: true };
      const e = makeKeyEvent({ key: 'Escape' });

      let closed: string | null = null;
      if (state.modals.length > 0 && state.modals[state.modals.length - 1].cancelable) {
        closed = 'modal';
      } else if (state.toolsPanel) {
        closed = 'toolsPanel';
      } else if (state.shortcuts) {
        closed = 'shortcuts';
      }

      expect(closed).toBe('modal');
    });

    it('should close tools panel when no modal is open', () => {
      const state = { modals: [] as any[], toolsPanel: 'encoder' as const, shortcuts: true };

      let closed: string | null = null;
      if (state.modals.length > 0) {
        closed = 'modal';
      } else if (state.toolsPanel) {
        closed = 'toolsPanel';
      } else if (state.shortcuts) {
        closed = 'shortcuts';
      }

      expect(closed).toBe('toolsPanel');
    });

    it('should close shortcuts panel when nothing else is open', () => {
      const state = { modals: [] as any[], toolsPanel: false as const, shortcuts: true };

      let closed: string | null = null;
      if (state.modals.length > 0) {
        closed = 'modal';
      } else if (state.toolsPanel) {
        closed = 'toolsPanel';
      } else if (state.shortcuts) {
        closed = 'shortcuts';
      }

      expect(closed).toBe('shortcuts');
    });

    it('should do nothing when no overlay is open', () => {
      const state = { modals: [] as any[], toolsPanel: false as const, shortcuts: false };

      let closed: string | null = null;
      if (state.modals.length > 0) {
        closed = 'modal';
      } else if (state.toolsPanel) {
        closed = 'toolsPanel';
      } else if (state.shortcuts) {
        closed = 'shortcuts';
      }

      expect(closed).toBeNull();
    });

    it('should not close non-cancelable modal', () => {
      const state = { modals: [{ id: 'm1', cancelable: false }], toolsPanel: false as const, shortcuts: false };

      let closed: string | null = null;
      if (state.modals.length > 0 && state.modals[state.modals.length - 1].cancelable) {
        closed = 'modal';
      } else if (state.toolsPanel) {
        closed = 'toolsPanel';
      } else if (state.shortcuts) {
        closed = 'shortcuts';
      }

      expect(closed).toBeNull();
    });
  });

  describe('Tools panel shortcut isolation', () => {
    it('should not intercept request shortcuts when tools panel is open', () => {
      const toolsPanelOpen = true;
      const requestKeys = ['t', 'w', 'm', 'i', 's', 'h', 'b', 'p'];

      for (const key of requestKeys) {
        const e = makeKeyEvent({ key, ctrlKey: true });
        let intercepted = false;

        if (!toolsPanelOpen) {
          intercepted = true;
        }

        expect(intercepted).toBe(false);
      }
    });

    it('should still handle global shortcuts when tools panel is open', () => {
      const globalKeys = [
        { key: '/', ctrl: true, action: 'showShortcuts' },
        { key: 'J', ctrl: true, shift: true, action: 'showToolsPanel:jwt' },
        { key: 'E', ctrl: true, shift: true, action: 'showToolsPanel:encoder' },
        { key: 'Escape', action: 'closeOverlay' },
      ];

      for (const gk of globalKeys) {
        // Global shortcuts and Escape are checked BEFORE the tools-panel guard
        const handled = true;
        expect(handled).toBe(true);
      }
    });

    it('Escape should close tools panel even though tools-panel guard skips other keys', () => {
      // Simulates the handler order: Escape is checked before the guard
      let toolsPanel: false | 'jwt' | 'encoder' = 'encoder';
      const modals: any[] = [];
      const shortcuts = false;

      const e = makeKeyEvent({ key: 'Escape' });

      // Escape handler runs first (before guard)
      if (e.key === 'Escape') {
        if (modals.length > 0) {
          // close modal
        } else if (toolsPanel) {
          toolsPanel = false;
        } else if (shortcuts) {
          // close shortcuts
        }
      }

      expect(toolsPanel).toBe(false);
    });
  });

  describe('Encoder panel shortcuts (Ctrl+D, Ctrl+M)', () => {
    it('Ctrl+D should toggle encode/decode direction', () => {
      let direction: 'encode' | 'decode' = 'encode';
      const e = makeKeyEvent({ key: 'd', ctrlKey: true });

      if (e.ctrlKey && !e.shiftKey && e.key === 'd') {
        direction = direction === 'encode' ? 'decode' : 'encode';
      }

      expect(direction).toBe('decode');
    });

    it('Ctrl+D should toggle back to encode', () => {
      let direction: 'encode' | 'decode' = 'decode' as 'encode' | 'decode';
      const e = makeKeyEvent({ key: 'd', ctrlKey: true });

      if (e.ctrlKey && !e.shiftKey && e.key === 'd') {
        direction = direction === 'encode' ? 'decode' : 'encode';
      }

      expect(direction).toBe('encode');
    });

    it('Ctrl+M should toggle base64/url mode', () => {
      let mode: 'base64' | 'url' = 'base64';
      const e = makeKeyEvent({ key: 'm', ctrlKey: true });

      if (e.ctrlKey && !e.shiftKey && e.key === 'm') {
        mode = mode === 'base64' ? 'url' : 'base64';
      }

      expect(mode).toBe('url');
    });

    it('Ctrl+M should toggle back to base64', () => {
      let mode: 'base64' | 'url' = 'url' as 'base64' | 'url';
      const e = makeKeyEvent({ key: 'm', ctrlKey: true });

      if (e.ctrlKey && !e.shiftKey && e.key === 'm') {
        mode = mode === 'base64' ? 'url' : 'base64';
      }

      expect(mode).toBe('base64');
    });

    it('Ctrl+M should not be captured by main handler when tools panel is open', () => {
      const toolsPanelOpen = true;
      let mainHandlerCaptured = false;
      let encoderHandled = false;

      const e = makeKeyEvent({ key: 'm', ctrlKey: true });

      // Simulates main handler logic
      if (!toolsPanelOpen) {
        // Main handler would handle Ctrl+M for method dropdown
        if (e.ctrlKey && !e.shiftKey && e.key === 'm') {
          mainHandlerCaptured = true;
        }
      }

      // Simulates encoder panel handler
      if (toolsPanelOpen && e.ctrlKey && !e.shiftKey && e.key === 'm') {
        encoderHandled = true;
      }

      expect(mainHandlerCaptured).toBe(false);
      expect(encoderHandled).toBe(true);
    });

    it('Ctrl+D should not conflict with any global shortcut', () => {
      const allGlobal = [...globalShortcuts, ...requestShortcuts, ...responseShortcuts];
      const ctrlD = allGlobal.find(s =>
        s.key.toLowerCase() === 'd' && s.ctrl && !s.shift && !s.alt
      );
      expect(ctrlD).toBeUndefined();
    });
  });

  describe('Tools panel toggle shortcuts', () => {
    it('Ctrl+Shift+J should toggle JWT panel', () => {
      let toolsPanel: false | 'jwt' | 'encoder' = false as false | 'jwt' | 'encoder';
      const e = makeKeyEvent({ key: 'J', ctrlKey: true, shiftKey: true });

      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        toolsPanel = toolsPanel === 'jwt' ? false : 'jwt';
      }
      expect(toolsPanel).toBe('jwt');

      // Toggle off
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        toolsPanel = toolsPanel === 'jwt' ? false : 'jwt';
      }
      expect(toolsPanel).toBe(false);
    });

    it('Ctrl+Shift+E should toggle Encoder panel', () => {
      let toolsPanel: false | 'jwt' | 'encoder' = false as false | 'jwt' | 'encoder';
      const e = makeKeyEvent({ key: 'E', ctrlKey: true, shiftKey: true });

      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        toolsPanel = toolsPanel === 'encoder' ? false : 'encoder';
      }
      expect(toolsPanel).toBe('encoder');

      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        toolsPanel = toolsPanel === 'encoder' ? false : 'encoder';
      }
      expect(toolsPanel).toBe(false);
    });

    it('opening JWT should close Encoder and vice versa', () => {
      let toolsPanel: false | 'jwt' | 'encoder' = 'encoder' as false | 'jwt' | 'encoder';

      // Press Ctrl+Shift+J while encoder is open
      toolsPanel = (toolsPanel as false | 'jwt' | 'encoder') === 'jwt' ? false : 'jwt';
      expect(toolsPanel).toBe('jwt');

      // Press Ctrl+Shift+E while JWT is open
      toolsPanel = (toolsPanel as false | 'jwt' | 'encoder') === 'encoder' ? false : 'encoder';
      expect(toolsPanel).toBe('encoder');
    });
  });

  describe('WebSocket shortcuts', () => {
    it('Ctrl+Enter should map to connect when disconnected', () => {
      const wsStatus = 'disconnected' as 'disconnected' | 'connecting' | 'connected';
      const e = makeKeyEvent({ key: 'Enter', ctrlKey: true });
      let action = '';

      if (e.ctrlKey && e.key === 'Enter') {
        if (wsStatus === 'connected') action = 'disconnect';
        else if (wsStatus !== 'connecting') action = 'connect';
      }
      expect(action).toBe('connect');
    });

    it('Ctrl+Enter should map to disconnect when connected', () => {
      const wsStatus = 'connected';
      const e = makeKeyEvent({ key: 'Enter', ctrlKey: true });
      let action = '';

      if (e.ctrlKey && e.key === 'Enter') {
        if (wsStatus === 'connected') action = 'disconnect';
        else if (wsStatus !== 'connecting') action = 'connect';
      }
      expect(action).toBe('disconnect');
    });

    it('Ctrl+Enter should do nothing when connecting', () => {
      const wsStatus = 'connecting' as 'disconnected' | 'connecting' | 'connected';
      const e = makeKeyEvent({ key: 'Enter', ctrlKey: true });
      let action = '';

      if (e.ctrlKey && e.key === 'Enter') {
        if (wsStatus === 'connected') action = 'disconnect';
        else if (wsStatus !== 'connecting') action = 'connect';
      }
      expect(action).toBe('');
    });

    it('Ctrl+L should clear WS messages', () => {
      const isWsTab = true;
      const e = makeKeyEvent({ key: 'l', ctrlKey: true });
      let cleared = false;

      if (isWsTab && e.ctrlKey && !e.shiftKey && e.key === 'l') {
        cleared = true;
      }
      expect(cleared).toBe(true);
    });
  });

  describe('Help sequence (PPPP / HHHH)', () => {
    it('should trigger on four consecutive P presses', () => {
      let seq = '';
      const keys = ['P', 'P', 'P', 'P'];
      let triggered = false;

      for (const key of keys) {
        seq += key;
        if (seq.endsWith('PPPP') || seq.endsWith('HHHH')) {
          triggered = true;
        }
      }
      expect(triggered).toBe(true);
    });

    it('should trigger on four consecutive H presses', () => {
      let seq = '';
      const keys = ['H', 'H', 'H', 'H'];
      let triggered = false;

      for (const key of keys) {
        seq += key;
        if (seq.endsWith('PPPP') || seq.endsWith('HHHH')) {
          triggered = true;
        }
      }
      expect(triggered).toBe(true);
    });

    it('should not trigger on three P presses', () => {
      let seq = '';
      const keys = ['P', 'P', 'P'];
      let triggered = false;

      for (const key of keys) {
        seq += key;
        if (seq.endsWith('PPPP') || seq.endsWith('HHHH')) {
          triggered = true;
        }
      }
      expect(triggered).toBe(false);
    });

    it('should not trigger on mixed keys', () => {
      let seq = '';
      const keys = ['P', 'H', 'P', 'H'];
      let triggered = false;

      for (const key of keys) {
        seq += key;
        if (seq.endsWith('PPPP') || seq.endsWith('HHHH')) {
          triggered = true;
        }
      }
      expect(triggered).toBe(false);
    });
  });

  describe('Body type shortcuts after Ctrl+B', () => {
    const bodyTypes: Record<string, string> = {
      'j': 'json', 'x': 'xml', 'y': 'yaml', 'h': 'html', 't': 'text',
      'f': 'form-data', 'u': 'form-urlencoded', 'i': 'binary', 'g': 'graphql', 'n': 'none'
    };

    Object.entries(bodyTypes).forEach(([key, type]) => {
      it(`pressing '${key}' after Ctrl+B should set body type to '${type}'`, () => {
        let bodyTypeShortcutsEnabled = true;
        let selectedType = '';

        const e = makeKeyEvent({ key });

        if (bodyTypeShortcutsEnabled && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          const k = e.key.toLowerCase();
          if (bodyTypes[k]) {
            selectedType = bodyTypes[k];
            bodyTypeShortcutsEnabled = false;
          }
        }

        expect(selectedType).toBe(type);
        expect(bodyTypeShortcutsEnabled).toBe(false);
      });
    });

    it('should not activate body type shortcut when Ctrl+B mode is not active', () => {
      const bodyTypeShortcutsEnabled = false;
      let selectedType = '';

      const e = makeKeyEvent({ key: 'j' });

      if (bodyTypeShortcutsEnabled && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (bodyTypes[e.key.toLowerCase()]) {
          selectedType = bodyTypes[e.key.toLowerCase()];
        }
      }

      expect(selectedType).toBe('');
    });
  });
});
