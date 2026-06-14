import { describe, it, expect, vi, afterEach } from 'vitest';

describe('formatShortcut', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('joins macOS glyphs with + separators', async () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
    });
    vi.resetModules();
    const { formatShortcut, shortcutTitle } = await import('$lib/utils/platform');
    expect(formatShortcut('Ctrl+Shift+A')).toBe('⌘ ⇧ A');
    expect(shortcutTitle('Authorization', 'Ctrl+Shift+A')).toBe('Authorization (⌘ ⇧ A)');
  });

  it('keeps + separators on Windows-style combos', async () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    vi.resetModules();
    const { formatShortcut } = await import('$lib/utils/platform');
    expect(formatShortcut('Ctrl+Shift+R')).toBe('Ctrl+Shift+R');
  });
});
