import { describe, it, expect } from 'vitest';
import { exportPostmanEnvironment, importPostmanEnvironment } from './environmentImporter';

describe('environmentImporter', () => {
  it('exports Postman-compatible environment JSON', () => {
    const json = exportPostmanEnvironment('Dev', [
      { key: 'baseUrl', value: 'https://dev.api.com', initial_value: 'https://dev.api.com', enabled: true, is_secret: false },
      { key: 'token', value: 'secret', initial_value: '', enabled: true, is_secret: false },
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('Dev');
    expect(parsed._postman_variable_scope).toBe('environment');
    expect(parsed.values).toHaveLength(2);
    expect(parsed.values[0]).toEqual({
      key: 'baseUrl',
      value: 'https://dev.api.com',
      type: 'default',
      enabled: true,
    });
  });

  it('imports Postman environment files', () => {
    const raw = JSON.stringify({
      name: 'Staging',
      values: [
        { key: 'host', value: 'staging.example.com', enabled: true },
        { key: 'disabled', value: 'x', enabled: false },
      ],
      _postman_variable_scope: 'environment',
    });
    const result = importPostmanEnvironment(raw);
    expect(result.name).toBe('Staging');
    expect(result.errors).toEqual([]);
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toEqual({
      key: 'host',
      value: 'staging.example.com',
      initial_value: 'staging.example.com',
      enabled: true,
      is_secret: false,
    });
    expect(result.variables[1].enabled).toBe(false);
  });

  it('rejects invalid JSON', () => {
    const result = importPostmanEnvironment('{not json');
    expect(result.variables).toEqual([]);
    expect(result.errors[0]).toMatch(/Invalid JSON/);
  });

  it('rejects files without values array', () => {
    const result = importPostmanEnvironment(JSON.stringify({ name: 'Bad' }));
    expect(result.variables).toEqual([]);
    expect(result.errors[0]).toMatch(/values/);
  });
});
