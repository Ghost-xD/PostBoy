import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

import {
  variables,
  interpolate,
  interpolateKeyValues,
  getUnresolvedVariables,
  getAllUnresolvedVariables,
  countVariablesInText,
  flattenJsonPaths,
  getValueAtPath,
  resolveMappingEntry,
  materializeMappingsFromResponse,
} from './variableStore';

import { get } from 'svelte/store';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

describe('variableStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // Reset the internal store to a clean state
    variables.subscribe((map) => {
      // no-op, just to ensure subscription works
    })();
  });

  describe('variables.load', () => {
    it('loads variables from the database and stores them', async () => {
      const vars = [{ key: 'token', value: 'abc123' }, { key: 'host', value: 'localhost' }];
      mockInvoke.mockResolvedValueOnce(vars);

      const result = await variables.load(1);

      expect(result).toEqual(vars);
      expect(mockInvoke).toHaveBeenCalledWith('db_get_variables', { collectionId: 1 });
      expect(variables.getForCollection(1)).toEqual(vars);
    });

    it('handles null response from db gracefully', async () => {
      mockInvoke.mockResolvedValueOnce(null);

      const result = await variables.load(1);

      expect(result).toEqual([]);
      expect(variables.getForCollection(1)).toEqual([]);
    });

    it('returns empty array and logs warning on error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('table not found'));

      const result = await variables.load(1);

      expect(result).toEqual([]);
      expect(variables.getForCollection(1)).toEqual([]);
    });
  });

  describe('variables.set', () => {
    it('adds a new variable when it does not exist', async () => {
      mockInvoke.mockResolvedValueOnce([]);    // load
      mockInvoke.mockResolvedValueOnce(undefined); // set

      await variables.load(1);
      const success = await variables.set(1, 'token', 'xyz');

      expect(success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('db_set_variable', { collectionId: 1, key: 'token', value: 'xyz' });
      const vars = variables.getForCollection(1);
      expect(vars.find(v => v.key === 'token')?.value).toBe('xyz');
    });

    it('updates an existing variable', async () => {
      mockInvoke.mockResolvedValueOnce([{ key: 'token', value: 'old' }]); // load
      mockInvoke.mockResolvedValueOnce(undefined); // set

      await variables.load(1);
      const success = await variables.set(1, 'token', 'new');

      expect(success).toBe(true);
      const vars = variables.getForCollection(1);
      expect(vars.find(v => v.key === 'token')?.value).toBe('new');
    });

    it('sorts variables alphabetically by key after set', async () => {
      mockInvoke.mockResolvedValueOnce([{ key: 'zeta', value: '1' }]); // load
      mockInvoke.mockResolvedValueOnce(undefined); // set alpha

      await variables.load(1);
      await variables.set(1, 'alpha', '2');

      const vars = variables.getForCollection(1);
      expect(vars[0].key).toBe('alpha');
      expect(vars[1].key).toBe('zeta');
    });

    it('returns false on error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('db fail'));

      const success = await variables.set(1, 'token', 'xyz');

      expect(success).toBe(false);
    });
  });

  describe('variables.delete', () => {
    it('removes a variable from the store', async () => {
      mockInvoke.mockResolvedValueOnce([{ key: 'token', value: 'abc' }, { key: 'host', value: 'local' }]); // load
      mockInvoke.mockResolvedValueOnce(undefined); // delete

      await variables.load(1);
      const success = await variables.delete(1, 'token');

      expect(success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('db_delete_variable', { collectionId: 1, key: 'token' });
      const vars = variables.getForCollection(1);
      expect(vars).toHaveLength(1);
      expect(vars[0].key).toBe('host');
    });

    it('returns false on error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('db fail'));

      const success = await variables.delete(1, 'token');

      expect(success).toBe(false);
    });
  });

  describe('variables.clear', () => {
    it('clears all variables for a collection', async () => {
      mockInvoke.mockResolvedValueOnce([{ key: 'a', value: '1' }, { key: 'b', value: '2' }]); // load
      mockInvoke.mockResolvedValueOnce(undefined); // clear

      await variables.load(1);
      const success = await variables.clear(1);

      expect(success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('db_clear_variables', { collectionId: 1 });
      expect(variables.getForCollection(1)).toEqual([]);
    });

    it('returns false on error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('db fail'));

      const success = await variables.clear(1);

      expect(success).toBe(false);
    });
  });

  describe('variables.getForCollection', () => {
    it('returns empty array for undefined collectionId', () => {
      expect(variables.getForCollection(undefined)).toEqual([]);
    });

    it('returns empty array for unknown collectionId', () => {
      expect(variables.getForCollection(999)).toEqual([]);
    });

    it('returns empty array for collectionId 0 (falsy)', () => {
      expect(variables.getForCollection(0)).toEqual([]);
    });
  });
});

describe('interpolate', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('replaces known variables in text', async () => {
    mockInvoke.mockResolvedValueOnce([{ key: 'host', value: 'example.com' }]);
    await variables.load(1);

    const result = interpolate('https://{{host}}/api', 1);
    expect(result).toBe('https://example.com/api');
  });

  it('leaves unknown variables unchanged', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await variables.load(1);

    const result = interpolate('{{unknown}}', 1);
    expect(result).toBe('{{unknown}}');
  });

  it('handles multiple variables in one string', async () => {
    mockInvoke.mockResolvedValueOnce([
      { key: 'host', value: 'api.com' },
      { key: 'token', value: 'abc' }
    ]);
    await variables.load(1);

    const result = interpolate('https://{{host}}/{{token}}', 1);
    expect(result).toBe('https://api.com/abc');
  });

  it('trims whitespace inside variable braces', async () => {
    mockInvoke.mockResolvedValueOnce([{ key: 'name', value: 'Alice' }]);
    await variables.load(1);

    const result = interpolate('Hello {{ name }}!', 1);
    expect(result).toBe('Hello Alice!');
  });

  it('returns original text when text is empty', () => {
    expect(interpolate('', 1)).toBe('');
  });

  it('returns original text when text is null/undefined-like', () => {
    expect(interpolate(null as any, 1)).toBe(null);
    expect(interpolate(undefined as any, 1)).toBe(undefined);
  });

  it('returns original text when collectionId is undefined', () => {
    expect(interpolate('{{host}}', undefined)).toBe('{{host}}');
  });
});

describe('interpolateKeyValues', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('interpolates both keys and values', async () => {
    mockInvoke.mockResolvedValueOnce([{ key: 'header', value: 'X-Custom' }, { key: 'val', value: '123' }]);
    await variables.load(1);

    const result = interpolateKeyValues(
      [{ key: '{{header}}', value: '{{val}}' }],
      1
    );
    expect(result).toEqual([{ key: 'X-Custom', value: '123' }]);
  });

  it('handles empty array', () => {
    const result = interpolateKeyValues([], 1);
    expect(result).toEqual([]);
  });
});

describe('getUnresolvedVariables', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('returns empty for empty text', () => {
    expect(getUnresolvedVariables('', 1)).toEqual([]);
  });

  it('returns unresolved variable names', async () => {
    mockInvoke.mockResolvedValueOnce([{ key: 'known', value: 'ok' }]);
    await variables.load(1);

    const result = getUnresolvedVariables('{{known}} and {{unknown}}', 1);
    expect(result).toEqual(['unknown']);
  });

  it('returns all variables when none are defined', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await variables.load(1);

    const result = getUnresolvedVariables('{{a}} + {{b}}', 1);
    expect(result).toEqual(['a', 'b']);
  });

  it('deduplicates unresolved names', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await variables.load(1);

    const result = getUnresolvedVariables('{{x}} and {{x}} again', 1);
    expect(result).toEqual(['x']);
  });

  it('returns empty when all variables are resolved', async () => {
    mockInvoke.mockResolvedValueOnce([{ key: 'a', value: '1' }, { key: 'b', value: '2' }]);
    await variables.load(1);

    const result = getUnresolvedVariables('{{a}} {{b}}', 1);
    expect(result).toEqual([]);
  });
});

describe('getAllUnresolvedVariables', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('collects unresolved variables across multiple texts', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await variables.load(1);

    const result = getAllUnresolvedVariables(['{{a}}', '{{b}}', '{{a}}'], 1);
    expect(result).toEqual(['a', 'b']);
  });

  it('returns empty for empty texts array', () => {
    const result = getAllUnresolvedVariables([], 1);
    expect(result).toEqual([]);
  });
});

describe('countVariablesInText', () => {
  it('counts variable placeholders in text', () => {
    expect(countVariablesInText('{{a}} and {{b}} and {{c}}')).toBe(3);
  });

  it('returns 0 for text without variables', () => {
    expect(countVariablesInText('no variables here')).toBe(0);
  });

  it('returns 0 for empty text', () => {
    expect(countVariablesInText('')).toBe(0);
  });

  it('returns 0 for null/undefined', () => {
    expect(countVariablesInText(null as any)).toBe(0);
    expect(countVariablesInText(undefined as any)).toBe(0);
  });

  it('counts duplicate variable references separately', () => {
    expect(countVariablesInText('{{a}} {{a}}')).toBe(2);
  });
});

describe('flattenJsonPaths', () => {
  it('flattens a simple object', () => {
    const result = flattenJsonPaths({ name: 'Alice', age: 30 });
    expect(result).toEqual([
      { path: 'name', value: 'Alice' },
      { path: 'age', value: '30' },
    ]);
  });

  it('flattens nested objects', () => {
    const result = flattenJsonPaths({ user: { name: 'Bob' } });
    expect(result).toEqual([
      { path: 'user.name', value: 'Bob' },
    ]);
  });

  it('flattens arrays', () => {
    const result = flattenJsonPaths({ items: ['a', 'b'] });
    expect(result).toEqual([
      { path: 'items[0]', value: 'a' },
      { path: 'items[1]', value: 'b' },
    ]);
  });

  it('flattens arrays of objects', () => {
    const result = flattenJsonPaths({ items: [{ id: 1 }, { id: 2 }] });
    expect(result).toEqual([
      { path: 'items[0].id', value: '1' },
      { path: 'items[1].id', value: '2' },
    ]);
  });

  it('handles null and undefined', () => {
    expect(flattenJsonPaths(null)).toEqual([]);
    expect(flattenJsonPaths(undefined)).toEqual([]);
  });

  it('handles primitive values at root', () => {
    expect(flattenJsonPaths('hello')).toEqual([{ path: '', value: 'hello' }]);
    expect(flattenJsonPaths(42)).toEqual([{ path: '', value: '42' }]);
    expect(flattenJsonPaths(true)).toEqual([{ path: '', value: 'true' }]);
  });

  it('handles root-level arrays', () => {
    const result = flattenJsonPaths([{ a: 1 }, { a: 2 }]);
    expect(result).toEqual([
      { path: '[0].a', value: '1' },
      { path: '[1].a', value: '2' },
    ]);
  });

  it('handles deeply nested structures', () => {
    const result = flattenJsonPaths({ a: { b: { c: { d: 'deep' } } } });
    expect(result).toEqual([{ path: 'a.b.c.d', value: 'deep' }]);
  });

  it('handles empty object', () => {
    expect(flattenJsonPaths({})).toEqual([]);
  });

  it('handles empty array', () => {
    expect(flattenJsonPaths([])).toEqual([]);
  });
});

describe('getValueAtPath', () => {
  it('gets a top-level property', () => {
    expect(getValueAtPath({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('gets a nested property', () => {
    expect(getValueAtPath({ a: { b: { c: 'deep' } } }, 'a.b.c')).toBe('deep');
  });

  it('gets an array element', () => {
    expect(getValueAtPath({ items: ['x', 'y', 'z'] }, 'items[1]')).toBe('y');
  });

  it('gets a property from an array element', () => {
    expect(getValueAtPath({ items: [{ id: 10 }] }, 'items[0].id')).toBe('10');
  });

  it('returns undefined for null obj', () => {
    expect(getValueAtPath(null, 'a')).toBeUndefined();
  });

  it('returns undefined for undefined obj', () => {
    expect(getValueAtPath(undefined, 'a')).toBeUndefined();
  });

  it('returns undefined for empty path', () => {
    expect(getValueAtPath({ a: 1 }, '')).toBeUndefined();
  });

  it('returns undefined for missing path', () => {
    expect(getValueAtPath({ a: 1 }, 'b')).toBeUndefined();
  });

  it('returns undefined for out-of-bounds array index', () => {
    expect(getValueAtPath({ items: [1] }, 'items[5]')).toBeUndefined();
  });

  it('returns undefined for negative array index', () => {
    expect(getValueAtPath({ items: [1] }, 'items[-1]')).toBeUndefined();
  });

  it('returns undefined when traversing through a primitive', () => {
    expect(getValueAtPath({ a: 'string' }, 'a.b')).toBeUndefined();
  });

  it('returns undefined when traversing through null mid-path', () => {
    expect(getValueAtPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('returns undefined for non-numeric index on array', () => {
    expect(getValueAtPath([1, 2, 3], 'foo')).toBeUndefined();
  });

  it('stringifies objects at the target path', () => {
    const result = getValueAtPath({ nested: { key: 'val' } }, 'nested');
    expect(result).toBe('{"key":"val"}');
  });

  it('returns undefined when final value is null', () => {
    expect(getValueAtPath({ a: null }, 'a')).toBeUndefined();
  });

  it('returns undefined when final value is undefined', () => {
    expect(getValueAtPath({ a: undefined }, 'a')).toBeUndefined();
  });

  it('converts numeric values to string', () => {
    expect(getValueAtPath({ count: 42 }, 'count')).toBe('42');
  });

  it('converts boolean values to string', () => {
    expect(getValueAtPath({ active: true }, 'active')).toBe('true');
  });

  it('handles part not present in object', () => {
    expect(getValueAtPath({ a: { b: 1 } }, 'a.c')).toBeUndefined();
  });
});

describe('resolveMappingEntry', () => {
  const tokenResponse = {
    accessToken: 'jwt-token-value',
    expiresIn: 3600,
    tokenType: 'Bearer',
  };

  it('maps json path to variable name in the correct order', () => {
    const result = resolveMappingEntry(tokenResponse, 'accessToken', 'apiToken');
    expect(result).toEqual({ variableName: 'apiToken', value: 'jwt-token-value' });
  });

  it('auto-corrects when path and variable name fields are swapped', () => {
    const result = resolveMappingEntry(tokenResponse, 'apiToken', 'accessToken');
    expect(result).toEqual({ variableName: 'apiToken', value: 'jwt-token-value' });
  });

  it('returns null when neither field matches a response path', () => {
    expect(resolveMappingEntry(tokenResponse, 'apiToken', 'missing')).toBeNull();
  });

  it('returns null for empty path or name', () => {
    expect(resolveMappingEntry(tokenResponse, '', 'apiToken')).toBeNull();
    expect(resolveMappingEntry(tokenResponse, 'accessToken', '')).toBeNull();
  });
});

describe('materializeMappingsFromResponse', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('writes variables from response mappings and reloads from db', async () => {
    const response = { accessToken: 'secret-jwt', expiresIn: '3600' };
    mockInvoke.mockResolvedValueOnce(undefined); // set apiToken
    mockInvoke.mockResolvedValueOnce(undefined); // set expiresIn
    mockInvoke.mockResolvedValueOnce([
      { key: 'apiToken', value: 'secret-jwt' },
      { key: 'expiresIn', value: '3600' },
    ]); // reload after writes

    const written = await materializeMappingsFromResponse(1, response, [
      { jsonPath: 'accessToken', variableName: 'apiToken' },
      { jsonPath: 'expiresIn', variableName: 'expiresIn' },
    ]);

    expect(written).toBe(2);
    expect(mockInvoke).toHaveBeenCalledWith('db_set_variable', {
      collectionId: 1,
      key: 'apiToken',
      value: 'secret-jwt',
    });
    expect(mockInvoke).toHaveBeenCalledWith('db_set_variable', {
      collectionId: 1,
      key: 'expiresIn',
      value: '3600',
    });
    expect(mockInvoke).toHaveBeenCalledWith('db_get_variables', { collectionId: 1 });
    expect(variables.getForCollection(1)).toEqual([
      { key: 'apiToken', value: 'secret-jwt' },
      { key: 'expiresIn', value: '3600' },
    ]);
  });

  it('writes variables when mapping fields are swapped', async () => {
    const response = { accessToken: 'swapped-fix' };
    mockInvoke.mockResolvedValueOnce(undefined); // set
    mockInvoke.mockResolvedValueOnce([{ key: 'apiToken', value: 'swapped-fix' }]); // reload

    const written = await materializeMappingsFromResponse(2, response, [
      { jsonPath: 'apiToken', variableName: 'accessToken' },
    ]);

    expect(written).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_set_variable', {
      collectionId: 2,
      key: 'apiToken',
      value: 'swapped-fix',
    });
    expect(variables.getForCollection(2)).toEqual([{ key: 'apiToken', value: 'swapped-fix' }]);
  });

  it('returns 0 and skips db reload when no mappings resolve', async () => {
    const written = await materializeMappingsFromResponse(3, { foo: 'bar' }, [
      { jsonPath: 'missing', variableName: 'alsoMissing' },
    ]);

    expect(written).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('notifies subscribers after materializing so UI can refresh', async () => {
    const response = { accessToken: 'notify-me' };
    mockInvoke.mockResolvedValueOnce(undefined);
    mockInvoke.mockResolvedValueOnce([{ key: 'apiToken', value: 'notify-me' }]);

    let notifyCount = 0;
    const unsub = variables.subscribe(() => {
      notifyCount++;
    });

    await materializeMappingsFromResponse(4, response, [
      { jsonPath: 'accessToken', variableName: 'apiToken' },
    ]);

    unsub();
    // Initial subscribe callback + set + load = at least 3 notifications
    expect(notifyCount).toBeGreaterThanOrEqual(3);
  });
});
