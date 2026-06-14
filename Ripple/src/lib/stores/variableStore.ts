import { writable, get } from 'svelte/store';
import { db } from '$lib/api/tauri';
import {
  activeEnvironmentId,
  envVariables,
  environmentsRev,
} from './environmentStore';
import { globalVariables, globalsRev } from './globalVariableStore';
import { generateDynamicVariable, isDynamicVariable } from '$lib/utils/dynamicVariables';

export interface Variable {
  key: string;
  value: string;
}

// Store: collectionId -> array of variables
const variablesMap = writable<Map<number, Variable[]>>(new Map());
// Bumped on every mutation so Svelte 5 runes reliably re-render Map-backed UI.
const variablesRev = writable(0);

function bumpVariablesRev() {
  variablesRev.update((n) => n + 1);
}

export { variablesRev };

export const variables = {
  subscribe: variablesMap.subscribe,
  
  async load(collectionId: number): Promise<Variable[]> {
    try {
      const vars = (await db.getVariables(collectionId)) as Variable[];
      variablesMap.update(map => {
        const next = new Map(map);
        next.set(collectionId, vars || []);
        return next;
      });
      bumpVariablesRev();
      return vars || [];
    } catch (error) {
      // Table might not exist yet (migration pending), silently fail
      console.warn('Variables not loaded (migration may be pending):', error);
      variablesMap.update(map => {
        const next = new Map(map);
        next.set(collectionId, []);
        return next;
      });
      bumpVariablesRev();
      return [];
    }
  },
  
  async set(collectionId: number, key: string, value: string): Promise<boolean> {
    try {
      await db.setVariable(collectionId, key, value);
      variablesMap.update(map => {
        const existing = map.get(collectionId) || [];
        const idx = existing.findIndex(v => v.key === key);
        const updated = [...existing];
        if (idx >= 0) {
          updated[idx] = { key, value };
        } else {
          updated.push({ key, value });
        }
        const next = new Map(map);
        next.set(collectionId, updated.sort((a, b) => a.key.localeCompare(b.key)));
        return next;
      });
      bumpVariablesRev();
      return true;
    } catch (error) {
      console.error('Failed to set variable:', error);
      return false;
    }
  },
  
  async delete(collectionId: number, key: string): Promise<boolean> {
    try {
      await db.deleteVariable(collectionId, key);
      variablesMap.update(map => {
        const existing = map.get(collectionId) || [];
        const next = new Map(map);
        next.set(collectionId, existing.filter(v => v.key !== key));
        return next;
      });
      bumpVariablesRev();
      return true;
    } catch (error) {
      console.error('Failed to delete variable:', error);
      return false;
    }
  },
  
  async clear(collectionId: number): Promise<boolean> {
    try {
      await db.clearVariables(collectionId);
      variablesMap.update(map => {
        const next = new Map(map);
        next.set(collectionId, []);
        return next;
      });
      bumpVariablesRev();
      return true;
    } catch (error) {
      console.error('Failed to clear variables:', error);
      return false;
    }
  },
  
  getForCollection(collectionId: number | undefined): Variable[] {
    if (!collectionId) return [];
    return get(variablesMap).get(collectionId) || [];
  }
};

/**
 * Persist a value extracted from a chain step (or token refresh).
 * Updates collection variables and, when an environment is active, the
 * environment too — otherwise getResolvedVariables() keeps the stale env value.
 */
export async function persistExtractedVariable(
  collectionId: number,
  key: string,
  value: string
): Promise<boolean> {
  const ok = await variables.set(collectionId, key, value);
  const envId = get(activeEnvironmentId);
  if (envId) {
    await envVariables.set(envId, key, value);
  }
  return ok;
}

/** Merge global + collection + active environment. Later scopes win on conflicts. */
export function getResolvedVariables(collectionId: number | undefined): Variable[] {
  get(globalsRev);
  get(environmentsRev);
  const collVars = variables.getForCollection(collectionId);
  const envId = get(activeEnvironmentId);
  const envVars = envVariables.getForEnvironment(envId).filter((v) => v.enabled);

  const merged = new Map<string, Variable>();
  for (const v of globalVariables.getAll()) {
    merged.set(v.key, { key: v.key, value: v.value });
  }
  for (const v of collVars) {
    merged.set(v.key, { key: v.key, value: v.value });
  }
  for (const v of envVars) {
    merged.set(v.key, { key: v.key, value: v.value });
  }

  return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface TokenRefreshMapping {
  jsonPath: string;
  variableName: string;
}

/**
 * Resolve one response-mapping row into a variable key/value pair.
 * If the JSON path does not match but the variable-name field matches a path
 * (fields were entered backwards), the mapping is auto-corrected.
 */
export function resolveMappingEntry(
  responseJson: unknown,
  jsonPath: string,
  variableName: string
): { variableName: string; value: string } | null {
  const trimmedPath = jsonPath.trim();
  const trimmedName = variableName.trim();
  if (!trimmedPath || !trimmedName) return null;

  let value = getValueAtPath(responseJson as any, trimmedPath);
  let name = trimmedName;

  if (value === undefined) {
    const swappedValue = getValueAtPath(responseJson as any, trimmedName);
    if (swappedValue !== undefined) {
      value = swappedValue;
      name = trimmedPath;
    }
  }

  if (value === undefined) return null;
  return { variableName: name, value };
}

/** Write mapped values from a token response into collection variables. */
export async function materializeMappingsFromResponse(
  collectionId: number,
  responseJson: unknown,
  mappings: TokenRefreshMapping[]
): Promise<number> {
  let written = 0;
  for (const m of mappings) {
    const resolved = resolveMappingEntry(responseJson, m.jsonPath, m.variableName);
    if (!resolved) continue;
    const ok = await persistExtractedVariable(collectionId, resolved.variableName, resolved.value);
    if (ok) written++;
  }
  if (written > 0) {
    await variables.load(collectionId);
  }
  return written;
}

const VARIABLE_REGEX = /\{\{([^}]+)\}\}/g;

const CHAIN_TOKEN_ALIASES = [
  'accessToken',
  'access_token',
  'apiToken',
  'api_token',
  'token',
  'authToken',
  'idToken',
] as const;

function isTokenVariableName(key: string): boolean {
  const norm = key.replace(/[-_]/g, '').toLowerCase();
  return norm.includes('token');
}

/** Mirror a chain-extracted token under common auth variable names for this run only. */
export function expandChainTokenVars(vars: Record<string, string>): Record<string, string> {
  if (Object.keys(vars).length === 0) return vars;

  const expanded = { ...vars };
  let tokenValue: string | undefined;

  for (const [key, value] of Object.entries(vars)) {
    if (value && isTokenVariableName(key)) {
      tokenValue = value;
      break;
    }
  }

  if (!tokenValue) return expanded;

  for (const alias of CHAIN_TOKEN_ALIASES) {
    if (!expanded[alias]) expanded[alias] = tokenValue;
  }

  return expanded;
}

export function buildInterpolationMap(
  collectionId: number | undefined,
  overrides?: Record<string, string>
): Map<string, string> {
  const vars = getResolvedVariables(collectionId);
  const varMap = new Map(vars.map((v) => [v.key, v.value]));
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      varMap.set(key, value);
    }
  }
  return varMap;
}

export function interpolate(
  text: string,
  collectionId: number | undefined,
  overrides?: Record<string, string>
): string {
  if (!text || !text.includes('{{')) return text;

  const varMap = buildInterpolationMap(collectionId, overrides);

  return text.replace(VARIABLE_REGEX, (match, varName) => {
    const trimmed = varName.trim();
    
    // Check for dynamic variables first
    if (trimmed.startsWith('$')) {
      const dynamicValue = generateDynamicVariable(trimmed);
      if (dynamicValue !== undefined) {
        return dynamicValue;
      }
    }
    
    // Fall back to regular variables
    return varMap.has(trimmed) ? varMap.get(trimmed)! : match;
  });
}

// Like interpolate(), but escapes each substituted value so it is safe inside a
// JSON string literal (handles ", \, and control chars like newlines). Use for
// JSON request bodies so a variable value containing quotes can't break the
// body. Plain numbers/booleans pass through unchanged, so `"n": {{count}}` with
// count=5 still yields valid JSON. Note: injecting a raw JSON object/array via a
// variable in an unquoted position (e.g. `"data": {{obj}}`) is not supported —
// wrap such payloads in quotes or build them as part of the template.
export function interpolateJson(
  text: string,
  collectionId: number | undefined,
  overrides?: Record<string, string>
): string {
  if (!text || !text.includes('{{')) return text;

  const varMap = buildInterpolationMap(collectionId, overrides);

  return text.replace(VARIABLE_REGEX, (match, varName) => {
    const trimmed = varName.trim();
    
    // Check for dynamic variables first
    if (trimmed.startsWith('$')) {
      const dynamicValue = generateDynamicVariable(trimmed);
      if (dynamicValue !== undefined) {
        // JSON.stringify produces a quoted, fully-escaped string; strip the
        // surrounding quotes since the template already supplies them.
        return JSON.stringify(dynamicValue).slice(1, -1);
      }
    }
    
    // Fall back to regular variables
    if (!varMap.has(trimmed)) return match;
    return JSON.stringify(varMap.get(trimmed)!).slice(1, -1);
  });
}

export function interpolateKeyValues(
  pairs: Array<{ key: string; value: string }>,
  collectionId: number | undefined,
  overrides?: Record<string, string>
): Array<{ key: string; value: string }> {
  return pairs.map((p) => ({
    key: interpolate(p.key, collectionId, overrides),
    value: interpolate(p.value, collectionId, overrides),
  }));
}

export function getUnresolvedVariables(text: string, collectionId: number | undefined): string[] {
  if (!text) return [];

  const vars = getResolvedVariables(collectionId);
  const varKeys = new Set(vars.map(v => v.key));
  
  const unresolved: string[] = [];
  let match;
  const regex = new RegExp(VARIABLE_REGEX);
  
  while ((match = regex.exec(text)) !== null) {
    const varName = match[1].trim();
    if (!varKeys.has(varName)) {
      unresolved.push(varName);
    }
  }
  
  return [...new Set(unresolved)];
}

export function getAllUnresolvedVariables(
  texts: string[],
  collectionId: number | undefined
): string[] {
  const all = texts.flatMap(t => getUnresolvedVariables(t, collectionId));
  return [...new Set(all)];
}

export function countVariablesInText(text: string): number {
  if (!text) return 0;
  const matches = text.match(VARIABLE_REGEX);
  return matches ? matches.length : 0;
}

export function flattenJsonPaths(obj: any, prefix = ''): Array<{ path: string; value: string }> {
  const results: Array<{ path: string; value: string }> = [];
  
  if (obj === null || obj === undefined) {
    return results;
  }
  
  if (typeof obj !== 'object') {
    results.push({ path: prefix, value: String(obj) });
    return results;
  }
  
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      const newPrefix = prefix ? `${prefix}[${idx}]` : `[${idx}]`;
      results.push(...flattenJsonPaths(item, newPrefix));
    });
  } else {
    Object.entries(obj).forEach(([key, value]) => {
      const newPrefix = prefix ? `${prefix}.${key}` : key;
      results.push(...flattenJsonPaths(value, newPrefix));
    });
  }
  
  return results;
}

export function getValueAtPath(obj: any, path: string): string | undefined {
  if (obj === null || obj === undefined || !path) {
    return undefined;
  }
  
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: any = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (isNaN(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }
      current = current[idx];
    } else if (typeof current === 'object') {
      if (!(part in current)) {
        return undefined;
      }
      current = current[part];
    } else {
      return undefined;
    }
  }
  
  if (current === null || current === undefined) {
    return undefined;
  }
  
  return typeof current === 'object' ? JSON.stringify(current) : String(current);
}
