//! Embedded llama.cpp inference engine.
//!
//! Wraps `llama-cpp-2`. The llama backend is a process-wide singleton
//! (leaked into a `'static` reference because the backend handle is meant to
//! live for the entire program). The model is reference-counted (`Arc`) so we
//! can move it into `tokio::task::spawn_blocking` closures for synchronous
//! inference without lifetime gymnastics.
//!
//! Each chat creates a fresh `LlamaContext` from the model. This means we
//! recompute the prompt KV-cache every turn, but the alternative is a much
//! more complex actor-thread design. For short prompts on small models this
//! is fine; the model file load (which is the slow part) only happens once
//! via [`Engine::load`].

use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

static BACKEND: OnceLock<&'static LlamaBackend> = OnceLock::new();

/// GBNF grammar that constrains what the model can emit BETWEEN
/// `<tool_call>` and `</tool_call>`. It accepts any well-formed
/// `{"name": <one of our tools>, "arguments": <any valid JSON object>}`
/// followed by the closing tag. Applied lazily via `grammar_lazy` — text
/// emitted BEFORE the `<tool_call>` trigger is completely unconstrained,
/// so the model is still free to write prose for normal chat replies.
///
/// What this fixes:
/// - Malformed JSON inside `<tool_call>` (extra trailing commas, missing
///   quotes, etc.) — the grammar mask makes those tokens unreachable.
/// - Hallucinated tool names — only the eight enumerated names are valid.
/// - Truncation right after the JSON — the model has to emit
///   `</tool_call>` before EOS is allowed.
///
/// What this does NOT fix:
/// - The model deciding to refuse instead of calling a tool. Grammar
///   sampling only kicks in once the trigger has been emitted; we still
///   need a capable model (and the existing intercepts) for the
///   tool-vs-refusal decision.
const TOOL_CALL_GRAMMAR: &str = r#"
root         ::= ws "{" ws "\"name\"" ws ":" ws tool-name ws "," ws "\"arguments\"" ws ":" ws json-object ws "}" ws "</tool_call>"

tool-name    ::= "\"list_collections\""
              | "\"list_requests\""
              | "\"inspect_request\""
              | "\"get_request\""
              | "\"run_request\""
              | "\"get_variables\""
              | "\"set_variable\""
              | "\"get_history\""
              | "\"get_last_response\""

json-value   ::= json-string | json-number | json-boolean | "null" | json-object | json-array

json-object  ::= "{" ws "}"
              | "{" ws json-pair (ws "," ws json-pair)* ws "}"

json-pair    ::= json-string ws ":" ws json-value

json-array   ::= "[" ws "]"
              | "[" ws json-value (ws "," ws json-value)* ws "]"

json-string  ::= "\"" json-char* "\""

json-char    ::= [^"\\] | "\\" json-esc

json-esc     ::= ["\\/bfnrt] | "u" hex hex hex hex

hex          ::= [0-9a-fA-F]

json-boolean ::= "true" | "false"

json-number  ::= "-"? json-int json-frac? json-exp?
json-int     ::= "0" | [1-9] [0-9]*
json-frac    ::= "." [0-9]+
json-exp     ::= [eE] ("-" | "+")? [0-9]+

ws           ::= [ \t\n\r]*
"#;

fn backend() -> Result<&'static LlamaBackend, String> {
    if let Some(b) = BACKEND.get() {
        return Ok(b);
    }
    let b = LlamaBackend::init().map_err(|e| format!("llama backend init failed: {e}"))?;
    let leaked: &'static LlamaBackend = Box::leak(Box::new(b));
    let _ = BACKEND.set(leaked);
    Ok(BACKEND.get().copied().expect("backend just set"))
}

/// Cheap to clone — the underlying `LlamaModel` is shared via `Arc`. Cloning
/// gives a handle that can be moved into `tokio::task::spawn_blocking`
/// without holding a `MutexGuard` across `.await`.
#[derive(Clone)]
pub struct Engine {
    model: Arc<LlamaModel>,
    pub threads: u32,
    pub ctx_size: u32,
    pub model_id: String,
    pub tool_call_style: String,
}

impl Engine {
    pub fn load(
        path: PathBuf,
        threads: u32,
        ctx_size: u32,
        model_id: String,
        tool_call_style: String,
    ) -> Result<Self, String> {
        let backend = backend()?;
        // Offload as many layers as possible to GPU. llama.cpp clamps this to
        // the actual layer count and falls back to CPU automatically when no
        // GPU device is present (or when the build was compiled without a GPU
        // backend). Setting it high is the documented "use GPU if available".
        let params = LlamaModelParams::default().with_n_gpu_layers(999);
        let params = std::pin::pin!(params);
        let model = LlamaModel::load_from_file(backend, &path, &params)
            .map_err(|e| format!("Failed to load model from {}: {e}", path.display()))?;
        Ok(Self {
            model: Arc::new(model),
            threads,
            ctx_size,
            model_id,
            tool_call_style,
        })
    }

    /// Generate a completion from `prompt`, calling `on_delta` for each
    /// detokenized chunk. Returning `false` from `on_delta` cancels generation.
    /// `cancel` provides an external cancel signal (e.g. from a UI button).
    pub fn complete<F>(
        &self,
        prompt: &str,
        max_tokens: u32,
        cancel: Arc<AtomicBool>,
        mut on_delta: F,
    ) -> Result<String, String>
    where
        F: FnMut(&str) -> bool,
    {
        let backend = backend()?;

        let n_ctx = NonZeroU32::new(self.ctx_size.max(512))
            .ok_or_else(|| "ctx_size must be > 0".to_string())?;
        let mut ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(n_ctx))
            // Make the logical batch as wide as the context window. The decoder
            // splits internally into `n_ubatch` chunks, but `cparams.n_batch`
            // caps how many tokens a single `decode()` call may submit
            // (asserted in llama-context.cpp). Without this, any prompt
            // longer than the default 2048 tokens crashes — easy to hit once
            // a tool response (e.g. a JWT-laden JSON body) is fed back into
            // the conversation.
            .with_n_batch(n_ctx.get());
        if self.threads > 0 {
            ctx_params = ctx_params.with_n_threads(self.threads as i32);
            ctx_params = ctx_params.with_n_threads_batch(self.threads as i32);
        }

        let mut ctx = self
            .model
            .new_context(backend, ctx_params)
            .map_err(|e| format!("Failed to create context: {e}"))?;

        let tokens = self
            .model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| format!("Tokenize failed: {e}"))?;

        let n_ctx_i32 = ctx.n_ctx() as i32;
        // Clamp `max_tokens` to whatever fits in the remaining context rather
        // than erroring out. This honours the "don't truncate the user's
        // reply for arbitrary reasons" intent: the assistant can use every
        // token left in the window. If even one new token can't fit, the
        // prompt itself was already too big — that is a real error.
        let prompt_len_i32 = tokens.len() as i32;
        if prompt_len_i32 >= n_ctx_i32 {
            return Err(format!(
                "Prompt ({} tokens) does not fit in context size {} — clear the conversation or load a larger context model",
                tokens.len(),
                n_ctx_i32
            ));
        }
        let max_tokens = (max_tokens as i32).min(n_ctx_i32 - prompt_len_i32) as u32;

        let mut batch = LlamaBatch::new(tokens.len().max(512), 1);
        let last_index = (tokens.len() - 1) as i32;
        for (i, token) in (0_i32..).zip(tokens.into_iter()) {
            let is_last = i == last_index;
            batch
                .add(token, i, &[0], is_last)
                .map_err(|e| format!("batch add: {e}"))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("initial decode: {e}"))?;

        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_micros() as u32)
            .unwrap_or(1234);
        // Sampler chain. The previous `dist + greedy` baseline allowed small
        // models to enter degenerate repetition loops (e.g. streaming
        // `X-WebGL-Enabled: false` forever when asked an ambiguous prompt),
        // because once the model assigned ~all probability mass to a token,
        // every subsequent sample picked the same token. A modest repetition
        // penalty on the last 64 tokens makes those loops impossible. Slight
        // temperature + top-k/top-p keeps tool-call JSON deterministic enough
        // while still allowing the model to recover from a stuck token.
        //
        // A lazy grammar sampler is also attached: until the model emits
        // `<tool_call>`, the grammar is inert; once it has, the grammar
        // forces the JSON body to be well-formed and to use one of our real
        // tool names, terminated by `</tool_call>`. We tolerate grammar
        // construction failures (e.g. an llama-cpp-2 version that doesn't
        // accept some grammar feature) by simply omitting the sampler — the
        // engine keeps working, just without that extra guarantee.
        let grammar_sampler = LlamaSampler::grammar_lazy(
            &self.model,
            TOOL_CALL_GRAMMAR,
            "root",
            ["<tool_call>"],
            &[],
        )
        .ok();

        let mut samplers: Vec<LlamaSampler> = Vec::with_capacity(6);
        samplers.push(LlamaSampler::penalties(64, 1.15, 0.0, 0.0));
        if let Some(g) = grammar_sampler {
            samplers.push(g);
        }
        samplers.push(LlamaSampler::top_k(40));
        samplers.push(LlamaSampler::top_p(0.95, 1));
        samplers.push(LlamaSampler::temp(0.6));
        samplers.push(LlamaSampler::dist(seed));

        let mut sampler = LlamaSampler::chain_simple(samplers);

        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut n_cur = batch.n_tokens();
        let mut produced = String::new();
        let mut n_decoded: u32 = 0;

        while n_decoded < max_tokens {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(token);

            if self.model.is_eog_token(token) {
                break;
            }

            let piece = self
                .model
                .token_to_piece(token, &mut decoder, true, None)
                .map_err(|e| format!("detokenize: {e}"))?;

            if !piece.is_empty() {
                produced.push_str(&piece);
                if !on_delta(&piece) {
                    break;
                }
            }

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| format!("batch add: {e}"))?;
            n_cur += 1;
            ctx.decode(&mut batch)
                .map_err(|e| format!("decode loop: {e}"))?;

            n_decoded += 1;
        }

        Ok(produced)
    }
}

