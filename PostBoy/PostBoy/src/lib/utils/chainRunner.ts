import { db, http, fileOps } from '$lib/api/tauri';
import { variables, interpolate, interpolateJson, interpolateKeyValues, getValueAtPath, flattenJsonPaths } from '$lib/stores/variableStore';
import { applyRequestAuth } from '$lib/auth/authResolver';
import { normalizeAuthType } from '$lib/auth/tabAuth';

export interface ChainExtraction {
  jsonPath: string;
  variableName: string;
}

export interface ChainStep {
  id: string;
  requestId: number;
  extractions: ChainExtraction[];
}

export interface Chain {
  id: string;
  name: string;
  steps: ChainStep[];
}

export interface StepResponse {
  status: number;
  statusText: string;
  body: string;
  time: number;
  headers?: Record<string, string>;
}

export interface ExtractedValue {
  variableName: string;
  jsonPath: string;
  value: string;
}

export interface StepResult {
  stepIndex: number;
  requestName: string;
  requestMethod: string;
  requestUrl: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  response?: StepResponse;
  extractedValues: ExtractedValue[];
  error?: string;
}

export interface ChainCallbacks {
  onStepStart?: (stepIndex: number) => void;
  onStepComplete?: (result: StepResult) => void;
  onLog?: (message: string, level: 'info' | 'error' | 'system') => void;
}

export async function resolveRequest(request: any, collectionId: number): Promise<{
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}> {
  let headers = request.headers || '[]';
  if (typeof headers === 'string') {
    try { headers = JSON.parse(headers); } catch { headers = []; }
  }

  let params = request.params || '[]';
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = []; }
  }

  const resolvedParams = interpolateKeyValues(params, collectionId);
  const validParams = resolvedParams.filter((p: any) => p.key && p.value);

  let requestUrl = interpolate(request.url, collectionId);
  if (validParams.length > 0) {
    // Params tab is the source of truth: strip any existing query string
    // from the URL to avoid sending duplicates (server would see arrays).
    const qIdx = requestUrl.indexOf('?');
    if (qIdx >= 0) requestUrl = requestUrl.slice(0, qIdx);
    const urlParams = new URLSearchParams();
    validParams.forEach((p: any) => urlParams.append(p.key, p.value));
    requestUrl += '?' + urlParams.toString();
  }

  const resolvedHeaders = interpolateKeyValues(headers, collectionId);
  const headersObj: Record<string, string> = {};
  resolvedHeaders.filter((h: any) => h.key && h.value).forEach((h: any) => {
    headersObj[h.key] = h.value;
  });

  const authType = request.auth_type || 'none';
  let authDataRaw: any = request.auth_data || '{}';
  if (typeof authDataRaw === 'string') {
    try { authDataRaw = JSON.parse(authDataRaw); } catch { authDataRaw = {}; }
  }

  let requestBody: string | undefined;
  const bodyType = request.body_type || 'none';
  const bodyContent = request.body_content || '';

  if (request.method !== 'GET' && request.method !== 'HEAD' && bodyType !== 'none') {
    if (bodyType === 'form-urlencoded' && bodyContent) {
      let formPairs: any[] = [];
      try { formPairs = JSON.parse(bodyContent); } catch { formPairs = []; }
      if (Array.isArray(formPairs) && formPairs.length > 0) {
        const resolvedPairs = interpolateKeyValues(formPairs, collectionId);
        const urlParams = new URLSearchParams();
        resolvedPairs.filter((p: any) => p.key).forEach((p: any) => urlParams.append(p.key, p.value));
        requestBody = urlParams.toString();
      } else {
        requestBody = interpolate(bodyContent, collectionId);
      }
      if (!headersObj['Content-Type']) headersObj['Content-Type'] = 'application/x-www-form-urlencoded';

    } else if (bodyType === 'form-data' && bodyContent) {
      let formPairs: any[] = [];
      try { formPairs = JSON.parse(bodyContent); } catch { formPairs = []; }
      if (Array.isArray(formPairs) && formPairs.length > 0) {
        const textPairs = formPairs.filter(p => p.type === 'text' && p.key);
        const filePairs = formPairs.filter(p => p.type === 'file' && p.key && p.value);
        const resolvedTextPairs = interpolateKeyValues(
          textPairs.map(p => ({ key: p.key, value: p.value })),
          collectionId
        );

        if (resolvedTextPairs.length > 0 || filePairs.length > 0) {
          const boundary = '----RippleFormBoundary' + Date.now();
          let body = '';
          resolvedTextPairs.forEach((p: any) => {
            body += `--${boundary}\r\nContent-Disposition: form-data; name="${p.key}"\r\n\r\n${p.value}\r\n`;
          });
          for (const fp of filePairs) {
            try {
              const fileData = await fileOps.readFileBase64(fp.value);
              const fileName = fp.fileName || fileData.name;
              body += `--${boundary}\r\nContent-Disposition: form-data; name="${fp.key}"; filename="${fileName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${fileData.base64}\r\n`;
            } catch { /* file read failed, skip */ }
          }
          body += `--${boundary}--\r\n`;
          requestBody = body;
          headersObj['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        }
      }

    } else if (bodyType === 'binary') {
      const filePath = request.binary_file_path || request.binaryFilePath || bodyContent;
      if (filePath) {
        try {
          const fileData = await fileOps.readFileBase64(filePath);
          requestBody = fileData.base64;
          if (!headersObj['Content-Type']) headersObj['Content-Type'] = 'application/octet-stream';
          headersObj['Content-Transfer-Encoding'] = 'base64';
        } catch { /* file read failed */ }
      }

    } else if (bodyType === 'graphql' && bodyContent) {
      requestBody = bodyContent;
      if (!headersObj['Content-Type']) headersObj['Content-Type'] = 'application/json';

    } else if (bodyContent) {
      // JSON bodies escape interpolated values so a value containing quotes,
      // backslashes or newlines can't produce malformed JSON.
      requestBody = bodyType === 'json'
        ? interpolateJson(bodyContent, collectionId)
        : interpolate(bodyContent, collectionId);
      if (!headersObj['Content-Type']) {
        if (bodyType === 'json') headersObj['Content-Type'] = 'application/json';
        else if (bodyType === 'xml') headersObj['Content-Type'] = 'application/xml';
      }
    }
  }

  const authResult = await applyRequestAuth({
    authType: normalizeAuthType(authType),
    authData: authDataRaw,
    method: request.method,
    url: requestUrl,
    headers: headersObj,
    body: requestBody,
    collectionId,
  });
  Object.assign(headersObj, authResult.headers);
  requestUrl = authResult.url;
  requestBody = authResult.body;

  return {
    method: request.method,
    url: requestUrl,
    headers: headersObj,
    body: requestBody,
    authType: normalizeAuthType(authType),
    authData: authDataRaw as Record<string, unknown>,
  };
}

export async function executeStep(
  requestId: number,
  collectionId: number,
  extractions: ChainExtraction[]
): Promise<StepResult> {
  const request = await db.getRequest(requestId) as any;
  if (!request) {
    return {
      stepIndex: 0,
      requestName: 'Unknown',
      requestMethod: '?',
      requestUrl: '',
      status: 'error',
      extractedValues: [],
      error: `Request ID ${requestId} not found`,
    };
  }

  const resolved = await resolveRequest(request, collectionId);

  const response: any = await http.executeRequest(
    resolved.method,
    resolved.url,
    Object.keys(resolved.headers).length > 0 ? resolved.headers : undefined,
    resolved.body,
    {
      authType: resolved.authType,
      authData: resolved.authData,
    }
  );

  const stepResponse: StepResponse = {
    status: response.status,
    statusText: response.statusText || '',
    body: response.body || '',
    time: response.responseTime || 0,
    headers: response.headers || undefined,
  };

  const extractedValues = extractValues(response.body || '', extractions);

  for (const ev of extractedValues) {
    await variables.set(collectionId, ev.variableName, ev.value);
  }

  return {
    stepIndex: 0,
    requestName: request.name || 'Untitled',
    requestMethod: request.method || 'GET',
    requestUrl: resolved.url,
    status: response.status >= 400 ? 'error' : 'success',
    response: stepResponse,
    extractedValues,
    error: response.status >= 400 ? `${response.status} ${response.statusText || ''}` : undefined,
  };
}

export function extractValues(
  responseBody: string,
  extractions: ChainExtraction[]
): ExtractedValue[] {
  if (!responseBody || extractions.length === 0) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return [];
  }

  const results: ExtractedValue[] = [];
  for (const ext of extractions) {
    if (!ext.jsonPath || !ext.variableName) continue;
    const value = getValueAtPath(parsed, ext.jsonPath);
    if (value !== undefined) {
      results.push({
        variableName: ext.variableName,
        jsonPath: ext.jsonPath,
        value,
      });
    }
  }
  return results;
}

export async function executeChain(
  chain: Chain,
  collectionId: number,
  callbacks?: ChainCallbacks
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  await variables.load(collectionId);

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];
    callbacks?.onStepStart?.(i);
    callbacks?.onLog?.(`Step ${i + 1}: Executing...`, 'info');

    try {
      const result = await executeStep(step.requestId, collectionId, step.extractions);
      result.stepIndex = i;
      results.push(result);

      callbacks?.onLog?.(
        `Step ${i + 1}: ${result.requestMethod} ${result.requestUrl} — ${result.response?.status ?? '?'} (${result.response?.time ?? 0}ms)`,
        result.status === 'error' ? 'error' : 'info'
      );

      if (result.extractedValues.length > 0) {
        for (const ev of result.extractedValues) {
          const masked = ev.value.length > 12 ? ev.value.slice(0, 4) + '...' + ev.value.slice(-4) : ev.value;
          callbacks?.onLog?.(`  Extracted: {{${ev.variableName}}} = ${masked}`, 'system');
        }
      }

      callbacks?.onStepComplete?.(result);

      if (result.status === 'error') {
        for (let j = i + 1; j < chain.steps.length; j++) {
          results.push({
            stepIndex: j,
            requestName: '',
            requestMethod: '',
            requestUrl: '',
            status: 'skipped',
            extractedValues: [],
          });
        }
        break;
      }
    } catch (error: any) {
      const errorResult: StepResult = {
        stepIndex: i,
        requestName: '',
        requestMethod: '',
        requestUrl: '',
        status: 'error',
        extractedValues: [],
        error: error.message || String(error),
      };
      results.push(errorResult);
      callbacks?.onLog?.(`Step ${i + 1}: Failed — ${error.message || error}`, 'error');
      callbacks?.onStepComplete?.(errorResult);

      for (let j = i + 1; j < chain.steps.length; j++) {
        results.push({
          stepIndex: j,
          requestName: '',
          requestMethod: '',
          requestUrl: '',
          status: 'skipped',
          extractedValues: [],
        });
      }
      break;
    }
  }

  return results;
}

export async function loadChains(collectionId: number): Promise<Chain[]> {
  try {
    const raw = await db.getSetting(`chains_${collectionId}`, '[]');
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveChains(collectionId: number, chains: Chain[]): Promise<void> {
  await db.setSetting(`chains_${collectionId}`, JSON.stringify(chains));
}

export function suggestVariableName(jsonPath: string): string {
  const parts = jsonPath.replace(/\[\d+\]/g, '').split('.');
  const last = parts[parts.length - 1] || parts[parts.length - 2] || 'value';
  return last.replace(/[^a-zA-Z0-9_]/g, '');
}

export function getAvailableVarsForStep(chain: Chain, stepIndex: number): string[] {
  const varNames: string[] = [];
  for (let i = 0; i < stepIndex; i++) {
    for (const ext of chain.steps[i].extractions) {
      if (ext.variableName) varNames.push(ext.variableName);
    }
  }
  return varNames;
}

export { flattenJsonPaths };
