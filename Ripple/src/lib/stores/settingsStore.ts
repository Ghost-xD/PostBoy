import { writable, get } from 'svelte/store';
import { db } from '$lib/api/tauri';
import { applyTheme, type ThemeMode } from '$lib/utils/theme';

export interface AppSettings {
  theme: ThemeMode;
  requestTimeout: number;
  proxyEnabled: boolean;
  proxyUrl: string;
  sslVerification: boolean;
  followRedirects: boolean;
  maxRedirects: number;
  /**
   * User opt-in for the on-device LLM ("Son of Anton"). When `false`, the
   * Tools nav-bar pill, app-menu entry, and Ctrl+Shift+M shortcut are
   * hidden, AND `initChatbotFeature()` skips its background work — no
   * model registry fetch, no default model load, no llama-cpp context.
   * That makes cold start noticeably faster on machines where the user
   * never uses Anton. Independent of `chatbotSupported`, which reflects
   * the platform-level capability (the `chatbot` Cargo feature being
   * compiled in).
   */
  chatbotEnabled: boolean;
}

const DEFAULTS: AppSettings = {
  theme: 'dark',
  requestTimeout: 30,
  proxyEnabled: false,
  proxyUrl: '',
  sslVerification: false,
  followRedirects: true,
  maxRedirects: 10,
  chatbotEnabled: true,
};

export const settings = writable<AppSettings>({ ...DEFAULTS });

export async function loadSettings(): Promise<void> {
  try {
    const saved = await db.getSetting('app_settings') as string | null;
    if (saved) {
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      settings.set({ ...DEFAULTS, ...parsed });
    }
    applyTheme(get(settings).theme);
  } catch {
    settings.set({ ...DEFAULTS });
    applyTheme(DEFAULTS.theme);
  }
}

export async function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  settings.update(s => ({ ...s, [key]: value }));
  const current = get(settings);
  if (key === 'theme') applyTheme(current.theme);
  await db.setSetting('app_settings', JSON.stringify(current));
}

export async function toggleTheme(): Promise<void> {
  const next: ThemeMode = get(settings).theme === 'dark' ? 'light' : 'dark';
  await updateSetting('theme', next);
}

export async function resetSettings(): Promise<void> {
  settings.set({ ...DEFAULTS });
  applyTheme(DEFAULTS.theme);
  await db.setSetting('app_settings', JSON.stringify(DEFAULTS));
}

export function getSettingsForRequest() {
  const s = get(settings);
  return {
    timeout: s.requestTimeout,
    proxyUrl: s.proxyEnabled && s.proxyUrl ? s.proxyUrl : undefined,
    sslVerification: s.sslVerification,
    followRedirects: s.followRedirects,
    maxRedirects: s.maxRedirects,
  };
}
