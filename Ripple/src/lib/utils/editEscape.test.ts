import { describe, it, expect, afterEach } from 'vitest';
import { cancelActiveEdit, registerEditEscapeCancel } from './editEscape';

describe('editEscape', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('returns false when no inline edit is active', () => {
    expect(cancelActiveEdit()).toBe(false);
  });

  it('calls the registered cancel handler and returns true', () => {
    let cancelled = false;
    cleanups.push(registerEditEscapeCancel(() => {
      cancelled = true;
    }));

    expect(cancelActiveEdit()).toBe(true);
    expect(cancelled).toBe(true);
    expect(cancelActiveEdit()).toBe(true);
  });

  it('uses the most recently registered handler', () => {
    cleanups.push(registerEditEscapeCancel(() => {}));
    cleanups.push(registerEditEscapeCancel(() => {}));

    let hit = '';
    cleanups.push(registerEditEscapeCancel(() => { hit = 'top'; }));

    cancelActiveEdit();
    expect(hit).toBe('top');
  });
});
