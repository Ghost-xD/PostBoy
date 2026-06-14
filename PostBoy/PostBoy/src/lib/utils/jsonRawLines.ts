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

type JsonPath = (string | number)[];

type ContainerFrame = {
  path: JsonPath;
  kind: 'object' | 'array';
  nextIndex: number;
};

const JSON_INDENT = 2;

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

function getIndent(line: string): number {
  return line.match(/^(\s*)/)?.[1].length ?? 0;
}

function getLevel(line: string): number {
  return getIndent(line) / JSON_INDENT;
}

function getAtPath(value: unknown, path: JsonPath): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      if (typeof segment !== 'number') return undefined;
      current = current[segment];
    } else {
      if (typeof segment !== 'string') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

function collectAllLeafCopyValues(
  value: unknown,
  path: JsonPath = [],
  out = new Map<string, string>()
): Map<string, string> {
  const copy = copyValueForLeaf(value);
  if (copy !== null) {
    out.set(pathKey(path), copy);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAllLeafCopyValues(item, [...path, index], out));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectAllLeafCopyValues(child, [...path, key], out);
    }
  }
  return out;
}

function parsePropertyLine(line: string): { key: string; valuePart: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  try {
    const key = JSON.parse(line.slice(0, colonIdx).trim());
    if (typeof key !== 'string' && typeof key !== 'number') return null;
    return { key: String(key), valuePart: line.slice(colonIdx + 1).trim() };
  } catch {
    return null;
  }
}

function isCloseLine(trimmed: string): boolean {
  return trimmed === '}' || trimmed === '},' || trimmed === ']' || trimmed === '],';
}

function opensContainer(valuePart: string): boolean {
  return valuePart === '{' || valuePart === '[';
}

function parseArrayScalarLine(trimmed: string): boolean {
  const content = trimmed.endsWith(',') ? trimmed.slice(0, -1).trim() : trimmed;
  if (!content || content === '{' || content === '[') return false;
  try {
    const parsed = JSON.parse(content);
    return parsed === null || typeof parsed !== 'object';
  } catch {
    return false;
  }
}

function syncFramesToLevel(frames: ContainerFrame[], level: number) {
  while (frames.length > level + 1) {
    frames.pop();
  }
}

function mapLeafCopiesToLines(formattedText: string, parsed: unknown): Map<number, string> {
  const leafCopies = collectAllLeafCopyValues(parsed);
  const copiesByLine = new Map<number, string>();
  const frames: ContainerFrame[] = [{ path: [], kind: 'object', nextIndex: 0 }];

  function copyForPath(path: JsonPath): string | undefined {
    return leafCopies.get(pathKey(path));
  }

  const lines = formattedText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    const level = getLevel(line);
    const trimmed = line.trim();

    if (isCloseLine(trimmed)) {
      if (frames.length > 1) frames.pop();
      continue;
    }

    syncFramesToLevel(frames, level);
    const frame = frames[frames.length - 1];

    const property = parsePropertyLine(line);
    if (property) {
      const fieldPath: JsonPath =
        frame.kind === 'object'
          ? [...frame.path, property.key]
          : [...frame.path, frame.nextIndex, property.key];

      if (opensContainer(property.valuePart)) {
        const kind = property.valuePart === '[' ? 'array' : 'object';
        frames.push({ path: fieldPath, kind, nextIndex: 0 });
        if (frame.kind === 'array') frame.nextIndex += 1;
      } else {
        const copy = copyForPath(fieldPath);
        if (copy !== undefined) copiesByLine.set(lineNumber, copy);
        if (frame.kind === 'array') frame.nextIndex += 1;
      }
      continue;
    }

    if (frame.kind !== 'array') continue;

    if (trimmed === '{') {
      frames.push({ path: [...frame.path, frame.nextIndex], kind: 'object', nextIndex: 0 });
      frame.nextIndex += 1;
      continue;
    }

    if (trimmed === '[') {
      frames.push({ path: [...frame.path, frame.nextIndex], kind: 'array', nextIndex: 0 });
      frame.nextIndex += 1;
      continue;
    }

    if (parseArrayScalarLine(trimmed)) {
      const elementPath: JsonPath = [...frame.path, frame.nextIndex];
      const copy = copyForPath(elementPath);
      if (copy !== undefined) copiesByLine.set(lineNumber, copy);
      frame.nextIndex += 1;
    }
  }

  return copiesByLine;
}

/** @deprecated Use mapLeafCopiesToLines — kept for callers that only need top-level keys. */
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
  const parsed = JSON.parse(body) as unknown;
  const text = JSON.stringify(truncateObjectLeaves(JSON.parse(JSON.stringify(parsed))), null, 2);
  const copiesByLine = mapLeafCopiesToLines(text, parsed);
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

function leafValueType(value: unknown): JsonRawLine['valueType'] {
  if (value === null) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** Used by tests and legacy callers — builds per-line metadata from formatted JSON. */
export function buildJsonRawLines(formattedJson: string): JsonRawLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(formattedJson);
  } catch {
    return formattedJson.split('\n').map((text, index) => ({
      lineNumber: index + 1,
      indent: '',
      text,
      suffix: '',
    }));
  }

  const truncatedText = JSON.stringify(truncateObjectLeaves(JSON.parse(JSON.stringify(parsed))), null, 2);
  const copiesByLine = mapLeafCopiesToLines(truncatedText, parsed);

  return truncatedText.split('\n').map((text, index) => {
    const lineNumber = index + 1;
    const indent = text.match(/^(\s*)/)?.[1] ?? '';
    const suffix = text.trimEnd().endsWith(',') ? ',' : '';
    const copyValue = copiesByLine.get(lineNumber);
    const key = parseLineKey(text);

    if (copyValue === undefined) {
      return { lineNumber, indent, text, suffix: '' };
    }

    const colonIdx = text.indexOf(':');
    const valuePart = colonIdx === -1 ? text.trim().replace(/,$/, '') : text.slice(colonIdx + 1).trim().replace(/,$/, '');
    const fieldKey = key ?? undefined;
    const isSensitive = fieldKey ? isSensitiveFieldKey(fieldKey) : false;
    let parsedValue: unknown = copyValue;
    if (copyValue !== 'null') {
      try {
        parsedValue = JSON.parse(valuePart);
      } catch {
        parsedValue = copyValue;
      }
    } else {
      parsedValue = null;
    }

    return {
      lineNumber,
      indent,
      text,
      copyValue,
      key: fieldKey,
      valueType: leafValueType(parsedValue),
      valueRaw: valuePart,
      valueDisplay: isSensitive ? maskSecret(copyValue) : valuePart,
      suffix,
    };
  });
}
