import { db } from '$lib/api/tauri';
import { addLog } from '$lib/stores/consoleStore';

export interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

export function parseSetCookieHeader(header: string, requestUrl: string): ParsedCookie | null {
  const parts = header.split(';').map(p => p.trim());
  if (parts.length === 0) return null;

  const nameValue = parts[0];
  const eqIndex = nameValue.indexOf('=');
  if (eqIndex < 0) return null;

  const name = nameValue.substring(0, eqIndex).trim();
  const value = nameValue.substring(eqIndex + 1).trim();

  if (!name) return null;

  let domain = '';
  let path = '/';
  let expires: string | null = null;
  let secure = false;
  let httpOnly = false;
  let sameSite = 'Lax';

  try {
    const url = new URL(requestUrl);
    domain = url.hostname;
    path = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1) || '/';
  } catch {
    // Fallback: use defaults
  }

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const attrEq = part.indexOf('=');
    const attrName = (attrEq >= 0 ? part.substring(0, attrEq) : part).trim().toLowerCase();
    const attrValue = attrEq >= 0 ? part.substring(attrEq + 1).trim() : '';

    switch (attrName) {
      case 'domain':
        if (attrValue) {
          domain = attrValue.startsWith('.') ? attrValue : attrValue;
        }
        break;
      case 'path':
        if (attrValue) path = attrValue;
        break;
      case 'expires':
        if (attrValue) {
          try {
            const d = new Date(attrValue);
            if (!isNaN(d.getTime())) {
              expires = d.toISOString();
            }
          } catch { /* ignore */ }
        }
        break;
      case 'max-age':
        if (attrValue) {
          const secs = parseInt(attrValue, 10);
          if (!isNaN(secs)) {
            if (secs <= 0) {
              expires = new Date(0).toISOString();
            } else {
              expires = new Date(Date.now() + secs * 1000).toISOString();
            }
          }
        }
        break;
      case 'secure':
        secure = true;
        break;
      case 'httponly':
        httpOnly = true;
        break;
      case 'samesite':
        if (['strict', 'lax', 'none'].includes(attrValue.toLowerCase())) {
          sameSite = attrValue.charAt(0).toUpperCase() + attrValue.slice(1).toLowerCase();
        }
        break;
    }
  }

  return { name, value, domain, path, expires, secure, httpOnly, sameSite };
}

export function parseCookies(setCookieHeaders: string[], requestUrl: string): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];
  for (const header of setCookieHeaders) {
    const cookie = parseSetCookieHeader(header, requestUrl);
    if (cookie) cookies.push(cookie);
  }
  return cookies;
}

export function domainMatches(cookieDomain: string, requestHost: string): boolean {
  const cd = cookieDomain.toLowerCase();
  const rh = requestHost.toLowerCase();

  if (cd.startsWith('.')) {
    const bare = cd.substring(1);
    return rh === bare || rh.endsWith(cd);
  }
  return rh === cd;
}

export function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (requestPath.startsWith(cookiePath)) {
    if (cookiePath.endsWith('/')) return true;
    if (requestPath.charAt(cookiePath.length) === '/') return true;
  }
  return false;
}

export function isExpired(expires: string | null): boolean {
  if (!expires) return false;
  try {
    return new Date(expires).getTime() < Date.now();
  } catch {
    return false;
  }
}

export async function captureCookies(
  collectionId: number,
  responseHeaders: Record<string, string> | Array<[string, string]>,
  requestUrl: string
): Promise<number> {
  const setCookieHeaders: string[] = [];

  if (Array.isArray(responseHeaders)) {
    for (const [key, value] of responseHeaders) {
      if (key.toLowerCase() === 'set-cookie') {
        setCookieHeaders.push(value);
      }
    }
  } else {
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (key.toLowerCase() === 'set-cookie') {
        setCookieHeaders.push(value);
      }
    }
  }

  if (setCookieHeaders.length === 0) return 0;

  const cookies = parseCookies(setCookieHeaders, requestUrl);
  let saved = 0;

  for (const cookie of cookies) {
    try {
      await db.setCookie(collectionId, cookie);
      saved++;
    } catch (err) {
      addLog(`Failed to save cookie ${cookie.name}: ${err}`, 'warn');
    }
  }

  if (saved > 0) {
    addLog(`Captured ${saved} cookie(s) from response`, 'info');
  }

  return saved;
}

export async function injectCookies(
  collectionId: number,
  url: string
): Promise<string> {
  try {
    const cookies = await db.getCookiesForUrl(collectionId, url) as any[];
    if (!cookies || cookies.length === 0) return '';

    return cookies
      .map((c: any) => `${c.name}=${c.value}`)
      .join('; ');
  } catch (err) {
    addLog(`Failed to inject cookies: ${err}`, 'warn');
    return '';
  }
}
