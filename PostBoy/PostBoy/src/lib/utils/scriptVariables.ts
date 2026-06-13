import { variables } from '$lib/stores/variableStore';
import type { ScriptVariableApi } from './requestScriptRunner';

/** In-memory overlay + collection variables for script execution. */
export function createScriptVariableApi(collectionId?: number): ScriptVariableApi {
  const overlay = new Map<string, string>();

  return {
    get(name: string) {
      if (overlay.has(name)) return overlay.get(name);
      if (!collectionId) return undefined;
      const v = variables.getForCollection(collectionId).find((x) => x.key === name);
      return v?.value;
    },
    set(name: string, value: string) {
      overlay.set(name, value);
      if (collectionId) {
        void variables.set(collectionId, name, value);
      }
    },
    has(name: string) {
      if (overlay.has(name)) return true;
      if (!collectionId) return false;
      const v = variables.getForCollection(collectionId).find((x) => x.key === name);
      return !!v;
    },
    unset(name: string) {
      overlay.delete(name);
      if (collectionId) void variables.delete(collectionId, name);
    },
  };
}

export function getOverlayValue(api: ScriptVariableApi, name: string): string | undefined {
  return api.get(name);
}
