import { writable, get } from 'svelte/store';
import { db } from '$lib/api/tauri';
import type { Variable } from './variableStore';

const globalsList = writable<Variable[]>([]);
const globalsRev = writable(0);

function bumpGlobalsRev() {
  globalsRev.update((n) => n + 1);
}

export { globalsRev };

export const globalVariables = {
  subscribe: globalsList.subscribe,

  async load(): Promise<Variable[]> {
    try {
      const vars = (await db.getGlobalVariables()) as Variable[];
      const list = vars || [];
      globalsList.set(list);
      bumpGlobalsRev();
      return list;
    } catch (error) {
      console.warn('Global variables not loaded:', error);
      globalsList.set([]);
      bumpGlobalsRev();
      return [];
    }
  },

  async set(key: string, value: string): Promise<boolean> {
    try {
      await db.setGlobalVariable(key, value);
      globalsList.update((existing) => {
        const idx = existing.findIndex((v) => v.key === key);
        const updated = [...existing];
        if (idx >= 0) {
          updated[idx] = { key, value };
        } else {
          updated.push({ key, value });
        }
        return updated.sort((a, b) => a.key.localeCompare(b.key));
      });
      bumpGlobalsRev();
      return true;
    } catch (error) {
      console.error('Failed to set global variable:', error);
      return false;
    }
  },

  async delete(key: string): Promise<boolean> {
    try {
      await db.deleteGlobalVariable(key);
      globalsList.update((existing) => existing.filter((v) => v.key !== key));
      bumpGlobalsRev();
      return true;
    } catch (error) {
      console.error('Failed to delete global variable:', error);
      return false;
    }
  },

  getAll(): Variable[] {
    return get(globalsList);
  },
};

export async function initGlobals(): Promise<void> {
  await globalVariables.load();
}
