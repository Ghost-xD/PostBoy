import { writable, get } from 'svelte/store';
import { db } from '$lib/api/tauri';

export interface Environment {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  initial_value: string;
  enabled: boolean;
}

const environmentsList = writable<Environment[]>([]);
const activeEnvironmentId = writable<number | null>(null);
const envVariablesMap = writable<Map<number, EnvironmentVariable[]>>(new Map());
const environmentsRev = writable(0);

const ACTIVE_ENV_SETTING_KEY = 'active_environment_id';

function bumpEnvironmentsRev() {
  environmentsRev.update((n) => n + 1);
}

export { environmentsRev, activeEnvironmentId };

export const environments = {
  subscribe: environmentsList.subscribe,

  async loadAll(): Promise<Environment[]> {
    try {
      const list = (await db.listEnvironments()) as Environment[];
      environmentsList.set(list || []);
      bumpEnvironmentsRev();
      return list || [];
    } catch (error) {
      console.warn('Environments not loaded:', error);
      environmentsList.set([]);
      bumpEnvironmentsRev();
      return [];
    }
  },

  async create(name: string): Promise<number | null> {
    try {
      const id = (await db.createEnvironment(name)) as number;
      await environments.loadAll();
      return id;
    } catch (error) {
      console.error('Failed to create environment:', error);
      return null;
    }
  },

  async update(id: number, name: string): Promise<boolean> {
    try {
      await db.updateEnvironment(id, name);
      environmentsList.update((list) =>
        list.map((e) => (e.id === id ? { ...e, name } : e)).sort((a, b) => a.name.localeCompare(b.name))
      );
      bumpEnvironmentsRev();
      return true;
    } catch (error) {
      console.error('Failed to update environment:', error);
      return false;
    }
  },

  async delete(id: number): Promise<boolean> {
    try {
      await db.deleteEnvironment(id);
      environmentsList.update((list) => list.filter((e) => e.id !== id));
      envVariablesMap.update((map) => {
        const next = new Map(map);
        next.delete(id);
        return next;
      });
      if (get(activeEnvironmentId) === id) {
        await setActiveEnvironment(null);
      }
      bumpEnvironmentsRev();
      return true;
    } catch (error) {
      console.error('Failed to delete environment:', error);
      return false;
    }
  },

  async duplicate(id: number): Promise<number | null> {
    try {
      const newId = (await db.duplicateEnvironment(id)) as number;
      await environments.loadAll();
      await envVariables.load(newId);
      return newId;
    } catch (error) {
      console.error('Failed to duplicate environment:', error);
      return null;
    }
  },

  getAll(): Environment[] {
    return get(environmentsList);
  },

  getById(id: number | null | undefined): Environment | undefined {
    if (!id) return undefined;
    return get(environmentsList).find((e) => e.id === id);
  },
};

export const envVariables = {
  subscribe: envVariablesMap.subscribe,

  async load(environmentId: number): Promise<EnvironmentVariable[]> {
    try {
      const vars = (await db.getEnvironmentVariables(environmentId)) as EnvironmentVariable[];
      envVariablesMap.update((map) => {
        const next = new Map(map);
        next.set(environmentId, vars || []);
        return next;
      });
      bumpEnvironmentsRev();
      return vars || [];
    } catch (error) {
      console.warn('Environment variables not loaded:', error);
      envVariablesMap.update((map) => {
        const next = new Map(map);
        next.set(environmentId, []);
        return next;
      });
      bumpEnvironmentsRev();
      return [];
    }
  },

  async set(
    environmentId: number,
    key: string,
    value: string,
    initialValue?: string
  ): Promise<boolean> {
    try {
      await db.setEnvironmentVariable(environmentId, key, value, initialValue);
      envVariablesMap.update((map) => {
        const existing = map.get(environmentId) || [];
        const idx = existing.findIndex((v) => v.key === key);
        const initial = initialValue ?? existing[idx]?.initial_value ?? value;
        const updated = [...existing];
        if (idx >= 0) {
          updated[idx] = { key, value, initial_value: initial, enabled: true };
        } else {
          updated.push({ key, value, initial_value: initial, enabled: true });
        }
        const next = new Map(map);
        next.set(
          environmentId,
          updated.sort((a, b) => a.key.localeCompare(b.key))
        );
        return next;
      });
      bumpEnvironmentsRev();
      return true;
    } catch (error) {
      console.error('Failed to set environment variable:', error);
      return false;
    }
  },

  async delete(environmentId: number, key: string): Promise<boolean> {
    try {
      await db.deleteEnvironmentVariable(environmentId, key);
      envVariablesMap.update((map) => {
        const existing = map.get(environmentId) || [];
        const next = new Map(map);
        next.set(
          environmentId,
          existing.filter((v) => v.key !== key)
        );
        return next;
      });
      bumpEnvironmentsRev();
      return true;
    } catch (error) {
      console.error('Failed to delete environment variable:', error);
      return false;
    }
  },

  async clear(environmentId: number): Promise<boolean> {
    try {
      await db.clearEnvironmentVariables(environmentId);
      envVariablesMap.update((map) => {
        const next = new Map(map);
        next.set(environmentId, []);
        return next;
      });
      bumpEnvironmentsRev();
      return true;
    } catch (error) {
      console.error('Failed to clear environment variables:', error);
      return false;
    }
  },

  async resetToInitial(environmentId: number): Promise<boolean> {
    try {
      await db.resetEnvironmentVariables(environmentId);
      await envVariables.load(environmentId);
      return true;
    } catch (error) {
      console.error('Failed to reset environment variables:', error);
      return false;
    }
  },

  getForEnvironment(environmentId: number | null | undefined): EnvironmentVariable[] {
    if (!environmentId) return [];
    return get(envVariablesMap).get(environmentId) || [];
  },
};

export async function loadActiveEnvironment(): Promise<number | null> {
  try {
    const raw = (await db.getSetting(ACTIVE_ENV_SETTING_KEY, null)) as string | number | null;
    if (raw === null || raw === undefined || raw === '') {
      activeEnvironmentId.set(null);
      return null;
    }
    const id = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (Number.isNaN(id)) {
      activeEnvironmentId.set(null);
      return null;
    }
    activeEnvironmentId.set(id);
    await envVariables.load(id);
    return id;
  } catch {
    activeEnvironmentId.set(null);
    return null;
  }
}

export async function setActiveEnvironment(id: number | null): Promise<void> {
  activeEnvironmentId.set(id);
  if (id) {
    await envVariables.load(id);
    await db.setSetting(ACTIVE_ENV_SETTING_KEY, String(id));
  } else {
    await db.setSetting(ACTIVE_ENV_SETTING_KEY, '');
  }
  bumpEnvironmentsRev();
}

export async function initEnvironments(): Promise<void> {
  await environments.loadAll();
  const activeId = await loadActiveEnvironment();
  if (activeId) {
    const exists = environments.getById(activeId);
    if (!exists) {
      await setActiveEnvironment(null);
    }
  }
}
