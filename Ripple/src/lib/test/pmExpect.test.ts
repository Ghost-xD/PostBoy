import { describe, it, expect } from 'vitest';
import { createPmExpect, runPmTest } from '../utils/pmExpect';
import { runTestScript } from '../utils/requestScriptRunner';

describe('pmExpect', () => {
  it('supports below/above comparisons', () => {
    expect(() => createPmExpect(3).to.be.below(5)).not.toThrow();
    expect(() => createPmExpect(6).to.be.below(5)).toThrow(/below 5/);
    expect(() => createPmExpect(10).to.be.above(5)).not.toThrow();
  });

  it('supports have.property', () => {
    expect(() => createPmExpect({ url: 'https://x.test' }).to.have.property('url')).not.toThrow();
    expect(() => createPmExpect({}).to.have.property('url')).toThrow(/property url/);
    expect(() =>
      createPmExpect({ url: 'https://x.test' }).to.have.property('url', 'https://x.test')
    ).not.toThrow();
  });

  it('supports include for strings and arrays', () => {
    expect(() => createPmExpect('hello world').to.include('world')).not.toThrow();
    expect(() => createPmExpect([1, 2, 3]).to.include(2)).not.toThrow();
  });

  it('supports negated assertions', () => {
    expect(() => createPmExpect(200).to.not.equal(404)).not.toThrow();
    expect(() => createPmExpect(200).to.not.equal(200)).toThrow();
  });

  it('supports type checks', () => {
    expect(() => createPmExpect('text').to.be.a('string')).not.toThrow();
    expect(() => createPmExpect([]).to.be.an('array')).not.toThrow();
  });
});

describe('runPmTest async', () => {
  it('waits for async test callbacks', async () => {
    const results: Array<{ name: string; passed: boolean; error?: string }> = [];
    const pending: Promise<void>[] = [];
    pending.push(
      runPmTest('async test', async () => {
        await new Promise((r) => setTimeout(r, 10));
        createPmExpect(1).to.equal(1);
      }, results)
    );
    await Promise.all(pending);
    expect(results[0]?.passed).toBe(true);
  });
});

describe('runTestScript assertions', () => {
  const vars = { get: () => undefined, set: () => {}, has: () => false, unset: () => {} };
  const request = { method: 'GET', url: 'https://api.test', headers: {} };
  const response = { status: 200, statusText: 'OK', headers: {}, body: '{"id":1}', responseTime: 10 };

  it('runs below and property assertions from scripts', async () => {
    const result = await runTestScript(
      `
        pm.test('status ok', () => { pm.expect(pm.response.code).to.equal(200); });
        pm.test('has id', () => {
          const json = pm.response.json();
          pm.expect(json).to.have.property('id');
          pm.expect(json.id).to.equal(1);
        });
        pm.test('timing', () => { pm.expect(pm.response.responseTime).to.be.below(5000); });
      `,
      request,
      response,
      vars
    );
    expect(result.errors).toHaveLength(0);
    expect(result.testResults.every((t) => t.passed)).toBe(true);
  });

  it('runs async pm.test blocks', async () => {
    const result = await runTestScript(
      `
        pm.test('async chain', async () => {
          await Promise.resolve();
          pm.expect(pm.response.code).to.be.below(300);
        });
      `,
      request,
      response,
      vars
    );
    expect(result.testResults[0]?.passed).toBe(true);
  });
});
