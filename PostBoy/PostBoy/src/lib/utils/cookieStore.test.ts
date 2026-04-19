import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSetCookieHeader,
  parseCookies,
  domainMatches,
  pathMatches,
  isExpired,
} from '$lib/stores/cookieStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}));

describe('Cookie Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseSetCookieHeader', () => {
    it('should parse a simple Set-Cookie header', () => {
      const cookie = parseSetCookieHeader('session=abc123', 'https://example.com/api');
      expect(cookie).not.toBeNull();
      expect(cookie!.name).toBe('session');
      expect(cookie!.value).toBe('abc123');
      expect(cookie!.domain).toBe('example.com');
    });

    it('should parse a cookie with explicit domain', () => {
      const cookie = parseSetCookieHeader('id=42; Domain=.example.com', 'https://api.example.com/v1');
      expect(cookie!.domain).toBe('.example.com');
    });

    it('should parse a cookie with path', () => {
      const cookie = parseSetCookieHeader('token=xyz; Path=/api', 'https://example.com/api/v1');
      expect(cookie!.path).toBe('/api');
    });

    it('should parse Secure flag', () => {
      const cookie = parseSetCookieHeader('token=xyz; Secure', 'https://example.com');
      expect(cookie!.secure).toBe(true);
    });

    it('should parse HttpOnly flag', () => {
      const cookie = parseSetCookieHeader('sid=abc; HttpOnly', 'https://example.com');
      expect(cookie!.httpOnly).toBe(true);
    });

    it('should parse SameSite attribute', () => {
      const strict = parseSetCookieHeader('a=1; SameSite=Strict', 'https://example.com');
      expect(strict!.sameSite).toBe('Strict');

      const lax = parseSetCookieHeader('a=1; SameSite=Lax', 'https://example.com');
      expect(lax!.sameSite).toBe('Lax');

      const none = parseSetCookieHeader('a=1; SameSite=None', 'https://example.com');
      expect(none!.sameSite).toBe('None');
    });

    it('should parse Expires attribute', () => {
      const cookie = parseSetCookieHeader(
        'a=1; Expires=Thu, 01 Jan 2099 00:00:00 GMT',
        'https://example.com'
      );
      expect(cookie!.expires).not.toBeNull();
      expect(new Date(cookie!.expires!).getFullYear()).toBe(2099);
    });

    it('should parse Max-Age attribute', () => {
      const before = Date.now();
      const cookie = parseSetCookieHeader('a=1; Max-Age=3600', 'https://example.com');
      const after = Date.now();
      expect(cookie!.expires).not.toBeNull();
      const expiresMs = new Date(cookie!.expires!).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 3600 * 1000 - 100);
      expect(expiresMs).toBeLessThanOrEqual(after + 3600 * 1000 + 100);
    });

    it('should handle Max-Age=0 as immediate expiry', () => {
      const cookie = parseSetCookieHeader('a=1; Max-Age=0', 'https://example.com');
      expect(cookie!.expires).not.toBeNull();
      expect(new Date(cookie!.expires!).getTime()).toBe(0);
    });

    it('should parse all attributes combined', () => {
      const cookie = parseSetCookieHeader(
        'session=token123; Domain=.example.com; Path=/app; Secure; HttpOnly; SameSite=Strict',
        'https://app.example.com/app/dashboard'
      );
      expect(cookie!.name).toBe('session');
      expect(cookie!.value).toBe('token123');
      expect(cookie!.domain).toBe('.example.com');
      expect(cookie!.path).toBe('/app');
      expect(cookie!.secure).toBe(true);
      expect(cookie!.httpOnly).toBe(true);
      expect(cookie!.sameSite).toBe('Strict');
    });

    it('should return null for empty name', () => {
      const cookie = parseSetCookieHeader('=value', 'https://example.com');
      expect(cookie).toBeNull();
    });

    it('should handle value with equals sign', () => {
      const cookie = parseSetCookieHeader('token=abc=def=', 'https://example.com');
      expect(cookie!.name).toBe('token');
      expect(cookie!.value).toBe('abc=def=');
    });

    it('should default path from request URL', () => {
      const cookie = parseSetCookieHeader('a=1', 'https://example.com/api/v1/users');
      expect(cookie!.path).toBe('/api/v1/');
    });

    it('should default domain from request URL', () => {
      const cookie = parseSetCookieHeader('a=1', 'https://sub.example.com/page');
      expect(cookie!.domain).toBe('sub.example.com');
    });

    it('should default SameSite to Lax', () => {
      const cookie = parseSetCookieHeader('a=1', 'https://example.com');
      expect(cookie!.sameSite).toBe('Lax');
    });
  });

  describe('parseCookies', () => {
    it('should parse multiple Set-Cookie headers', () => {
      const result = parseCookies(
        ['a=1; Path=/', 'b=2; Secure', 'c=3'],
        'https://example.com'
      );
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('a');
      expect(result[1].name).toBe('b');
      expect(result[2].name).toBe('c');
    });

    it('should skip invalid headers', () => {
      const result = parseCookies(
        ['good=value', '=invalid', 'also_good=yes'],
        'https://example.com'
      );
      expect(result).toHaveLength(2);
    });

    it('should return empty for empty input', () => {
      expect(parseCookies([], 'https://example.com')).toHaveLength(0);
    });
  });

  describe('domainMatches', () => {
    it('should match exact domain', () => {
      expect(domainMatches('example.com', 'example.com')).toBe(true);
    });

    it('should match with leading dot for subdomain', () => {
      expect(domainMatches('.example.com', 'sub.example.com')).toBe(true);
    });

    it('should match with leading dot for exact', () => {
      expect(domainMatches('.example.com', 'example.com')).toBe(true);
    });

    it('should not match different domain', () => {
      expect(domainMatches('example.com', 'other.com')).toBe(false);
    });

    it('should not match partial domain', () => {
      expect(domainMatches('.example.com', 'notexample.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(domainMatches('Example.COM', 'example.com')).toBe(true);
    });

    it('should match deep subdomain', () => {
      expect(domainMatches('.example.com', 'a.b.c.example.com')).toBe(true);
    });
  });

  describe('pathMatches', () => {
    it('should match exact path', () => {
      expect(pathMatches('/', '/')).toBe(true);
    });

    it('should match prefix path with trailing slash', () => {
      expect(pathMatches('/api/', '/api/users')).toBe(true);
    });

    it('should match prefix path where next char is slash', () => {
      expect(pathMatches('/api', '/api/users')).toBe(true);
    });

    it('should not match non-prefix', () => {
      expect(pathMatches('/api', '/other')).toBe(false);
    });

    it('should match root path for anything', () => {
      expect(pathMatches('/', '/anything/here')).toBe(true);
    });

    it('should not match partial path component', () => {
      expect(pathMatches('/api', '/api-v2')).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should return false for null expires', () => {
      expect(isExpired(null)).toBe(false);
    });

    it('should return true for past date', () => {
      expect(isExpired('2020-01-01T00:00:00.000Z')).toBe(true);
    });

    it('should return false for future date', () => {
      expect(isExpired('2099-01-01T00:00:00.000Z')).toBe(false);
    });

    it('should return false for invalid date string', () => {
      expect(isExpired('not-a-date')).toBe(false);
    });
  });

  describe('Cookie matching logic', () => {
    it('should match a cookie for a given URL', () => {
      const cookie = { domain: '.example.com', path: '/api', secure: false };
      const url = new URL('https://sub.example.com/api/data');

      const matches = domainMatches(cookie.domain, url.hostname)
        && pathMatches(cookie.path, url.pathname)
        && (!cookie.secure || url.protocol === 'https:');

      expect(matches).toBe(true);
    });

    it('should reject secure cookie on http URL', () => {
      const cookie = { domain: 'example.com', path: '/', secure: true };
      const url = new URL('http://example.com/page');

      const matches = domainMatches(cookie.domain, url.hostname)
        && pathMatches(cookie.path, url.pathname)
        && (!cookie.secure || url.protocol === 'https:');

      expect(matches).toBe(false);
    });

    it('should allow secure cookie on https URL', () => {
      const cookie = { domain: 'example.com', path: '/', secure: true };
      const url = new URL('https://example.com/page');

      const matches = domainMatches(cookie.domain, url.hostname)
        && pathMatches(cookie.path, url.pathname)
        && (!cookie.secure || url.protocol === 'https:');

      expect(matches).toBe(true);
    });

    it('should reject cookie for wrong domain', () => {
      const cookie = { domain: 'other.com', path: '/', secure: false };
      const url = new URL('https://example.com/');

      expect(domainMatches(cookie.domain, url.hostname)).toBe(false);
    });

    it('should reject cookie for wrong path', () => {
      const cookie = { domain: 'example.com', path: '/admin', secure: false };
      const url = new URL('https://example.com/api/data');

      expect(pathMatches(cookie.path, url.pathname)).toBe(false);
    });
  });

  describe('Cookie header building', () => {
    it('should build Cookie header from multiple cookies', () => {
      const cookies = [
        { name: 'session', value: 'abc123' },
        { name: 'theme', value: 'dark' },
        { name: 'lang', value: 'en' },
      ];

      const header = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      expect(header).toBe('session=abc123; theme=dark; lang=en');
    });

    it('should return empty for no cookies', () => {
      const cookies: any[] = [];
      const header = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
      expect(header).toBe('');
    });
  });
});
