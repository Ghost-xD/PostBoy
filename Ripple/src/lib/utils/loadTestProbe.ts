// ---------------------------------------------------------------------------
// Load-test probe bridge (TS side).
//
// The probe itself runs in Rust (`probe_collection` -> src-tauri/src/load_probe.rs)
// so it uses the same reqwest stack as the interactive Send and emits live
// `probe-progress` events. This file's only job is the resolution step:
// turning a saved request row into a fully-resolved HTTP payload (auth,
// query params, form bodies, {{variable}} interpolation).
//
// We deliberately reuse `resolveRequest` from chainRunner.ts instead of
// re-implementing it in Rust — that logic also powers the Send button and
// the chain runner, and a Rust copy would inevitably drift. The cost is
// trivial because resolution is just string concatenation; the actual
// network calls happen in Rust.
// ---------------------------------------------------------------------------

import { db, loadTest } from '$lib/api/tauri';
import { variables } from '$lib/stores/variableStore';
import { resolveRequest } from '$lib/utils/chainRunner';
import type { DraftPlan } from '$lib/stores/loadTestStore';

/** Saved-request row as returned by `db.getRequests`. */
interface SavedRequest {
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

/** Shape we hand to the Rust probe — matches `ResolvedReq` in load_probe.rs. */
export interface ResolvedReq {
  requestId: number;
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  isMutating: boolean;
}

/** One row in the probe selection table the user toggles before running. */
export interface ProbeSelection {
  requestId: number;
  name: string;
  method: string;
  url: string;
  isMutating: boolean;
  /** True when this request looks like an auth/login endpoint (URL pattern).
   *  Used to: (a) auto-include even though it's mutating, (b) promote it
   *  to run first so its fresh token is available to downstream steps in
   *  chain mode (which breaks the iteration on the first error). */
  isAuth: boolean;
  included: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Substring patterns that strongly imply "this request produces a token we
// want the chain to use". Conservative on purpose — false positives would
// hand a side-effect call to the probe before the user opts in.
const AUTH_URL_PATTERNS = ['/login', '/signin', '/authenticate', '/oauth/token', '/auth/token'];

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has((method || '').toUpperCase());
}

export function isAuthLoginRequest(method: string, url: string): boolean {
  if (!isMutatingMethod(method)) return false;
  const lower = (url || '').toLowerCase();
  return AUTH_URL_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Build the list shown in the probe phase.
 *
 * Defaults:
 *  - GETs              -> auto-included, kept in collection order
 *  - Auth/login POSTs  -> auto-included AND promoted to the front so the
 *                         fresh token they produce can flow into later steps
 *                         (chain mode breaks the iteration on the first
 *                         error, so a stale-token failure before login
 *                         would never reach login otherwise)
 *  - Other mutating    -> listed but unchecked; user opts in
 */
export async function buildProbeSelection(collectionId: number): Promise<ProbeSelection[]> {
  const rows = (await db.getRequests(collectionId)) as SavedRequest[];
  const built: ProbeSelection[] = rows.map((r) => {
    const mutating = isMutatingMethod(r.method);
    const auth = isAuthLoginRequest(r.method, r.url);
    return {
      requestId: r.id,
      name: r.name,
      method: r.method,
      url: r.url,
      isMutating: mutating,
      isAuth: auth,
      // Auth endpoints opt-in by default (we promote them too); other
      // mutating verbs stay unchecked until the user explicitly enables.
      included: auth || !mutating,
    };
  });

  // Promote auth endpoints to the front, preserving the relative order of
  // everything else. Stable partition: auth-in-original-order, then rest.
  const auths = built.filter((r) => r.isAuth);
  const rest = built.filter((r) => !r.isAuth);
  return [...auths, ...rest];
}

/**
 * Resolve every included request and invoke the Rust probe. Returns the
 * `ProbePlan` (results + ready draft plan). Live `probe-progress` events
 * fire during execution — the caller subscribes to them via Tauri's
 * `listen` API before calling this.
 */
export async function runProbe(
  collectionId: number,
  selection: ProbeSelection[],
): Promise<ProbePlanWire> {
  // Make sure {{var}} interpolation has the latest collection variables
  // (resolveRequest pulls them from the variableStore).
  await variables.load(collectionId);

  const included = selection.filter((s) => s.included);
  if (included.length === 0) {
    throw new Error('Pick at least one request to probe.');
  }

  const rowsById = new Map<number, SavedRequest>();
  const allRows = (await db.getRequests(collectionId)) as SavedRequest[];
  for (const r of allRows) rowsById.set(r.id, r);

  const resolved: ResolvedReq[] = [];
  for (const sel of included) {
    const row = rowsById.get(sel.requestId);
    if (!row) continue;
    const r = await resolveRequest(row, collectionId);
    resolved.push({
      requestId: sel.requestId,
      name: sel.name || row.name || row.url,
      method: r.method,
      url: r.url,
      headers: r.headers,
      body: r.body,
      isMutating: sel.isMutating,
    });
  }

  return (await loadTest.probeCollection(resolved)) as ProbePlanWire;
}

// ---------------------------------------------------------------------------
// Wire types returned by the Rust probe (mirror load_probe.rs)
// ---------------------------------------------------------------------------

export interface ProbeResultWire {
  index: number;
  requestId: number;
  name: string;
  method: string;
  url: string;
  statusCode: number;
  timeMs: number;
  bodyPreview: string;
  headers: Record<string, string>;
  error: string | null;
  ok: boolean;
  detectedVars: string[];
}

export interface DiscoveredVarWire {
  variableName: string;
  jsonPath: string;
  sourceStepIndex: number;
  sourceRequestName: string;
}

export interface ProbePlanWire {
  results: ProbeResultWire[];
  steps: Array<{
    id: string;
    sourceRequestId: number;
    name: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string | null;
    bodyIsBase64: boolean;
    extractions: Array<{ jsonPath: string; variableName: string }>;
  }>;
  initialVars: Record<string, string>;
  discoveredVars: DiscoveredVarWire[];
  rationale: string;
}

/** Live progress event payload (Tauri event name: `probe-progress`). */
export interface ProbeProgressEvent {
  index: number;
  total: number;
  result: ProbeResultWire;
}

/**
 * Promote a `ProbePlanWire` into a full `DraftPlan` using the existing
 * config knobs (duration, concurrency, etc). The probe never touches load
 * parameters — those belong to the user's configure-screen choices.
 */
export function probePlanToDraft(
  probe: ProbePlanWire,
  config: {
    mode: 'chain' | 'per_endpoint';
    concurrency: number;
    durationSecs: number;
    totalRequests: number;
    rampUpSecs: number;
    targetRps: number;
    timeoutSecs: number;
  },
): DraftPlan {
  return {
    mode: config.mode,
    concurrency: config.concurrency,
    durationSecs: config.durationSecs,
    totalRequests: config.totalRequests,
    rampUpSecs: config.rampUpSecs,
    targetRps: config.targetRps,
    timeoutSecs: config.timeoutSecs,
    initialVars: probe.initialVars || {},
    steps: probe.steps.map((s) => ({
      id: s.id,
      sourceRequestId: s.sourceRequestId,
      name: s.name,
      method: s.method,
      url: s.url,
      headers: s.headers || {},
      body: s.body ?? undefined,
      bodyIsBase64: !!s.bodyIsBase64,
      extractions: s.extractions || [],
    })),
    rationale: probe.rationale || '',
    origin: 'ai',
  };
}
