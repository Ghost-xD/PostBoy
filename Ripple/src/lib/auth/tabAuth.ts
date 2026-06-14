import type { Tab } from '$lib/stores/tabStore';
import type { AuthData } from './types';

/** Normalize legacy `apikey` → `api-key`. */
export function normalizeAuthType(authType: string | undefined): string {
  if (!authType || authType === 'noauth') return 'none';
  if (authType === 'apikey') return 'api-key';
  return authType;
}

/** Build auth_data JSON for DB persistence from a tab. */
export function serializeAuthFromTab(tab: Pick<Tab, 'authType' | 'authData' | 'authUsername' | 'authPassword' | 'authToken' | 'authApiKey' | 'authApiValue'>): {
  authType: string;
  authData: AuthData;
} {
  const authType = normalizeAuthType(tab.authType);
  const authData: AuthData = { ...(tab.authData || {}) };

  if (authType === 'basic') {
    authData.username = tab.authUsername || authData.username || '';
    authData.password = tab.authPassword ?? authData.password ?? '';
  } else if (authType === 'bearer') {
    authData.token = tab.authToken || authData.token || '';
  } else if (authType === 'api-key') {
    authData.key = tab.authApiKey || authData.key || '';
    authData.value = tab.authApiValue ?? authData.value ?? '';
    if (!authData.addTo) authData.addTo = 'header';
  }

  return { authType, authData };
}

/** Merge persisted auth into tab fields (legacy + authData). */
export function authFieldsFromStored(
  authType: string,
  authDataRaw: AuthData | string
): Partial<Tab> {
  let authData: AuthData = {};
  if (typeof authDataRaw === 'string') {
    try {
      authData = JSON.parse(authDataRaw);
    } catch {
      authData = {};
    }
  } else if (authDataRaw) {
    authData = { ...authDataRaw };
  }

  const normalized = normalizeAuthType(authType);
  const patch: Partial<Tab> = {
    authType: normalized,
    authData,
    authUsername: String(authData.username ?? ''),
    authPassword: String(authData.password ?? ''),
    authToken: String(authData.token ?? authData.accessToken ?? ''),
    authApiKey: String(authData.key ?? ''),
    authApiValue: String(authData.value ?? ''),
  };
  return patch;
}

export function updateTabAuthData(
  current: AuthData,
  field: string,
  value: string | number | boolean | undefined
): AuthData {
  return { ...current, [field]: value };
}
