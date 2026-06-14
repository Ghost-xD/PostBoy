import { describe, it, expect } from 'vitest';
import {
  getVariableContext,
  filterVariableSuggestions,
  applyVariableSelection,
  buildVariableInsertion,
  maskVariableValue,
} from '$lib/utils/variableAutocomplete';

describe('getVariableContext', () => {
  it('detects cursor inside an unfinished variable token', () => {
    const text = 'https://{{host}}/api';
    const ctx = getVariableContext(text, 14);
    expect(ctx).toEqual({ start: 8, end: 14, query: 'host' });
  });

  it('detects empty query right after {{', () => {
    const text = 'Bearer {{';
    const ctx = getVariableContext(text, 9);
    expect(ctx).toEqual({ start: 7, end: 9, query: '' });
  });

  it('returns null when variable is already closed', () => {
    expect(getVariableContext('https://{{host}}/x', 16)).toBeNull();
  });

  it('uses the nearest unfinished {{ before the cursor', () => {
    const text = '{{a}} and {{b';
    const ctx = getVariableContext(text, 14);
    expect(ctx).toEqual({ start: 10, end: 14, query: 'b' });
  });
});

describe('filterVariableSuggestions', () => {
  const vars = [
    { key: 'apiToken', value: 'abc' },
    { key: 'host', value: 'api.example.com' },
    { key: 'expiresIn', value: '3600' },
  ];

  it('returns all variables for an empty query', () => {
    expect(filterVariableSuggestions(vars, '')).toEqual(vars);
  });

  it('filters by partial name (case-insensitive)', () => {
    expect(filterVariableSuggestions(vars, 'token').map((v) => v.key)).toEqual(['apiToken']);
    expect(filterVariableSuggestions(vars, 'HOST').map((v) => v.key)).toEqual(['host']);
  });
});

describe('applyVariableSelection', () => {
  it('inserts a completed variable token', () => {
    const text = 'https://{{ho';
    const ctx = getVariableContext(text, text.length)!;
    const result = applyVariableSelection(text, ctx, 'host');
    expect(result.value).toBe('https://{{host}}');
    expect(result.cursor).toBe('https://{{host}}'.length);
  });

  it('strips auto-inserted closing braces after partial {{', () => {
    const text = '"apiKey": "{{}}';
    const ctx = getVariableContext(text, 13)!;
    const result = applyVariableSelection(text, ctx, 'apiKey');
    expect(result.value).toBe('"apiKey": "{{apiKey}}');
  });

  it('buildVariableInsertion wraps the name', () => {
    expect(buildVariableInsertion('apiToken')).toBe('{{apiToken}}');
  });
});

describe('maskVariableValue', () => {
  it('truncates long values for display', () => {
    const long = 'a'.repeat(40);
    expect(maskVariableValue(long)).toMatch(/^a{8}…/);
  });
});
