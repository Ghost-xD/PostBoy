import { ai, db } from '$lib/api/tauri';
import type { DraftPlan, LoadConfig, PlanStep } from '$lib/stores/loadTestStore';

// ---------------------------------------------------------------------------
// Prompt for the local AI ("Son of Anton") to draft a load-test plan.
//
// The model is a small local llama.cpp build, so we ask for STRICT JSON only
// and validate aggressively. Any parse/validation failure falls back to a
// deterministic "metrics-only" plan that runs the requests in their saved
// order with no extractions.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Ripple's load-test planner. Given a list of saved API requests, you produce a JSON load-test plan.

OUTPUT REQUIREMENTS (CRITICAL):
- Return ONLY a single JSON object. No prose, no markdown, no code fences.
- The JSON MUST match exactly this shape (no extra keys):
{
  "rationale": "<2-4 sentences explaining the order and any token extractions>",
  "initialVars": { "<varName>": "<value>" },
  "steps": [
    {
      "sourceRequestId": <number from the input>,
      "extractions": [ { "jsonPath": "<dotted.path>", "variableName": "<camelCase>" } ]
    }
  ]
}

RULES:
1. ORDER. Place authentication / login / token-fetching requests FIRST so later steps can reuse the token they return.
2. EXTRACTIONS. When a response likely returns a token (fields like "access_token", "token", "id_token", "jwt", "sessionId"), add an extraction that stores it into a sensible {{variableName}} (e.g. access_token).
3. REUSE. If a subsequent request's headers already contain a placeholder like "Bearer {{access_token}}" or "Authorization: Bearer XXX", connect it to the extracted variable name from step 1.
4. NO HALLUCINATION. Only reference sourceRequestId values that appear in the input. Never invent new requests, URLs, or fields.
5. JSON PATHS. Use dotted paths like "data.access_token" or "items[0].id". Keep them simple.
6. DO NOT suggest load parameters (concurrency, duration, ramp-up, RPS). The user sets those directly; focus only on ordering, extractions, and variables.
7. NO TRAILING COMMAS, NO COMMENTS, NO MARKDOWN.`;

interface AiPlanResponse {
  rationale?: string;
  initialVars?: Record<string, string>;
  steps?: Array<{
    sourceRequestId?: number;
    extractions?: Array<{ jsonPath?: string; variableName?: string }>;
  }>;
  suggested?: {
    concurrency?: number;
    durationSecs?: number;
    rampUpSecs?: number;
    targetRps?: number;
  };
}

interface CollectionRequest {
  id: number;
  name: string;
  method: string;
  url: string;
  headers: any;
  params: any;
  body_type?: string;
  body_content?: string;
  auth_type?: string;
  auth_data?: any;
}

/** Best-effort JSON parse: strips any leading prose/markdown fences before
 *  parsing. Returns null on any failure. */
function tryParsePlanJson(raw: string): AiPlanResponse | null {
  if (!raw) return null;
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const slice = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(slice) as AiPlanResponse;
  } catch {
    return null;
  }
}

/** Build a compact representation of the collection's requests for the AI.
 *  We trim long bodies so we don't blow the context window. */
function summarizeRequest(r: CollectionRequest): any {
  let headers: any = r.headers;
  if (typeof headers === 'string') {
    try { headers = JSON.parse(headers); } catch { headers = []; }
  }
  let authData: any = r.auth_data;
  if (typeof authData === 'string') {
    try { authData = JSON.parse(authData); } catch { authData = {}; }
  }
  const body = r.body_content || '';
  const trimmedBody = body.length > 600 ? body.slice(0, 600) + '...[trimmed]' : body;
  return {
    id: r.id,
    name: r.name,
    method: r.method,
    url: r.url,
    headers: Array.isArray(headers) ? headers : [],
    authType: r.auth_type || 'none',
    authPreview: redactAuth(authData),
    bodyType: r.body_type || 'none',
    body: trimmedBody,
  };
}

function redactAuth(authData: any): any {
  if (!authData || typeof authData !== 'object') return {};
  const out: any = {};
  for (const [k, v] of Object.entries(authData)) {
    if (typeof v !== 'string') continue;
    if (v.length > 8) out[k] = v.slice(0, 4) + '***' + v.slice(-2);
    else out[k] = v ? '***' : '';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building PlanSteps from AI output + raw requests
// ---------------------------------------------------------------------------

function toPlanStep(req: CollectionRequest, position: number, extractions: { jsonPath: string; variableName: string }[]): PlanStep {
  let headersArr: any = req.headers;
  if (typeof headersArr === 'string') {
    try { headersArr = JSON.parse(headersArr); } catch { headersArr = []; }
  }
  const headersObj: Record<string, string> = {};
  if (Array.isArray(headersArr)) {
    for (const h of headersArr) {
      if (h && h.key) headersObj[h.key] = h.value ?? '';
    }
  }

  // Translate auth into a header so the load-test plan is self-contained.
  let authData: any = req.auth_data;
  if (typeof authData === 'string') {
    try { authData = JSON.parse(authData); } catch { authData = {}; }
  }
  const authType = req.auth_type || 'none';
  if (authType === 'bearer' && authData?.token) {
    headersObj['Authorization'] = `Bearer ${authData.token}`;
  } else if (authType === 'basic' && (authData?.username || authData?.password)) {
    const enc = btoa(`${authData.username || ''}:${authData.password || ''}`);
    headersObj['Authorization'] = `Basic ${enc}`;
  } else if (authType === 'api-key' && authData?.key) {
    headersObj[authData.key] = authData.value || '';
  }

  let body: string | undefined;
  const bodyType = req.body_type || 'none';
  const bodyContent = req.body_content || '';
  if (req.method !== 'GET' && req.method !== 'HEAD' && bodyType !== 'none' && bodyContent) {
    body = bodyContent;
    if (!headersObj['Content-Type']) {
      if (bodyType === 'json') headersObj['Content-Type'] = 'application/json';
      else if (bodyType === 'xml') headersObj['Content-Type'] = 'application/xml';
      else if (bodyType === 'form-urlencoded') headersObj['Content-Type'] = 'application/x-www-form-urlencoded';
      else if (bodyType === 'graphql') headersObj['Content-Type'] = 'application/json';
    }
  }

  return {
    id: `s${position}_r${req.id}`,
    sourceRequestId: req.id,
    name: req.name || `Request ${req.id}`,
    method: req.method || 'GET',
    url: req.url || '',
    headers: headersObj,
    body,
    extractions,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DraftPlanArgs {
  config: LoadConfig;
  /** Optional progress callback (not used yet — chatSend is non-streaming in
   *  the wrapper, but kept here so the screen can show "thinking..." state). */
  onProgress?: (msg: string) => void;
}

export async function draftPlan({ config }: DraftPlanArgs): Promise<DraftPlan> {
  if (!config.collectionId) throw new Error('Pick a collection first.');

  const rawRequests = (await db.getRequests(config.collectionId)) as CollectionRequest[];
  if (!rawRequests || rawRequests.length === 0) {
    throw new Error('This collection has no saved requests.');
  }

  // Always have a deterministic fallback ready, regardless of what the AI
  // returns. We use it when the AI is disabled, unsupported, or its output
  // can't be parsed/validated.
  const fallback = buildFallbackPlan(config, rawRequests);

  // Probe AI availability. If the chatbot feature isn't compiled in, or no
  // engine is loaded, skip the AI round-trip entirely.
  let aiSupported = false;
  try {
    const status = await ai.getStatus();
    aiSupported = !!status.supported && !!status.engine_loaded;
  } catch {
    aiSupported = false;
  }
  if (!aiSupported) {
    return { ...fallback, rationale: 'AI not available — using saved request order with no extractions. Edit the plan below before running.', origin: 'fallback' };
  }

  const userPrompt = buildUserPrompt(rawRequests.map(summarizeRequest), config.notes);

  let raw = '';
  try {
    raw = await ai.complete(userPrompt, {
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 1500,
    });
  } catch (e: any) {
    return {
      ...fallback,
      rationale: `AI draft failed (${e?.message || e}). Showing fallback plan — edit as needed.`,
      origin: 'fallback',
    };
  }

  const parsed = tryParsePlanJson(raw);
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    return {
      ...fallback,
      rationale: 'AI did not return a usable plan (could not parse JSON). Showing fallback — edit as needed.',
      origin: 'fallback',
    };
  }

  // Build PlanSteps in the AI's chosen order, ignoring unknown ids and
  // deduplicating. If, after sanitization, no steps remain, fall back.
  const requestsById = new Map(rawRequests.map((r) => [r.id, r]));
  const seen = new Set<number>();
  const steps: PlanStep[] = [];
  parsed.steps.forEach((s, idx) => {
    if (typeof s.sourceRequestId !== 'number') return;
    const req = requestsById.get(s.sourceRequestId);
    if (!req) return;
    if (seen.has(req.id)) return;
    seen.add(req.id);
    const extractions = (s.extractions || [])
      .filter((e) => e && typeof e.jsonPath === 'string' && typeof e.variableName === 'string' && e.jsonPath && e.variableName)
      .map((e) => ({ jsonPath: e.jsonPath!.trim(), variableName: e.variableName!.trim() }));
    steps.push(toPlanStep(req, idx, extractions));
  });

  // Append any request the AI skipped so users always see the full set in
  // the review step (they can delete unwanted ones manually).
  rawRequests.forEach((r) => {
    if (!seen.has(r.id)) steps.push(toPlanStep(r, steps.length, []));
  });

  const initialVars: Record<string, string> = {};
  if (parsed.initialVars && typeof parsed.initialVars === 'object') {
    for (const [k, v] of Object.entries(parsed.initialVars)) {
      if (typeof k === 'string' && k && typeof v === 'string') initialVars[k] = v;
    }
  }

  // Merge collection variables into initialVars so the user's already-set
  // tokens/base URLs are available to the run by default. The AI's
  // explicit values take precedence.
  try {
    const vars = (await db.getVariables(config.collectionId)) as Array<{ key: string; value: string }>;
    for (const v of vars || []) {
      if (!(v.key in initialVars)) initialVars[v.key] = v.value;
    }
  } catch {
    /* variables table may not exist yet */
  }

  // Load parameters (duration, concurrency, ramp-up, RPS, caps, timeout) are
  // operational knobs the user sets deliberately in the config form — they
  // ALWAYS win. The AI's job is the value-add it can't get wrong: request
  // chaining (steps), JSON extractions, and initial variables. We ignore any
  // load-param suggestions the model emits so it can't silently override the
  // user's run settings (e.g. forcing duration back to its favourite 30s).
  return {
    mode: config.mode,
    concurrency: config.concurrency,
    durationSecs: config.durationSecs,
    totalRequests: config.totalRequests,
    rampUpSecs: config.rampUpSecs,
    targetRps: config.targetRps,
    timeoutSecs: config.timeoutSecs,
    initialVars,
    steps,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
    origin: 'ai',
  };
}

function buildUserPrompt(requestSummaries: any[], notes: string): string {
  const lines: string[] = [];
  lines.push('Draft a load-test plan for the following collection of API requests.');
  lines.push('');
  lines.push('REQUESTS (JSON):');
  lines.push(JSON.stringify(requestSummaries, null, 2));
  if (notes && notes.trim()) {
    lines.push('');
    lines.push('USER NOTES:');
    lines.push(notes.trim());
  }
  lines.push('');
  lines.push('Now return ONLY the JSON plan as specified.');
  return lines.join('\n');
}

function buildFallbackPlan(config: LoadConfig, requests: CollectionRequest[]): DraftPlan {
  return {
    mode: config.mode,
    concurrency: config.concurrency,
    durationSecs: config.durationSecs,
    totalRequests: config.totalRequests,
    rampUpSecs: config.rampUpSecs,
    targetRps: config.targetRps,
    timeoutSecs: config.timeoutSecs,
    initialVars: {},
    steps: requests.map((r, i) => toPlanStep(r, i, [])),
    rationale: '',
    origin: 'fallback',
  };
}

// ---------------------------------------------------------------------------
// Post-run analysis: "which APIs to optimize and why"
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM_PROMPT = `You are Ripple's performance analyst. Given aggregated load-test results, write a concise (4-7 sentences) plain-English analysis for a developer. Focus on:
- WHICH endpoints to optimize first (call them out by name + method).
- WHY (high p95 latency, high error rate, large response bodies, etc.).
- Concrete next steps (e.g. "add caching", "investigate DB queries", "raise connection pool").
Markdown allowed (lists, bold). NO preamble like "Here is...". NO disclaimers. Just the analysis.`;

export async function analyzeResults(result: any): Promise<string> {
  // Trim the payload to the essentials so the model fits it comfortably.
  const compact = {
    elapsed_ms: result.elapsed_ms,
    total_count: result.total_count,
    total_ok: result.total_ok,
    total_err: result.total_err,
    rps_overall: round2(result.rps_overall),
    bottleneck_order: result.bottlenecks,
    per_step: (result.per_step || []).map((s: any) => ({
      name: s.name,
      method: s.method,
      url: s.url,
      count: s.count,
      errors: s.errors,
      error_rate: round2(s.error_rate),
      avg_ms: round2(s.avg_ms),
      p95_ms: round2(s.p95_ms),
      p99_ms: round2(s.p99_ms),
      max_ms: round2(s.max_ms),
      status_codes: s.status_codes,
    })),
  };

  let aiSupported = false;
  try {
    const status = await ai.getStatus();
    aiSupported = !!status.supported && !!status.engine_loaded;
  } catch {
    aiSupported = false;
  }
  if (!aiSupported) {
    return buildHeuristicAnalysis(compact);
  }

  try {
    const text = await ai.complete(
      'Analyze these results:\n\n' + JSON.stringify(compact, null, 2),
      { systemPrompt: ANALYSIS_SYSTEM_PROMPT, maxTokens: 600 },
    );
    const trimmed = (text || '').trim();
    return trimmed || buildHeuristicAnalysis(compact);
  } catch {
    return buildHeuristicAnalysis(compact);
  }
}

function round2(n: number): number {
  if (typeof n !== 'number' || !isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function buildHeuristicAnalysis(compact: any): string {
  const steps = (compact.per_step || []).slice();
  if (steps.length === 0) return '_No requests completed; nothing to analyze._';

  const byP95 = steps.slice().sort((a: any, b: any) => b.p95_ms - a.p95_ms);
  const byErr = steps.slice().sort((a: any, b: any) => b.error_rate - a.error_rate);
  const slowest = byP95[0];
  const mostErrors = byErr[0];

  const lines: string[] = [];
  lines.push(`Across ${compact.total_count} requests over ${(compact.elapsed_ms / 1000).toFixed(1)}s (${compact.rps_overall} rps), ${compact.total_err} failed.`);
  if (slowest && slowest.p95_ms > 0) {
    lines.push(`- **Slowest endpoint:** \`${slowest.method} ${slowest.name}\` — p95 ${round2(slowest.p95_ms)}ms (avg ${round2(slowest.avg_ms)}ms). Investigate downstream latency, DB queries, or response payload size.`);
  }
  if (mostErrors && mostErrors.error_rate > 0) {
    lines.push(`- **Highest error rate:** \`${mostErrors.method} ${mostErrors.name}\` — ${round2(mostErrors.error_rate * 100)}% errors. Check rate limits, auth tokens, and connection pool capacity.`);
  }
  if (byP95.length > 1 && byP95[1].p95_ms > 0) {
    lines.push(`- Next watch: \`${byP95[1].method} ${byP95[1].name}\` at p95 ${round2(byP95[1].p95_ms)}ms.`);
  }
  lines.push(`_Heuristic analysis (AI not available)._`);
  return lines.join('\n');
}
