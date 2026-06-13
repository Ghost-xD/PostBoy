import { md5Hex } from './md5';
import type { DigestAuthData } from './types';

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a preemptive HTTP Digest Authorization header (RFC 2617, MD5). */
export function buildDigestAuthorization(
  method: string,
  uri: string,
  data: DigestAuthData
): string | null {
  const username = data.username?.trim();
  const password = data.password ?? '';
  const realm = data.realm?.trim() || 'Ripple';
  if (!username) return null;

  const nonce = data.nonce?.trim() || randomHex(8);
  const nc = data.nonceCount?.trim() || '00000001';
  const cnonce = data.clientNonce?.trim() || randomHex(8);
  const qop = data.qop?.trim() || 'auth';
  const algorithm = (data.algorithm || 'MD5').toUpperCase();
  if (algorithm !== 'MD5') return null;

  const ha1 = md5Hex(`${username}:${realm}:${password}`);
  const ha2 = md5Hex(`${method.toUpperCase()}:${uri}`);
  let response: string;
  if (qop === 'auth' || qop === 'auth-int') {
    response = md5Hex(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5Hex(`${ha1}:${nonce}:${ha2}`);
  }

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (data.opaque?.trim()) parts.push(`opaque="${data.opaque.trim()}"`);

  return `Digest ${parts.join(', ')}`;
}

export function digestRequestUri(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
