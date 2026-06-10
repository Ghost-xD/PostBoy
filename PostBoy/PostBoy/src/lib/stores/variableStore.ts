import { writable, get } from 'svelte/store';
import { db } from '$lib/api/tauri';

export interface Variable {
  key: string;
  value: string;
}

// Store: collectionId -> array of variables
const variablesMap = writable<Map<number, Variable[]>>(new Map());

export const variables = {
  subscribe: variablesMap.subscribe,
  
  async load(collectionId: number): Promise<Variable[]> {
    try {
      const vars = (await db.getVariables(collectionId)) as Variable[];
      variablesMap.update(map => {
        map.set(collectionId, vars || []);
        return new Map(map);
      });
      return vars || [];
    } catch (error) {
      // Table might not exist yet (migration pending), silently fail
      console.warn('Variables not loaded (migration may be pending):', error);
      variablesMap.update(map => {
        map.set(collectionId, []);
        return new Map(map);
      });
      return [];
    }
  },
  
  async set(collectionId: number, key: string, value: string): Promise<boolean> {
    try {
      await db.setVariable(collectionId, key, value);
      variablesMap.update(map => {
        const existing = map.get(collectionId) || [];
        const idx = existing.findIndex(v => v.key === key);
        if (idx >= 0) {
          existing[idx] = { key, value };
        } else {
          existing.push({ key, value });
        }
        map.set(collectionId, [...existing].sort((a, b) => a.key.localeCompare(b.key)));
        return new Map(map);
      });
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
        map.set(collectionId, existing.filter(v => v.key !== key));
        return new Map(map);
      });
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
        map.set(collectionId, []);
        return new Map(map);
      });
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

const VARIABLE_REGEX = /\{\{([^}]+)\}\}/g;

export function interpolate(text: string, collectionId: number | undefined): string {
  if (!text || !collectionId) return text;
  
  const vars = variables.getForCollection(collectionId);
  const varMap = new Map(vars.map(v => [v.key, v.value]));
  
  return text.replace(VARIABLE_REGEX, (match, varName) => {
    const trimmed = varName.trim();
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
export function interpolateJson(text: string, collectionId: number | undefined): string {
  if (!text || !collectionId) return text;

  const vars = variables.getForCollection(collectionId);
  const varMap = new Map(vars.map(v => [v.key, v.value]));

  return text.replace(VARIABLE_REGEX, (match, varName) => {
    const trimmed = varName.trim();
    if (!varMap.has(trimmed)) return match;
    // JSON.stringify produces a quoted, fully-escaped string; strip the
    // surrounding quotes since the template already supplies them.
    return JSON.stringify(varMap.get(trimmed)!).slice(1, -1);
  });
}

export function interpolateKeyValues(
  pairs: Array<{ key: string; value: string }>,
  collectionId: number | undefined
): Array<{ key: string; value: string }> {
  return pairs.map(p => ({
    key: interpolate(p.key, collectionId),
    value: interpolate(p.value, collectionId)
  }));
}

export function getUnresolvedVariables(text: string, collectionId: number | undefined): string[] {
  if (!text) return [];
  
  const vars = variables.getForCollection(collectionId);
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
