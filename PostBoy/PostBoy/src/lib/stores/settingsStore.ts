import { writable, get } from 'svelte/store';
import { db } from '$lib/api/tauri';

export interface AppSettings {
  requestTimeout: number;
  proxyEnabled: boolean;
  proxyUrl: string;
  sslVerification: boolean;
  followRedirects: boolean;
  maxRedirects: number;
}

const DEFAULTS: AppSettings = {
  requestTimeout: 30,
  proxyEnabled: false,
  proxyUrl: '',
  sslVerification: false,
  followRedirects: true,
  maxRedirects: 10,
};

export const settings = writable<AppSettings>({ ...DEFAULTS });

export async function loadSettings(): Promise<void> {
  try {
    const saved = await db.getSetting('app_settings') as string | null;
    if (saved) {
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      settings.set({ ...DEFAULTS, ...parsed });
    }
  } catch {
    settings.set({ ...DEFAULTS });
  }
}

export async function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  settings.update(s => ({ ...s, [key]: value }));
  const current = get(settings);
  await db.setSetting('app_settings', JSON.stringify(current));
}

export async function resetSettings(): Promise<void> {
  settings.set({ ...DEFAULTS });
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
