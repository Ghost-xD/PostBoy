export interface FormField {
  key: string;
  value: string;
  type: 'text' | 'file';
  fileName?: string;
}

export interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  formFields?: FormField[];
}

/**
 * Tokenize a shell command string, respecting single quotes, double quotes,
 * and backslash escapes. Returns an array of unquoted tokens.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === '\\' && i + 1 < input.length) {
      const next = input[i + 1];
      if (next === '\n' || next === '\r') {
        // Line continuation — skip backslash + newline(s)
        i += 2;
        if (i < input.length && input[i] === '\n') i++;
        continue;
      }
      // Escaped character — take it literally
      current += next;
      i += 2;
      continue;
    }

    if (ch === "'") {
      // Single-quoted string: everything until next unescaped single quote
      i++;
      while (i < input.length && input[i] !== "'") {
        current += input[i];
        i++;
      }
      i++; // skip closing quote
      continue;
    }

    if (ch === '"') {
      // Double-quoted string: backslash escapes are active inside
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1];
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
            i += 2;
            continue;
          }
        }
        current += input[i];
        i++;
      }
      i++; // skip closing quote
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function parseCurlCommand(curlString: string): ParsedCurl | null {
  try {
    const tokens = tokenize(curlString.trim());

    if (tokens.length === 0) return null;

    // Skip leading 'curl' token
    let start = 0;
    if (tokens[0].toLowerCase() === 'curl') {
      start = 1;
    }

    let method = 'GET';
    let url = '';
    const headers: Record<string, string> = {};
    let body: string | undefined;
    const formFields: FormField[] = [];

    let i = start;
    while (i < tokens.length) {
      const token = tokens[i];

      if ((token === '-X' || token === '--request') && i + 1 < tokens.length) {
        method = tokens[i + 1].toUpperCase();
        i += 2;
        continue;
      }

      if ((token === '-H' || token === '--header') && i + 1 < tokens.length) {
        const headerStr = tokens[i + 1];
        const colonIndex = headerStr.indexOf(':');
        if (colonIndex > 0) {
          const key = headerStr.substring(0, colonIndex).trim();
          const value = headerStr.substring(colonIndex + 1).trim();
          headers[key] = value;
        }
        i += 2;
        continue;
      }

      if ((token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-urlencode') && i + 1 < tokens.length) {
        body = tokens[i + 1];
        if (method === 'GET') method = 'POST';
        i += 2;
        continue;
      }

      if (token === '-u' || token === '--user') {
        // Basic auth — skip for now
        i += 2;
        continue;
      }

      if ((token === '-F' || token === '--form') && i + 1 < tokens.length) {
        const fieldStr = tokens[i + 1];
        const eqIdx = fieldStr.indexOf('=');
        if (eqIdx > 0) {
          const key = fieldStr.substring(0, eqIdx);
          const val = fieldStr.substring(eqIdx + 1);
          if (val.startsWith('@')) {
            const filePath = val.substring(1);
            const parts = filePath.replace(/\\/g, '/').split('/');
            formFields.push({ key, value: filePath, type: 'file', fileName: parts[parts.length - 1] });
          } else {
            const base64Match = val.match(/\$\(base64\s+(?:-\w+\s+\S+\s+)*([^)]+)\)/);
            if (base64Match) {
              const filePath = base64Match[1].trim();
              const parts = filePath.replace(/\\/g, '/').split('/');
              formFields.push({ key, value: filePath, type: 'file', fileName: parts[parts.length - 1] });
            } else {
              formFields.push({ key, value: val, type: 'text' });
            }
          }
        }
        if (method === 'GET') method = 'POST';
        i += 2;
        continue;
      }

      // Skip flags that take a value
      if ((token === '-A' || token === '--user-agent' ||
           token === '-e' || token === '--referer' ||
           token === '-o' || token === '--output' ||
           token === '-b' || token === '--cookie' ||
           token === '--connect-timeout' || token === '--max-time') && i + 1 < tokens.length) {
        i += 2;
        continue;
      }

      // Skip boolean flags
      if (token === '--compressed' || token === '-k' || token === '--insecure' ||
          token === '-s' || token === '--silent' || token === '-v' || token === '--verbose' ||
          token === '-L' || token === '--location' || token === '-i' || token === '--include' ||
          token === '-S' || token === '--show-error' || token === '--fail' ||
          token.startsWith('--')) {
        i++;
        continue;
      }

      // Anything else that looks like a URL
      if (!url && (token.startsWith('http://') || token.startsWith('https://'))) {
        url = token;
        i++;
        continue;
      }

      // Bare argument — might be a URL without scheme
      if (!url && token.includes('.') && !token.startsWith('-')) {
        url = token;
        i++;
        continue;
      }

      i++;
    }

    if (!url) {
      return null;
    }

    return { method, url, headers, body, formFields: formFields.length > 0 ? formFields : undefined };
  } catch (error) {
    console.error('Failed to parse curl command:', error);
    return null;
  }
}

export interface CurlExportOptions {
  method: string;
  url: string;
  headers: Array<{key: string, value: string}>;
  body?: string;
  bodyType?: string;
  formDataPairs?: Array<{key: string, value: string, type: 'text' | 'file', fileName?: string}>;
  authType?: string;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  authApiKey?: string;
  authApiValue?: string;
}

export function generateCurlCommand(opts: CurlExportOptions): string {
  const parts: string[] = ['curl'];
  
  if (opts.method !== 'GET') {
    parts.push(`-X ${opts.method}`);
  }
  
  parts.push(`'${opts.url}'`);
  
  const allHeaders: Array<{key: string, value: string}> = [...opts.headers.filter(h => h.key && h.value)];
  
  if (opts.authType === 'bearer' && opts.authToken) {
    allHeaders.push({ key: 'Authorization', value: `Bearer ${opts.authToken}` });
  } else if (opts.authType === 'api-key' && opts.authApiKey && opts.authApiValue) {
    allHeaders.push({ key: opts.authApiKey, value: opts.authApiValue });
  }
  
  for (const h of allHeaders) {
    parts.push(`-H '${h.key}: ${h.value}'`);
  }
  
  if (opts.authType === 'basic' && opts.authUsername) {
    parts.push(`-u '${opts.authUsername}:${opts.authPassword || ''}'`);
  }
  
  if (opts.bodyType === 'form-data' && opts.formDataPairs?.length) {
    for (const pair of opts.formDataPairs.filter(p => p.key)) {
      if (pair.type === 'file' && pair.value) {
        parts.push(`-F '${pair.key}=@${pair.value}'`);
      } else if (pair.type === 'text') {
        const escaped = pair.value.replace(/'/g, "'\\''");
        parts.push(`-F '${pair.key}=${escaped}'`);
      }
    }
  } else if (opts.body && opts.method !== 'GET' && opts.method !== 'HEAD') {
    const escaped = opts.body.replace(/'/g, "'\\''");
    parts.push(`-d '${escaped}'`);
  }
  
  return parts.join(' \\\n  ');
}
