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
        // Keep the sampler minimal to be resilient across llama-cpp-2 minor versions.
        // `dist(seed)` + `greedy()` is the documented baseline and matches the
        // upstream `simple` example.
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::dist(seed),
            LlamaSampler::greedy(),
        ]);

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

