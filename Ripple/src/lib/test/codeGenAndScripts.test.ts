import { describe, it, expect } from 'vitest';
import { buildAuthForCodegen } from '$lib/utils/codeGenAuth';
import { generateCurl, generatePython } from '$lib/utils/codeGenerator';
import { runPreRequestScript, runTestScript } from '$lib/utils/requestScriptRunner';

describe('buildAuthForCodegen', () => {
  it('adds bearer header', () => {
    const r = buildAuthForCodegen({ authType: 'bearer', authToken: 'tok', url: 'https://api.test' });
    expect(r.headers).toEqual([{ key: 'Authorization', value: 'Bearer tok' }]);
  });

  it('adds oauth query param', () => {
    const r = buildAuthForCodegen({
      authType: 'oauth2',
      url: 'https://api.test/data',
      authData: { accessToken: 'oat', addTokenTo: 'query' },
    });
    expect(r.url).toContain('access_token=oat');
  });

  it('documents aws sigv4 in preamble', () => {
    const r = buildAuthForCodegen({
      authType: 'aws-sigv4',
      url: 'https://api.test',
      authData: { region: 'us-east-1', service: 'execute-api' },
    });
    expect(r.preamble.some((l) => l.includes('AWS Signature'))).toBe(true);
  });
});

describe('codeGenerator auth', () => {
  it('includes resolved digest header in curl', () => {
    const code = generateCurl({
      method: 'GET',
      url: 'https://api.test',
      headers: [],
      authType: 'digest',
      resolvedHeaders: { Authorization: 'Digest username="u"' },
    });
    expect(code).toContain('Authorization: Digest username="u"');
  });

  it('includes python basic auth kwarg', () => {
    const code = generatePython({
      method: 'GET',
      url: 'https://api.test',
      headers: [],
      authType: 'basic',
      authUsername: 'u',
      authPassword: 'p',
    });
    expect(code).toContain("auth=('u', 'p')");
  });
});

describe('requestScriptRunner', () => {
  it('runs pre-request script and mutates headers', async () => {
    const vars = { get: () => undefined, set: () => {}, has: () => false, unset: () => {} };
    const result = await runPreRequestScript(
      `pm.request.headers.upsert({ key: 'X-Test', value: '1' });`,
      { method: 'GET', url: 'https://api.test', headers: {} },
      vars,
      1 // collectionId
    );
    expect(result.request.headers['X-Test']).toBe('1');
    expect(result.errors).toHaveLength(0);
  });

  it('runs test script assertions', async () => {
    const vars = { get: () => undefined, set: () => {}, has: () => false, unset: () => {} };
    const result = await runTestScript(
      `pm.test('status ok', () => { pm.expect(pm.response.code).to.equal(200); });`,
      { method: 'GET', url: 'https://api.test', headers: {} },
      { status: 200, statusText: 'OK', headers: {}, body: '{}', responseTime: 10 },
      vars,
      1 // collectionId
    );
    expect(result.testResults[0]?.passed).toBe(true);
  });
});
