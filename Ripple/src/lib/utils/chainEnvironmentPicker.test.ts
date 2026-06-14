import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/modalManager.svelte', () => ({
  showForm: vi.fn(),
}));

vi.mock('$lib/stores/environmentStore', () => ({
  environments: {
    loadAll: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
  },
  activeEnvironmentId: {
    subscribe: vi.fn(),
  },
  setActiveEnvironment: vi.fn(),
}));

import * as modalManager from '$lib/utils/modalManager.svelte';
import { environments, setActiveEnvironment } from '$lib/stores/environmentStore';
import { get } from 'svelte/store';
import { pickChainRunEnvironment, applyChainRunEnvironment } from './chainEnvironmentPicker';

vi.mock('svelte/store', async () => {
  const actual = await vi.importActual<typeof import('svelte/store')>('svelte/store');
  return {
    ...actual,
    get: vi.fn(),
  };
});

describe('chainEnvironmentPicker', () => {
  beforeEach(() => {
    vi.mocked(environments.loadAll).mockResolvedValue([]);
    vi.mocked(environments.getAll).mockReturnValue([
      { id: 1, name: 'NPE', created_at: '', updated_at: '' },
      { id: 2, name: 'Local', created_at: '', updated_at: '' },
    ]);
    vi.mocked(get).mockReturnValue(1);
  });

  it('returns environment id when user confirms', async () => {
    vi.mocked(modalManager.showForm).mockResolvedValue({ environmentId: '2' });
    await expect(pickChainRunEnvironment('GetLicense')).resolves.toBe(2);
  });

  it('returns null when user picks no environment', async () => {
    vi.mocked(modalManager.showForm).mockResolvedValue({ environmentId: '' });
    await expect(pickChainRunEnvironment('GetLicense')).resolves.toBeNull();
  });

  it('returns undefined when user cancels', async () => {
    vi.mocked(modalManager.showForm).mockResolvedValue(null);
    await expect(pickChainRunEnvironment('GetLicense')).resolves.toBeUndefined();
  });

  it('applies selected environment and returns its name', async () => {
    vi.mocked(setActiveEnvironment).mockResolvedValue(undefined);
    vi.mocked(environments.getById).mockReturnValue({ id: 2, name: 'Local', created_at: '', updated_at: '' });
    await expect(applyChainRunEnvironment(2)).resolves.toBe('Local');
    expect(setActiveEnvironment).toHaveBeenCalledWith(2);
  });
});
