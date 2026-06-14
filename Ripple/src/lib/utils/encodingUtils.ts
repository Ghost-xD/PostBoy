export interface JwtDecodeResult {
  header: any;
  payload: any;
  signature: string;
  valid: boolean;
  error?: string;
}

export interface JwtExpiryInfo {
  expiresAt: Date | null;
  isExpired: boolean;
  expiresIn: string;
}

export function decodeJwt(token: string): JwtDecodeResult {
  try {
    const cleaned = token.trim().replace(/^Bearer\s+/i, '');
    const parts = cleaned.split('.');
    if (parts.length !== 3) {
      return { header: null, payload: null, signature: '', valid: false, error: 'Invalid JWT: expected 3 parts separated by dots' };
    }

    const decodeBase64Url = (str: string) => {
      let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      return JSON.parse(atob(base64));
    };

    const header = decodeBase64Url(parts[0]);
    const payload = decodeBase64Url(parts[1]);
    return { header, payload, signature: parts[2], valid: true };
  } catch (e: any) {
    return { header: null, payload: null, signature: '', valid: false, error: e.message };
  }
}

export function getJwtExpiry(payload: any): JwtExpiryInfo {
  if (!payload?.exp) {
    return { expiresAt: null, isExpired: false, expiresIn: 'No expiry' };
  }
  const expiresAt = new Date(payload.exp * 1000);
  const now = new Date();
  const isExpired = expiresAt < now;
  const diff = Math.abs(expiresAt.getTime() - now.getTime());

  const label = (val: number, unit: string) => `${val}${unit}`;
  const prefix = isExpired ? 'Expired ' : '';
  const suffix = isExpired ? ' ago' : '';

  if (diff < 60000) return { expiresAt, isExpired, expiresIn: `${prefix}${label(Math.round(diff / 1000), 's')}${suffix}` };
  if (diff < 3600000) return { expiresAt, isExpired, expiresIn: `${prefix}${label(Math.round(diff / 60000), 'm')}${suffix}` };
  if (diff < 86400000) return { expiresAt, isExpired, expiresIn: `${prefix}${label(Math.round(diff / 3600000), 'h')}${suffix}` };
  return { expiresAt, isExpired, expiresIn: `${prefix}${label(Math.round(diff / 86400000), 'd')}${suffix}` };
}

export function encodeBase64(input: string): string {
  try {
    return btoa(unescape(encodeURIComponent(input)));
  } catch {
    return btoa(input);
  }
}

export function decodeBase64(input: string): string {
  try {
    return decodeURIComponent(escape(atob(input)));
  } catch {
    return atob(input);
  }
}

export function encodeUrlString(input: string): string {
  return encodeURIComponent(input);
}

export function decodeUrlString(input: string): string {
  return decodeURIComponent(input);
}
