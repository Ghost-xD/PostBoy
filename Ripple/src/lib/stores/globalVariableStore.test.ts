import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/tauri', () => ({
  db: {
    getGlobalVariables: vi.fn(),
    setGlobalVariable: vi.fn(),
    deleteGlobalVariable: vi.fn(),
  },
}));

import { db } from '$lib/api/tauri';
import { globalVariables, initGlobals } from './globalVariableStore';

describe('globalVariableStore', () => {
  beforeEach(() => {
    vi.mocked(db.getGlobalVariables).mockResolvedValue([
      { key: 'npeApi', value: 'https://api.example.com' },
    ]);
  });

  it('loads globals from the database', async () => {
    await initGlobals();
    expect(globalVariables.getAll()).toEqual([
      { key: 'npeApi', value: 'https://api.example.com' },
    ]);
  });

  it('sets a global variable in memory and persists it', async () => {
    await globalVariables.load();
    await globalVariables.set('localApi', 'http://localhost:8080');
    expect(db.setGlobalVariable).toHaveBeenCalledWith('localApi', 'http://localhost:8080', false);
    expect(globalVariables.getAll().map((v) => v.key)).toContain('localApi');
  });
});
