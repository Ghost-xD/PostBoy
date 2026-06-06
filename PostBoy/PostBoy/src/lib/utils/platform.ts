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
