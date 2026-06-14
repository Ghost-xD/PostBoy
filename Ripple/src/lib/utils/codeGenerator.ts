import { buildAuthForCodegen, type AuthCodegenInput } from './codeGenAuth';

export interface CodeGenOptions extends AuthCodegenInput {
  method: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  bodyType?: string;
}

function mergeHeaders(
  base: Array<{ key: string; value: string }>,
  auth: AuthCodegenInput
): { headers: Array<{ key: string; value: string }>; url: string; preamble: string[]; pythonExtra?: string } {
  const authResult = buildAuthForCodegen(auth);
  const seen = new Set(base.map((h) => h.key.toLowerCase()));
  const headers = [...base.filter((h) => h.key && h.value)];
  for (const h of authResult.headers) {
    if (!seen.has(h.key.toLowerCase())) {
      headers.push(h);
      seen.add(h.key.toLowerCase());
    }
  }
  return {
    headers,
    url: authResult.url,
    preamble: authResult.preamble,
    pythonExtra: authResult.pythonExtra,
  };
}

function joinPreamble(preamble: string[], lang: 'js' | 'py' | 'cs' | 'bash'): string {
  if (preamble.length === 0) return '';
  const prefix = lang === 'py' ? '#' : lang === 'cs' ? '//' : '//';
  return preamble.map((l) => (l.startsWith('//') ? l : `${prefix} ${l.replace(/^\/\/\s?/, '')}`)).join('\n') + '\n\n';
}

export function generateFetch(opts: CodeGenOptions): string {
  const { headers, url, preamble } = mergeHeaders(opts.headers, opts);
  const lines: string[] = [];
  if (preamble.length) lines.push(joinPreamble(preamble, 'js').trimEnd());
  lines.push(`const response = await fetch('${url}', {`);
  lines.push(`  method: '${opts.method}',`);
  if (headers.length > 0) {
    lines.push(`  headers: {`);
    headers.forEach((h) => lines.push(`    '${h.key.replace(/'/g, "\\'")}': '${h.value.replace(/'/g, "\\'")}',`));
    lines.push(`  },`);
  }
  if (opts.body && opts.method !== 'GET' && opts.method !== 'HEAD') {
    if (opts.bodyType === 'json') {
      lines.push(`  body: JSON.stringify(${opts.body}),`);
    } else {
      lines.push(`  body: '${opts.body.replace(/'/g, "\\'")}',`);
    }
  }
  lines.push(`});`);
  lines.push(``);
  lines.push(`const data = await response.json();`);
  lines.push(`console.log(data);`);
  return lines.join('\n');
}

export function generatePython(opts: CodeGenOptions): string {
  const { headers, url, preamble, pythonExtra } = mergeHeaders(opts.headers, opts);
  const lines: string[] = [];
  if (preamble.length) lines.push(joinPreamble(preamble, 'py').trimEnd());
  lines.push(`import requests`);
  lines.push(``);
  lines.push(`url = '${url.replace(/'/g, "\\'")}'`);
  if (headers.length > 0) {
    lines.push(`headers = {`);
    headers.forEach((h) => lines.push(`    '${h.key.replace(/'/g, "\\'")}': '${h.value.replace(/'/g, "\\'")}',`));
    lines.push(`}`);
  }
  if (opts.body && opts.method !== 'GET' && opts.method !== 'HEAD') {
    if (opts.bodyType === 'json') {
      lines.push(`payload = ${opts.body}`);
    } else {
      lines.push(`payload = '${opts.body.replace(/'/g, "\\'")}'`);
    }
  }
  lines.push(``);

  const args = [`url`];
  if (headers.length > 0) args.push(`headers=headers`);
  if (opts.body && opts.method !== 'GET' && opts.method !== 'HEAD') {
    args.push(opts.bodyType === 'json' ? `json=payload` : `data=payload`);
  }
  if (pythonExtra) args.push(pythonExtra);

  lines.push(`response = requests.${opts.method.toLowerCase()}(${args.join(', ')})`);
  lines.push(`print(response.status_code)`);
  lines.push(`print(response.json())`);
  return lines.join('\n');
}

export function generateAxios(opts: CodeGenOptions): string {
  const { headers, url, preamble, pythonExtra } = mergeHeaders(opts.headers, opts);
  const lines: string[] = [];
  if (preamble.length) lines.push(joinPreamble(preamble, 'js').trimEnd());
  lines.push(`const axios = require('axios');`);
  lines.push(``);
  lines.push(`const config = {`);
  lines.push(`  method: '${opts.method.toLowerCase()}',`);
  lines.push(`  url: '${url.replace(/'/g, "\\'")}',`);
  if (headers.length > 0) {
    lines.push(`  headers: {`);
    headers.forEach((h) => lines.push(`    '${h.key.replace(/'/g, "\\'")}': '${h.value.replace(/'/g, "\\'")}',`));
    lines.push(`  },`);
  }
  if (opts.body && opts.method !== 'GET' && opts.method !== 'HEAD') {
    if (opts.bodyType === 'json') {
      lines.push(`  data: ${opts.body},`);
    } else {
      lines.push(`  data: '${opts.body.replace(/'/g, "\\'")}',`);
    }
  }
  if (pythonExtra) {
    const m = pythonExtra.match(/auth=\(('[^']*)',\s*'([^']*)'\)/);
    if (m) {
      lines.push(`  auth: { username: '${m[1]}', password: '${m[2]}' },`);
    }
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(`const response = await axios(config);`);
  lines.push(`console.log(response.data);`);
  return lines.join('\n');
}

export function generateCsharp(opts: CodeGenOptions): string {
  const { headers, url, preamble, pythonExtra } = mergeHeaders(opts.headers, opts);
  const lines: string[] = [];
  if (preamble.length) lines.push(joinPreamble(preamble, 'cs').trimEnd());
  lines.push(`using System.Net.Http;`);
  lines.push(`using System.Text;`);
  lines.push(``);
  lines.push(`var client = new HttpClient();`);

  for (const h of headers) {
    if (h.key.toLowerCase() !== 'content-type') {
      lines.push(`client.DefaultRequestHeaders.Add("${h.key.replace(/"/g, '\\"')}", "${h.value.replace(/"/g, '\\"')}");`);
    }
  }

  if (pythonExtra) {
    const m = pythonExtra.match(/auth=\(('[^']*)',\s*'([^']*)'\)/);
    if (m) {
      lines.push(`var authBytes = Encoding.ASCII.GetBytes("${m[1]}:${m[2]}");`);
      lines.push(`client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", Convert.ToBase64String(authBytes));`);
    }
  }

  lines.push(``);

  if (opts.body && opts.method !== 'GET' && opts.method !== 'HEAD') {
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value || 'application/json';
    lines.push(`var content = new StringContent(@"${opts.body.replace(/"/g, '""')}", Encoding.UTF8, "${ct}");`);
    if (opts.method === 'POST') {
      lines.push(`var response = await client.PostAsync("${url.replace(/"/g, '\\"')}", content);`);
    } else if (opts.method === 'PUT') {
      lines.push(`var response = await client.PutAsync("${url.replace(/"/g, '\\"')}", content);`);
    } else {
      lines.push(`var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod("${opts.method}"), "${url.replace(/"/g, '\\"')}") { Content = content });`);
    }
  } else {
    if (opts.method === 'GET') {
      lines.push(`var response = await client.GetAsync("${url.replace(/"/g, '\\"')}");`);
    } else if (opts.method === 'DELETE') {
      lines.push(`var response = await client.DeleteAsync("${url.replace(/"/g, '\\"')}");`);
    } else {
      lines.push(`var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod("${opts.method}"), "${url.replace(/"/g, '\\"')}"));`);
    }
  }

  lines.push(`var body = await response.Content.ReadAsStringAsync();`);
  lines.push(`Console.WriteLine(body);`);
  return lines.join('\n');
}

export function generateCurl(opts: CodeGenOptions): string {
  const authResult = buildAuthForCodegen(opts);
  const merged = mergeHeaders(opts.headers, opts);
  if (authResult.preamble.length) {
    return authResult.preamble.join('\n') + '\n\n' + generateCurlBody(
      opts.method, merged.url, merged.headers, authResult.curlFlags, opts.body, opts.bodyType
    );
  }
  return generateCurlBody(
    opts.method, merged.url, merged.headers, authResult.curlFlags, opts.body, opts.bodyType
  );
}

function generateCurlBody(
  method: string,
  url: string,
  headers: Array<{ key: string; value: string }>,
  curlFlags: string[],
  body?: string,
  bodyType?: string
): string {
  const parts: string[] = ['curl'];
  if (method !== 'GET') parts.push(`-X ${method}`);
  parts.push(`'${url.replace(/'/g, "'\\''")}'`);
  for (const h of headers) {
    parts.push(`-H '${h.key.replace(/'/g, "'\\''")}: ${h.value.replace(/'/g, "'\\''")}'`);
  }
  for (const flag of curlFlags) parts.push(flag);
  if (body && method !== 'GET' && method !== 'HEAD') {
    parts.push(`-d '${body.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(' \\\n  ');
}

export const generators: Record<string, { label: string; language: string; generate: (opts: CodeGenOptions) => string }> = {
  fetch: { label: 'JavaScript (fetch)', language: 'javascript', generate: generateFetch },
  python: { label: 'Python (requests)', language: 'python', generate: generatePython },
  axios: { label: 'Node.js (axios)', language: 'javascript', generate: generateAxios },
  csharp: { label: 'C# (HttpClient)', language: 'csharp', generate: generateCsharp },
  curl: { label: 'cURL', language: 'bash', generate: generateCurl },
};
