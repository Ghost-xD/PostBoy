import { variables } from '$lib/stores/variableStore';
import {
  activeEnvironmentId,
  envVariables,
} from '$lib/stores/environmentStore';
import { get } from 'svelte/store';
import type { ScriptVariableApi } from './requestScriptRunner';

export interface ScriptVariableContext {
  /** pm.variables / pm.environment */
  environment: ScriptVariableApi;
  /** pm.collectionVariables */
  collection: ScriptVariableApi;
}

/** Overlay + scoped variables for script execution (Postman-compatible). */
export function createScriptVariableContext(collectionId?: number): ScriptVariableContext {
  const envOverlay = new Map<string, string>();
  const collOverlay = new Map<string, string>();
  const envId = get(activeEnvironmentId);

  const environment: ScriptVariableApi = {
    get(name: string) {
      if (envOverlay.has(name)) return envOverlay.get(name);
      if (!envId) return undefined;
      const v = envVariables.getForEnvironment(envId).find((x) => x.key === name && x.enabled);
      return v?.value;
    },
    set(name: string, value: string) {
      envOverlay.set(name, value);
      if (envId) void envVariables.set(envId, name, value);
    },
    has(name: string) {
      if (envOverlay.has(name)) return true;
      if (!envId) return false;
      return !!envVariables.getForEnvironment(envId).find((x) => x.key === name && x.enabled);
    },
    unset(name: string) {
      envOverlay.delete(name);
      if (envId) void envVariables.delete(envId, name);
    },
  };

  const collection: ScriptVariableApi = {
    get(name: string) {
      if (collOverlay.has(name)) return collOverlay.get(name);
      if (!collectionId) return undefined;
      const v = variables.getForCollection(collectionId).find((x) => x.key === name);
      return v?.value;
    },
    set(name: string, value: string) {
      collOverlay.set(name, value);
      if (collectionId) void variables.set(collectionId, name, value);
    },
    has(name: string) {
      if (collOverlay.has(name)) return true;
      if (!collectionId) return false;
      return !!variables.getForCollection(collectionId).find((x) => x.key === name);
    },
    unset(name: string) {
      collOverlay.delete(name);
      if (collectionId) void variables.delete(collectionId, name);
    },
  };

  return { environment, collection };
}

/** @deprecated Use createScriptVariableContext for full Postman scoping. */
export function createScriptVariableApi(collectionId?: number): ScriptVariableApi {
  const ctx = createScriptVariableContext(collectionId);
  return ctx.environment;
}

export function getOverlayValue(api: ScriptVariableApi, name: string): string | undefined {
  return api.get(name);
}
