import { describe, it, expect } from 'vitest';
import {
  runStreamPreConnectScript,
  runStreamOnMessageScript,
} from '../utils/streamScriptRunner';

const noopVariables = {
  get: () => undefined,
  set: () => {},
  has: () => false,
  unset: () => {},
};

describe('streamScriptRunner', () => {
  const ctx = {
    method: 'WS',
    url: 'ws://localhost:8080',
    headers: { Authorization: 'Bearer tok' },
    collectionId: 1,
  };

  describe('runStreamPreConnectScript', () => {
    it('mutates request url via pm.request', async () => {
      const script = `pm.request.url = pm.request.url + '/v2';`;
      const result = await runStreamPreConnectScript(script, ctx, noopVariables);
      expect(result.request.url).toBe('ws://localhost:8080/v2');
      expect(result.errors).toHaveLength(0);
    });

    it('captures script errors', async () => {
      const result = await runStreamPreConnectScript('throw new Error("boom");', ctx, noopVariables);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('runStreamOnMessageScript', () => {
    it('exposes pm.message API', async () => {
      const script = `
        pm.test('has data', () => {
          pm.expect(pm.message.data).to.equal('{"ok":true}');
        });
        pm.test('not binary', () => {
          pm.expect(pm.message.binary).to.equal(false);
        });
      `;
      const result = await runStreamOnMessageScript(
        script,
        ctx,
        { data: '{"ok":true}', binary: false, timestamp: 123 },
        noopVariables
      );

      expect(result.errors).toHaveLength(0);
      expect(result.testResults).toHaveLength(2);
      expect(result.testResults.every((t) => t.passed)).toBe(true);
    });

    it('parses message JSON via pm.response.json()', async () => {
      const script = `
        const json = pm.response.json();
        pm.test('status field', () => pm.expect(json.status).to.equal('ready'));
      `;
      const result = await runStreamOnMessageScript(
        script,
        { ...ctx, method: 'SSE' },
        {
          data: '{"status":"ready"}',
          eventType: 'status',
          lastEventId: '5',
          timestamp: 1,
        },
        noopVariables
      );

      expect(result.testResults[0]?.passed).toBe(true);
    });

    it('records failing tests', async () => {
      const result = await runStreamOnMessageScript(
        `pm.test('fail', () => pm.expect(1).to.equal(2));`,
        ctx,
        { data: 'x', timestamp: 1 },
        noopVariables
      );
      expect(result.testResults[0]?.passed).toBe(false);
    });
  });
});
