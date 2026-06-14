import { describe, expect, it, vi } from 'vitest';
import { importHarEntriesFromReadResult } from '$lib/utils/harImportWorkflow';

const sampleHar = {
  log: {
    entries: [
      {
        time: 10,
        request: {
          method: 'GET',
          url: 'https://api.example.com/health',
          headers: [],
        },
        response: {
          status: 200,
          headers: [],
          content: { text: 'ok' },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com/items',
          headers: [],
          postData: { mimeType: 'application/json', text: '{}' },
        },
        response: {
          status: 201,
          headers: [],
          content: { text: '{"id":1}' },
        },
      },
    ],
  },
};

describe('harImportWorkflow', () => {
  it('imports entries when read_file returns the Tauri { success, data } wrapper', async () => {
    const addHistory = vi.fn().mockResolvedValue(true);
    const readResult = { success: true, data: JSON.stringify(sampleHar) };

    const result = await importHarEntriesFromReadResult(readResult, addHistory);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.imported).toBe(2);
    expect(addHistory).toHaveBeenCalledTimes(2);
    expect(addHistory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: 'GET', url: 'https://api.example.com/health' }),
      expect.objectContaining({ status: 200, responseTime: 10 })
    );
    expect(addHistory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: 'POST', bodyType: 'json' }),
      expect.objectContaining({ status: 201 })
    );
  });

  it('regression: passing read_file wrapper to JSON.parse throws (the original bug)', () => {
    const readResult = { success: true, data: JSON.stringify(sampleHar) };
    expect(() => JSON.parse(readResult as unknown as string)).toThrow();
  });

  it('returns failure when wrapper contains invalid JSON', async () => {
    const addHistory = vi.fn();
    const result = await importHarEntriesFromReadResult(
      { success: true, data: 'not-json' },
      addHistory
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Invalid JSON/);
    expect(addHistory).not.toHaveBeenCalled();
  });

  it('returns failure when HAR has no importable entries', async () => {
    const addHistory = vi.fn();
    const result = await importHarEntriesFromReadResult(
      { success: true, data: JSON.stringify({ log: { entries: [] } }) },
      addHistory
    );

    expect(result.ok).toBe(false);
    expect(addHistory).not.toHaveBeenCalled();
  });
});
