import { describe, expect, it } from 'vitest';
import {
  containsVariableReference,
  findSensitiveJsonMatches,
  findSensitiveMatchAtPos,
  isSensitiveFieldKey,
  isSensitiveHeaderName,
  maskSensitiveJsonText,
  shouldMaskFieldValue,
  unmaskSensitiveJsonText,
} from '$lib/utils/sensitiveData';

describe('sensitiveData', () => {
  it('detects sensitive field keys', () => {
    expect(isSensitiveFieldKey('password')).toBe(true);
    expect(isSensitiveFieldKey('accessToken')).toBe(true);
    expect(isSensitiveFieldKey('username')).toBe(false);
  });

  it('detects sensitive header names', () => {
    expect(isSensitiveHeaderName('Authorization')).toBe(true);
    expect(isSensitiveHeaderName('Content-Type')).toBe(false);
  });

  it('masks header values by key but not when using variables', () => {
    expect(
      shouldMaskFieldValue({ fieldKey: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9' })
    ).toBe(true);
    expect(
      shouldMaskFieldValue({ fieldKey: 'Authorization', value: 'Bearer {{apiToken}}' })
    ).toBe(false);
  });

  it('finds sensitive JSON string values', () => {
    const json = '{\n  "username": "ada",\n  "password": "New#Island@2025"\n}';
    const matches = findSensitiveJsonMatches(json);
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe('password');
    expect(matches[0].value).toBe('New#Island@2025');
  });

  it('masks sensitive JSON values in display text', () => {
    const json = '{\n  "password": "secret-value"\n}';
    const { text, matches } = maskSensitiveJsonText(json);
    expect(matches).toHaveLength(1);
    expect(text).toContain('"password":');
    expect(text).not.toContain('secret-value');
    expect(text).toMatch(/"•+"/);
  });

  it('unmasks placeholder values when persisting JSON', () => {
    const json = '{\n  "password": "••••••••"\n}';
    const secrets = new Map([['password', 'real-secret']]);
    const { text, secretsByKey } = unmaskSensitiveJsonText(json, secrets);
    expect(text).toContain('"real-secret"');
    expect(secretsByKey.get('password')).toBe('real-secret');
  });

  it('does not mask sensitive JSON keys when the value is a variable reference', () => {
    const json = '{\n  "apiKey": "{{apiKey}}"\n}';
    const matches = findSensitiveJsonMatches(json);
    expect(matches).toHaveLength(0);
    const { text } = maskSensitiveJsonText(json);
    expect(text).toContain('"{{apiKey}}"');
    expect(text).not.toMatch(/"•+"/);
  });

  it('finds sensitive match only within the quoted value span', () => {
    const json = '{\n  "username": "ada",\n  "password": "secret"\n}';
    const matches = findSensitiveJsonMatches(json);
    const password = matches[0];
    expect(findSensitiveMatchAtPos(matches, password.valueFrom)).toBe(password);
    expect(findSensitiveMatchAtPos(matches, password.valueFrom + 2)).toBe(password);
    expect(findSensitiveMatchAtPos(matches, password.valueTo - 1)).toBe(password);
    expect(findSensitiveMatchAtPos(matches, password.valueTo)).toBeNull();
    expect(findSensitiveMatchAtPos(matches, password.valueFrom - 1)).toBeNull();
  });
});
