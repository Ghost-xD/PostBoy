import type { Chain, ChainExtraction } from './chainRunner';
import { authFieldsFromStored } from '$lib/auth/tabAuth';
import { buildAuthForCodegen } from './codeGenAuth';
import type { CodeGenOptions } from './codeGenerator';
import { expandChainTokenVars } from '$lib/stores/variableStore';

export interface ChainCodegenStepInput {
  stepNumber: number;
  name: string;
  options: CodeGenOptions;
  extractions: ChainExtraction[];
}

export interface ChainCodegenInput {
  chainName: string;
  steps: ChainCodegenStepInput[];
}

const TOKEN_ALIASES = [
  'accessToken',
  'access_token',
  'apiToken',
  'api_token',
  'token',
  'authToken',
  'idToken',
] as const;

function escJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escPy(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Build CodeGenOptions from a saved collection request (keeps {{variables}} as-is). */
export function requestToCodeGenOptions(request: any): CodeGenOptions {
  const headers = parseJsonArray(request.headers).filter((h: any) => h.key && h.value);
  const params = parseJsonArray(request.params).filter((p: any) => p.key && p.value);

  let url = String(request.url || '');
  if (params.length > 0) {
    const qIdx = url.indexOf('?');
    if (qIdx >= 0) url = url.slice(0, qIdx);
    const urlParams = new URLSearchParams();
    params.forEach((p: any) => urlParams.append(p.key, p.value));
    url += '?' + urlParams.toString();
  }

  const authFields = authFieldsFromStored(request.auth_type || 'none', request.auth_data || '{}');
  const bodyType = request.body_type || 'none';
  const method = request.method || 'GET';

  return {
    method,
    url,
    headers,
    body:
      method !== 'GET' && method !== 'HEAD' && bodyType !== 'none'
        ? request.body_content || undefined
        : undefined,
    bodyType,
    authType: authFields.authType,
    authToken: authFields.authToken,
    authUsername: authFields.authUsername,
    authPassword: authFields.authPassword,
    authApiKey: authFields.authApiKey,
    authApiValue: authFields.authApiValue,
    authData: authFields.authData,
  };
}

export function buildChainCodegenInput(chain: Chain, requests: any[]): ChainCodegenInput | null {
  if (!chain.steps.length) return null;

  const byId = new Map<number, any>(requests.map((r) => [r.id, r]));
  const steps: ChainCodegenStepInput[] = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];
    const request = byId.get(step.requestId);
    if (!request) continue;
    steps.push({
      stepNumber: i + 1,
      name: request.name || `Step ${i + 1}`,
      options: requestToCodeGenOptions(request),
      extractions: step.extractions.filter((e) => e.jsonPath && e.variableName),
    });
  }

  if (steps.length === 0) return null;

  return { chainName: chain.name, steps };
}

function collectedVarNames(steps: ChainCodegenStepInput[], upToStep: number): Set<string> {
  const raw: Record<string, string> = {};
  for (let i = 0; i < upToStep; i++) {
    for (const ext of steps[i].extractions) {
      raw[ext.variableName] = '';
    }
  }
  return new Set(Object.keys(expandChainTokenVars(raw)));
}

function resolveTemplateVar(varName: string, known: Set<string>): string | undefined {
  if (known.has(varName)) return varName;
  if (TOKEN_ALIASES.includes(varName as (typeof TOKEN_ALIASES)[number])) {
    for (const k of known) {
      if (TOKEN_ALIASES.includes(k as (typeof TOKEN_ALIASES)[number])) return k;
    }
  }
  return undefined;
}

function substituteTemplateVars(text: string, known: Set<string>, mode: 'js' | 'py'): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, rawName) => {
    const resolved = resolveTemplateVar(rawName.trim(), known);
    if (!resolved) return match;
    if (mode === 'py') return `{vars['${escPy(resolved)}']}`;
    return `\${vars['${escJs(resolved)}']}`;
  });
}

function jsStringLiteral(text: string, known: Set<string>): string {
  const substituted = text.includes('{{') ? substituteTemplateVars(text, known, 'js') : text;
  if (substituted.includes('${vars[')) return `\`${substituted}\``;
  return `'${escJs(substituted)}'`;
}

function pyStringLiteral(text: string, known: Set<string>): string {
  if (!text.includes('{{')) return `'${escPy(text)}'`;
  const inner = text.replace(/\{\{([^}]+)\}\}/g, (match, rawName) => {
    const resolved = resolveTemplateVar(rawName.trim(), known);
    if (!resolved) return match;
    return `{vars['${escPy(resolved)}']}`;
  });
  return `f"${inner.replace(/"/g, '\\"')}"`;
}

function jsExtractExpr(dataVar: string, jsonPath: string): string {
  const parts = jsonPath.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let expr = dataVar;
  for (const part of parts) {
    expr += /^\d+$/.test(part) ? `[${part}]` : `.${part}`;
  }
  return expr;
}

function pyExtractExpr(dataVar: string, jsonPath: string): string {
  const parts = jsonPath.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let expr = dataVar;
  for (const part of parts) {
    expr += /^\d+$/.test(part) ? `[${part}]` : `['${escPy(part)}']`;
  }
  return expr;
}

function mergedStepRequest(
  opts: CodeGenOptions,
  known: Set<string>,
  mode: 'js' | 'py'
): {
  url: string;
  headers: Array<{ key: string; value: string }>;
  preamble: string[];
  curlFlags: string[];
  pythonExtra?: string;
} {
  const auth = buildAuthForCodegen({
    authType: opts.authType,
    authToken: opts.authToken,
    authUsername: opts.authUsername,
    authPassword: opts.authPassword,
    authApiKey: opts.authApiKey,
    authApiValue: opts.authApiValue,
    authData: opts.authData,
    url: opts.url,
  });

  const seen = new Set<string>();
  const headers: Array<{ key: string; value: string }> = [];

  for (const h of opts.headers) {
    if (!h.key || !h.value) continue;
    headers.push({ key: h.key, value: mode === 'py' ? pyStringLiteral(h.value, known) : h.value });
    seen.add(h.key.toLowerCase());
  }

  for (const h of auth.headers) {
    if (seen.has(h.key.toLowerCase())) continue;
    headers.push({
      key: h.key,
      value: mode === 'py' ? pyStringLiteral(h.value, known) : h.value,
    });
    seen.add(h.key.toLowerCase());
  }

  return {
    url: mode === 'py' ? pyStringLiteral(auth.url, known) : substituteTemplateVars(auth.url, known, 'js'),
    headers: headers.map((h) =>
      mode === 'js' ? { key: h.key, value: jsStringLiteral(h.value, known) } : h
    ),
    preamble: auth.preamble,
    curlFlags: auth.curlFlags,
    pythonExtra: auth.pythonExtra,
  };
}

function joinPreamble(preamble: string[], lang: 'js' | 'py' | 'bash'): string {
  if (preamble.length === 0) return '';
  const prefix = lang === 'py' ? '#' : '//';
  return preamble.map((l) => (l.startsWith('//') ? l.replace(/^\/\/\s?/, `${prefix} `) : `${prefix} ${l}`)).join('\n') + '\n\n';
}

export function generateChainFetch(input: ChainCodegenInput): string {
  const lines: string[] = [`// Chain: ${input.chainName}`, `const vars = {};`, ''];

  input.steps.forEach((step, idx) => {
    const known = collectedVarNames(input.steps, idx);
    const req = mergedStepRequest(step.options, known, 'js');
    if (req.preamble.length) lines.push(joinPreamble(req.preamble, 'js').trimEnd(), '');

    lines.push(`// Step ${step.stepNumber}: ${step.name}`);
    lines.push(`const response${step.stepNumber} = await fetch(${jsStringLiteral(req.url, known)}, {`);
    lines.push(`  method: '${step.options.method}',`);
    if (req.headers.length > 0) {
      lines.push(`  headers: {`);
      req.headers.forEach((h) => lines.push(`    '${escJs(h.key)}': ${h.value},`));
      lines.push(`  },`);
    }
    if (step.options.body && step.options.method !== 'GET' && step.options.method !== 'HEAD') {
      if (step.options.bodyType === 'json') {
        lines.push(`  body: JSON.stringify(${substituteTemplateVars(step.options.body, known, 'js')}),`);
      } else {
        lines.push(`  body: ${jsStringLiteral(substituteTemplateVars(step.options.body, known, 'js'), known)},`);
      }
    }
    lines.push(`});`);
    lines.push(`const data${step.stepNumber} = await response${step.stepNumber}.json();`);

    for (const ext of step.extractions) {
      lines.push(`vars['${escJs(ext.variableName)}'] = ${jsExtractExpr(`data${step.stepNumber}`, ext.jsonPath)};`);
    }
    lines.push('');
  });

  const last = input.steps[input.steps.length - 1];
  lines.push(`console.log(data${last.stepNumber});`);
  return lines.join('\n');
}

export function generateChainPython(input: ChainCodegenInput): string {
  const lines: string[] = [`# Chain: ${input.chainName}`, `import requests`, ``, `vars = {}`, ''];

  input.steps.forEach((step, idx) => {
    const known = collectedVarNames(input.steps, idx);
    const req = mergedStepRequest(step.options, known, 'py');
    if (req.preamble.length) lines.push(joinPreamble(req.preamble, 'py').trimEnd(), '');

    lines.push(`# Step ${step.stepNumber}: ${step.name}`);
    lines.push(`url = ${req.url}`);

    if (req.headers.length > 0) {
      lines.push(`headers = {`);
      req.headers.forEach((h) => lines.push(`    '${escPy(h.key)}': ${h.value},`));
      lines.push(`}`);
    }

    const args = [`'${step.options.method.toLowerCase()}'`, 'url'];
    if (req.headers.length > 0) args.push('headers=headers');
    if (step.options.body && step.options.method !== 'GET' && step.options.method !== 'HEAD') {
      if (step.options.bodyType === 'json') {
        lines.push(`payload = ${substituteTemplateVars(step.options.body, known, 'py')}`);
        args.push('json=payload');
      } else {
        lines.push(`payload = ${pyStringLiteral(step.options.body, known)}`);
        args.push('data=payload');
      }
    }
    if (req.pythonExtra) args.push(req.pythonExtra);

    lines.push(`response${step.stepNumber} = requests.request(${args.join(', ')})`);
    lines.push(`data${step.stepNumber} = response${step.stepNumber}.json()`);

    for (const ext of step.extractions) {
      lines.push(`vars['${escPy(ext.variableName)}'] = ${pyExtractExpr(`data${step.stepNumber}`, ext.jsonPath)}`);
    }
    lines.push('');
  });

  const last = input.steps[input.steps.length - 1];
  lines.push(`print(response${last.stepNumber}.status_code)`);
  lines.push(`print(data${last.stepNumber})`);
  return lines.join('\n');
}

export function generateChainAxios(input: ChainCodegenInput): string {
  const lines: string[] = [`const axios = require('axios');`, ``, `// Chain: ${input.chainName}`, `const vars = {};`, ''];

  input.steps.forEach((step, idx) => {
    const known = collectedVarNames(input.steps, idx);
    const req = mergedStepRequest(step.options, known, 'js');
    if (req.preamble.length) lines.push(joinPreamble(req.preamble, 'js').trimEnd(), '');

    lines.push(`// Step ${step.stepNumber}: ${step.name}`);
    lines.push(`const response${step.stepNumber} = await axios({`);
    lines.push(`  method: '${step.options.method.toLowerCase()}',`);
    lines.push(`  url: ${jsStringLiteral(req.url, known)},`);
    if (req.headers.length > 0) {
      lines.push(`  headers: {`);
      req.headers.forEach((h) => lines.push(`    '${escJs(h.key)}': ${h.value},`));
      lines.push(`  },`);
    }
    if (step.options.body && step.options.method !== 'GET' && step.options.method !== 'HEAD') {
      if (step.options.bodyType === 'json') {
        lines.push(`  data: ${substituteTemplateVars(step.options.body, known, 'js')},`);
      } else {
        lines.push(`  data: ${jsStringLiteral(substituteTemplateVars(step.options.body, known, 'js'), known)},`);
      }
    }
    lines.push(`});`);
    lines.push(`const data${step.stepNumber} = response${step.stepNumber}.data;`);

    for (const ext of step.extractions) {
      lines.push(`vars['${escJs(ext.variableName)}'] = ${jsExtractExpr(`data${step.stepNumber}`, ext.jsonPath)};`);
    }
    lines.push('');
  });

  const last = input.steps[input.steps.length - 1];
  lines.push(`console.log(data${last.stepNumber});`);
  return lines.join('\n');
}

export function generateChainCurl(input: ChainCodegenInput): string {
  const lines: string[] = [`# Chain: ${input.chainName}`, ''];

  input.steps.forEach((step, idx) => {
    const known = collectedVarNames(input.steps, idx);
    const req = mergedStepRequest(step.options, known, 'js');
    if (req.preamble.length) lines.push(joinPreamble(req.preamble, 'bash').trimEnd());

    lines.push(`# Step ${step.stepNumber}: ${step.name}`);
    const parts = ['curl'];
    if (step.options.method !== 'GET') parts.push(`-X ${step.options.method}`);
    parts.push(`'${req.url.replace(/'/g, "'\\''")}'`);
    for (const h of req.headers) {
      const val = h.value.replace(/^'|'$/g, '').replace(/^`|`$/g, '').replace(/^\$\{vars\['/g, '${vars[').replace(/'\]\}$/, "']}");
      parts.push(`-H '${h.key.replace(/'/g, "'\\''")}: ${val.replace(/'/g, "'\\''")}'`);
    }
    for (const flag of req.curlFlags) parts.push(flag);
    if (step.options.body && step.options.method !== 'GET' && step.options.method !== 'HEAD') {
      parts.push(`-d '${substituteTemplateVars(step.options.body, known, 'js').replace(/'/g, "'\\''")}'`);
    }
    lines.push(parts.join(' \\\n  '));

    for (const ext of step.extractions) {
      const jqPath = ext.jsonPath.replace(/\[(\d+)\]/g, '.$1');
      lines.push(`# ${ext.variableName}=$(... | jq -r '.${jqPath}')`);
    }
    lines.push('');
  });

  return lines.join('\n').trimEnd();
}

export const chainGenerators: Record<
  string,
  { label: string; language: string; generate: (input: ChainCodegenInput) => string }
> = {
  fetch: { label: 'JavaScript (fetch)', language: 'javascript', generate: generateChainFetch },
  python: { label: 'Python (requests)', language: 'python', generate: generateChainPython },
  axios: { label: 'Node.js (axios)', language: 'javascript', generate: generateChainAxios },
  curl: { label: 'cURL', language: 'bash', generate: generateChainCurl },
};
