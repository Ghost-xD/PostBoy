import type { AuthData } from '$lib/auth/types';
import { normalizeAuthType } from '$lib/auth/tabAuth';

export interface AuthCodegenInput {
  authType?: string;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  authApiKey?: string;
  authApiValue?: string;
  authData?: AuthData;
  url: string;
  /** Pre-resolved Authorization (and similar) from applyRequestAuth — preferred when present. */
  resolvedHeaders?: Record<string, string>;
}

export interface AuthCodegenResult {
  headers: Array<{ key: string; value: string }>;
  url: string;
  /** Lines to prepend (comments / setup). */
  preamble: string[];
  /** Extra curl flags (e.g. -u for basic). */
  curlFlags: string[];
  /** Python requests kwargs snippet (without trailing comma). */
  pythonExtra?: string;
}

function data(input: AuthCodegenInput): AuthData {
  return { ...(input.authData || {}) };
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildAuthForCodegen(input: AuthCodegenInput): AuthCodegenResult {
  const authType = normalizeAuthType(input.authType);
  const d = data(input);
  const headers: Array<{ key: string; value: string }> = [];
  let url = input.url;
  const preamble: string[] = [];
  const curlFlags: string[] = [];
  let pythonExtra: string | undefined;

  // Prefer headers already applied by Ripple (digest, hawk, aws, oauth refresh, etc.)
  if (input.resolvedHeaders) {
    for (const [key, value] of Object.entries(input.resolvedHeaders)) {
      if (key.toLowerCase() === 'authorization' || key.startsWith('X-Amz-')) {
        headers.push({ key, value });
      }
    }
    const tokenParam = d.queryParamName ? String(d.queryParamName) : 'access_token';
    try {
      const u = new URL(url);
      if (u.searchParams.has(tokenParam) && authType === 'oauth2') {
        /* url already has oauth query token */
      }
    } catch {
      /* ignore */
    }
  }

  switch (authType) {
    case 'none':
      break;

    case 'basic': {
      const username = input.authUsername || String(d.username || '');
      const password = input.authPassword ?? String(d.password ?? '');
      if (username && !headers.some((h) => h.key.toLowerCase() === 'authorization')) {
        headers.push({
          key: 'Authorization',
          value: `Basic ${btoa(`${username}:${password}`)}`,
        });
        curlFlags.push(`-u '${esc(username)}:${esc(password)}'`);
        pythonExtra = `auth=('${esc(username)}', '${esc(password)}')`;
      }
      break;
    }

    case 'bearer': {
      const token = input.authToken || String(d.token || d.accessToken || '');
      if (token && !headers.some((h) => h.key.toLowerCase() === 'authorization')) {
        headers.push({ key: 'Authorization', value: `Bearer ${token}` });
      }
      break;
    }

    case 'api-key': {
      const key = input.authApiKey || String(d.key || '');
      const value = input.authApiValue ?? String(d.value ?? '');
      const addTo = String(d.addTo || 'header');
      if (key) {
        if (addTo === 'query') {
          try {
            const u = new URL(url);
            u.searchParams.set(key, value);
            url = u.toString();
          } catch {
            preamble.push(`// Append query param: ${key}=${value}`);
          }
        } else if (!headers.some((h) => h.key === key)) {
          headers.push({ key, value });
        }
      }
      break;
    }

    case 'digest': {
      if (!headers.some((h) => h.key.toLowerCase() === 'authorization')) {
        preamble.push(
          '// Digest auth — use preemptive header from Ripple Send, or HTTPDigestAuth:',
          "// Python: requests.get(url, auth=HTTPDigestAuth('user', 'pass'))",
          '// JS: use digest-fetch or copy Authorization header after sending in Ripple'
        );
      }
      break;
    }

    case 'oauth2': {
      const token = String(d.accessToken || input.authToken || '');
      const addTo = String(d.addTokenTo || 'header');
      const prefix = String(d.headerPrefix || d.tokenType || 'Bearer');
      if (token) {
        if (addTo === 'query') {
          const param = String(d.queryParamName || 'access_token');
          try {
            const u = new URL(url);
            u.searchParams.set(param, token);
            url = u.toString();
          } catch {
            preamble.push(`// Append ?${param}=${token}`);
          }
        } else if (!headers.some((h) => h.key.toLowerCase() === 'authorization')) {
          headers.push({ key: 'Authorization', value: `${prefix} ${token}` });
        }
      } else if (d.accessTokenUrl) {
        preamble.push(
          `// OAuth 2.0: POST token to ${d.accessTokenUrl}`,
          `// grant_type=${d.grantType || 'client_credentials'} — then set Authorization: Bearer <access_token>`
        );
      }
      break;
    }

    case 'aws-sigv4': {
      if (!headers.some((h) => h.key.toLowerCase() === 'authorization')) {
        const region = String(d.region || 'us-east-1');
        const service = String(d.service || 'execute-api');
        preamble.push(
          '// AWS Signature Version 4 — sign with SDK or copy headers from Ripple Send:',
          `// region=${region}, service=${service}`,
          '// Python: use botocore.auth.SigV4Auth or requests-aws4auth',
          '// Node: @aws-sdk/signature-v4 or aws4 package'
        );
      }
      break;
    }

    case 'hawk': {
      if (!headers.some((h) => h.key.toLowerCase() === 'authorization')) {
        preamble.push(
          '// Hawk auth — use hawk client library or copy Authorization from Ripple Send:',
          '// Node: const Hawk = require("hawk"); Hawk.client.header(url, method, { credentials })'
        );
      }
      break;
    }

    case 'ntlm': {
      const username = String(d.username ?? '');
      const password = String(d.password ?? '');
      const domain = String(d.domain ?? '');
      const user = domain ? `${domain}\\${username}` : username;
      if (user) {
        curlFlags.push(`--ntlm -u '${esc(`${user}:${password}`)}'`);
        pythonExtra = `# NTLM: use requests-ntlm or curl --ntlm -u '${esc(user)}:****'`;
      }
      preamble.push('// NTLM is applied by the native HTTP client (libcurl)');
      break;
    }
    case 'client-cert': {
      const pfx = String(d.pfxPath ?? '');
      const cert = String(d.certPath ?? '');
      const key = String(d.keyPath ?? '');
      const pass = String(d.passphrase ?? '');
      if (pfx) {
        const certArg = pass ? `${pfx}:${pass}` : pfx;
        curlFlags.push(`--cert-type P12 --cert '${esc(certArg)}'`);
      } else if (cert && key) {
        curlFlags.push(`--cert '${esc(cert)}' --key '${esc(key)}'`);
        if (pass) curlFlags.push(`--pass '${esc(pass)}'`);
      }
      preamble.push('// Mutual TLS is applied by the native HTTP client (libcurl)');
      break;
    }
  }

  return { headers, url, preamble, curlFlags, pythonExtra };
}
