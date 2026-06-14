import { fileOps } from '$lib/api/tauri';
import type { DraftPlan, LoadConfig, PlanStep } from '$lib/stores/loadTestStore';

// ---------------------------------------------------------------------------
// Compile an approved DraftPlan + the user's LoadConfig into the JSON
// contract the Rust load-test engine expects.
//
// File resolution happens here, in JS, so the Rust engine stays generic:
//   - uploadFiles      -> read each file, store as initialVar (text or base64)
//   - dataFile         -> parse CSV/JSON into an array of {key:value} rows
//   - envFile          -> JSON of {key:value} merged into initialVars
//
// The compiler does NOT perform variable interpolation in step URLs/headers
// — the Rust worker does that per-iteration (so `{{rowField}}` from the
// current data row can flow through cleanly).
// ---------------------------------------------------------------------------

export interface CompiledPlan {
  mode: 'chain' | 'per_endpoint';
  concurrency: number;
  durationSecs: number | null;
  totalRequests: number | null;
  rampUpSecs: number;
  targetRps: number;
  timeoutSecs: number;
  steps: PlanStep[];
  initialVars: Record<string, string>;
  dataRows: Record<string, string>[];
}

export interface CompileWarning {
  kind: 'file_read' | 'data_parse' | 'env_parse';
  message: string;
}

export interface CompileResult {
  plan: CompiledPlan;
  warnings: CompileWarning[];
}

export async function compilePlan(draft: DraftPlan, config: LoadConfig): Promise<CompileResult> {
  const warnings: CompileWarning[] = [];
  const initialVars: Record<string, string> = { ...draft.initialVars };

  // 1. Upload files → initialVars
  for (const f of config.uploadFiles) {
    if (!f.variableName || !f.path) continue;
    try {
      if (f.asBase64) {
        const r = await fileOps.readFileBase64(f.path);
        initialVars[f.variableName] = r.base64;
      } else {
        const r = (await fileOps.readFile(f.path)) as any;
        const text = typeof r === 'string' ? r : r?.data || '';
        initialVars[f.variableName] = text;
      }
    } catch (e: any) {
      warnings.push({
        kind: 'file_read',
        message: `Failed to read upload "${f.variableName}" from ${f.path}: ${e?.message || e}`,
      });
    }
  }

  // 2. Env file → merged into initialVars (file values take precedence over
  //    the AI defaults but NOT over explicit uploadFiles vars set above —
  //    user-supplied env beats AI guess, user-supplied upload beats env.)
  if (config.envFile?.path) {
    try {
      const r = (await fileOps.readFile(config.envFile.path)) as any;
      const text = typeof r === 'string' ? r : r?.data || '';
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k !== 'string' || !k) continue;
          if (k in initialVars && config.uploadFiles.some((u) => u.variableName === k)) continue;
          initialVars[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
      } else {
        warnings.push({ kind: 'env_parse', message: 'Env file must be a JSON object of {key: value}.' });
      }
    } catch (e: any) {
      warnings.push({ kind: 'env_parse', message: `Env file parse failed: ${e?.message || e}` });
    }
  }

  // 3. Data file → rows
  let dataRows: Record<string, string>[] = [];
  if (config.dataFile?.path) {
    try {
      const r = (await fileOps.readFile(config.dataFile.path)) as any;
      const text = typeof r === 'string' ? r : r?.data || '';
      dataRows = config.dataFile.format === 'csv' ? parseCsv(text) : parseJsonRows(text);
    } catch (e: any) {
      warnings.push({ kind: 'data_parse', message: `Data file parse failed: ${e?.message || e}` });
    }
  }

  return {
    plan: {
      mode: draft.mode,
      concurrency: Math.max(1, Math.floor(draft.concurrency)),
      durationSecs: draft.durationSecs > 0 ? draft.durationSecs : null,
      totalRequests: draft.totalRequests > 0 ? draft.totalRequests : null,
      rampUpSecs: Math.max(0, Math.floor(draft.rampUpSecs)),
      targetRps: Math.max(0, Math.floor(draft.targetRps)),
      timeoutSecs: Math.max(1, Math.floor(draft.timeoutSecs)),
      steps: draft.steps.map(sanitizeStep),
      initialVars,
      dataRows,
    },
    warnings,
  };
}

function sanitizeStep(s: PlanStep): PlanStep {
  return {
    id: s.id,
    sourceRequestId: s.sourceRequestId,
    name: s.name || s.url || 'Unnamed',
    method: (s.method || 'GET').toUpperCase(),
    url: s.url || '',
    headers: s.headers || {},
    body: s.body,
    bodyIsBase64: s.bodyIsBase64,
    extractions: (s.extractions || []).filter((e) => e && e.jsonPath && e.variableName),
  };
}

// ---------------------------------------------------------------------------
// Minimal CSV parser. Handles double-quoted fields with escaped quotes ("")
// and CRLF/LF line endings. Returns an array of {column: value} maps using
// the first row as header. Empty header columns are dropped.
// ---------------------------------------------------------------------------

export function parseCsv(text: string): Record<string, string>[] {
  if (!text) return [];
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cur.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        cur.push(field); field = '';
        rows.push(cur); cur = [];
      } else {
        field += ch;
      }
    }
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === '') continue;
    const obj: Record<string, string> = {};
    header.forEach((key, idx) => { if (key) obj[key] = r[idx] ?? ''; });
    out.push(obj);
  }
  return out;
}

function parseJsonRows(text: string): Record<string, string>[] {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('JSON data file must be an array of objects.');
  return parsed.map((row, idx) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Row ${idx} is not an object.`);
    }
    const obj: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof k !== 'string' || !k) continue;
      obj[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Data-flow analysis for the review screen.
//
// Walks the plan once to produce, per step, the variables it *provides*
// (via `extractions[].variableName`) and the variables it *uses* (any
// `{{name}}` reference in the url, header keys/values, or body). The
// `producers` map answers "which step first provided `accessToken`?", which
// drives the "from Step 1" badges and warning highlights for unresolved
// references.
//
// This is what makes the order intelligible: the user can see at a glance
// that Step 1 → accessToken → consumed by Steps 2, 4, 5, instead of
// re-reading every URL and header looking for {{vars}}.
// ---------------------------------------------------------------------------

export interface VarReference {
  /** Variable name, e.g. `accessToken`. */
  name: string;
  /** Step index that first provided this var, or null if it's a missing or
   *  initial var (the caller checks against `initialVars` to disambiguate). */
  fromStep: number | null;
}

export interface StepDataFlow {
  provides: string[];
  uses: VarReference[];
  /** Vars referenced but never produced earlier and not in initialVars. */
  warnings: string[];
}

export interface DataFlowSummary {
  producers: Map<string, number>;
  /** Reverse index: var name -> step indices that consume it. */
  consumers: Map<string, number[]>;
  perStep: StepDataFlow[];
  /** Names referenced but never produced and not in initialVars. */
  unresolved: string[];
}

const VAR_RE = /\{\{\s*([\w.-]+?)\s*\}\}/g;

function extractVarNames(...sources: (string | undefined | null)[]): string[] {
  const found = new Set<string>();
  for (const src of sources) {
    if (!src) continue;
    VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAR_RE.exec(src)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return Array.from(found);
}

export function computeDataFlow(
  steps: PlanStep[],
  initialVars: Record<string, string> = {},
): DataFlowSummary {
  const producers = new Map<string, number>();
  const consumers = new Map<string, number[]>();
  const perStep: StepDataFlow[] = [];
  const unresolved = new Set<string>();
  const initialNames = new Set(Object.keys(initialVars));

  steps.forEach((step, idx) => {
    // Sources to scan for {{var}} references — every place the Rust worker
    // does interpolation: url, header keys + values, body.
    const headerStrings: string[] = [];
    for (const [k, v] of Object.entries(step.headers || {})) {
      headerStrings.push(k, v);
    }
    const used = extractVarNames(step.url, step.body, ...headerStrings);

    const uses: VarReference[] = used.map((name) => {
      const fromStep = producers.has(name) ? producers.get(name)! : null;
      const list = consumers.get(name) ?? [];
      list.push(idx);
      consumers.set(name, list);
      return { name, fromStep };
    });

    const warnings: string[] = [];
    for (const ref of uses) {
      if (ref.fromStep === null && !initialNames.has(ref.name)) {
        warnings.push(ref.name);
        unresolved.add(ref.name);
      }
    }

    const provides: string[] = [];
    for (const ex of step.extractions || []) {
      if (!ex.variableName) continue;
      provides.push(ex.variableName);
      // First producer wins — that's the step the consumer badge will point
      // at. Subsequent re-extractions don't shadow it.
      if (!producers.has(ex.variableName)) {
        producers.set(ex.variableName, idx);
      }
    }

    perStep.push({ provides, uses, warnings });
  });

  return {
    producers,
    consumers,
    perStep,
    unresolved: Array.from(unresolved),
  };
}
