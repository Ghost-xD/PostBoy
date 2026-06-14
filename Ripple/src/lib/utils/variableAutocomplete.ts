import type { Variable } from '$lib/stores/variableStore';

export interface VariableContext {
  /** Index of the opening `{{` */
  start: number;
  /** Index where the partial token ends (usually the cursor) */
  end: number;
  /** Partial variable name typed after `{{` */
  query: string;
}

/** True when the cursor is inside an unfinished `{{...` token. */
export function getVariableContext(text: string, cursor: number): VariableContext | null {
  if (!text || cursor < 0) return null;

  const before = text.slice(0, cursor);
  const openIdx = before.lastIndexOf('{{');
  if (openIdx === -1) return null;

  const afterOpen = before.slice(openIdx + 2);
  if (afterOpen.includes('}}')) return null;

  return {
    start: openIdx,
    end: cursor,
    query: afterOpen.trim(),
  };
}

export function filterVariableSuggestions(
  vars: Variable[],
  query: string
): Variable[] {
  const q = query.trim().toLowerCase();
  if (!q) return vars;
  return vars.filter((v) => v.key.toLowerCase().includes(q));
}

export function buildVariableInsertion(varName: string): string {
  return `{{${varName}}}`;
}

export function applyVariableSelection(
  text: string,
  context: VariableContext,
  varName: string
): { value: string; cursor: number } {
  const insertion = buildVariableInsertion(varName);
  let end = context.end;
  // Monaco auto-closes `{` inside strings; drop trailing `}` so we don't get `{{name}}}}`.
  while (end < text.length && text[end] === '}' && end - context.end < 2) {
    end++;
  }
  const value = text.slice(0, context.start) + insertion + text.slice(end);
  return { value, cursor: context.start + insertion.length };
}

export function maskVariableValue(value: string, max = 24): string {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
