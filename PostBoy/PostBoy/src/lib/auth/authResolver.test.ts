import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyRequestAuth } from './authResolver';
import { serializeAuthFromTab, authFieldsFromStored, normalizeAuthType } from './tabAuth';

describe('normalizeAuthType', () => {
  it('maps legacy values', () => {
    expect(normalizeAuthType('apikey')).toBe('api-key');
    expect(normalizeAuthType('noauth')).toBe('none');
    expect(normalizeAuthType(undefined)).toBe('none');
  });
});

describe('serializeAuthFromTab', () => {
  it('merges legacy basic fields', () => {
    const { authType, authData } = serializeAuthFromTab({
      authType: 'basic',
      authData: {},
      authUsername: 'u',
      authPassword: 'p',
      authToken: '',
      authApiKey: '',
      authApiValue: '',
    });
    expect(authType).toBe('basic');
    expect(authData.username).toBe('u');
    expect(authData.password).toBe('p');
  });

  it('preserves oauth2 authData', () => {
    const { authData } = serializeAuthFromTab({
      authType: 'oauth2',
      authData: { accessToken: 'tok', grantType: 'client_credentials' },
      authUsername: '',
      authPassword: '',
      authToken: '',
      authApiKey: '',
      authApiValue: '',
    });
    expect(authData.accessToken).toBe('tok');
  });
});

describe('authFieldsFromStored', () => {
  it('loads digest auth into authData', () => {
    const fields = authFieldsFromStored('digest', {
      username: 'u',
      password: 'p',
      realm: 'test',
    });
    expect(fields.authType).toBe('digest');
    expect(fields.authData).toEqual({ username: 'u', password: 'p', realm: 'test' });
  });
});

describe('applyRequestAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applies bearer token', async () => {
    const result = await applyRequestAuth({
      authType: 'bearer',
      authData: { token: 'abc123' },
      method: 'GET',
      url: 'https://api.example.com',
      headers: {},
    });
    expect(result.headers.Authorization).toBe('Bearer abc123');
  });

  it('applies basic auth', async () => {
    const result = await applyRequestAuth({
      authType: 'basic',
      authData: { username: 'user', password: 'pass' },
      method: 'GET',
      url: 'https://api.example.com',
      headers: {},
    });
    expect(result.headers.Authorization).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('adds api key to query when configured', async () => {
    const result = await applyRequestAuth({
      authType: 'api-key',
      authData: { key: 'api_key', value: 'secret', addTo: 'query' },
      method: 'GET',
      url: 'https://api.example.com/data',
      headers: {},
    });
    expect(result.url).toContain('api_key=secret');
  });

  it('builds digest authorization header', async () => {
    const result = await applyRequestAuth({
      authType: 'digest',
      authData: { username: 'user', password: 'pass', realm: 'Ripple', nonce: 'fixednonce' },
      method: 'GET',
      url: 'https://api.example.com/path',
      headers: {},
    });
    expect(result.headers.Authorization).toMatch(/^Digest /);
    expect(result.headers.Authorization).toContain('username="user"');
  });

  it('builds hawk authorization header', async () => {
    const result = await applyRequestAuth({
      authType: 'hawk',
      authData: { authId: 'hawk-id', authKey: 'hawk-secret-key' },
      method: 'GET',
      url: 'https://api.example.com/resource',
      headers: {},
    });
    expect(result.headers.Authorization).toMatch(/^Hawk id="hawk-id"/);
  });

  it('passes through ntlm for native transport', async () => {
    const result = await applyRequestAuth({
      authType: 'ntlm',
      authData: { username: 'user', password: 'pass', domain: 'CORP' },
      method: 'GET',
      url: 'https://intranet.corp.local',
      headers: {},
    });
    expect(result.warning).toBeUndefined();
  });
});
