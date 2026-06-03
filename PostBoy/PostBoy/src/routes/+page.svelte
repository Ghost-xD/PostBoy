<script lang="ts">
  import { run, createBubbler, stopPropagation } from 'svelte/legacy';

  const bubble = createBubbler();
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { db, fileOps, app } from '$lib/api/tauri';
  import { tabs, activeTabId, activeTab, updateActiveTabBatch, updateTab, restoreTabs, saveTabs, saveTabsImmediate, enableAutoSave, findOpenTab, setActiveTab, addTab as storeAddTab, removeTab, nextTab, prevTab } from '$lib/stores/tabStore';
  import type { Tab } from '$lib/stores/tabStore';
  import {
    responseLayout, responsePanelHeight, leftSidebarWidth, rightSidebarWidth,
    leftSidebarCollapsed, rightSidebarCollapsed, activeSidebarTab,
    activeRequestTab, activeResponseTab, showShortcuts, showToolsPanel, showDiffTool, toolsFullscreen, toggleResponseLayout, getUIState, restoreUIState, enableUIPersistence
  } from '$lib/stores/uiStore';
  import { wsConnect, wsDisconnect, clearWsMessages } from '$lib/stores/wsStore';
  import { sseConnect, sseDisconnect, clearSseMessages } from '$lib/stores/sseStore';
  import { activeModals, closeModal } from '$lib/utils/modalManager.svelte';
  import { addLog } from '$lib/stores/consoleStore';
  import { variables } from '$lib/stores/variableStore';
  import * as modalManager from '$lib/utils/modalManager.svelte';
  import { parseOpenApiSpec } from '$lib/utils/openApiParser';
  import { importCollection } from '$lib/utils/collectionImporter';
  
  import TabBar from '$lib/components/TabBar.svelte';
  import RequestBuilder from '$lib/components/RequestBuilder.svelte';
  import ResponsePanel from '$lib/components/ResponsePanel.svelte';
  import LeftSidebar from '$lib/components/LeftSidebar.svelte';
  import AppFooter from '$lib/components/AppFooter.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import KeyboardShortcuts from '$lib/components/KeyboardShortcuts.svelte';
  import JwtDecoderPanel from '$lib/components/JwtDecoderPanel.svelte';
  import EncoderPanel from '$lib/components/EncoderPanel.svelte';
  import SqlRunnerPanel from '$lib/components/SqlRunnerPanel.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import DiagnosticsPanel from '$lib/components/DiagnosticsPanel.svelte';
  import CookieJarPanel from '$lib/components/CookieJarPanel.svelte';
  import ChatbotPanel from '$lib/components/ChatbotPanel.svelte';
  import ToolsNavBar from '$lib/components/ToolsNavBar.svelte';
  import type { ToolsNavTab } from '$lib/components/ToolsNavBar.svelte';
  import DiffTool from '$lib/components/DiffTool.svelte';
  import SearchPicker from '$lib/components/SearchPicker.svelte';
  import { loadSettings, settings } from '$lib/stores/settingsStore';
  import { chatbotSupported, chatbotStatus, initChatbotFeature, teardownChatbotFeature, loadDefaultModel } from '$lib/stores/chatbotStore';

  let version = $state('');
  let collections: any[] = $state([]);
  let history: any[] = $state([]);
  let requestBuilderRef: RequestBuilder | undefined = $state();
  let responsePanelRef: ResponsePanel | undefined = $state();
  let showSearchPicker = $state(false);
  let diffFullscreen = $state(false);

  // Reset Tools modal fullscreen each time it opens. (Keeping fullscreen
  // sticky across opens is unintuitive when switching between modal kinds.)
  run(() => {
    if (!$showToolsPanel) toolsFullscreen.set(false);
  });

  // Tools-modal tab list. Order here is the display order in the nav.
  // The chatbot entry is filtered out at render time when the build
  // doesn't include the feature.
  let toolsNavTabs = ($derived([
    ($chatbotSupported && $settings.chatbotEnabled) ? { key: 'chatbot', label: 'Son of Anton', title: 'Ctrl+Shift+M' } : null,
    { key: 'jwt', label: 'JWT Decoder', title: 'Ctrl+Shift+J' },
    { key: 'encoder', label: 'Encode / Decode', title: 'Ctrl+Shift+E' },
    { key: 'sql', label: 'SQL Runner', title: 'Ctrl+Shift+Q' },
    { key: 'diagnostics', label: 'Diagnostics', title: 'Ctrl+Shift+N' },
    { key: 'cookies', label: 'Cookie Jar', title: 'Ctrl+Shift+X' },
    { key: 'settings', label: 'Settings', title: 'Ctrl+,' },
  ].filter(Boolean) as ToolsNavTab[]));

  // The wave bump in the nav doubles as the active-tab indicator. We fill
  // it with the accent blue so on the pitch-black surface it reads as a
  // glowing bulge anchored to whatever tab is active.
  let toolsWaveColor = $derived('#4d8df6');

  function handleSearchPickerSelect(e: CustomEvent<string>) {
    showSearchPicker = false;
    const target = e.detail;
    if (target === 'collections') {
      if ($leftSidebarCollapsed) leftSidebarCollapsed.set(false);
      activeSidebarTab.set('collections');
      setTimeout(() => window.dispatchEvent(new CustomEvent('focus-sidebar-search')), 50);
    } else if (target === 'history') {
      if ($leftSidebarCollapsed) leftSidebarCollapsed.set(false);
      activeSidebarTab.set('history');
      setTimeout(() => window.dispatchEvent(new CustomEvent('focus-sidebar-search')), 50);
    } else if (target === 'response') {
      window.dispatchEvent(new CustomEvent('open-response-search'));
    }
  }

  // Sync showShortcuts store with local variable for two-way binding
  let showShortcutsVisible = $state(false);
  run(() => {
    showShortcutsVisible = $showShortcuts;
  });
  run(() => {
    showShortcuts.set(showShortcutsVisible);
  });

  // Drag state
  let isDraggingLeft = false;
  let isDraggingRight = false;
  let isDraggingBottom = false;
  let rafId: number | null = null;

  let updateAvailable: { version: string; body?: string } | null = $state(null);
  let isUpdating = $state(false);
  let updateStatus = $state('');

  onMount(async () => {
    version = (await app.getVersion()) as string;
    await loadCollections();
    await loadHistory();
    
    const savedData = await restoreTabs();
    if (savedData) {
      restoreUIState(savedData);
      addLog(`✓ Restored ${savedData.tabs?.length || 0} tab(s)`, 'system');
    }
    
    enableAutoSave();
    // Persist layout state (sidebar widths, response panel position/size,
    // collapsed flags) whenever the user resizes a panel or toggles a
    // layout. Uses the existing debounced saveTabs so rapid drag events
    // coalesce into a single write 500ms after the user lets go.
    enableUIPersistence(() => saveTabs(getUIState()));
    setupKeyboardShortcuts();

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    checkForUpdates();
    listenForRustUpdate();
    setupAppMenu();
    // Load persisted settings BEFORE deciding whether to bring up the chatbot
    // stack. If the user disabled Anton, `initChatbotFeature` is skipped
    // entirely — no model registry fetch, no default-model preload — which
    // is the whole point of the toggle (fast cold start, no LLM memory).
    void loadSettings().then(() => {
      lastChatbotEnabled = get(settings).chatbotEnabled;
      if (lastChatbotEnabled) {
        initChatbotFeature();
      }
    });
  });

  // React to the user flipping the chatbot toggle at runtime. Enabling
  // re-runs the same init path the cold-start uses; disabling unloads the
  // engine to free RAM right away and resets `chatbotSupported` so the UI
  // bits (tools pill, menu item, panel) re-hide reactively.
  //
  // `lastChatbotEnabled` stays `null` until `loadSettings()` resolves and
  // sets the baseline above. That avoids two startup races: (a) the effect
  // firing with the default-true value and triggering a redundant init,
  // and (b) the loaded value being `false` then arriving and tearing down
  // something we never initialised.
  let lastChatbotEnabled: boolean | null = null;
  $effect(() => {
    const enabled = $settings.chatbotEnabled;
    if (lastChatbotEnabled === null) return;
    if (enabled === lastChatbotEnabled) return;
    lastChatbotEnabled = enabled;
    if (enabled) {
      initChatbotFeature();
    } else {
      // Close the chatbot tools panel if it's currently showing, otherwise
      // the user would be left staring at an empty Tools pane until they
      // pick a different tool.
      if (get(showToolsPanel) === 'chatbot') showToolsPanel.set(false);
      void teardownChatbotFeature();
    }
  });

  async function setupAppMenu() {
    try {
      const { Menu, MenuItem, Submenu, PredefinedMenuItem } = await import('@tauri-apps/api/menu');

      const fileSubmenu = await Submenu.new({
        text: 'File',
        items: [
          await MenuItem.new({ id: 'new-request', text: 'New Request', accelerator: 'CmdOrCtrl+N', action: () => storeAddTab() }),
          await MenuItem.new({ id: 'save-request', text: 'Save Request', accelerator: 'CmdOrCtrl+S', action: () => saveRequest() }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'import-collection', text: 'Import Collection', action: () => importCollections() }),
          await MenuItem.new({ id: 'import-openapi', text: 'Import OpenAPI Spec', accelerator: 'CmdOrCtrl+Shift+O', action: () => importOpenApi() }),
          await MenuItem.new({ id: 'export-collection', text: 'Export Collections', action: () => exportCollections() }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await PredefinedMenuItem.new({ item: 'Quit' }),
        ],
      });

      const editSubmenu = await Submenu.new({
        text: 'Edit',
        items: [
          await PredefinedMenuItem.new({ item: 'Undo' }),
          await PredefinedMenuItem.new({ item: 'Redo' }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await PredefinedMenuItem.new({ item: 'Cut' }),
          await PredefinedMenuItem.new({ item: 'Copy' }),
          await PredefinedMenuItem.new({ item: 'Paste' }),
          await PredefinedMenuItem.new({ item: 'SelectAll' }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'format-body', text: 'Format Body', accelerator: 'CmdOrCtrl+Shift+F', action: () => requestBuilderRef?.formatBody() }),
        ],
      });

      const toolsItems: any[] = [
        await MenuItem.new({ id: 'jwt-decoder', text: 'JWT Decoder', accelerator: 'CmdOrCtrl+Shift+J', action: () => showToolsPanel.update(v => v === 'jwt' ? false : 'jwt') }),
        await MenuItem.new({ id: 'encoder', text: 'Base64 / URL Encoder', accelerator: 'CmdOrCtrl+Shift+E', action: () => showToolsPanel.update(v => v === 'encoder' ? false : 'encoder') }),
        await MenuItem.new({ id: 'sql-runner', text: 'SQL Query Runner', accelerator: 'CmdOrCtrl+Shift+Q', action: () => showToolsPanel.update(v => v === 'sql' ? false : 'sql') }),
        await MenuItem.new({ id: 'cookie-jar', text: 'Cookie Jar', accelerator: 'CmdOrCtrl+Shift+X', action: () => showToolsPanel.update(v => v === 'cookies' ? false : 'cookies') }),
        await MenuItem.new({ id: 'diagnostics', text: 'Network Diagnostics', accelerator: 'CmdOrCtrl+Shift+N', action: () => showToolsPanel.update(v => v === 'diagnostics' ? false : 'diagnostics') }),
        await MenuItem.new({ id: 'diff-tool', text: 'Diff / Compare', accelerator: 'CmdOrCtrl+Shift+B', action: () => showDiffTool.update(v => !v) }),
      ];

      if ($chatbotSupported && $settings.chatbotEnabled) {
        toolsItems.unshift(
          await MenuItem.new({ id: 'ai-chatbot', text: 'Son of Anton', accelerator: 'CmdOrCtrl+Shift+M', action: () => showToolsPanel.update(v => v === 'chatbot' ? false : 'chatbot') }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
        );
      }

      const toolsSubmenu = await Submenu.new({
        text: 'Tools',
        items: [
          ...toolsItems,
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'copy-curl', text: 'Copy as cURL', accelerator: 'CmdOrCtrl+Shift+K', action: () => requestBuilderRef?.copyAsCurl() }),
          await MenuItem.new({ id: 'code-gen', text: 'Code Generation', accelerator: 'CmdOrCtrl+Shift+G', action: () => requestBuilderRef?.openCodeGen() }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'export-snapshot', text: 'Export as HTML Snapshot', accelerator: 'CmdOrCtrl+Shift+S', action: () => responsePanelRef?.exportSnapshot() }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'settings', text: 'Settings', accelerator: 'CmdOrCtrl+,', action: () => showToolsPanel.update(v => v === 'settings' ? false : 'settings') }),
        ],
      });

      const viewSubmenu = await Submenu.new({
        text: 'View',
        items: [
          await MenuItem.new({ id: 'toggle-sidebar', text: 'Toggle Collections', accelerator: 'CmdOrCtrl+Shift+C', action: () => leftSidebarCollapsed.update(v => !v) }),
          await MenuItem.new({ id: 'toggle-response', text: 'Toggle Response Layout', accelerator: 'CmdOrCtrl+Shift+L', action: () => toggleResponseLayout() }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'shortcuts', text: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', action: () => showShortcuts.update(v => !v) }),
        ],
      });

      const helpSubmenu = await Submenu.new({
        text: 'Help',
        items: [
          await MenuItem.new({ id: 'help-shortcuts', text: 'Keyboard Shortcuts', action: () => showShortcuts.set(true) }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'about', text: `About Ripple v${version}`, action: async () => {
            await modalManager.showInfo('About Ripple', `Ripple v${version}\n\nA fast, native desktop API client.\nBuilt with Tauri, Rust & SvelteKit.\n\nAll data stays local in SQLite.\nNo accounts, no cloud, no telemetry.`);
          }}),
          await MenuItem.new({ id: 'check-updates', text: 'Check for Updates', action: () => checkForUpdates(true) }),
        ],
      });

      const menu = await Menu.new({
        items: [fileSubmenu, editSubmenu, toolsSubmenu, viewSubmenu, helpSubmenu],
      });

      await menu.setAsAppMenu();
    } catch (e) {
      console.debug('Menu setup skipped (not in Tauri context):', e);
    }
  }

  async function checkForUpdates(manual = false) {
    if (window.location.hostname === 'localhost') return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<string>('check_for_update');
      addLog(result, 'system');
      if (manual && !result.startsWith('Update available')) {
        await modalManager.showSuccess('Up to Date', `You're running the latest version of Ripple (v${version}).`);
      }
    } catch (e: any) {
      const msg = e?.message || e || 'Unknown error';
      console.debug('Update check failed:', msg);
      if (manual) {
        await modalManager.showError('Update Check Failed', `Could not check for updates.\n\n${msg}`);
      }
    }
  }

  async function installUpdate() {
    try {
      isUpdating = true;
      addLog('Downloading and installing update...', 'system');
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('perform_update');
    } catch (e: any) {
      addLog(`Update failed: ${e.message || e}`, 'error');
      isUpdating = false;
    }
  }

  function dismissUpdate() {
    updateAvailable = null;
  }


  async function listenForRustUpdate() {
    if (window.location.hostname === 'localhost') return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<{ version: string; body: string }>('update-available', (event) => {
        if (!updateAvailable) {
          updateAvailable = { version: event.payload.version, body: event.payload.body };
          addLog(`Update available (backend): v${event.payload.version}`, 'system');
        }
      });
      await listen<string>('update-status', (event) => {
        updateStatus = event.payload;
      });
    } catch { /* dev mode */ }
  }

  onDestroy(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (keyboardHandler) {
      window.removeEventListener('keydown', keyboardHandler, true);
    }
  });

  function handleBeforeUnload() {
    saveTabsImmediate(getUIState());
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      saveTabsImmediate(getUIState());
    }
  }

  async function loadCollections() {
    try {
      const cols = await db.getCollections() as any[];
      for (const col of cols) {
        col.requests = await db.getRequests(col.id);
      }
      collections = cols;
      
      // Load variables in background (don't block UI)
      for (const col of cols) {
        variables.load(col.id).catch(() => {});
      }
    } catch (error) {
      console.error('Failed to load collections:', error);
    }
  }

  async function loadHistory() {
    try {
      history = (await db.getHistory(50)) as any[];
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }

  let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

  function setupKeyboardShortcuts() {
    let bodyTypeShortcutsEnabled = false;
    let bodyTypeTimeout: ReturnType<typeof setTimeout> | null = null;
    let helpSequence = '';
    let helpTimeout: ReturnType<typeof setTimeout> | null = null;
    
    keyboardHandler = (e: KeyboardEvent) => {
      // Ctrl+/ — toggle keyboard shortcuts panel
      if (e.ctrlKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        showShortcuts.update(v => !v);
        return;
      }

      // Ctrl+Shift+J — JWT Decoder
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        showToolsPanel.update(v => v === 'jwt' ? false : 'jwt');
        return;
      }

      // Ctrl+Shift+E — Base64/URL Encoder
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        showToolsPanel.update(v => v === 'encoder' ? false : 'encoder');
        return;
      }

      // Ctrl+Shift+Q — SQL Query Runner
      if (e.ctrlKey && e.shiftKey && e.key === 'Q') {
        e.preventDefault();
        showToolsPanel.update(v => v === 'sql' ? false : 'sql');
        return;
      }

      // Ctrl+Shift+X — Cookie Jar
      if (e.ctrlKey && e.shiftKey && e.key === 'X') {
        e.preventDefault();
        showToolsPanel.update(v => v === 'cookies' ? false : 'cookies');
        return;
      }

      // Ctrl+Shift+N — Network Diagnostics
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        showToolsPanel.update(v => v === 'diagnostics' ? false : 'diagnostics');
        return;
      }

      // Ctrl+Shift+Enter — toggle Tools panel fullscreen (only when the
      // tools panel is open).
      if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
        if ($showToolsPanel) {
          e.preventDefault();
          toolsFullscreen.update((v) => !v);
        }
        return;
      }

      // Ctrl+Shift+M — AI Chatbot: toggle the panel. The model itself is
      // loaded in the background at app start (see initChatbotFeature), so
      // the shortcut is purely a UI toggle now.
      if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        if ($chatbotSupported && $settings.chatbotEnabled) {
          e.preventDefault();
          showToolsPanel.update((v) => (v === 'chatbot' ? false : 'chatbot'));
          // If somehow the background load didn't fire (e.g. user installed
          // a model after launch), kick it now.
          if (!get(chatbotStatus).engineLoaded) {
            loadDefaultModel().then((res) => {
              if (res.kind === 'no-models') {
                addLog('AI: no model installed yet — pick one from the Models tab.', 'warn');
              } else if (res.kind === 'error') {
                addLog(`AI: failed to load ${res.modelId} — ${res.message}`, 'error');
              }
            });
          }
        }
        return;
      }

      // Ctrl+Shift+B — Diff Tool (standalone modal)
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        showDiffTool.update(v => !v);
        return;
      }

      // Ctrl+, — Settings
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        showToolsPanel.update(v => v === 'settings' ? false : 'settings');
        return;
      }

      // Ctrl+Shift+O — Import OpenAPI Spec
      if (e.ctrlKey && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        importOpenApi();
        return;
      }

      // Escape — close the topmost overlay/modal/panel (priority order)
      if (e.key === 'Escape') {
        const modals = $activeModals;
        if (modals.length > 0) {
          const topModal = modals[modals.length - 1];
          if (topModal.cancelable) {
            e.preventDefault();
            closeModal(topModal.id, -1);
          }
          return;
        }
        if ($showDiffTool) {
          e.preventDefault();
          showDiffTool.set(false);
          return;
        }
        if ($showToolsPanel) {
          e.preventDefault();
          showToolsPanel.set(false);
          return;
        }
        if ($showShortcuts) {
          e.preventDefault();
          showShortcuts.set(false);
          return;
        }
      }

      // When tools panel, shortcuts modal, or search picker is open, don't intercept request-specific keys
      if ($showToolsPanel || $showShortcuts || showSearchPicker) return;

      // Ctrl+F — open search picker
      if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
        e.preventDefault();
        showSearchPicker = true;
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle through tabs
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        e.shiftKey ? prevTab() : nextTab();
        return;
      }

      // Ctrl+T — new tab
      if (e.ctrlKey && !e.shiftKey && e.key === 't') {
        e.preventDefault();
        storeAddTab();
        return;
      }

      // Ctrl+W — close current tab
      if (e.ctrlKey && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        removeTab($activeTabId);
        return;
      }

      // Ctrl+M — open method/request type dropdown
      if (e.ctrlKey && !e.shiftKey && e.key === 'm') {
        e.preventDefault();
        const trigger = document.querySelector('.method-trigger') as HTMLButtonElement | null;
        if (trigger) {
          trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
        }
        return;
      }

      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        const tab = $activeTab;
        if (tab.method === 'WS' || tab.method === 'WSS') {
          if (tab.wsStatus === 'connected') {
            wsDisconnect(tab.id);
          } else if (tab.wsStatus !== 'connecting') {
            const hdrs: Record<string, string> = {};
            for (const h of (tab.headers || [])) {
              if (h.key && h.value) hdrs[h.key] = h.value;
            }
            wsConnect(tab.id, tab.url, Object.keys(hdrs).length > 0 ? hdrs : undefined);
          }
        } else if (tab.method === 'SSE') {
          if (tab.sseStatus === 'connected' || tab.sseStatus === 'reconnecting') {
            sseDisconnect(tab.id);
          } else if (tab.sseStatus !== 'connecting') {
            const hdrs: Record<string, string> = {};
            for (const h of (tab.headers || [])) {
              if (h.key && h.value) hdrs[h.key] = h.value;
            }
            sseConnect(tab.id, tab.url, Object.keys(hdrs).length > 0 ? hdrs : undefined);
          }
        } else {
          document.getElementById('send-btn')?.click();
        }
      } else if (e.ctrlKey && !e.shiftKey && e.key === 'l') {
        const tab = $activeTab;
        if (tab.method === 'WS' || tab.method === 'WSS') {
          e.preventDefault();
          clearWsMessages(tab.id);
        } else if (tab.method === 'SSE') {
          e.preventDefault();
          clearSseMessages(tab.id);
        }
      } else if (e.ctrlKey && !e.shiftKey && e.key === 'i') {
        e.preventDefault();
        const urlInput = document.getElementById('url-input') as HTMLInputElement | null;
        if (urlInput) {
          urlInput.focus();
          urlInput.select();
        }
      } else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveRequest();
      } else if (e.ctrlKey && !e.shiftKey && e.key === 'h') {
        e.preventDefault();
        activeRequestTab.set('headers');
        setTimeout(() => {
          const firstHeaderInput = document.querySelector('#headers-container .key-input') as HTMLInputElement | null;
          firstHeaderInput?.focus();
        }, 50);
      } else if (e.ctrlKey && !e.shiftKey && e.key === 'd') {
        e.preventDefault();
        activeRequestTab.set('docs');
      } else if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        if (get(activeRequestTab) !== 'docs') activeRequestTab.set('docs');
        requestBuilderRef?.toggleDocsMode();
      } else if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        activeRequestTab.set('body');
        bodyTypeShortcutsEnabled = true;
        if (bodyTypeTimeout) clearTimeout(bodyTypeTimeout);
        bodyTypeTimeout = setTimeout(() => { bodyTypeShortcutsEnabled = false; }, 2000);
        setTimeout(() => {
          const activeBodyInput = document.querySelector('.tab-pane.active .body-input, .tab-pane.active .cm-content') as HTMLElement | null;
          activeBodyInput?.focus();
        }, 50);
      } else if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        activeRequestTab.set('params');
        setTimeout(() => {
          const firstParamInput = document.querySelector('#params-container .key-input') as HTMLInputElement | null;
          firstParamInput?.focus();
        }, 50);
      } else if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        activeRequestTab.set('auth');
        setTimeout(() => {
          const firstAuthInput = document.querySelector('#auth-tab input, #auth-tab select') as HTMLElement | null;
          firstAuthInput?.focus();
        }, 50);
      } else if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        activeSidebarTab.set('collections');
      } else if (e.ctrlKey && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        activeSidebarTab.set('history');
      } else if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        requestBuilderRef?.formatBody();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        requestBuilderRef?.copyAsCurl();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        requestBuilderRef?.openCodeGen();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        responsePanelRef?.exportSnapshot();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        toggleResponseLayout();
      } else if (e.ctrlKey && (e.key === '{' || (e.shiftKey && e.key === '['))) {
        e.preventDefault();
        leftSidebarCollapsed.update(v => !v);
      } else if (e.ctrlKey && (e.key === '}' || (e.shiftKey && e.key === ']'))) {
        e.preventDefault();
        rightSidebarCollapsed.update(v => !v);
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === '1') {
        e.preventDefault();
        activeResponseTab.set('preview');
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === '2') {
        e.preventDefault();
        activeResponseTab.set('headers');
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === '3') {
        e.preventDefault();
        activeResponseTab.set('console');
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === '4') {
        e.preventDefault();
        activeResponseTab.set('diff');
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        activeResponseTab.set('preview');
        window.dispatchEvent(new CustomEvent('set-preview-mode', { detail: 'tree' }));
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        activeResponseTab.set('preview');
        window.dispatchEvent(new CustomEvent('set-preview-mode', { detail: 'raw' }));
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        activeResponseTab.set('preview');
        window.dispatchEvent(new CustomEvent('set-preview-mode', { detail: 'graph' }));
      } else if (bodyTypeShortcutsEnabled && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        const bodyTypes: Record<string, string> = {
          'j': 'json', 'x': 'xml', 'y': 'yaml', 'h': 'html', 't': 'text',
          'f': 'form-data', 'u': 'form-urlencoded', 'i': 'binary', 'g': 'graphql', 'n': 'none'
        };
        if (bodyTypes[key]) {
          e.preventDefault();
          bodyTypeShortcutsEnabled = false;
          if (bodyTypeTimeout) clearTimeout(bodyTypeTimeout);
          updateActiveTabBatch({ bodyType: bodyTypes[key] });
          setTimeout(() => {
            const activeBodyInput = document.querySelector('.tab-pane.active .body-input, .tab-pane.active .cm-content') as HTMLElement | null;
            activeBodyInput?.focus();
          }, 50);
        }
      }

      // PPPP help sequence — type "P" four times (unmodified) to open shortcuts
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key && e.key.length === 1) {
        if (helpTimeout) clearTimeout(helpTimeout);
        helpSequence += e.key.toUpperCase();
        if (helpSequence.length > 10) helpSequence = helpSequence.slice(-10);

        if (helpSequence.endsWith('PPPP') || helpSequence.endsWith('HHHH')) {
          e.preventDefault();
          showShortcuts.update(v => !v);
          helpSequence = '';
          return;
        }

        helpTimeout = setTimeout(() => { helpSequence = ''; }, 2000);
      }

    };

    window.addEventListener('keydown', keyboardHandler, true);
  }

  // Modal-heavy flows
  function getSerializableBodyContent(tab: Tab): string {
    if (tab.bodyType === 'form-data') {
      const pairs = tab.formDataPairs?.filter((p: any) => p.key);
      return pairs && pairs.length > 0 ? JSON.stringify(pairs) : '';
    }
    if (tab.bodyType === 'binary') {
      return tab.binaryFilePath || '';
    }
    if (tab.bodyType === 'graphql') {
      const vars = tab.graphqlVariables || '{}';
      try {
        return JSON.stringify({ query: tab.graphqlQuery || '', variables: JSON.parse(vars) });
      } catch {
        return JSON.stringify({ query: tab.graphqlQuery || '', variables: {} });
      }
    }
    return tab.bodyContent;
  }

  async function saveRequest() {
    const tab = $activeTab;
    if (!tab.url) {
      await modalManager.showWarning('URL Required', 'Please enter a URL first');
      return;
    }

    if (tab.requestId && tab.collectionId) {
      const collection = collections.find(c => c.id === tab.collectionId);
      const choice = await modalManager.showModal({
        type: 'question',
        title: 'Request Already Saved',
        message: `This request is already saved as <strong>"${tab.name}"</strong> in <strong>${collection?.name || 'a collection'}</strong>.`,
        detail: 'Would you like to update it or save as a new request?',
        buttons: ['Update Existing', 'Save as New', 'Cancel'],
        defaultButton: 0
      });

      if (choice === 2 || choice === -1) return;
      if (choice === 0) {
        const updateAuthData: any = {};
        if (tab.authType === 'basic') {
          updateAuthData.username = tab.authUsername;
          updateAuthData.password = tab.authPassword;
        } else if (tab.authType === 'bearer') {
          updateAuthData.token = tab.authToken;
        } else if (tab.authType === 'api-key') {
          updateAuthData.key = tab.authApiKey;
          updateAuthData.value = tab.authApiValue;
        }
        const requestData = {
          name: tab.name,
          method: tab.method,
          url: tab.url,
          headers: tab.headers.filter(h => h.key),
          params: tab.params.filter(p => p.key),
          bodyContent: getSerializableBodyContent(tab),
          bodyType: tab.bodyType,
          authType: tab.authType,
          authData: updateAuthData,
          description: tab.description
        };
        await db.updateRequest(tab.requestId, requestData);
        await loadCollections();
        addLog(`✓ Updated "${tab.name}" in ${collection?.name}`, 'system');
        return;
      }
    }

    if (collections.length === 0) {
      const create = await modalManager.confirm('No Collections', 'You need to create a collection first. Would you like to create one now?');
      if (create) {
        await createCollection();
        if (collections.length === 0) return;
      } else {
        return;
      }
    }

    const suggestedName = (tab.name && tab.name !== 'New Request') ? tab.name : tab.url.split('?')[0].split('/').filter(Boolean).pop() || 'Request';
    const collectionOptions = collections.map(c => ({ value: c.id.toString(), label: `${c.name} (${c.requests?.length || 0} requests)` }));
    const defaultCollectionValue = tab.collectionId?.toString() || collectionOptions[0]?.value || '';

    const result = await modalManager.showForm('Save Request', 'Enter request details:', [
      { id: 'name', label: 'Request Name', type: 'text', value: suggestedName, placeholder: 'My Request' },
      { id: 'collection', label: 'Collection', type: 'select', options: collectionOptions, value: defaultCollectionValue }
    ]);

    if (!result) return;
    const requestName = result.name || suggestedName;
    const collectionId = parseInt(result.collection);

    const authData: any = {};
    if (tab.authType === 'basic') {
      authData.username = tab.authUsername;
      authData.password = tab.authPassword;
    } else if (tab.authType === 'bearer') {
      authData.token = tab.authToken;
    } else if (tab.authType === 'api-key') {
      authData.key = tab.authApiKey;
      authData.value = tab.authApiValue;
    }

    const requestData = {
      name: requestName,
      method: tab.method,
      url: tab.url,
      headers: tab.headers.filter(h => h.key),
      params: tab.params.filter(p => p.key),
      bodyContent: getSerializableBodyContent(tab),
      bodyType: tab.bodyType,
      authType: tab.authType,
      authData,
      description: tab.description
    };

    const newRequestId = await db.createRequest(collectionId, requestData) as number;
    updateActiveTabBatch({ name: requestName, requestId: newRequestId, collectionId });
    await loadCollections();

    const collection = collections.find(c => c.id === collectionId);
    addLog(`✓ Saved "${requestName}" to ${collection?.name}`, 'system');
  }

  async function createCollection() {
    const result = await modalManager.showForm('Create Collection', 'Enter collection details:', [
      { id: 'name', label: 'Collection Name', type: 'text', value: '', placeholder: 'My Collection' },
      { id: 'description', label: 'Description (optional)', type: 'text', value: '', placeholder: 'A brief description...' }
    ]);

    if (!result || !result.name) return;
    await db.createCollection(result.name, result.description || '');
    await loadCollections();
    addLog(`✓ Created collection "${result.name}"`, 'system');
  }

  async function importCollections() {
    const openResult = await fileOps.showOpenDialog({ title: 'Import Collection (Ripple / Postman / Insomnia)', filters: ['.json'] });
    const filePath = Array.isArray(openResult) ? openResult[0] : openResult;
    if (!filePath) return;

    const readResult = await fileOps.readFile(filePath) as any;
    const content = typeof readResult === 'string' ? readResult : readResult?.data;
    if (!content) return;

    const result = importCollection(content);

    if (result.collections.length === 0) {
      await modalManager.showInfo('Import Failed', result.errors.length ? result.errors.join('\n') : 'No collections found in file.');
      return;
    }

    let totalRequests = 0;
    let totalVars = 0;

    for (const collection of result.collections) {
      const collectionId = await db.createCollection(collection.name, collection.description) as number;

      for (const req of collection.requests) {
        await db.createRequest(collectionId, {
          name: req.name,
          method: req.method,
          url: req.url,
          headers: req.headers,
          params: req.params,
          bodyType: req.bodyType,
          bodyContent: req.bodyContent,
          authType: req.authType,
          authData: req.authData,
          description: (req as any).description || '',
        });
        totalRequests++;
      }

      for (const v of collection.variables) {
        await db.setVariable(collectionId, v.key, v.value);
        totalVars++;
      }
    }

    await loadCollections();
    const formatLabel = result.format === 'postman-v2.1' ? 'Postman v2.1'
      : result.format === 'insomnia-v4' ? 'Insomnia'
      : 'Ripple';
    const summary = `Imported ${result.collections.length} collection(s) with ${totalRequests} request(s)${totalVars > 0 ? ` and ${totalVars} variable(s)` : ''} from ${formatLabel} format.`;
    const warnings = result.errors.length ? `\n\nWarnings:\n${result.errors.join('\n')}` : '';
    addLog(`✓ ${formatLabel} collection imported: ${totalRequests} requests`, 'system');
    await modalManager.showInfo('Collection Import Complete', summary + warnings);
  }

  async function importOpenApi() {
    const result = await fileOps.showOpenDialog({ title: 'Import OpenAPI / Swagger Spec', filters: ['.json', '.yaml', '.yml'] });
    const filePath = Array.isArray(result) ? result[0] : result;
    if (!filePath) return;

    const fileResult = await fileOps.readFile(filePath) as any;
    const raw = typeof fileResult === 'string' ? fileResult : fileResult?.data;
    if (!raw) return;
    const parsed = parseOpenApiSpec(raw);

    if (parsed.collections.length === 0) {
      await modalManager.showInfo('Import Failed', parsed.errors.length ? parsed.errors.join('\n') : 'No endpoints found in spec.');
      return;
    }

    let imported = 0;
    for (const collection of parsed.collections) {
      const collectionId = await db.createCollection(collection.name, collection.description) as number;
      for (const req of collection.requests) {
        await db.createRequest(collectionId, {
          name: req.name,
          method: req.method,
          url: req.url,
          headers: req.headers,
          params: req.params,
          bodyType: req.bodyType,
          bodyContent: req.bodyContent,
          authType: req.authType,
          authData: req.authData,
          description: req.description || '',
        });
        imported++;
      }
    }

    await loadCollections();
    const summary = `Imported ${parsed.collections.length} collection(s) with ${imported} request(s).`;
    const warnings = parsed.errors.length ? `\n\nWarnings:\n${parsed.errors.join('\n')}` : '';
    addLog(`✓ OpenAPI imported: ${imported} requests`, 'system');
    await modalManager.showInfo('OpenAPI Import Complete', summary + warnings);
  }

  async function exportCollections() {
    const result = await modalManager.showForm('Export Collections', 'Choose export options:', [
      { id: 'format', label: 'Format', type: 'select', options: [{ value: 'ripple', label: 'Ripple JSON' }, { value: 'postman', label: 'Postman v2.1' }], value: 'ripple' }
    ]);

    if (!result) return;
    const exportData = await db.exportCollections(null, result.format) as string;
    const filePath = await fileOps.showSaveDialog({ title: 'Save Export', defaultPath: `collections.${result.format === 'postman' ? 'postman_collection' : 'ripple'}.json` }) as string | null;
    if (filePath) {
      await fileOps.writeFile(filePath as string, exportData);
      addLog('✓ Collections exported', 'system');
    }
  }

  async function clearAllCollections() {
    const confirm = await modalManager.confirm('Clear All Collections', 'Are you sure you want to delete ALL collections? This cannot be undone.');
    if (!confirm) return;
    for (const col of collections) {
      await db.deleteCollection(col.id);
    }
    await loadCollections();
    addLog('✓ All collections cleared', 'system');
  }

  async function clearHistoryHandler() {
    const confirm = await modalManager.confirm('Clear History', 'Are you sure you want to clear all history?');
    if (!confirm) return;
    await db.clearHistory();
    await loadHistory();
    addLog('✓ History cleared', 'system');
  }

  function loadRequest(request: any) {
    const existingTab = findOpenTab(request.url, request.method);
    if (existingTab) {
      setActiveTab(existingTab.id);
      if (request.collectionId && existingTab.collectionId !== request.collectionId) {
        updateTab(existingTab.id, {
          collectionId: request.collectionId,
          requestId: request.id || existingTab.requestId,
          name: request.name || existingTab.name
        });
      }
      return;
    }

    // Parse headers - could be JSON string or array
    let headersData = request.headers || [];
    if (typeof headersData === 'string') {
      try { headersData = JSON.parse(headersData); } catch { headersData = []; }
    }
    const parsedHeaders = Array.isArray(headersData)
      ? headersData
      : Object.entries(headersData).map(([k, v]) => ({ key: k, value: v as string }));
    if (parsedHeaders.length === 0) parsedHeaders.push({ key: '', value: '' });

    // Parse params - could be JSON string or array
    let paramsData = request.params || [];
    if (typeof paramsData === 'string') {
      try { paramsData = JSON.parse(paramsData); } catch { paramsData = []; }
    }
    const parsedParams = Array.isArray(paramsData) ? paramsData : [];
    if (parsedParams.length === 0) parsedParams.push({ key: '', value: '' });

    // Parse auth data
    let authDataRaw = request.authData || request.auth_data || '{}';
    if (typeof authDataRaw === 'string') {
      try { authDataRaw = JSON.parse(authDataRaw); } catch { authDataRaw = {}; }
    }
    const loadedAuthType = request.authType || request.auth_type || 'none';

    const loadedBodyType = request.bodyType || request.body_type || 'json';
    const loadedBodyContent = request.bodyContent || request.body_content || '';

    const tabUpdate: any = {
      name: request.name,
      requestId: request.id,
      collectionId: request.collectionId,
      method: request.method,
      url: request.url,
      headers: parsedHeaders,
      params: parsedParams,
      bodyType: loadedBodyType,
      bodyContent: loadedBodyContent,
      authType: loadedAuthType,
      authToken: authDataRaw.token || '',
      authUsername: authDataRaw.username || '',
      authPassword: authDataRaw.password || '',
      authApiKey: authDataRaw.key || '',
      authApiValue: authDataRaw.value || '',
      description: request.description || ''
    };

    if (loadedBodyType === 'form-data' && loadedBodyContent) {
      try {
        const pairs = JSON.parse(loadedBodyContent);
        if (Array.isArray(pairs)) tabUpdate.formDataPairs = pairs;
        tabUpdate.bodyContent = '';
      } catch { /* not JSON, leave as-is */ }
    } else if (loadedBodyType === 'binary' && loadedBodyContent) {
      tabUpdate.binaryFilePath = loadedBodyContent;
      tabUpdate.binaryFileName = loadedBodyContent.replace(/\\/g, '/').split('/').pop() || '';
      tabUpdate.bodyContent = '';
    } else if (loadedBodyType === 'graphql' && loadedBodyContent) {
      try {
        const gql = JSON.parse(loadedBodyContent);
        tabUpdate.graphqlQuery = gql.query || '';
        tabUpdate.graphqlVariables = JSON.stringify(gql.variables || {}, null, 2);
        tabUpdate.bodyContent = '';
      } catch { /* not JSON, leave as-is */ }
    }

    const newTab = storeAddTab();
    updateTab(newTab.id, tabUpdate);
    addLog(`✓ Loaded "${request.name}"`, 'system');
  }

  function loadFromHistory(item: any) {
    const existingTab = findOpenTab(item.url, item.method);
    if (existingTab) {
      setActiveTab(existingTab.id);
      return;
    }

    // Parse headers - could be JSON string or object
    let headersObj = item.headers || {};
    if (typeof headersObj === 'string') {
      try { headersObj = JSON.parse(headersObj); } catch { headersObj = {}; }
    }
    const parsedHeaders = Array.isArray(headersObj) 
      ? headersObj 
      : Object.entries(headersObj).map(([k, v]) => ({ key: k, value: v as string }));
    if (parsedHeaders.length === 0) parsedHeaders.push({ key: '', value: '' });

    // Parse params - could be JSON string or array
    let paramsArr = item.params || [];
    if (typeof paramsArr === 'string') {
      try { paramsArr = JSON.parse(paramsArr); } catch { paramsArr = []; }
    }
    const parsedParams = Array.isArray(paramsArr) ? paramsArr : [];
    if (parsedParams.length === 0) parsedParams.push({ key: '', value: '' });

    // Parse response headers
    let respHeaders = item.responseHeaders || item.response_headers || {};
    if (typeof respHeaders === 'string') {
      try { respHeaders = JSON.parse(respHeaders); } catch { respHeaders = {}; }
    }

    // Parse response body
    let respBody = item.responseBody || item.response_body || '';
    if (typeof respBody === 'string' && respBody.startsWith('"') && respBody.endsWith('"')) {
      try { respBody = JSON.parse(respBody); } catch { /* keep as is */ }
    }

    // Parse auth data
    let histAuthData = item.authData || item.auth_data || '{}';
    if (typeof histAuthData === 'string') {
      try { histAuthData = JSON.parse(histAuthData); } catch { histAuthData = {}; }
    }
    const histAuthType = item.authType || item.auth_type || 'none';

    // Create a new tab with history data
    const newTab = storeAddTab();
    updateTab(newTab.id, {
      name: item.url.split('?')[0].split('/').filter(Boolean).pop() || 'History Request',
      method: item.method,
      url: item.url,
      headers: parsedHeaders,
      params: parsedParams,
      bodyType: item.bodyType || item.body_type || 'json',
      bodyContent: item.bodyContent || item.body_content || '',
      authType: histAuthType,
      authToken: histAuthData.token || '',
      authUsername: histAuthData.username || '',
      authPassword: histAuthData.password || '',
      authApiKey: histAuthData.key || '',
      authApiValue: histAuthData.value || '',
      responseStatus: item.status || item.status_code,
      responseTime: item.responseTime || item.response_time,
      responseHeaders: respHeaders,
      responseBody: respBody
    });
    addLog(`✓ Loaded from history`, 'system');
  }

  // Drag handlers
  function startDragLeft(e: MouseEvent) {
    isDraggingLeft = true;
    e.preventDefault();
    document.body.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  function startDragRight(e: MouseEvent) {
    isDraggingRight = true;
    e.preventDefault();
    document.body.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  function startDragBottom(e: MouseEvent) {
    isDraggingBottom = true;
    e.preventDefault();
    document.body.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }

  function handleDrag(e: MouseEvent) {
    if (!isDraggingLeft && !isDraggingRight && !isDraggingBottom) return;
    
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (isDraggingLeft) {
        leftSidebarWidth.set(Math.max(200, Math.min(600, e.clientX)));
      } else if (isDraggingRight) {
        rightSidebarWidth.set(Math.max(300, Math.min(800, window.innerWidth - e.clientX)));
      } else if (isDraggingBottom) {
        responsePanelHeight.set(Math.max(150, Math.min(600, window.innerHeight - e.clientY - 40)));
      }
    });
  }

  function stopDrag() {
    isDraggingLeft = false;
    isDraggingRight = false;
    isDraggingBottom = false;
    document.body.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
</script>

<svelte:window onmousemove={handleDrag} onmouseup={stopDrag} />

<svelte:head>
  <title>Ripple v{version}</title>
  <link rel="stylesheet" href="/app.css" />
  <link rel="stylesheet" href="/collapsed-sidebar.css" />
</svelte:head>

{#if updateAvailable}
  <div class="update-toast">
    <button class="update-toast-close" onclick={dismissUpdate} title="Dismiss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="update-toast-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>
    <div class="update-toast-body">
      <div class="update-toast-title">Update Available</div>
      <div class="update-toast-version">Ripple v{updateAvailable.version} is ready</div>
      {#if updateAvailable.body}
        <div class="update-toast-notes">{updateAvailable.body}</div>
      {/if}
    </div>
    <div class="update-toast-actions">
      <button class="update-toast-btn primary" onclick={installUpdate} disabled={isUpdating}>
        {#if isUpdating}
          <svg class="update-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
          {updateStatus || 'Installing...'}
        {:else}
          Install & Restart
        {/if}
      </button>
      <button class="update-toast-btn secondary" onclick={dismissUpdate}>
        Later
      </button>
    </div>
  </div>
{/if}

<div class="app-container" class:layout-bottom={$responseLayout === 'bottom'}>
  <LeftSidebar 
    {collections}
    {history}
    onCreateCollection={createCollection}
    onImportCollections={importCollections}
    onImportOpenApi={importOpenApi}
    onExportCollections={exportCollections}
    onClearAllCollections={clearAllCollections}
    onLoadCollections={loadCollections}
    onLoadRequest={loadRequest}
    onClearHistory={clearHistoryHandler}
    onLoadFromHistory={loadFromHistory}
    onLoadHistory={loadHistory}
    onDragLeft={startDragLeft}
  />

  <div class="work-area" class:layout-bottom={$responseLayout === 'bottom'}>
    <div class="main-content">
      <TabBar />
      <RequestBuilder bind:this={requestBuilderRef} onHistoryUpdate={loadHistory} />
    </div>

    <ResponsePanel 
      bind:this={responsePanelRef}
      {collections}
      onDragBottom={startDragBottom}
      onDragRight={startDragRight}
    />
  </div>
</div>

<AppFooter {version} />
<Modal />
<KeyboardShortcuts bind:show={showShortcutsVisible} />
<SearchPicker bind:show={showSearchPicker} on:select={handleSearchPickerSelect} />

{#if $showToolsPanel}
  <div
    class="tools-overlay"
    role="dialog"
    tabindex="-1"
    onclick={() => showToolsPanel.set(false)}
    onkeydown={(e) => { if (e.key === 'Escape') showToolsPanel.set(false); }}
  >
    <div class="tools-modal" class:tools-fullscreen={$toolsFullscreen} role="presentation" onclick={stopPropagation(bubble('click'))} onkeydown={stopPropagation(bubble('keydown'))}>
      <ToolsNavBar
        tabs={toolsNavTabs}
        value={typeof $showToolsPanel === 'string' ? $showToolsPanel : ''}
        waveColor={toolsWaveColor}
        on:select={(e) => showToolsPanel.set(e.detail.key as Exclude<typeof $showToolsPanel, false>)}
      >
        {#snippet actions()}
                <div  class="tools-nav-icon-actions">
            <button class="tools-close" onclick={() => toolsFullscreen.update(v => !v)} title={$toolsFullscreen ? 'Exit fullscreen (Ctrl+Shift+Enter)' : 'Fullscreen (Ctrl+Shift+Enter)'}>
              {#if $toolsFullscreen}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
              {:else}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
              {/if}
            </button>
            <button class="tools-close" onclick={() => showToolsPanel.set(false)} title="Close (Esc)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
            </button>
          </div>
              {/snippet}
      </ToolsNavBar>
      <div class="tools-body">
        {#if $showToolsPanel === 'chatbot' && $chatbotSupported && $settings.chatbotEnabled}
          <ChatbotPanel />
        {:else if $showToolsPanel === 'jwt'}
          <JwtDecoderPanel />
        {:else if $showToolsPanel === 'encoder'}
          <EncoderPanel />
        {:else if $showToolsPanel === 'sql'}
          <SqlRunnerPanel />
        {:else if $showToolsPanel === 'diagnostics'}
          <DiagnosticsPanel />
        {:else if $showToolsPanel === 'cookies'}
          <CookieJarPanel />
        {:else if $showToolsPanel === 'settings'}
          <SettingsPanel />
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if $showDiffTool}
  <div
    class="diff-overlay"
    role="dialog"
    tabindex="-1"
    onclick={() => showDiffTool.set(false)}
    onkeydown={(e) => { if (e.key === 'Escape') showDiffTool.set(false); }}
  >
    <div class="diff-modal" class:diff-fullscreen={diffFullscreen} role="presentation" onclick={stopPropagation(bubble('click'))} onkeydown={stopPropagation(bubble('keydown'))}>
      <div class="diff-modal-header">
        <span class="diff-modal-title">Diff / Compare</span>
        <div class="diff-modal-actions">
          <button class="diff-modal-btn" onclick={() => diffFullscreen = !diffFullscreen} title={diffFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {#if diffFullscreen}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
            {:else}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            {/if}
          </button>
          <button class="diff-modal-btn" onclick={() => showDiffTool.set(false)} title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
          </button>
        </div>
      </div>
      <div class="diff-modal-body">
        <DiffTool />
      </div>
    </div>
  </div>
{/if}

<style>
  .update-toast {
    position: fixed;
    bottom: 40px;
    right: 20px;
    width: 320px;
    background: var(--bg-secondary, #2C2C2C);
    border: 1px solid var(--border-color, #555);
    border-radius: 14px;
    padding: 20px;
    z-index: 9999;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.04);
    animation: toastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  @keyframes toastSlideIn {
    from { opacity: 0; transform: translateY(20px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .update-toast-close {
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    color: var(--text-secondary, #b0b0b0);
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .update-toast-close:hover {
    background: var(--bg-tertiary, #404040);
    color: var(--text-primary, #fff);
  }

  .update-toast-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
    color: var(--accent-color);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .update-toast-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .update-toast-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-primary, #fff);
  }

  .update-toast-version {
    font-size: 0.8rem;
    color: var(--text-secondary, #b0b0b0);
  }

  .update-toast-notes {
    font-size: 0.75rem;
    color: var(--text-secondary, #b0b0b0);
    opacity: 0.7;
    margin-top: 2px;
    line-height: 1.4;
    max-height: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .update-toast-actions {
    display: flex;
    gap: 8px;
  }

  .update-toast-btn {
    flex: 1;
    padding: 8px 0;
    border: none;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .update-toast-btn.primary {
    background: var(--accent-color, #8776D5);
    color: #fff;
  }
  .update-toast-btn.primary:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }
  .update-toast-btn.primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
    filter: none;
  }

  .update-toast-btn.secondary {
    background: var(--bg-tertiary, #404040);
    color: var(--text-secondary, #b0b0b0);
  }
  .update-toast-btn.secondary:hover {
    background: var(--bg-primary, #212121);
    color: var(--text-primary, #fff);
  }

  .update-spinner {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .tools-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: toolsFadeIn 150ms ease-out;
  }

  @keyframes toolsFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .tools-modal {
    /* The whole app already runs the pitch-black + blue theme via the root
       CSS variables in static/app.css, so we don't redeclare them here.
       The blue wave in the nav is the visual seam between the nav strip and
       the body. Non-fullscreen sits at 96vw/96vh — almost edge-to-edge but
       leaves a hairline of the host app visible so it still feels like a
       modal. Fullscreen (the .tools-fullscreen modifier below) goes the
       remaining ~4% and drops the border-radius. */
    width: 96vw;
    max-width: 96vw;
    height: 96vh;
    max-height: 96vh;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--accent-glow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: toolsSlideIn 200ms ease-out;
    transition: width 0.2s ease, height 0.2s ease, max-width 0.2s ease, max-height 0.2s ease, border-radius 0.2s ease;
  }

  .tools-modal.tools-fullscreen {
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
    border: none;
  }

  @keyframes toolsSlideIn {
    from { opacity: 0; transform: scale(0.95) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .tools-nav-icon-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tools-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    transition: all 0.15s;
  }

  .tools-close:hover {
    background: var(--bg-tertiary);
    color: var(--accent-color);
  }

  .tools-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Diff Tool standalone modal ── */
  .diff-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 9500;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: toolsFadeIn 150ms ease-out;
  }

  .diff-modal {
    width: 92vw;
    height: 88vh;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: toolsSlideIn 200ms ease-out;
    transition: all 0.2s ease;
  }

  .diff-fullscreen {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    border: none;
  }

  .diff-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .diff-modal-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }

  .diff-modal-actions {
    display: flex;
    gap: 4px;
  }

  .diff-modal-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }
  .diff-modal-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .diff-modal-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

</style>
