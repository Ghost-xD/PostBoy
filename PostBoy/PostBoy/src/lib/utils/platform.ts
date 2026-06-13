// Platform detection + shortcut-glyph helpers.
//
// macOS uses Cmd (⌘) as the primary chord modifier where Windows/Linux use
// Ctrl, and renders modifier keys as glyphs (⌘ ⇧ ⌥ ⌃) instead of words. We
// centralise both the detection and the glyph mapping here so the keyboard
// handler and the shortcuts cheat sheet stay consistent.

export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  (/(Mac|iPhone|iPad|iPod)/i.test(
    (navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent
  ));

// Map a single shortcut token to its display form. On macOS the modifier
// words become the familiar glyphs; on Windows/Linux the original text is
// kept (there is no universally-recognised Ctrl glyph there).
export function displayKey(token: string): string {
  const t = token.trim();
  if (!isMac) {
    // Normalise a couple of labels so they read nicely everywhere.
    if (t === 'Escape') return 'Esc';
    if (t === 'Control') return 'Ctrl';
    if (t === 'Option') return 'Alt';
    return t;
  }
  switch (t) {
    case 'Ctrl':
    case 'Cmd':
    case 'Command':
      return '⌘';
    // The literal Control key (⌃). Used where a shortcut intentionally stays
    // on Control even on macOS (e.g. tab cycling, since ⌘Tab is the OS app
    // switcher).
    case 'Control':
      return '⌃';
    case 'Shift':
      return '⇧';
    case 'Alt':
    case 'Option':
      return '⌥';
    case 'Enter':
    case 'Return':
      return '⏎';
    case 'Esc':
    case 'Escape':
      return '⎋';
    case 'Tab':
      return '⇥';
    default:
      return t;
  }
}

// Render a full shortcut chord for tooltips and titles. Accepts canonical
// Windows-style combos ("Ctrl+Shift+J", "Alt+1") and maps them to the local
// modifier names/glyphs (⌘/⌥ on macOS, Ctrl/Alt elsewhere).
export function formatShortcut(combo: string): string {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (isMac) {
    return parts.map((p) => displayKey(p)).join('');
  }
  return parts
    .map((p) => {
      if (p === 'Cmd' || p === 'Command') return 'Ctrl';
      if (p === 'Option') return 'Alt';
      return p;
    })
    .join('+');
}

/** Tooltip helper: `"Preview" + "Alt+1"` → `"Preview (⌥1)"` on macOS. */
export function shortcutTitle(label: string, combo: string): string {
  return `${label} (${formatShortcut(combo)})`;
}

/** Primary modifier for most app shortcuts: ⌘ on macOS, Ctrl elsewhere. */
export function isPrimaryModifier(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** SQL Runner chord. On macOS ⌘⇧Q is reserved for Log Out, so we bind ⌃⇧Q instead. */
export const SQL_RUNNER_SHORTCUT = isMac ? 'Control+Shift+Q' : 'Ctrl+Shift+Q';

/** Toggle light / dark theme. */
export const THEME_TOGGLE_SHORTCUT = 'Ctrl+Shift+U';

/** Environments panel (request-bar companion). */
export const ENVIRONMENTS_SHORTCUT = 'Ctrl+Shift+V';

/**
 * Global variables panel.
 * Uses Shift+Y so it does not collide with the body-type chord Ctrl+B → Y (YAML),
 * which only accepts an unmodified Y key.
 */
export const GLOBALS_SHORTCUT = 'Ctrl+Shift+Y';

export function matchesSqlRunnerShortcut(e: KeyboardEvent): boolean {
  if (e.altKey || !e.shiftKey || (e.key !== 'Q' && e.key !== 'q')) return false;
  if (isMac) return e.ctrlKey && !e.metaKey;
  return e.ctrlKey;
}

export function matchesEnvironmentsShortcut(e: KeyboardEvent): boolean {
  return isPrimaryModifier(e) && e.shiftKey && (e.key === 'V' || e.key === 'v');
}

export function matchesGlobalsShortcut(e: KeyboardEvent): boolean {
  return isPrimaryModifier(e) && e.shiftKey && (e.key === 'Y' || e.key === 'y');
}
