import { isSensitiveFieldKey, maskSecret } from '$lib/utils/sensitiveData';

export const RAW_VALUE_TRUNCATE_LENGTH = 120;

export interface JsonRawLine {
  lineNumber: number;
  indent: string;
  text: string;
  copyValue?: string;
  key?: string;
  valueType?: 'string' | 'number' | 'boolean' | 'null';
  valueRaw?: string;
  valueDisplay?: string;
  suffix: string;
}

function truncateLeafValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length <= RAW_VALUE_TRUNCATE_LENGTH) return value;
    return `${value.slice(0, RAW_VALUE_TRUNCATE_LENGTH)}...`;
  }
  return value;
}

function truncateObjectLeaves(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => truncateObjectLeaves(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, child]) => [entryKey, truncateObjectLeaves(child, entryKey)])
    );
  }
  if (typeof value === 'string' && key && isSensitiveFieldKey(key)) {
    return maskSecret(value);
  }
  return truncateLeafValue(value);
}

function copyValueForLeaf(value: unknown): string | null {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function collectTopLevelCopyValues(parsed: Record<string, unknown>): Map<string, string> {
  const copiesByKey = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    const copyValue = copyValueForLeaf(value);
    if (copyValue !== null) copiesByKey.set(key, copyValue);
  }
  return copiesByKey;
}

export function parseLineKey(line: string): string | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  try {
    const key = JSON.parse(line.slice(0, colonIdx).trim());
    return typeof key === 'string' ? key : null;
  } catch {
    return null;
  }
}

export function buildFieldModeDocument(body: string): {
  text: string;
  copiesByLine: Map<number, string>;
} {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const copiesByKey = collectTopLevelCopyValues(parsed);
  const text = JSON.stringify(truncateObjectLeaves(JSON.parse(JSON.stringify(parsed))), null, 2);

  const copiesByLine = new Map<number, string>();

  text.split('\n').forEach((line, index) => {
    const key = parseLineKey(line);
    if (!key) return;
    const copyValue = copiesByKey.get(key);
    if (copyValue === undefined) return;
    copiesByLine.set(index + 1, copyValue);
  });

  return { text, copiesByLine };
}

export function formatJsonForRawView(body: string): string {
  try {
    if (body && body.trim()) {
      return JSON.stringify(JSON.parse(body), null, 2);
    }
  } catch {
    // fall through
  }
  return body;
}

/** Used by tests and legacy callers — builds per-line metadata from formatted JSON. */
export function buildJsonRawLines(formattedJson: string): JsonRawLine[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(formattedJson) as Record<string, unknown>;
  } catch {
    return formattedJson.split('\n').map((text, index) => ({
      lineNumber: index + 1,
      indent: '',
      text,
      suffix: '',
    }));
  }

  const truncatedText = JSON.stringify(truncateObjectLeaves(JSON.parse(JSON.stringify(parsed))), null, 2);
  const copiesByKey = collectTopLevelCopyValues(parsed);

  return truncatedText.split('\n').map((text, index) => {
    const lineNumber = index + 1;
    const indent = text.match(/^(\s*)/)?.[1] ?? '';
    const suffix = text.trimEnd().endsWith(',') ? ',' : '';
    const key = parseLineKey(text);
    const copyValue = key ? copiesByKey.get(key) : undefined;

    if (!key || copyValue === undefined) {
      return { lineNumber, indent, text, suffix: '' };
    }

    const colonIdx = text.indexOf(':');
    const valuePart = colonIdx === -1 ? '' : text.slice(colonIdx + 1).trim().replace(/,$/, '');
    const isSensitive = key ? isSensitiveFieldKey(key) : false;

    return {
      lineNumber,
      indent,
      text,
      copyValue,
      key,
      valueType: typeof parsed[key] === 'number'
        ? 'number'
        : typeof parsed[key] === 'boolean'
          ? 'boolean'
          : parsed[key] === null
            ? 'null'
            : 'string',
      valueRaw: valuePart,
      valueDisplay: isSensitive ? maskSecret(copyValue ?? '') : valuePart,
      suffix,
    };
  });
}
