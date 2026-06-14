import { describe, expect, it } from 'vitest';
import {
  getCompleteVariableTokenAt,
  maskSecret,
  resolveVariableValue,
} from '$lib/utils/variableHoverPreview';

describe('variableHoverPreview', () => {
  describe('getCompleteVariableTokenAt', () => {
    it('finds a token when the index is inside {{apiToken}}', () => {
      const text = 'Bearer {{apiToken}}';
      const token = getCompleteVariableTokenAt(text, 10);
      expect(token).toEqual({ name: 'apiToken', start: 7, end: 19 });
    });

    it('returns null outside any token', () => {
      expect(getCompleteVariableTokenAt('Bearer static', 3)).toBeNull();
    });

    it('returns null for incomplete tokens', () => {
      expect(getCompleteVariableTokenAt('Bearer {{apiTok', 12)).toBeNull();
    });
  });

  describe('resolveVariableValue', () => {
    it('returns the stored value for a known key', () => {
      expect(
        resolveVariableValue('apiToken', [{ key: 'apiToken', value: 'secret-abc' }])
      ).toBe('secret-abc');
    });

    it('returns null when the variable is missing', () => {
      expect(resolveVariableValue('missing', [])).toBeNull();
    });
  });

  describe('maskSecret', () => {
    it('masks values with bullet placeholders', () => {
      expect(maskSecret('super-secret-token')).toMatch(/^•+$/);
    });
  });
});
