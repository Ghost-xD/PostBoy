import { describe, expect, it } from 'vitest';
import { parseHarFromFileReadResult, parseHarToHistoryEntries } from '$lib/utils/harImporter';

const sampleHar = {
  log: {
    entries: [
      {
        time: 42.5,
        request: {
          method: 'GET',
          url: 'https://api.example.com/users?page=1',
          headers: [{ name: 'Accept', value: 'application/json' }],
          queryString: [{ name: 'page', value: '1' }],
        },
        response: {
          status: 200,
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          content: { mimeType: 'application/json', text: '{"ok":true}' },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com/users',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          postData: { mimeType: 'application/json', text: '{"name":"Ada"}' },
        },
        response: {
          status: 201,
          headers: [],
          content: { text: '{"id":1}' },
        },
      },
      {
        request: { url: 'https://broken.example.com' },
        response: { status: 500 },
      },
    ],
  },
};

describe('harImporter', () => {
  it('parses valid HAR entries into history payloads', () => {
    const result = parseHarToHistoryEntries(sampleHar);
    expect(result.entries).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);

    const getEntry = result.entries[0];
    expect(getEntry.requestData.method).toBe('GET');
    expect(getEntry.requestData.bodyType).toBe('none');
    expect(getEntry.responseData.status).toBe(200);
    expect(getEntry.responseData.responseTime).toBe(43);

    const postEntry = result.entries[1];
    expect(postEntry.requestData.bodyType).toBe('json');
    expect(postEntry.requestData.bodyContent).toBe('{"name":"Ada"}');
  });

  it('returns an error for invalid HAR documents', () => {
    const result = parseHarToHistoryEntries(null);
    expect(result.entries).toHaveLength(0);
    expect(result.errors[0]).toMatch(/Invalid HAR/);
  });

  it('parses HAR from read_file invoke wrapper { success, data }', () => {
    const harJson = JSON.stringify(sampleHar);
    const result = parseHarFromFileReadResult({ success: true, data: harJson });
    expect(result.entries).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });

  it('returns a clear error when read_file object is passed to JSON.parse path', () => {
    const result = parseHarFromFileReadResult({ success: true, data: 'not-json' });
    expect(result.entries).toHaveLength(0);
    expect(result.errors[0]).toMatch(/Invalid JSON/);
  });

  it('regression: bare read_file wrapper is not valid JSON input', () => {
    const readResult = { success: true, data: JSON.stringify(sampleHar) };
    expect(() => JSON.parse(readResult as unknown as string)).toThrow();
    expect(parseHarFromFileReadResult(readResult).entries.length).toBeGreaterThan(0);
  });
});
