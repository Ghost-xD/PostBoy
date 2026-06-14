import type { EnvironmentVariable } from '$lib/stores/environmentStore';

export interface PostmanEnvironmentExport {
  name: string;
  values: Array<{
    key: string;
    value: string;
    type?: string;
    enabled?: boolean;
  }>;
  _postman_variable_scope?: string;
}

export interface EnvironmentImportResult {
  name: string;
  variables: EnvironmentVariable[];
  errors: string[];
}

export function exportPostmanEnvironment(
  name: string,
  variables: EnvironmentVariable[]
): string {
  const payload: PostmanEnvironmentExport = {
    name,
    values: variables.map((v) => ({
      key: v.key,
      value: v.value,
      type: 'default',
      enabled: v.enabled,
    })),
    _postman_variable_scope: 'environment',
  };
  return JSON.stringify(payload, null, 2);
}

export function importPostmanEnvironment(raw: string): EnvironmentImportResult {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e: any) {
    return { name: 'Imported Environment', variables: [], errors: [`Invalid JSON: ${e.message}`] };
  }

  const errors: string[] = [];
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported Environment';

  if (!Array.isArray(data.values)) {
    return { name, variables: [], errors: ['Missing "values" array — not a Postman environment file.'] };
  }

  const variables: EnvironmentVariable[] = [];
  for (const entry of data.values) {
    if (!entry?.key) continue;
    const key = String(entry.key).trim();
    if (!key) continue;
    const value = String(entry.value ?? '');
    const enabled = entry.enabled !== false;
    variables.push({
      key,
      value,
      initial_value: value,
      enabled,
      is_secret: false,
    });
  }

  if (variables.length === 0) {
    errors.push('No variables found in environment file.');
  }

  return { name, variables, errors };
}
