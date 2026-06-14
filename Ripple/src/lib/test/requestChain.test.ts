import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

import {
  extractValues,
  suggestVariableName,
  getAvailableVarsForStep,
  type Chain,
  type ChainStep,
  type ChainExtraction,
  type StepResult,
} from '$lib/utils/chainRunner';

describe('Chain Runner — extractValues', () => {
  it('extracts values from valid JSON at simple paths', () => {
    const body = JSON.stringify({ token: 'abc123', userId: 42 });
    const extractions: ChainExtraction[] = [
      { jsonPath: 'token', variableName: 'authToken' },
      { jsonPath: 'userId', variableName: 'uid' },
    ];
    const result = extractValues(body, extractions);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ variableName: 'authToken', jsonPath: 'token', value: 'abc123' });
    expect(result[1]).toEqual({ variableName: 'uid', jsonPath: 'userId', value: '42' });
  });

  it('extracts values from nested paths', () => {
    const body = JSON.stringify({ data: { user: { name: 'Alice', email: 'a@b.com' } } });
    const extractions: ChainExtraction[] = [
      { jsonPath: 'data.user.name', variableName: 'userName' },
      { jsonPath: 'data.user.email', variableName: 'userEmail' },
    ];
    const result = extractValues(body, extractions);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('Alice');
    expect(result[1].value).toBe('a@b.com');
  });

  it('extracts values from array paths', () => {
    const body = JSON.stringify({ items: [{ id: 1 }, { id: 2 }] });
    const extractions: ChainExtraction[] = [
      { jsonPath: 'items[0].id', variableName: 'firstId' },
      { jsonPath: 'items[1].id', variableName: 'secondId' },
    ];
    const result = extractValues(body, extractions);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('1');
    expect(result[1].value).toBe('2');
  });

  it('skips extractions with missing paths', () => {
    const body = JSON.stringify({ token: 'abc' });
    const extractions: ChainExtraction[] = [
      { jsonPath: 'token', variableName: 'authToken' },
      { jsonPath: 'nonexistent.path', variableName: 'missing' },
    ];
    const result = extractValues(body, extractions);
    expect(result).toHaveLength(1);
    expect(result[0].variableName).toBe('authToken');
  });

  it('returns empty for invalid JSON', () => {
    const result = extractValues('not json', [{ jsonPath: 'x', variableName: 'y' }]);
    expect(result).toHaveLength(0);
  });

  it('returns empty for empty body', () => {
    const result = extractValues('', [{ jsonPath: 'x', variableName: 'y' }]);
    expect(result).toHaveLength(0);
  });

  it('returns empty for no extractions', () => {
    const result = extractValues('{"a":1}', []);
    expect(result).toHaveLength(0);
  });

  it('skips extractions with empty jsonPath or variableName', () => {
    const body = JSON.stringify({ a: 1, b: 2 });
    const extractions: ChainExtraction[] = [
      { jsonPath: '', variableName: 'x' },
      { jsonPath: 'a', variableName: '' },
      { jsonPath: 'b', variableName: 'valid' },
    ];
    const result = extractValues(body, extractions);
    expect(result).toHaveLength(1);
    expect(result[0].variableName).toBe('valid');
  });

  it('handles objects as extracted values (stringified)', () => {
    const body = JSON.stringify({ nested: { key: 'val' } });
    const extractions: ChainExtraction[] = [
      { jsonPath: 'nested', variableName: 'obj' },
    ];
    const result = extractValues(body, extractions);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('{"key":"val"}');
  });
});

describe('Chain Runner — suggestVariableName', () => {
  it('extracts last segment of dot path', () => {
    expect(suggestVariableName('data.user.token')).toBe('token');
  });

  it('strips array brackets', () => {
    expect(suggestVariableName('items[0].name')).toBe('name');
  });

  it('handles single-segment path', () => {
    expect(suggestVariableName('token')).toBe('token');
  });

  it('strips non-alphanumeric characters', () => {
    expect(suggestVariableName('data.user-name')).toBe('username');
  });
});

describe('Chain Runner — getAvailableVarsForStep', () => {
  const chain: Chain = {
    id: 'c1',
    name: 'Test Chain',
    steps: [
      {
        id: 's1',
        requestId: 1,
        extractions: [
          { jsonPath: 'token', variableName: 'authToken' },
          { jsonPath: 'userId', variableName: 'uid' },
        ],
      },
      {
        id: 's2',
        requestId: 2,
        extractions: [
          { jsonPath: 'email', variableName: 'userEmail' },
        ],
      },
      {
        id: 's3',
        requestId: 3,
        extractions: [],
      },
    ],
  };

  it('returns empty for step 0 (no prior steps)', () => {
    expect(getAvailableVarsForStep(chain, 0)).toEqual([]);
  });

  it('returns step 0 extractions for step 1', () => {
    expect(getAvailableVarsForStep(chain, 1)).toEqual(['authToken', 'uid']);
  });

  it('returns step 0 + step 1 extractions for step 2', () => {
    expect(getAvailableVarsForStep(chain, 2)).toEqual(['authToken', 'uid', 'userEmail']);
  });
});

describe('Chain Runner — Chain CRUD via settings', () => {
  const mockInvoke = invoke as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('loadChains returns parsed chains from settings', async () => {
    const { loadChains } = await import('$lib/utils/chainRunner');
    const chains: Chain[] = [{ id: 'c1', name: 'Flow', steps: [] }];
    mockInvoke.mockResolvedValueOnce(JSON.stringify(chains));

    const result = await loadChains(10);
    expect(result).toEqual(chains);
    expect(mockInvoke).toHaveBeenCalledWith('db_get_setting', { key: 'chains_10', defaultValue: '[]' });
  });

  it('loadChains returns empty array on error', async () => {
    const { loadChains } = await import('$lib/utils/chainRunner');
    mockInvoke.mockRejectedValueOnce(new Error('fail'));

    const result = await loadChains(10);
    expect(result).toEqual([]);
  });

  it('saveChains persists to settings', async () => {
    const { saveChains } = await import('$lib/utils/chainRunner');
    const chains: Chain[] = [{ id: 'c1', name: 'Flow', steps: [] }];
    mockInvoke.mockResolvedValueOnce(undefined);

    await saveChains(10, chains);
    expect(mockInvoke).toHaveBeenCalledWith('db_set_setting', {
      key: 'chains_10',
      value: JSON.stringify(chains),
    });
  });
});
