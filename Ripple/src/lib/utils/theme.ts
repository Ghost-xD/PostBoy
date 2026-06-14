export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'ripple-theme';

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  document.body.style.backgroundColor = theme === 'light' ? '#ffffff' : '#000000';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore quota / private mode
  }
}

export function readCachedTheme(): ThemeMode | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const cached = localStorage.getItem(THEME_STORAGE_KEY);
    return cached === 'light' || cached === 'dark' ? cached : null;
  } catch {
    return null;
  }
}
