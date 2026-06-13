/** Shared rules for keys/headers that should be masked in the UI. */

const SENSITIVE_KEY_RE =
  /^(password|passwd|pwd|pass|secret|token|access_?token|refresh_?token|id_?token|api_?key|apikey|client_?secret|session_?token|private_?key|credential|auth_?code|authorization|bearer)$/i;

const SENSITIVE_HEADER_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-access-token|api-key|apikey)$/i;

const VARIABLE_REF_RE = /\{\{[^}]+\}\}/;

const MASK_CHAR = '•';

export function containsVariableReference(text: string): boolean {
  return VARIABLE_REF_RE.test(text);
}

export function isSensitiveFieldKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  return SENSITIVE_KEY_RE.test(trimmed);
}

export function isSensitiveHeaderName(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  return SENSITIVE_HEADER_RE.test(trimmed) || isSensitiveFieldKey(trimmed);
}

export function shouldMaskFieldValue(options: {
  value: string;
  fieldKey?: string;
  type?: 'text' | 'password';
  sensitive?: boolean;
}): boolean {
  if (options.type === 'password') return true;
  if (options.sensitive) return true;
  if (containsVariableReference(options.value)) return false;
  const key = options.fieldKey?.trim() ?? '';
  if (!key) return false;
  return isSensitiveFieldKey(key) || isSensitiveHeaderName(key);
}

/** Placeholder shown in JSON editors (plain text — no CodeMirror text-security). */
export function maskSecret(value: string): string {
  if (!value) return '';
  return MASK_CHAR.repeat(Math.min(Math.max(value.length, 8), 32));
}

export function isMaskPlaceholder(value: string): boolean {
  return /^[•*]+$/.test(value);
}

export interface SensitiveJsonMatch {
  key: string;
  value: string;
  valueFrom: number;
  valueTo: number;
  line: number;
}

/** Find quoted JSON string values for sensitive keys (standard formatted JSON). */
export function findSensitiveJsonMatches(text: string): SensitiveJsonMatch[] {
  const matches: SensitiveJsonMatch[] = [];
  const re =
    /"([^"\\]+)"\s*:\s*("(?:[^"\\]|\\.)*")/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = match[1];
    if (!isSensitiveFieldKey(key)) continue;

    const quoted = match[2];
    let value = quoted.slice(1, -1);
    try {
      value = JSON.parse(quoted);
    } catch {
      /* keep unescaped slice */
    }

    if (containsVariableReference(value)) continue;

    const valueFrom = match.index + match[0].indexOf(quoted);
    const valueTo = valueFrom + quoted.length;
    const line = text.slice(0, valueFrom).split('\n').length;

    matches.push({ key, value, valueFrom, valueTo, line });
  }

  return matches;
}

export function secretsByLineFromMatches(matches: SensitiveJsonMatch[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const item of matches) {
    map.set(item.line, item.value);
  }
  return map;
}

/** Match when the cursor is over a sensitive JSON value (quoted string), not the whole line. */
export function findSensitiveMatchAtPos(
  matches: SensitiveJsonMatch[],
  pos: number
): SensitiveJsonMatch | null {
  for (const match of matches) {
    if (pos >= match.valueFrom && pos < match.valueTo) return match;
  }
  return null;
}

export function maskSensitiveJsonText(text: string): {
  text: string;
  matches: SensitiveJsonMatch[];
} {
  const matches = findSensitiveJsonMatches(text);
  if (matches.length === 0) return { text, matches };

  let masked = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const item = matches[i];
    const inner = maskSecret(item.value);
    masked = masked.slice(0, item.valueFrom) + `"${inner}"` + masked.slice(item.valueTo);
  }

  return { text: masked, matches };
}

/** Restore real secrets in a masked JSON document before persisting. */
export function unmaskSensitiveJsonText(
  maskedDoc: string,
  secretsByKey: Map<string, string>
): { text: string; secretsByKey: Map<string, string> } {
  const nextSecrets = new Map(secretsByKey);
  let result = maskedDoc;
  const fields = findSensitiveJsonMatches(maskedDoc);

  for (let i = fields.length - 1; i >= 0; i--) {
    const item = fields[i];
    let secret = item.value;
    if (isMaskPlaceholder(secret)) {
      secret = nextSecrets.get(item.key) ?? secret;
    } else {
      nextSecrets.set(item.key, secret);
    }
    const quoted = JSON.stringify(secret);
    result = result.slice(0, item.valueFrom) + quoted + result.slice(item.valueTo);
  }

  return { text: result, secretsByKey: nextSecrets };
}

export function formatJsonBody(text: string): string {
  try {
    if (text && text.trim()) {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    /* keep raw */
  }
  return text;
}
