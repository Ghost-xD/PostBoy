import type { HawkAuthData } from './types';

async function hmacSha256Base64(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function randomNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(6))));
}

/** Build a Hawk Authorization header (HTTP Hawk scheme). */
export async function buildHawkAuthorization(
  method: string,
  url: string,
  data: HawkAuthData
): Promise<string | null> {
  const id = data.authId?.trim();
  const key = data.authKey?.trim();
  if (!id || !key) return null;

  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();
  const parsed = new URL(url);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const resource = parsed.pathname + parsed.search;
  const host = parsed.hostname;
  const algorithm = data.algorithm === 'sha1' ? 'sha1' : 'sha256';

  const macData = [
    'hawk.1.header',
    ts,
    nonce,
    method.toUpperCase(),
    resource,
    host,
    port,
    data.ext || '',
    '',
  ].join('\n');

  const mac = await hmacSha256Base64(key, macData);
  let header = `Hawk id="${id}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;
  if (data.ext?.trim()) header += `, ext="${data.ext.trim()}"`;
  if (algorithm !== 'sha256') header += `, alg="${algorithm}"`;
  return header;
}
