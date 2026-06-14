import { describe, expect, it } from 'vitest';
import {
  buildExamplePayloadFromResponse,
  canSaveRequestExample,
  exampleToTabUpdates,
} from '$lib/utils/requestExamples';

describe('requestExamples', () => {
  describe('buildExamplePayloadFromResponse', () => {
    it('serializes headers object and body string for db.createRequestExample', () => {
      const payload = buildExamplePayloadFromResponse({
        responseStatus: 200,
        responseTime: 42,
        responseHeaders: { 'Content-Type': 'application/json' },
        responseBody: '{"ok":true}',
      });

      expect(payload).toEqual({
        statusCode: 200,
        responseTime: 42,
        responseHeaders: '{"Content-Type":"application/json"}',
        responseBody: '{"ok":true}',
      });
    });

    it('returns null when there is no response status', () => {
      expect(
        buildExamplePayloadFromResponse({
          responseStatus: null,
          responseTime: null,
          responseHeaders: {},
          responseBody: '',
        })
      ).toBeNull();
    });

    it('passes through pre-serialized header strings', () => {
      const payload = buildExamplePayloadFromResponse({
        responseStatus: 404,
        responseTime: 10,
        responseHeaders: '{"X-Trace":"abc"}',
        responseBody: 'Not Found',
      });

      expect(payload?.responseHeaders).toBe('{"X-Trace":"abc"}');
    });
  });

  describe('exampleToTabUpdates', () => {
    it('restores response fields from a stored example row', () => {
      const updates = exampleToTabUpdates({
        name: 'Success',
        status_code: 200,
        response_time: 88,
        response_headers: '{"Content-Type":"application/json"}',
        response_body: '{"id":1}',
      });

      expect(updates).toEqual({
        responseStatus: 200,
        responseStatusText: '',
        responseTime: 88,
        responseHeaders: { 'Content-Type': 'application/json' },
        responseBody: '{"id":1}',
      });
    });

    it('unwraps JSON-string-encoded bodies saved with JSON.stringify', () => {
      const updates = exampleToTabUpdates({
        name: 'Quoted',
        status_code: 200,
        response_headers: '{}',
        response_body: '"hello"',
      });

      expect(updates.responseBody).toBe('hello');
    });

    it('tolerates invalid stored header JSON', () => {
      const updates = exampleToTabUpdates({
        name: 'Bad headers',
        status_code: 500,
        response_headers: '{not json',
        response_body: 'error',
      });

      expect(updates.responseHeaders).toEqual({});
      expect(updates.responseBody).toBe('error');
    });
  });

  describe('canSaveRequestExample', () => {
    it('requires a saved request id and a response status', () => {
      expect(canSaveRequestExample(5, 200)).toBe(true);
      expect(canSaveRequestExample(undefined, 200)).toBe(false);
      expect(canSaveRequestExample(5, null)).toBe(false);
    });
  });
});
