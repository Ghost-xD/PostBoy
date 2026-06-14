import type { AwsSigV4AuthData } from './types';

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return hex(new Uint8Array(buf));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function uriEncode(str: string, encodeSlash = true): string {
  return str
    .split('')
    .map((c) => {
      if (/[A-Za-z0-9-_.~]/.test(c)) return c;
      if (c === '/' && !encodeSlash) return c;
      return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

async function getSignatureKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  let key: ArrayBuffer | Uint8Array = new TextEncoder().encode(`AWS4${secret}`);
  for (const chunk of [date, region, service, 'aws4_request']) {
    key = await hmacSha256(key, chunk);
  }
  return key as ArrayBuffer;
}

export interface AwsSignResult {
  headers: Record<string, string>;
  url: string;
}

/** Sign an HTTP request with AWS Signature Version 4. */
export async function signAwsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  data: AwsSigV4AuthData
): Promise<AwsSignResult | null> {
  const accessKey = data.accessKey?.trim();
  const secretKey = data.secretKey?.trim();
  const region = data.region?.trim() || 'us-east-1';
  const service = data.service?.trim() || 'execute-api';
  if (!accessKey || !secretKey) return null;

  const parsed = new URL(url);
  const amzDate = headers['X-Amz-Date'] || headers['x-amz-date'] || isoAmzDate();
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body || '');

  const signedHeadersSet = new Set<string>(['host', 'x-amz-date']);
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowerHeaders[k.toLowerCase()] = v.trim();
  }
  lowerHeaders['host'] = parsed.host;
  lowerHeaders['x-amz-date'] = amzDate;
  if (data.sessionToken?.trim()) {
    lowerHeaders['x-amz-security-token'] = data.sessionToken.trim();
    signedHeadersSet.add('x-amz-security-token');
  }

  const canonicalHeaders = [...signedHeadersSet]
    .sort()
    .map((h) => `${h}:${lowerHeaders[h]}\n`)
    .join('');
  const signedHeaders = [...signedHeadersSet].sort().join(';');
  const canonicalUri = uriEncode(parsed.pathname || '/', false);
  const canonicalQuery = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join('&');

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(secretKey, dateStamp, region, service);
  const signature = hex(new Uint8Array(await hmacSha256(signingKey, stringToSign)));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const outHeaders: Record<string, string> = { ...headers, Authorization: authorization, 'X-Amz-Date': amzDate };
  if (data.sessionToken?.trim()) {
    outHeaders['X-Amz-Security-Token'] = data.sessionToken.trim();
  }

  return { headers: outHeaders, url };
}

function isoAmzDate(d = new Date()): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}
