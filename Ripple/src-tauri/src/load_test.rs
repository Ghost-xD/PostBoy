// ---------------------------------------------------------------------------
// Load-test engine.
//
// Spawns a pool of `concurrency` tokio worker tasks that drive HTTP requests
// against a JS-supplied plan. A single aggregator task receives raw samples
// from the workers over an unbounded mpsc channel, maintains per-step
// histograms + global counters, and emits two Tauri events:
//
//   - `loadtest-progress`  emitted every PROGRESS_INTERVAL_MS while running
//   - `loadtest-done`      emitted once when the run finishes / is cancelled
//
// Two run modes are supported:
//
//   - "chain"        — each worker loops through the steps in order. Per
//                       iteration the worker has its own vars map seeded
//                       from initialVars + the iteration's data row.
//                       Extractions update that local map so later steps
//                       can substitute the value. On HTTP error the
//                       remainder of the iteration is skipped and the
//                       worker starts the next iteration.
//   - "per_endpoint" — each worker round-robins across the steps using a
//                       global atomic counter. Each request is independent;
//                       only initialVars + data row substitutions apply.
//
// Variable interpolation matches the rest of Ripple: `{{name}}` in URLs,
// header keys/values, and bodies. JSON path extraction supports dotted +
// `[index]` notation (mirrors variableStore.getValueAtPath in the frontend).
// ---------------------------------------------------------------------------

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::sleep;

const PROGRESS_INTERVAL_MS: u64 = 500;
const ROLLING_WINDOW_SECS: u64 = 5;

// ---------------------------------------------------------------------------
// Wire types (must match the JS contract in loadTestStore.ts / Compiler)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanExtraction {
    pub json_path: String,
    pub variable_name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub body_is_base64: bool,
    #[serde(default)]
    pub extractions: Vec<PlanExtraction>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTestPlan {
    pub mode: String,
    pub concurrency: u32,
    pub duration_secs: Option<u64>,
    pub total_requests: Option<u64>,
    #[serde(default)]
    pub ramp_up_secs: u64,
    #[serde(default)]
    pub target_rps: u64,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    pub steps: Vec<PlanStep>,
    #[serde(default)]
    pub initial_vars: HashMap<String, String>,
    #[serde(default)]
    pub data_rows: Vec<HashMap<String, String>>,
}

fn default_timeout() -> u64 {
    30
}

// ---------------------------------------------------------------------------
// Event payloads emitted to the frontend
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Default)]
struct StepAggregate {
    step_id: String,
    name: String,
    method: String,
    url: String,
    count: u64,
    errors: u64,
    error_rate: f64,
    bytes: u64,
    min_ms: f64,
    max_ms: f64,
    avg_ms: f64,
    p50_ms: f64,
    p90_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    status_codes: HashMap<u16, u64>,
}

#[derive(Clone, Debug, Serialize)]
struct ProgressEvent {
    elapsed_ms: u64,
    duration_ms: Option<u64>,
    active_workers: u32,
    requests_total: u64,
    requests_ok: u64,
    requests_err: u64,
    rps_rolling: f64,
    p95_rolling_ms: f64,
    per_step: Vec<StepAggregate>,
    throughput_series: Vec<u64>,
}

#[derive(Clone, Debug, Serialize)]
struct DoneEvent {
    elapsed_ms: u64,
    total_count: u64,
    total_ok: u64,
    total_err: u64,
    bytes_total: u64,
    rps_overall: f64,
    per_step: Vec<StepAggregate>,
    bottlenecks: Vec<String>,
    throughput_series: Vec<u64>,
    cancelled: bool,
}

// Internal sample type passed worker -> aggregator
#[derive(Debug)]
struct Sample {
    step_id: String,
    status: u16,
    latency_ms: u64,
    bytes: u64,
    ok: bool,
    /// Seconds elapsed from run start when the request finished. Used for
    /// the throughput sparkline and the rolling RPS / p95 window.
    t_bucket: u64,
}

// ---------------------------------------------------------------------------
// Engine state — a single load test runs at a time
// ---------------------------------------------------------------------------

struct EngineState {
    cancel: Arc<AtomicBool>,
    running: AtomicBool,
}

impl EngineState {
    fn new() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            running: AtomicBool::new(false),
        }
    }
}

fn state() -> &'static EngineState {
    static S: OnceLock<EngineState> = OnceLock::new();
    S.get_or_init(EngineState::new)
}

// ---------------------------------------------------------------------------
// Public Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn load_test_start(app: AppHandle, plan: LoadTestPlan) -> Result<(), String> {
    if plan.steps.is_empty() {
        return Err("Plan contains no steps".into());
    }
    if plan.concurrency == 0 {
        return Err("Concurrency must be >= 1".into());
    }
    if plan.duration_secs.is_none() && plan.total_requests.is_none() {
        return Err("Plan must specify either durationSecs or totalRequests".into());
    }
    if plan.mode != "chain" && plan.mode != "per_endpoint" {
        return Err(format!("Unknown mode: {}", plan.mode));
    }

    let s = state();
    if s.running.swap(true, Ordering::SeqCst) {
        return Err("A load test is already running".into());
    }
    s.cancel.store(false, Ordering::SeqCst);

    let cancel = s.cancel.clone();
    let app_for_task = app.clone();
    tokio::spawn(async move {
        let result = run_load_test(app_for_task.clone(), plan, cancel).await;
        state().running.store(false, Ordering::SeqCst);
        if let Err(e) = result {
            let _ = app_for_task.emit("loadtest-error", e);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn load_test_cancel() -> Result<(), String> {
    state().cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn load_test_running() -> bool {
    state().running.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async fn run_load_test(
    app: AppHandle,
    plan: LoadTestPlan,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    // Single HTTP client shared by all workers so connections are pooled.
    // Matches the loose defaults of http_client.rs (accept invalid certs by
    // default — load testing usually targets dev/staging envs).
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(plan.timeout_secs))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let start = Instant::now();
    let plan_arc = Arc::new(plan);

    // Workers send raw samples through this channel. Bounded would risk
    // backpressure stalling the workers under high load; unbounded is fine
    // because the aggregator drains it greedily on every tick.
    let (tx, rx) = mpsc::unbounded_channel::<Sample>();

    let active_workers = Arc::new(AtomicU64::new(0));
    let global_request_counter = Arc::new(AtomicU64::new(0));
    let endpoint_cursor = Arc::new(AtomicU64::new(0));
    let rps_limiter = if plan_arc.target_rps > 0 {
        Some(Arc::new(RpsLimiter::new(plan_arc.target_rps)))
    } else {
        None
    };

    let aggregator = tokio::spawn(aggregator_loop(
        app.clone(),
        plan_arc.clone(),
        rx,
        cancel.clone(),
        start,
        active_workers.clone(),
    ));

    // Spawn workers with optional ramp-up. We DON'T await them serially;
    // we kick them all off and let the duration / total cap stop them.
    let mut worker_handles = Vec::with_capacity(plan_arc.concurrency as usize);
    for i in 0..plan_arc.concurrency {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        if plan_arc.ramp_up_secs > 0 && plan_arc.concurrency > 1 {
            let delay_ms =
                (plan_arc.ramp_up_secs * 1000) / plan_arc.concurrency as u64 * i as u64;
            if delay_ms > 0 {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }
        let h = tokio::spawn(worker_loop(
            i,
            client.clone(),
            plan_arc.clone(),
            tx.clone(),
            cancel.clone(),
            start,
            active_workers.clone(),
            global_request_counter.clone(),
            endpoint_cursor.clone(),
            rps_limiter.clone(),
        ));
        worker_handles.push(h);
    }

    // Drop the original sender so the channel closes once all worker clones
    // are dropped — that's how the aggregator knows everyone's done.
    drop(tx);

    for h in worker_handles {
        let _ = h.await;
    }
    let _ = aggregator.await;

    Ok(())
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn worker_loop(
    worker_idx: u32,
    client: reqwest::Client,
    plan: Arc<LoadTestPlan>,
    tx: mpsc::UnboundedSender<Sample>,
    cancel: Arc<AtomicBool>,
    run_start: Instant,
    active_workers: Arc<AtomicU64>,
    global_count: Arc<AtomicU64>,
    endpoint_cursor: Arc<AtomicU64>,
    rps_limiter: Option<Arc<RpsLimiter>>,
) {
    active_workers.fetch_add(1, Ordering::SeqCst);
    let row_count = plan.data_rows.len();
    let mut iteration: u64 = 0;

    'outer: loop {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        if let Some(dur) = plan.duration_secs {
            if run_start.elapsed().as_secs() >= dur {
                break;
            }
        }
        if let Some(cap) = plan.total_requests {
            if global_count.load(Ordering::SeqCst) >= cap {
                break;
            }
        }

        // Pick a data row deterministically per (worker, iteration). This
        // gives roughly even distribution across rows even with low VU
        // counts and a tiny dataset.
        let row_idx = if row_count > 0 {
            ((worker_idx as u64).wrapping_mul(31).wrapping_add(iteration)) as usize % row_count
        } else {
            0
        };

        // Per-iteration vars map (initialVars + data row). Mutated by
        // extractions in chain mode; rebuilt each iteration.
        let mut vars: HashMap<String, String> = plan.initial_vars.clone();
        if row_count > 0 {
            for (k, v) in &plan.data_rows[row_idx] {
                vars.insert(k.clone(), v.clone());
            }
        }

        if plan.mode == "chain" {
            for step in &plan.steps {
                if cancel.load(Ordering::SeqCst) {
                    break 'outer;
                }
                if let Some(cap) = plan.total_requests {
                    if global_count.load(Ordering::SeqCst) >= cap {
                        break 'outer;
                    }
                }
                if let Some(ref lim) = rps_limiter {
                    lim.acquire().await;
                }
                let ok = run_one_step(
                    &client,
                    step,
                    &mut vars,
                    &tx,
                    run_start,
                    &global_count,
                )
                .await;
                if !ok {
                    // Step failed at the network layer or returned a server
                    // error — skip the remainder of this iteration in chain
                    // mode (matches existing chainRunner semantics).
                    break;
                }
            }
        } else {
            // per_endpoint mode: pick the next step round-robin
            let idx = endpoint_cursor.fetch_add(1, Ordering::Relaxed) as usize % plan.steps.len();
            let step = &plan.steps[idx];
            if let Some(ref lim) = rps_limiter {
                lim.acquire().await;
            }
            let _ = run_one_step(&client, step, &mut vars, &tx, run_start, &global_count).await;
        }

        iteration += 1;
    }

    active_workers.fetch_sub(1, Ordering::SeqCst);
}

/// Returns true when the request completed with status < 500 AND no
/// transport error. The "chain mode skip" only triggers on the false case.
async fn run_one_step(
    client: &reqwest::Client,
    step: &PlanStep,
    vars: &mut HashMap<String, String>,
    tx: &mpsc::UnboundedSender<Sample>,
    run_start: Instant,
    global_count: &AtomicU64,
) -> bool {
    let url = interpolate(&step.url, vars);
    let method = match step.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &url);
    for (k, v) in &step.headers {
        let key = interpolate(k, vars);
        let val = interpolate(v, vars);
        if !key.is_empty() {
            req = req.header(key, val);
        }
    }
    if let Some(body) = &step.body {
        if step.body_is_base64 {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(body) {
                req = req.body(bytes);
            } else {
                req = req.body(body.clone());
            }
        } else {
            req = req.body(interpolate(body, vars));
        }
    }

    let started = Instant::now();
    let response = req.send().await;
    let latency_ms = started.elapsed().as_millis() as u64;
    let t_bucket = run_start.elapsed().as_secs();

    let (status, ok_status, body_bytes, body_text) = match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ok = resp.status().is_success() || resp.status().is_redirection();
            let bytes = resp.bytes().await.unwrap_or_default();
            let text = std::str::from_utf8(&bytes).ok().map(|s| s.to_string());
            (status, ok, bytes.len() as u64, text)
        }
        Err(_) => (0, false, 0, None),
    };

    global_count.fetch_add(1, Ordering::Relaxed);
    let _ = tx.send(Sample {
        step_id: step.id.clone(),
        status,
        latency_ms,
        bytes: body_bytes,
        ok: ok_status,
        t_bucket,
    });

    // Apply extractions only when the request succeeded and the body is JSON.
    if ok_status && !step.extractions.is_empty() {
        if let Some(text) = body_text {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                for ex in &step.extractions {
                    if let Some(val) = json_path_get(&json, &ex.json_path) {
                        vars.insert(ex.variable_name.clone(), val);
                    }
                }
            }
        }
    }

    ok_status
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

struct AggregatorState {
    steps_meta: Vec<(String, String, String, String)>, // (id, name, method, url)
    /// Per step: latencies, error count, byte total, status code histogram.
    /// We keep ALL latencies so we can compute exact percentiles. For
    /// extreme runs this could be reservoir-sampled; for now the simplicity
    /// wins.
    per_step: HashMap<String, StepAccumulator>,
    total_count: u64,
    total_ok: u64,
    total_err: u64,
    bytes_total: u64,
    /// Throughput sparkline: index i = requests completed in second i since
    /// run start. Grows on demand.
    throughput: Vec<u64>,
    /// Recent latencies for the rolling window stats (kept small).
    rolling_latencies: std::collections::VecDeque<(u64, u64)>, // (t_bucket, latency_ms)
    rolling_count: std::collections::VecDeque<(u64, u64)>, // (t_bucket, completed_in_bucket)
}

struct StepAccumulator {
    latencies: Vec<u64>,
    errors: u64,
    bytes: u64,
    status_codes: HashMap<u16, u64>,
}

impl AggregatorState {
    fn new(plan: &LoadTestPlan) -> Self {
        let meta = plan
            .steps
            .iter()
            .map(|s| (s.id.clone(), s.name.clone(), s.method.clone(), s.url.clone()))
            .collect();
        let mut per_step = HashMap::new();
        for s in &plan.steps {
            per_step.insert(
                s.id.clone(),
                StepAccumulator {
                    latencies: Vec::new(),
                    errors: 0,
                    bytes: 0,
                    status_codes: HashMap::new(),
                },
            );
        }
        Self {
            steps_meta: meta,
            per_step,
            total_count: 0,
            total_ok: 0,
            total_err: 0,
            bytes_total: 0,
            throughput: Vec::new(),
            rolling_latencies: std::collections::VecDeque::new(),
            rolling_count: std::collections::VecDeque::new(),
        }
    }

    fn record(&mut self, sample: Sample) {
        self.total_count += 1;
        self.bytes_total += sample.bytes;
        if sample.ok {
            self.total_ok += 1;
        } else {
            self.total_err += 1;
        }
        while self.throughput.len() <= sample.t_bucket as usize {
            self.throughput.push(0);
        }
        self.throughput[sample.t_bucket as usize] += 1;

        if let Some(acc) = self.per_step.get_mut(&sample.step_id) {
            acc.latencies.push(sample.latency_ms);
            if !sample.ok {
                acc.errors += 1;
            }
            acc.bytes += sample.bytes;
            *acc.status_codes.entry(sample.status).or_insert(0) += 1;
        }

        self.rolling_latencies
            .push_back((sample.t_bucket, sample.latency_ms));
        self.rolling_count.push_back((sample.t_bucket, 1));
    }

    fn evict_rolling(&mut self, now_sec: u64) {
        let cutoff = now_sec.saturating_sub(ROLLING_WINDOW_SECS);
        while let Some(&(t, _)) = self.rolling_latencies.front() {
            if t < cutoff {
                self.rolling_latencies.pop_front();
            } else {
                break;
            }
        }
        while let Some(&(t, _)) = self.rolling_count.front() {
            if t < cutoff {
                self.rolling_count.pop_front();
            } else {
                break;
            }
        }
    }

    fn snapshot_steps(&self) -> Vec<StepAggregate> {
        self.steps_meta
            .iter()
            .map(|(id, name, method, url)| {
                let acc = self.per_step.get(id).expect("step accumulator missing");
                let mut agg = StepAggregate {
                    step_id: id.clone(),
                    name: name.clone(),
                    method: method.clone(),
                    url: url.clone(),
                    count: acc.latencies.len() as u64,
                    errors: acc.errors,
                    error_rate: 0.0,
                    bytes: acc.bytes,
                    min_ms: 0.0,
                    max_ms: 0.0,
                    avg_ms: 0.0,
                    p50_ms: 0.0,
                    p90_ms: 0.0,
                    p95_ms: 0.0,
                    p99_ms: 0.0,
                    status_codes: acc.status_codes.clone(),
                };
                if !acc.latencies.is_empty() {
                    let mut lat = acc.latencies.clone();
                    lat.sort_unstable();
                    let sum: u64 = lat.iter().sum();
                    agg.min_ms = *lat.first().unwrap() as f64;
                    agg.max_ms = *lat.last().unwrap() as f64;
                    agg.avg_ms = sum as f64 / lat.len() as f64;
                    agg.p50_ms = percentile(&lat, 50.0);
                    agg.p90_ms = percentile(&lat, 90.0);
                    agg.p95_ms = percentile(&lat, 95.0);
                    agg.p99_ms = percentile(&lat, 99.0);
                    agg.error_rate = acc.errors as f64 / lat.len() as f64;
                }
                agg
            })
            .collect()
    }

    fn rolling_p95(&self) -> f64 {
        if self.rolling_latencies.is_empty() {
            return 0.0;
        }
        let mut v: Vec<u64> = self.rolling_latencies.iter().map(|(_, l)| *l).collect();
        v.sort_unstable();
        percentile(&v, 95.0)
    }

    fn rolling_rps(&self) -> f64 {
        if self.rolling_count.is_empty() {
            return 0.0;
        }
        let total: u64 = self.rolling_count.iter().map(|(_, c)| *c).sum();
        total as f64 / ROLLING_WINDOW_SECS.max(1) as f64
    }
}

fn percentile(sorted: &[u64], pct: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = (pct / 100.0) * (sorted.len() as f64 - 1.0);
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    if lo == hi {
        sorted[lo] as f64
    } else {
        let weight = rank - lo as f64;
        sorted[lo] as f64 * (1.0 - weight) + sorted[hi] as f64 * weight
    }
}

async fn aggregator_loop(
    app: AppHandle,
    plan: Arc<LoadTestPlan>,
    mut rx: mpsc::UnboundedReceiver<Sample>,
    cancel: Arc<AtomicBool>,
    run_start: Instant,
    active_workers: Arc<AtomicU64>,
) {
    let mut agg = AggregatorState::new(&plan);
    let mut last_emit = Instant::now();

    loop {
        let recv_result = tokio::time::timeout(Duration::from_millis(50), rx.recv()).await;
        match recv_result {
            Ok(Some(sample)) => {
                agg.record(sample);
                // Drain any other immediately-available samples to keep
                // the channel from accumulating between ticks.
                while let Ok(s) = rx.try_recv() {
                    agg.record(s);
                }
            }
            Ok(None) => break, // all workers done
            Err(_) => {
                // timeout — no sample within 50ms, fall through to maybe emit
            }
        }

        let elapsed_ms = run_start.elapsed().as_millis() as u64;
        agg.evict_rolling(run_start.elapsed().as_secs());
        if last_emit.elapsed() >= Duration::from_millis(PROGRESS_INTERVAL_MS) {
            let event = ProgressEvent {
                elapsed_ms,
                duration_ms: plan.duration_secs.map(|d| d * 1000),
                active_workers: active_workers.load(Ordering::SeqCst) as u32,
                requests_total: agg.total_count,
                requests_ok: agg.total_ok,
                requests_err: agg.total_err,
                rps_rolling: agg.rolling_rps(),
                p95_rolling_ms: agg.rolling_p95(),
                per_step: agg.snapshot_steps(),
                throughput_series: agg.throughput.clone(),
            };
            let _ = app.emit("loadtest-progress", &event);
            last_emit = Instant::now();
        }
    }

    // Done — emit final aggregate.
    let elapsed_ms = run_start.elapsed().as_millis() as u64;
    let elapsed_secs = (elapsed_ms as f64 / 1000.0).max(0.001);
    let per_step = agg.snapshot_steps();
    let mut by_p95: Vec<&StepAggregate> = per_step.iter().collect();
    by_p95.sort_by(|a, b| {
        let pa = (a.p95_ms, a.error_rate);
        let pb = (b.p95_ms, b.error_rate);
        pb.partial_cmp(&pa).unwrap_or(std::cmp::Ordering::Equal)
    });
    let bottlenecks: Vec<String> = by_p95.iter().map(|s| s.step_id.clone()).collect();

    let done = DoneEvent {
        elapsed_ms,
        total_count: agg.total_count,
        total_ok: agg.total_ok,
        total_err: agg.total_err,
        bytes_total: agg.bytes_total,
        rps_overall: agg.total_count as f64 / elapsed_secs,
        per_step,
        bottlenecks,
        throughput_series: agg.throughput,
        cancelled: cancel.load(Ordering::SeqCst),
    };
    let _ = app.emit("loadtest-done", &done);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Substitute `{{varName}}` occurrences in `text` using `vars`. Missing vars
/// are left intact (so the user can spot them in the response/URL).
fn interpolate(text: &str, vars: &HashMap<String, String>) -> String {
    if text.is_empty() || !text.contains("{{") {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let bytes = text.as_bytes();
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(end_rel) = text[i + 2..].find("}}") {
                let end = i + 2 + end_rel;
                let name = text[i + 2..end].trim();
                if let Some(val) = vars.get(name) {
                    out.push_str(val);
                } else {
                    out.push_str(&text[i..end + 2]);
                }
                i = end + 2;
                continue;
            }
        }
        let ch_end = next_char_boundary(text, i);
        out.push_str(&text[i..ch_end]);
        i = ch_end;
    }
    out
}

fn next_char_boundary(s: &str, i: usize) -> usize {
    let mut j = i + 1;
    while j < s.len() && !s.is_char_boundary(j) {
        j += 1;
    }
    j
}

/// Resolve a dotted/array json-path against a JSON value (mirrors
/// variableStore.getValueAtPath on the frontend). Returns the value as a
/// string (objects/arrays are JSON-stringified).
fn json_path_get(value: &serde_json::Value, path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    // Normalize `foo[0].bar` -> `foo.0.bar` then split on '.'
    let normalized = path.replace('[', ".").replace(']', "");
    let mut current = value;
    for part in normalized.split('.').filter(|p| !p.is_empty()) {
        current = match current {
            serde_json::Value::Object(map) => map.get(part)?,
            serde_json::Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                arr.get(idx)?
            }
            _ => return None,
        };
    }
    Some(match current {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => "null".to_string(),
        other => other.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolate_replaces_known_vars() {
        let mut vars = HashMap::new();
        vars.insert("name".into(), "Alice".into());
        assert_eq!(interpolate("Hi {{name}}!", &vars), "Hi Alice!");
    }

    #[test]
    fn interpolate_leaves_missing_vars_intact() {
        let vars = HashMap::new();
        assert_eq!(interpolate("Hi {{missing}}!", &vars), "Hi {{missing}}!");
    }

    #[test]
    fn json_path_handles_arrays_and_objects() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"data":{"items":[{"id":42}]}}"#).unwrap();
        assert_eq!(json_path_get(&v, "data.items[0].id"), Some("42".into()));
    }

    #[test]
    fn percentile_basic() {
        let v = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        assert!((percentile(&v, 50.0) - 5.5).abs() < 0.001);
        assert!((percentile(&v, 90.0) - 9.1).abs() < 0.001);
    }
}

// ---------------------------------------------------------------------------
// Simple token-bucket-ish RPS limiter
// ---------------------------------------------------------------------------

struct RpsLimiter {
    rate: u64,
    inner: Mutex<RpsInner>,
}

struct RpsInner {
    /// Tokens available now (saturating up to `rate`).
    tokens: f64,
    last_refill: Instant,
}

impl RpsLimiter {
    fn new(rate: u64) -> Self {
        Self {
            rate,
            inner: Mutex::new(RpsInner {
                tokens: rate as f64,
                last_refill: Instant::now(),
            }),
        }
    }

    async fn acquire(&self) {
        loop {
            let wait_ms = {
                let mut inner = self.inner.lock().unwrap();
                let now = Instant::now();
                let elapsed = now.duration_since(inner.last_refill).as_secs_f64();
                inner.tokens = (inner.tokens + elapsed * self.rate as f64).min(self.rate as f64);
                inner.last_refill = now;
                if inner.tokens >= 1.0 {
                    inner.tokens -= 1.0;
                    return;
                }
                // Sleep just long enough to produce one token.
                ((1.0 - inner.tokens) / self.rate as f64 * 1000.0).ceil() as u64
            };
            sleep(Duration::from_millis(wait_ms.max(1))).await;
        }
    }
}
