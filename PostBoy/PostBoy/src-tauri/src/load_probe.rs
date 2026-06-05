// ---------------------------------------------------------------------------
// Load-test discovery / probe engine.
//
// Runs each saved request in a collection exactly once, sequentially, so we
// can see real response bodies/statuses before drafting the load-test chain.
//
// Why this exists (vs. drafting the plan from static metadata in the old
// `loadTestAI.ts` path): the only way to know which fields a response
// actually returns — and to grab a *fresh* auth token for chained requests
// like `/auth/me` — is to fire each request for real. Static metadata is
// what produced the junk extractions ("body.username -> username") and the
// dead chains where login's `accessToken` was extracted into the wrong var
// and never threaded into downstream `Authorization` headers.
//
// Pipeline:
//   1. TS resolves each saved request (auth, params, forms, {{vars}}) and
//      hands us already-built `ResolvedReq`s. We do NOT re-implement
//      request resolution here on purpose — the interactive Send path and
//      chainRunner share that TS code, and duplicating it in Rust would
//      drift over time.
//   2. We send them in order via the existing `http_client::execute_request`
//      so the probe uses the exact same reqwest stack as Send.
//   3. After each response we scan it (recursively) for token-shaped keys
//      (`accessToken`, `jwt`, `token`, `sessionId`, ...). The FIRST hit
//      becomes the chained token: from this point on, every later request
//      gets `Authorization: Bearer <value>` overwritten before we send it.
//      That gives `/auth/me` and friends a real shot at returning 200.
//   4. We emit `probe-progress` per step (mirrors `loadtest-progress`) and
//      `probe-done` at the end with the full results + a ready-to-edit
//      `DraftPlan` (steps, extractions, initialVars, rationale).
//
// The deterministic planner that builds the chain lives in this file too
// (see `build_plan_from_probe`) — no LLM involved, so plan generation is
// near-instant and never produces hallucinated extractions.
// ---------------------------------------------------------------------------

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::http_client::{self, HttpRequest};

// ---------------------------------------------------------------------------
// Wire types (must match loadTestProbe.ts)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedReq {
    pub request_id: i64,
    pub name: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub is_mutating: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub index: usize,
    pub request_id: i64,
    pub name: String,
    pub method: String,
    pub url: String,
    /// HTTP status code; 0 if the request never completed (transport error).
    pub status_code: u16,
    pub time_ms: u64,
    /// Trimmed body for the UI preview (full body stays Rust-side for
    /// detection). Capped at PROBE_PREVIEW_BYTES.
    pub body_preview: String,
    pub headers: HashMap<String, String>,
    pub error: Option<String>,
    pub ok: bool,
    /// Names of variables we detected as coming out of this response.
    pub detected_vars: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredVar {
    pub variable_name: String,
    pub json_path: String,
    pub source_step_index: usize,
    pub source_request_name: String,
}

/// The shape of a step in the generated draft plan. Matches
/// `PlanStep` in loadTestStore.ts so we can drop the steps directly into
/// `draftPlan` on the JS side.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub source_request_id: i64,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_is_base64: bool,
    pub extractions: Vec<PlanExtraction>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanExtraction {
    pub json_path: String,
    pub variable_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbePlan {
    pub results: Vec<ProbeResult>,
    pub steps: Vec<PlanStep>,
    pub initial_vars: HashMap<String, String>,
    pub discovered_vars: Vec<DiscoveredVar>,
    pub rationale: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    index: usize,
    total: usize,
    result: ProbeResult,
}

const PROBE_PREVIEW_BYTES: usize = 4_096;
const PROBE_TIMEOUT_SECS: u64 = 30;
/// Keys whose VALUE we treat as the chain token when we find them in a JSON
/// response. Case-insensitive, matched after lowercasing + stripping
/// non-alphanumerics so `access_token` / `accessToken` / `access-token` all
/// hit the same canonical form.
const TOKEN_KEY_CANDIDATES: &[&str] = &[
    "accesstoken",
    "idtoken",
    "jwt",
    "token",
    "sessionid",
    "authtoken",
    "bearertoken",
];

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn probe_collection(
    app: AppHandle,
    requests: Vec<ResolvedReq>,
) -> Result<ProbePlan, String> {
    if requests.is_empty() {
        return Err("No requests to probe — pick at least one in the discovery step.".into());
    }

    let total = requests.len();
    let mut results: Vec<ProbeResult> = Vec::with_capacity(total);
    let mut discovered: Vec<DiscoveredVar> = Vec::new();
    // The chained token we'll inject into Authorization for later requests
    // once we discover one. We only chain the FIRST primary token (typically
    // an accessToken) — additional discoveries are still recorded in
    // `discovered` for the planner, but we don't keep rewriting Authorization
    // mid-probe.
    let mut chained_bearer: Option<String> = None;
    // Track which canonical var names we've already extracted into
    // discovered_vars so we don't add duplicates if multiple responses echo
    // the same token (e.g. login then /me both return `accessToken`).
    let mut seen_var_names: HashSet<String> = HashSet::new();
    // Full bodies kept alongside results; planner uses these to find the
    // jsonPath of each detected token. Not surfaced to the UI.
    let mut full_bodies: Vec<Option<serde_json::Value>> = Vec::with_capacity(total);

    for (idx, req) in requests.iter().enumerate() {
        // Inject the chained bearer for any later request, overriding any
        // hardcoded Authorization the saved request carried. This is the
        // whole reason the probe exists: stale saved tokens must not poison
        // the chain when login just handed us a fresh one.
        let mut headers = req.headers.clone();
        if let Some(ref bearer) = chained_bearer {
            headers.insert("Authorization".to_string(), format!("Bearer {bearer}"));
        }

        let http_req = HttpRequest {
            method: req.method.clone(),
            url: req.url.clone(),
            headers: if headers.is_empty() { None } else { Some(headers) },
            body: req.body.clone(),
        };

        let started = std::time::Instant::now();
        let send_result = http_client::execute_request(
            http_req,
            Some(PROBE_TIMEOUT_SECS),
            None,
            None,
            Some(true),
            Some(10),
        )
        .await;
        let elapsed_ms = started.elapsed().as_millis() as u64;

        let (probe_result, body_json) = match send_result {
            Ok(resp) => {
                let ok = (200..400).contains(&resp.status);
                // Try to parse the body as JSON for token detection + the
                // planner. Non-JSON / binary bodies just skip extraction.
                let body_json: Option<serde_json::Value> = if resp.is_binary {
                    None
                } else {
                    serde_json::from_str(&resp.body).ok()
                };

                let mut detected_here: Vec<String> = Vec::new();
                if ok {
                    if let Some(ref json) = body_json {
                        // Find every token-shaped leaf in this response.
                        for (path, key, value) in find_token_paths(json) {
                            let var_name = canonical_var_name(&key);
                            // First token discovered overall becomes the
                            // chained bearer for the rest of the probe.
                            if chained_bearer.is_none() {
                                chained_bearer = Some(value.clone());
                            }
                            if seen_var_names.insert(var_name.clone()) {
                                discovered.push(DiscoveredVar {
                                    variable_name: var_name.clone(),
                                    json_path: path,
                                    source_step_index: idx,
                                    source_request_name: req.name.clone(),
                                });
                                detected_here.push(var_name);
                            }
                        }
                    }
                }

                (
                    ProbeResult {
                        index: idx,
                        request_id: req.request_id,
                        name: req.name.clone(),
                        method: req.method.clone(),
                        url: req.url.clone(),
                        status_code: resp.status,
                        time_ms: elapsed_ms,
                        body_preview: truncate_preview(&resp.body),
                        headers: resp.headers,
                        error: None,
                        ok,
                        detected_vars: detected_here,
                    },
                    body_json,
                )
            }
            Err(e) => (
                ProbeResult {
                    index: idx,
                    request_id: req.request_id,
                    name: req.name.clone(),
                    method: req.method.clone(),
                    url: req.url.clone(),
                    status_code: 0,
                    time_ms: elapsed_ms,
                    body_preview: String::new(),
                    headers: HashMap::new(),
                    error: Some(e),
                    ok: false,
                    detected_vars: Vec::new(),
                },
                None,
            ),
        };

        let progress = ProgressEvent {
            index: idx,
            total,
            result: probe_result.clone(),
        };
        let _ = app.emit("probe-progress", progress);

        results.push(probe_result);
        full_bodies.push(body_json);
    }

    let plan = build_plan_from_probe(&requests, &results, &discovered, &chained_bearer);
    let _ = app.emit("probe-done", &plan);
    Ok(plan)
}

// ---------------------------------------------------------------------------
// Deterministic planner
// ---------------------------------------------------------------------------

/// Build the editable draft plan: turn each probed request into a `PlanStep`,
/// attach extractions for the tokens we found, and rewrite downstream
/// `Authorization` headers to `Bearer {{varName}}` so the chain actually
/// works on the real load run.
fn build_plan_from_probe(
    requests: &[ResolvedReq],
    results: &[ProbeResult],
    discovered: &[DiscoveredVar],
    chained_bearer: &Option<String>,
) -> ProbePlan {
    // Map source_step_index -> Vec<(varName, jsonPath)> for the producer step.
    let mut extractions_by_step: HashMap<usize, Vec<PlanExtraction>> = HashMap::new();
    for d in discovered {
        extractions_by_step
            .entry(d.source_step_index)
            .or_default()
            .push(PlanExtraction {
                json_path: d.json_path.clone(),
                variable_name: d.variable_name.clone(),
            });
    }

    // The primary chain variable: the FIRST discovered token. Downstream
    // Authorization headers will be rewritten to `Bearer {{primaryVar}}`.
    let primary_var: Option<String> = discovered.first().map(|d| d.variable_name.clone());
    let primary_source_idx = discovered.first().map(|d| d.source_step_index);

    let mut steps: Vec<PlanStep> = Vec::with_capacity(requests.len());
    let mut rewrite_count = 0usize;
    for (idx, req) in requests.iter().enumerate() {
        let mut headers = req.headers.clone();

        // Rewrite the saved hardcoded `Authorization: Bearer <stale>` into
        // `Bearer {{varName}}` for any step that comes AFTER the token's
        // source step. This is what makes the load test actually
        // authenticate instead of 401'ing on a stale token.
        if let (Some(ref var), Some(src_idx)) = (&primary_var, primary_source_idx) {
            if idx > src_idx {
                // Only rewrite if there's an existing Authorization header
                // (any case) — we don't want to suddenly inject auth into
                // endpoints that weren't authed in the first place.
                let auth_key = headers
                    .keys()
                    .find(|k| k.eq_ignore_ascii_case("authorization"))
                    .cloned();
                if let Some(k) = auth_key {
                    headers.insert(k, format!("Bearer {{{{{var}}}}}"));
                    rewrite_count += 1;
                }
            }
        }

        steps.push(PlanStep {
            id: format!("step-{}-{}", req.request_id, idx),
            source_request_id: req.request_id,
            name: req.name.clone(),
            method: req.method.clone(),
            url: req.url.clone(),
            headers,
            body: req.body.clone(),
            body_is_base64: false,
            extractions: extractions_by_step.remove(&idx).unwrap_or_default(),
        });
    }

    // Seed initialVars with the fresh token we captured during the probe so
    // the FIRST iteration of the real run has a valid value even before
    // step 1 re-extracts it. The worker will overwrite it on each iteration
    // with the freshly-extracted value.
    let mut initial_vars: HashMap<String, String> = HashMap::new();
    if let (Some(ref var), Some(ref bearer)) = (&primary_var, chained_bearer) {
        initial_vars.insert(var.clone(), bearer.clone());
    }

    let rationale = build_rationale(results, discovered, rewrite_count);

    ProbePlan {
        results: results.to_vec(),
        steps,
        initial_vars,
        discovered_vars: discovered.to_vec(),
        rationale,
    }
}

fn build_rationale(
    results: &[ProbeResult],
    discovered: &[DiscoveredVar],
    rewrites: usize,
) -> String {
    let ok_count = results.iter().filter(|r| r.ok).count();
    let err_count = results.len() - ok_count;

    let mut parts: Vec<String> = Vec::new();
    parts.push(format!(
        "Probed {} request{} ({} ok, {} failed).",
        results.len(),
        if results.len() == 1 { "" } else { "s" },
        ok_count,
        err_count
    ));

    if let Some(first) = discovered.first() {
        parts.push(format!(
            "Detected {} from \"{}\" (step {}); wired into {} downstream Authorization header{}.",
            first.variable_name,
            first.source_request_name,
            first.source_step_index + 1,
            rewrites,
            if rewrites == 1 { "" } else { "s" }
        ));
        if discovered.len() > 1 {
            let extras: Vec<String> = discovered
                .iter()
                .skip(1)
                .map(|d| format!("{} (step {})", d.variable_name, d.source_step_index + 1))
                .collect();
            parts.push(format!("Also detected: {}.", extras.join(", ")));
        }
    } else {
        parts.push("No auth/token fields detected in responses; chain runs without injected variables.".into());
    }

    parts.join(" ")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn truncate_preview(body: &str) -> String {
    if body.len() <= PROBE_PREVIEW_BYTES {
        return body.to_string();
    }
    // Truncate on a char boundary so we don't slice a multibyte sequence in half.
    let mut end = PROBE_PREVIEW_BYTES;
    while end > 0 && !body.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = body[..end].to_string();
    out.push_str("\n…[truncated]");
    out
}

/// Normalize a JSON key name so `access_token`, `accessToken`, `access-token`
/// all collapse to `accesstoken`. Used both to test against
/// `TOKEN_KEY_CANDIDATES` and to derive the variable name we expose.
fn canonical_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Variable name we expose for an extracted token. We keep the original
/// casing where possible (so users see `accessToken` not `accesstoken`) but
/// strip separators.
fn canonical_var_name(key: &str) -> String {
    // Drop separators (_, -) but keep camelCase.
    let cleaned: String = key.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if cleaned.is_empty() {
        return "token".to_string();
    }
    cleaned
}

fn is_token_key(key: &str) -> bool {
    let canon = canonical_key(key);
    TOKEN_KEY_CANDIDATES.iter().any(|c| *c == canon.as_str())
}

/// Recursively walk a JSON value collecting `(jsonPath, key, value)` triples
/// for every string-valued leaf whose key looks like a token. We only follow
/// string leaves — arrays/objects under a token-like key are skipped because
/// downstream consumers (Authorization headers) expect a flat string.
fn find_token_paths(value: &serde_json::Value) -> Vec<(String, String, String)> {
    let mut out: Vec<(String, String, String)> = Vec::new();
    walk(value, &mut String::new(), &mut out);
    out
}

fn walk(value: &serde_json::Value, path: &mut String, out: &mut Vec<(String, String, String)>) {
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                let saved_len = path.len();
                if !path.is_empty() {
                    path.push('.');
                }
                path.push_str(k);

                if is_token_key(k) {
                    if let serde_json::Value::String(s) = v {
                        if !s.is_empty() {
                            out.push((path.clone(), k.clone(), s.clone()));
                        }
                    }
                }
                walk(v, path, out);
                path.truncate(saved_len);
            }
        }
        serde_json::Value::Array(arr) => {
            for (i, item) in arr.iter().enumerate() {
                let saved_len = path.len();
                path.push_str(&format!("[{i}]"));
                walk(item, path, out);
                path.truncate(saved_len);
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_key_strips_separators_and_lowercases() {
        assert_eq!(canonical_key("access_token"), "accesstoken");
        assert_eq!(canonical_key("accessToken"), "accesstoken");
        assert_eq!(canonical_key("Access-Token"), "accesstoken");
    }

    #[test]
    fn token_keys_detected() {
        assert!(is_token_key("accessToken"));
        assert!(is_token_key("access_token"));
        assert!(is_token_key("jwt"));
        assert!(is_token_key("sessionId"));
        assert!(!is_token_key("username"));
        assert!(!is_token_key("user_id"));
    }

    #[test]
    fn finds_top_level_token() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"accessToken":"abc","username":"emily"}"#).unwrap();
        let hits = find_token_paths(&v);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, "accessToken");
        assert_eq!(hits[0].2, "abc");
    }

    #[test]
    fn finds_nested_token() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"data":{"jwt":"xyz"}}"#).unwrap();
        let hits = find_token_paths(&v);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, "data.jwt");
        assert_eq!(hits[0].2, "xyz");
    }

    #[test]
    fn ignores_non_string_token_values() {
        let v: serde_json::Value = serde_json::from_str(r#"{"token":12345}"#).unwrap();
        assert!(find_token_paths(&v).is_empty());
    }

    #[test]
    fn build_plan_rewrites_downstream_authorization() {
        let mut headers_with_stale = HashMap::new();
        headers_with_stale.insert("Authorization".into(), "Bearer STALE".into());
        let requests = vec![
            ResolvedReq {
                request_id: 1,
                name: "login".into(),
                method: "POST".into(),
                url: "https://api/auth/login".into(),
                headers: HashMap::new(),
                body: Some("{}".into()),
                is_mutating: true,
            },
            ResolvedReq {
                request_id: 2,
                name: "me".into(),
                method: "GET".into(),
                url: "https://api/auth/me".into(),
                headers: headers_with_stale,
                body: None,
                is_mutating: false,
            },
        ];

        let results = vec![
            ProbeResult {
                index: 0,
                request_id: 1,
                name: "login".into(),
                method: "POST".into(),
                url: "https://api/auth/login".into(),
                status_code: 200,
                time_ms: 50,
                body_preview: String::new(),
                headers: HashMap::new(),
                error: None,
                ok: true,
                detected_vars: vec!["accessToken".into()],
            },
            ProbeResult {
                index: 1,
                request_id: 2,
                name: "me".into(),
                method: "GET".into(),
                url: "https://api/auth/me".into(),
                status_code: 200,
                time_ms: 30,
                body_preview: String::new(),
                headers: HashMap::new(),
                error: None,
                ok: true,
                detected_vars: vec![],
            },
        ];

        let discovered = vec![DiscoveredVar {
            variable_name: "accessToken".into(),
            json_path: "accessToken".into(),
            source_step_index: 0,
            source_request_name: "login".into(),
        }];

        let chained = Some("FRESH".to_string());
        let plan = build_plan_from_probe(&requests, &results, &discovered, &chained);

        assert_eq!(plan.steps.len(), 2);
        // Step 1 (login) gets the extraction.
        assert_eq!(plan.steps[0].extractions.len(), 1);
        assert_eq!(plan.steps[0].extractions[0].variable_name, "accessToken");
        // Step 2 (/me) has its Authorization rewritten to use {{accessToken}}.
        assert_eq!(
            plan.steps[1].headers.get("Authorization"),
            Some(&"Bearer {{accessToken}}".to_string())
        );
        // initialVars seeded with the fresh token for run iteration 0.
        assert_eq!(plan.initial_vars.get("accessToken"), Some(&"FRESH".into()));
    }

    #[test]
    fn build_plan_skips_rewrite_when_no_existing_authorization() {
        let requests = vec![
            ResolvedReq {
                request_id: 1,
                name: "login".into(),
                method: "POST".into(),
                url: "u".into(),
                headers: HashMap::new(),
                body: None,
                is_mutating: true,
            },
            ResolvedReq {
                request_id: 2,
                name: "public".into(),
                method: "GET".into(),
                url: "u".into(),
                headers: HashMap::new(),
                body: None,
                is_mutating: false,
            },
        ];
        let results: Vec<ProbeResult> = requests
            .iter()
            .enumerate()
            .map(|(i, r)| ProbeResult {
                index: i,
                request_id: r.request_id,
                name: r.name.clone(),
                method: r.method.clone(),
                url: r.url.clone(),
                status_code: 200,
                time_ms: 1,
                body_preview: String::new(),
                headers: HashMap::new(),
                error: None,
                ok: true,
                detected_vars: vec![],
            })
            .collect();
        let discovered = vec![DiscoveredVar {
            variable_name: "accessToken".into(),
            json_path: "accessToken".into(),
            source_step_index: 0,
            source_request_name: "login".into(),
        }];
        let plan = build_plan_from_probe(&requests, &results, &discovered, &None);
        // Public step had no Authorization header; we must NOT inject one.
        assert!(plan.steps[1].headers.get("Authorization").is_none());
    }
}
