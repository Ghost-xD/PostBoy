import { describe, it, expect } from 'vitest';

/**
 * Utility functions for JWT decoding and Base64/URL encoding
 */

function decodeJwt(token: string): { header: any; payload: any; signature: string; valid: boolean; error?: string } {
  try {
    const parts = token.trim().split('.');
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
    const signature = parts[2];

    return { header, payload, signature, valid: true };
  } catch (e: any) {
    return { header: null, payload: null, signature: '', valid: false, error: e.message };
  }
}

function getJwtExpiry(payload: any): { expiresAt: Date | null; isExpired: boolean; expiresIn: string } {
  if (!payload || !payload.exp) {
    return { expiresAt: null, isExpired: false, expiresIn: 'No expiry' };
  }
  const expiresAt = new Date(payload.exp * 1000);
  const now = new Date();
  const isExpired = expiresAt < now;
  const diff = expiresAt.getTime() - now.getTime();

  if (isExpired) {
    const ago = Math.abs(diff);
    if (ago < 60000) return { expiresAt, isExpired, expiresIn: `Expired ${Math.round(ago / 1000)}s ago` };
    if (ago < 3600000) return { expiresAt, isExpired, expiresIn: `Expired ${Math.round(ago / 60000)}m ago` };
    return { expiresAt, isExpired, expiresIn: `Expired ${Math.round(ago / 3600000)}h ago` };
  }

  if (diff < 60000) return { expiresAt, isExpired, expiresIn: `${Math.round(diff / 1000)}s` };
  if (diff < 3600000) return { expiresAt, isExpired, expiresIn: `${Math.round(diff / 60000)}m` };
  return { expiresAt, isExpired, expiresIn: `${Math.round(diff / 3600000)}h` };
}

function encodeBase64(input: string): string {
  return btoa(input);
}

function decodeBase64(input: string): string {
  return atob(input);
}

function encodeUrl(input: string): string {
  return encodeURIComponent(input);
}

function decodeUrl(input: string): string {
  return decodeURIComponent(input);
}

describe('JWT Decoder', () => {
  const sampleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('should decode a valid JWT into header, payload, and signature', () => {
    const result = decodeJwt(sampleJwt);
    expect(result.valid).toBe(true);
    expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(result.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(result.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  it('should extract claims from payload', () => {
    const result = decodeJwt(sampleJwt);
    expect(result.payload.sub).toBe('1234567890');
    expect(result.payload.name).toBe('John Doe');
    expect(result.payload.iat).toBe(1516239022);
  });

  it('should handle JWT with expiry claim', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const payloadStr = btoa(JSON.stringify({ sub: '1', exp: futureExp })).replace(/=/g, '');
    const token = `eyJhbGciOiJIUzI1NiJ9.${payloadStr}.sig`;
    const result = decodeJwt(token);
    expect(result.valid).toBe(true);

    const expiry = getJwtExpiry(result.payload);
    expect(expiry.isExpired).toBe(false);
    expect(expiry.expiresAt).toBeInstanceOf(Date);
    expect(expiry.expiresIn).toMatch(/\d+(m|h)/);
  });

  it('should detect expired JWT', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const payloadStr = btoa(JSON.stringify({ sub: '1', exp: pastExp })).replace(/=/g, '');
    const token = `eyJhbGciOiJIUzI1NiJ9.${payloadStr}.sig`;
    const result = decodeJwt(token);
    const expiry = getJwtExpiry(result.payload);
    expect(expiry.isExpired).toBe(true);
    expect(expiry.expiresIn).toContain('Expired');
  });

  it('should handle JWT without exp claim', () => {
    const result = decodeJwt(sampleJwt);
    const expiry = getJwtExpiry(result.payload);
    expect(expiry.expiresAt).toBeNull();
    expect(expiry.expiresIn).toBe('No expiry');
  });

  it('should return error for invalid token format', () => {
    const result = decodeJwt('not.a.valid.jwt.token');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return error for token with only 2 parts', () => {
    const result = decodeJwt('header.payload');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expected 3 parts');
  });

  it('should return error for empty string', () => {
    const result = decodeJwt('');
    expect(result.valid).toBe(false);
  });

  it('should handle token with Bearer prefix stripped', () => {
    const tokenWithBearer = 'Bearer ' + sampleJwt;
    const stripped = tokenWithBearer.replace(/^Bearer\s+/i, '');
    const result = decodeJwt(stripped);
    expect(result.valid).toBe(true);
    expect(result.header.alg).toBe('HS256');
  });

  it('should decode RS256 JWT header', () => {
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'abc123' })).replace(/=/g, '');
    const payload = btoa(JSON.stringify({ sub: 'user', iss: 'auth0.com' })).replace(/=/g, '');
    const token = `${header}.${payload}.signature`;
    const result = decodeJwt(token);
    expect(result.valid).toBe(true);
    expect(result.header.alg).toBe('RS256');
    expect(result.header.kid).toBe('abc123');
    expect(result.payload.iss).toBe('auth0.com');
  });
});

describe('Base64 Encode/Decode', () => {
  it('should encode plain text to base64', () => {
    expect(encodeBase64('Hello World')).toBe('SGVsbG8gV29ybGQ=');
  });

  it('should decode base64 to plain text', () => {
    expect(decodeBase64('SGVsbG8gV29ybGQ=')).toBe('Hello World');
  });

  it('should roundtrip encode/decode', () => {
    const input = 'PostBoy API Testing Tool!';
    expect(decodeBase64(encodeBase64(input))).toBe(input);
  });

  it('should handle empty string', () => {
    expect(encodeBase64('')).toBe('');
    expect(decodeBase64('')).toBe('');
  });

  it('should encode JSON string', () => {
    const json = '{"key":"value","nested":{"a":1}}';
    const encoded = encodeBase64(json);
    expect(decodeBase64(encoded)).toBe(json);
  });

  it('should handle special characters', () => {
    const input = 'user:password@host/path?q=1&b=2';
    const encoded = encodeBase64(input);
    expect(decodeBase64(encoded)).toBe(input);
  });

  it('should throw on invalid base64 input', () => {
    expect(() => decodeBase64('not valid base64!!!')).toThrow();
  });
});

describe('URL Encode/Decode', () => {
  it('should encode URL-unsafe characters', () => {
    expect(encodeUrl('hello world')).toBe('hello%20world');
    expect(encodeUrl('key=value&other=123')).toBe('key%3Dvalue%26other%3D123');
  });

  it('should decode URL-encoded string', () => {
    expect(decodeUrl('hello%20world')).toBe('hello world');
    expect(decodeUrl('key%3Dvalue%26other%3D123')).toBe('key=value&other=123');
  });

  it('should roundtrip encode/decode', () => {
    const input = 'https://api.example.com/search?q=hello world&page=1';
    expect(decodeUrl(encodeUrl(input))).toBe(input);
  });

  it('should handle empty string', () => {
    expect(encodeUrl('')).toBe('');
    expect(decodeUrl('')).toBe('');
  });

  it('should encode special characters', () => {
    expect(encodeUrl('#')).toBe('%23');
    expect(encodeUrl('?')).toBe('%3F');
    expect(encodeUrl('/')).toBe('%2F');
    expect(encodeUrl('@')).toBe('%40');
  });

  it('should not double-encode already encoded strings', () => {
    const encoded = encodeUrl('hello world');
    const doubleEncoded = encodeUrl(encoded);
    expect(decodeUrl(decodeUrl(doubleEncoded))).toBe('hello world');
  });

  it('should handle unicode characters', () => {
    const input = 'café résumé naïve';
    expect(decodeUrl(encodeUrl(input))).toBe(input);
  });
});

// ── cURL Parser Tests ─────────────────────────────────────────

import { parseCurlCommand, generateCurlCommand } from '$lib/utils/curlParser';

describe('cURL Parser - Form Data', () => {
  it('should parse -F text fields', () => {
    const result = parseCurlCommand(`curl -X POST https://api.com/upload -F 'name=test' -F 'skip=false'`);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('POST');
    expect(result!.formFields).toHaveLength(2);
    expect(result!.formFields![0]).toEqual({ key: 'name', value: 'test', type: 'text' });
    expect(result!.formFields![1]).toEqual({ key: 'skip', value: 'false', type: 'text' });
  });

  it('should parse -F file fields with @ prefix', () => {
    const result = parseCurlCommand(`curl -X POST https://api.com/upload -F 'file=@/path/to/doc.pdf'`);
    expect(result!.formFields).toHaveLength(1);
    expect(result!.formFields![0]).toEqual({
      key: 'file',
      value: '/path/to/doc.pdf',
      type: 'file',
      fileName: 'doc.pdf',
    });
  });

  it('should handle mixed text and file form fields', () => {
    const result = parseCurlCommand(
      `curl -X POST https://api.com/upload -H 'Authorization: Bearer token' -F 'filenames=report.xlsx' -F 'files_b64=@report.xlsx' -F 'skip_cache=false'`
    );
    expect(result!.method).toBe('POST');
    expect(result!.formFields).toHaveLength(3);
    expect(result!.formFields![0].type).toBe('text');
    expect(result!.formFields![1].type).toBe('file');
    expect(result!.formFields![2].type).toBe('text');
    expect(result!.headers['Authorization']).toBe('Bearer token');
  });

  it('should default to POST when -F is used without -X', () => {
    const result = parseCurlCommand(`curl https://api.com/upload -F 'key=value'`);
    expect(result!.method).toBe('POST');
  });

  it('should not include formFields when no -F flags present', () => {
    const result = parseCurlCommand(`curl -X GET https://api.com/data`);
    expect(result!.formFields).toBeUndefined();
  });

  it('should extract filename from file path', () => {
    const result = parseCurlCommand(`curl -F 'doc=@C:\\Users\\test\\file.xlsx' https://api.com`);
    expect(result!.formFields![0].fileName).toBe('file.xlsx');
  });

  it('should detect $(base64 ...) as file field', () => {
    const result = parseCurlCommand(`curl -X POST https://api.com/upload -F 'files_b64=$(base64 -w 0 your_file.xlsx)'`);
    expect(result!.formFields).toHaveLength(1);
    expect(result!.formFields![0]).toEqual({
      key: 'files_b64',
      value: 'your_file.xlsx',
      type: 'file',
      fileName: 'your_file.xlsx',
    });
  });

  it('should handle full upload curl with base64 and metadata fields', () => {
    const result = parseCurlCommand(
      `curl -X POST "https://api.example.com/upload" -H "Authorization: Bearer token" -F "filenames=report.xlsx" -F "files_b64=$(base64 -w 0 report.xlsx)" -F "skip_cache=false"`
    );
    expect(result!.formFields).toHaveLength(3);
    expect(result!.formFields![0]).toEqual({ key: 'filenames', value: 'report.xlsx', type: 'text' });
    expect(result!.formFields![1]).toEqual({ key: 'files_b64', value: 'report.xlsx', type: 'file', fileName: 'report.xlsx' });
    expect(result!.formFields![2]).toEqual({ key: 'skip_cache', value: 'false', type: 'text' });
  });
});

describe('cURL Generator - Form Data', () => {
  it('should generate -F flags for form-data body type', () => {
    const curl = generateCurlCommand({
      method: 'POST',
      url: 'https://api.com/upload',
      headers: [],
      bodyType: 'form-data',
      formDataPairs: [
        { key: 'name', value: 'test', type: 'text' },
        { key: 'file', value: '/path/to/doc.pdf', type: 'file' },
      ],
    });
    expect(curl).toContain("-F 'name=test'");
    expect(curl).toContain("-F 'file=@/path/to/doc.pdf'");
    expect(curl).not.toContain('-d');
  });

  it('should not include -F for empty keys', () => {
    const curl = generateCurlCommand({
      method: 'POST',
      url: 'https://api.com/upload',
      headers: [],
      bodyType: 'form-data',
      formDataPairs: [
        { key: '', value: 'no-key', type: 'text' },
        { key: 'valid', value: 'yes', type: 'text' },
      ],
    });
    expect(curl).not.toContain('no-key');
    expect(curl).toContain("-F 'valid=yes'");
  });

  it('should use -d for non-form-data body types', () => {
    const curl = generateCurlCommand({
      method: 'POST',
      url: 'https://api.com/data',
      headers: [],
      body: '{"key":"value"}',
      bodyType: 'json',
    });
    expect(curl).toContain("-d");
    expect(curl).not.toContain("-F");
  });
});

// ── Response Utilities Tests ──────────────────────────────────

import {
  detectResponseType,
  isResponseLarge,
  truncateResponse,
  formatBytes,
  base64ToDataUrl,
  getImageMimeType,
  LARGE_RESPONSE_THRESHOLD,
  TRUNCATED_PREVIEW_SIZE,
} from '$lib/utils/responseUtils';

describe('Response Type Detection', () => {
  it('should detect JSON content type', () => {
    const info = detectResponseType('application/json; charset=utf-8', false);
    expect(info.type).toBe('json');
    expect(info.label).toBe('JSON');
    expect(info.previewable).toBe(false);
  });

  it('should detect HTML content type', () => {
    const info = detectResponseType('text/html', false);
    expect(info.type).toBe('html');
    expect(info.label).toBe('HTML');
  });

  it('should detect XML content type', () => {
    const info = detectResponseType('application/xml', false);
    expect(info.type).toBe('xml');
    expect(info.label).toBe('XML');
  });

  it('should detect image content types', () => {
    const pngInfo = detectResponseType('image/png', true);
    expect(pngInfo.type).toBe('image');
    expect(pngInfo.previewable).toBe(true);

    const jpegInfo = detectResponseType('image/jpeg', true);
    expect(jpegInfo.type).toBe('image');

    const svgInfo = detectResponseType('image/svg+xml', true);
    expect(svgInfo.type).toBe('image');

    const webpInfo = detectResponseType('image/webp', true);
    expect(webpInfo.type).toBe('image');
  });

  it('should detect PDF content type', () => {
    const info = detectResponseType('application/pdf', true);
    expect(info.type).toBe('pdf');
    expect(info.label).toBe('PDF');
    expect(info.previewable).toBe(true);
  });

  it('should detect binary content types', () => {
    const zipInfo = detectResponseType('application/zip', true);
    expect(zipInfo.type).toBe('binary');

    const audioInfo = detectResponseType('audio/mpeg', true);
    expect(audioInfo.type).toBe('binary');

    const videoInfo = detectResponseType('video/mp4', true);
    expect(videoInfo.type).toBe('binary');
  });

  it('should fall back to text for unknown non-binary types', () => {
    const info = detectResponseType('text/plain', false);
    expect(info.type).toBe('text');
    expect(info.label).toBe('Text');
  });

  it('should fall back to binary when isBinary is true and type is unknown', () => {
    const info = detectResponseType('application/x-custom', true);
    expect(info.type).toBe('binary');
  });

  it('should handle empty content type', () => {
    const textInfo = detectResponseType('', false);
    expect(textInfo.type).toBe('text');

    const binaryInfo = detectResponseType('', true);
    expect(binaryInfo.type).toBe('binary');
  });

  it('should strip charset from content type before matching', () => {
    const info = detectResponseType('application/json; charset=utf-8', false);
    expect(info.type).toBe('json');
    expect(info.mimeType).toBe('application/json');
  });
});

describe('Large Response Handling', () => {
  it('should detect large responses above threshold', () => {
    const largeBody = 'x'.repeat(LARGE_RESPONSE_THRESHOLD + 1);
    expect(isResponseLarge(largeBody)).toBe(true);
  });

  it('should not flag small responses', () => {
    const smallBody = '{"key": "value"}';
    expect(isResponseLarge(smallBody)).toBe(false);
  });

  it('should not flag responses at exactly the threshold', () => {
    const body = 'x'.repeat(LARGE_RESPONSE_THRESHOLD);
    expect(isResponseLarge(body)).toBe(false);
  });

  it('should truncate large responses to preview size', () => {
    const largeBody = 'x'.repeat(LARGE_RESPONSE_THRESHOLD + 100);
    const result = truncateResponse(largeBody);
    expect(result.isTruncated).toBe(true);
    expect(result.truncated.length).toBe(TRUNCATED_PREVIEW_SIZE);
    expect(result.totalSize).toBe(largeBody.length);
  });

  it('should not truncate small responses', () => {
    const body = '{"ok": true}';
    const result = truncateResponse(body);
    expect(result.isTruncated).toBe(false);
    expect(result.truncated).toBe(body);
    expect(result.totalSize).toBe(body.length);
  });
});

describe('formatBytes', () => {
  it('should format bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
    expect(formatBytes(5242880)).toBe('5.00 MB');
  });

  it('should handle zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('base64ToDataUrl', () => {
  it('should create a valid data URL', () => {
    const result = base64ToDataUrl('SGVsbG8=', 'text/plain');
    expect(result).toBe('data:text/plain;base64,SGVsbG8=');
  });

  it('should work with image mime types', () => {
    const result = base64ToDataUrl('abc123', 'image/png');
    expect(result).toMatch(/^data:image\/png;base64,/);
  });
});

describe('getImageMimeType', () => {
  it('should return the image content type when present', () => {
    expect(getImageMimeType('image/png')).toBe('image/png');
    expect(getImageMimeType('image/jpeg; charset=utf-8')).toBe('image/jpeg');
  });

  it('should default to image/png for non-image types', () => {
    expect(getImageMimeType('text/plain')).toBe('image/png');
    expect(getImageMimeType('')).toBe('image/png');
  });
});

// ── Response Search Tests ─────────────────────────────────────

describe('Response Search - Text Matching', () => {
  function countMatches(text: string, query: string): number {
    if (!query) return 0;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    return (text.match(regex) || []).length;
  }

  it('should count matches in a JSON response', () => {
    const body = '{"name": "John", "age": 30, "name2": "Johnny"}';
    expect(countMatches(body, 'John')).toBe(2);
    expect(countMatches(body, 'name')).toBe(2);
  });

  it('should be case-insensitive', () => {
    const body = '{"Name": "JOHN", "name": "john"}';
    expect(countMatches(body, 'name')).toBe(2);
    expect(countMatches(body, 'john')).toBe(2);
  });

  it('should return 0 for no matches', () => {
    const body = '{"key": "value"}';
    expect(countMatches(body, 'missing')).toBe(0);
  });

  it('should return 0 for empty query', () => {
    const body = '{"key": "value"}';
    expect(countMatches(body, '')).toBe(0);
  });

  it('should handle special regex characters in query', () => {
    const body = 'price is $10.00 (USD)';
    expect(countMatches(body, '$10.00')).toBe(1);
    expect(countMatches(body, '(USD)')).toBe(1);
  });

  it('should handle large text', () => {
    const body = 'ab'.repeat(10000) + 'MATCH' + 'cd'.repeat(10000);
    expect(countMatches(body, 'MATCH')).toBe(1);
  });
});

describe('Response Search - HTML Escaping for Tree Highlight', () => {
  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function highlightText(text: string, query: string): string {
    if (!query || !text) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const queryEscaped = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!queryEscaped) return escaped;
    const regex = new RegExp(`(${queryEscaped})`, 'gi');
    return escaped.replace(regex, '<mark class="tree-search-match">$1</mark>');
  }

  it('should wrap matching text with mark tags', () => {
    const result = highlightText('"name"', 'name');
    expect(result).toContain('<mark class="tree-search-match">name</mark>');
  });

  it('should handle multiple matches', () => {
    const result = highlightText('"name": "name_value"', 'name');
    const marks = result.match(/<mark/g);
    expect(marks).toHaveLength(2);
  });

  it('should escape HTML in the text', () => {
    const result = highlightText('<script>alert("xss")</script>', 'script');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;');
  });

  it('should return escaped text when no query', () => {
    const result = highlightText('"key": "value"', '');
    expect(result).toBe('&quot;key&quot;: &quot;value&quot;');
  });

  it('should handle special regex characters in query', () => {
    const result = highlightText('price: $10.00', '$10.00');
    expect(result).toContain('<mark class="tree-search-match">$10.00</mark>');
  });
});

// --- Collection Search Filtering ---

describe('Collection Search - collectionMatchesSearch', () => {
  function collectionMatchesSearch(collection: any, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    if ((collection.name || '').toLowerCase().includes(q)) return true;
    if (collection.requests) {
      return collection.requests.some((r: any) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.url || '').toLowerCase().includes(q) ||
        (r.method || '').toLowerCase().includes(q)
      );
    }
    return false;
  }

  it('should match all collections when query is empty', () => {
    expect(collectionMatchesSearch({ name: 'Users' }, '')).toBe(true);
  });

  it('should match by collection name (case insensitive)', () => {
    expect(collectionMatchesSearch({ name: 'User API' }, 'user')).toBe(true);
    expect(collectionMatchesSearch({ name: 'User API' }, 'USER')).toBe(true);
    expect(collectionMatchesSearch({ name: 'User API' }, 'api')).toBe(true);
  });

  it('should not match when collection name does not contain query', () => {
    expect(collectionMatchesSearch({ name: 'User API' }, 'payment')).toBe(false);
  });

  it('should match by request name', () => {
    const col = {
      name: 'Auth',
      requests: [{ name: 'Login', url: '/login', method: 'POST' }]
    };
    expect(collectionMatchesSearch(col, 'login')).toBe(true);
  });

  it('should match by request URL', () => {
    const col = {
      name: 'Auth',
      requests: [{ name: 'Login', url: 'https://api.example.com/auth', method: 'POST' }]
    };
    expect(collectionMatchesSearch(col, 'example.com')).toBe(true);
  });

  it('should match by request method', () => {
    const col = {
      name: 'Users',
      requests: [{ name: 'Get User', url: '/users/1', method: 'GET' }]
    };
    expect(collectionMatchesSearch(col, 'get')).toBe(true);
  });

  it('should not match when no request fields match', () => {
    const col = {
      name: 'Users',
      requests: [{ name: 'Get User', url: '/users/1', method: 'GET' }]
    };
    expect(collectionMatchesSearch(col, 'delete')).toBe(false);
  });

  it('should handle collection with no requests', () => {
    expect(collectionMatchesSearch({ name: 'Empty' }, 'login')).toBe(false);
    expect(collectionMatchesSearch({ name: 'Empty', requests: [] }, 'login')).toBe(false);
  });

  it('should handle null/undefined fields gracefully', () => {
    const col = { name: undefined, requests: [{ name: null, url: undefined, method: '' }] };
    expect(collectionMatchesSearch(col, 'test')).toBe(false);
  });
});

describe('Collection Search - requestMatchesSearch', () => {
  function requestMatchesSearch(request: any, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return (request.name || '').toLowerCase().includes(q) ||
           (request.url || '').toLowerCase().includes(q) ||
           (request.method || '').toLowerCase().includes(q);
  }

  it('should match all requests when query is empty', () => {
    expect(requestMatchesSearch({ name: 'Test', url: '/test', method: 'GET' }, '')).toBe(true);
  });

  it('should match by request name', () => {
    expect(requestMatchesSearch({ name: 'Create User', url: '/users', method: 'POST' }, 'create')).toBe(true);
  });

  it('should match by URL', () => {
    expect(requestMatchesSearch({ name: 'Create User', url: '/api/v1/users', method: 'POST' }, '/api/v1')).toBe(true);
  });

  it('should match by method', () => {
    expect(requestMatchesSearch({ name: 'Create User', url: '/users', method: 'POST' }, 'post')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(requestMatchesSearch({ name: 'Create User', url: '/users', method: 'POST' }, 'CREATE')).toBe(true);
    expect(requestMatchesSearch({ name: 'CREATE', url: '/users', method: 'POST' }, 'create')).toBe(true);
  });

  it('should not match when no fields contain query', () => {
    expect(requestMatchesSearch({ name: 'Create User', url: '/users', method: 'POST' }, 'delete')).toBe(false);
  });

  it('should handle null/undefined fields', () => {
    expect(requestMatchesSearch({ name: null, url: undefined, method: '' }, 'test')).toBe(false);
  });
});

describe('History Search - filteredHistory', () => {
  function filterHistory(history: any[], searchQuery: string, methodFilter: string) {
    return history.filter((item) => {
      const matchesSearch =
        !searchQuery || item.url.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesMethod = methodFilter === 'ALL' || item.method === methodFilter;
      return matchesSearch && matchesMethod;
    });
  }

  const sampleHistory = [
    { url: 'https://api.example.com/users', method: 'GET', status_code: 200 },
    { url: 'https://api.example.com/users', method: 'POST', status_code: 201 },
    { url: 'https://api.example.com/products', method: 'GET', status_code: 200 },
    { url: 'https://api.example.com/orders', method: 'DELETE', status_code: 204 },
    { url: 'https://payment.stripe.com/charge', method: 'POST', status_code: 400 },
  ];

  it('should return all items when no filter is applied', () => {
    expect(filterHistory(sampleHistory, '', 'ALL')).toHaveLength(5);
  });

  it('should filter by URL search query (case insensitive)', () => {
    expect(filterHistory(sampleHistory, 'users', 'ALL')).toHaveLength(2);
    expect(filterHistory(sampleHistory, 'USERS', 'ALL')).toHaveLength(2);
  });

  it('should filter by method', () => {
    expect(filterHistory(sampleHistory, '', 'GET')).toHaveLength(2);
    expect(filterHistory(sampleHistory, '', 'POST')).toHaveLength(2);
    expect(filterHistory(sampleHistory, '', 'DELETE')).toHaveLength(1);
  });

  it('should combine URL search and method filter', () => {
    expect(filterHistory(sampleHistory, 'users', 'GET')).toHaveLength(1);
    expect(filterHistory(sampleHistory, 'users', 'POST')).toHaveLength(1);
    expect(filterHistory(sampleHistory, 'stripe', 'POST')).toHaveLength(1);
  });

  it('should return empty when nothing matches', () => {
    expect(filterHistory(sampleHistory, 'nonexistent', 'ALL')).toHaveLength(0);
    expect(filterHistory(sampleHistory, 'users', 'DELETE')).toHaveLength(0);
  });

  it('should handle empty history', () => {
    expect(filterHistory([], 'test', 'ALL')).toHaveLength(0);
  });

  it('should match partial URLs', () => {
    expect(filterHistory(sampleHistory, 'example.com', 'ALL')).toHaveLength(4);
    expect(filterHistory(sampleHistory, 'stripe', 'ALL')).toHaveLength(1);
  });
});

// --- Search Picker Target Routing ---

describe('Search Picker - Target Routing', () => {
  const validTargets = ['collections', 'history', 'response'];

  it('should have exactly 3 search targets', () => {
    expect(validTargets).toHaveLength(3);
  });

  it('should include collections target', () => {
    expect(validTargets).toContain('collections');
  });

  it('should include history target', () => {
    expect(validTargets).toContain('history');
  });

  it('should include response target', () => {
    expect(validTargets).toContain('response');
  });

  function routeSearchTarget(target: string): string {
    if (target === 'collections') return 'focus-sidebar-search';
    if (target === 'history') return 'focus-sidebar-search';
    if (target === 'response') return 'open-response-search';
    return 'unknown';
  }

  it('should route collections to sidebar search event', () => {
    expect(routeSearchTarget('collections')).toBe('focus-sidebar-search');
  });

  it('should route history to sidebar search event', () => {
    expect(routeSearchTarget('history')).toBe('focus-sidebar-search');
  });

  it('should route response to response search event', () => {
    expect(routeSearchTarget('response')).toBe('open-response-search');
  });

  it('should return unknown for invalid target', () => {
    expect(routeSearchTarget('invalid')).toBe('unknown');
  });

  function getPickerOptionByShortcut(shortcut: string): string | null {
    const options = [
      { id: 'collections', shortcut: '1' },
      { id: 'history', shortcut: '2' },
      { id: 'response', shortcut: '3' },
    ];
    const match = options.find(o => o.shortcut === shortcut);
    return match ? match.id : null;
  }

  it('should map shortcut 1 to collections', () => {
    expect(getPickerOptionByShortcut('1')).toBe('collections');
  });

  it('should map shortcut 2 to history', () => {
    expect(getPickerOptionByShortcut('2')).toBe('history');
  });

  it('should map shortcut 3 to response', () => {
    expect(getPickerOptionByShortcut('3')).toBe('response');
  });

  it('should return null for invalid shortcut', () => {
    expect(getPickerOptionByShortcut('0')).toBeNull();
    expect(getPickerOptionByShortcut('4')).toBeNull();
    expect(getPickerOptionByShortcut('a')).toBeNull();
  });

  function cycleIndex(current: number, direction: 'up' | 'down', total: number): number {
    if (direction === 'down') return (current + 1) % total;
    return (current + total - 1) % total;
  }

  it('should cycle down correctly', () => {
    expect(cycleIndex(0, 'down', 3)).toBe(1);
    expect(cycleIndex(1, 'down', 3)).toBe(2);
    expect(cycleIndex(2, 'down', 3)).toBe(0);
  });

  it('should cycle up correctly', () => {
    expect(cycleIndex(0, 'up', 3)).toBe(2);
    expect(cycleIndex(1, 'up', 3)).toBe(0);
    expect(cycleIndex(2, 'up', 3)).toBe(1);
  });
});

