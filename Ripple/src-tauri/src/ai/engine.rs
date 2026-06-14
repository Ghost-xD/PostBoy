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

/// Hardcoded fallback list of built-in tool names — used when a caller
/// doesn't pass a runtime allow-list (e.g. `ai_complete_text`). The
/// chat-loop path always passes a merged list including any active MCP
/// tools so the grammar accepts namespaced names.
const BUILTIN_TOOL_NAMES: &[&str] = &[
    "list_collections",
    "list_requests",
    "inspect_request",
    "get_request",
    "run_request",
    "get_variables",
    "set_variable",
    "get_history",
    "get_last_response",
];

/// Build the runtime tool-call GBNF grammar from a list of tool names.
///
/// Until MCP shipped, this lived as a `const` string with the eight
/// built-in tools hard-coded. The chat loop now mixes those with however
/// many enabled MCP tools the user has, so we generate the
/// `tool-name ::= ...` alternation on every turn. The rest of the grammar
/// (JSON value/object/etc. productions) is identical to the original
/// hand-tuned version.
///
/// `names` may be empty; in that case we fall back to the built-in list
/// rather than generating an unparseable empty alternation.
///
/// Why GBNF and not a regex / structured-output API? llama-cpp-2's
/// `LlamaSampler::grammar_lazy` is the only knob we have for "constrain
/// the next N tokens but only after a trigger string". Without it, small
/// models occasionally emit malformed JSON inside `<tool_call>` (extra
/// trailing commas, missing quotes), which the parser then drops on the
/// floor and the user sees no answer.
///
/// What this fixes:
/// - Malformed JSON inside `<tool_call>` — the grammar mask makes those
///   tokens unreachable.
/// - Hallucinated tool names — only the supplied names are reachable.
/// - Truncation right after the JSON — the model has to emit
///   `</tool_call>` before EOS is allowed.
///
/// What this does NOT fix:
/// - The model deciding to refuse instead of calling a tool. Grammar
///   sampling only kicks in once the trigger has been emitted; we still
///   need a capable model (and the existing intercepts) for the
///   tool-vs-refusal decision.
// llama.cpp's GBNF parser does NOT accept `|`-prefixed continuation lines
// (every rule alternative must be on the same physical line, OR expressed
// via parentheses/`?`/`*` operators). The official `grammars/json.gbnf` in
// llama.cpp follows the same convention. Multi-line `|` continuations
// produce `expecting name at | ...` parse errors and the entire grammar is
// silently rejected, which is what was killing tool-call sampling here.
fn build_tool_call_grammar(names: &[String]) -> String {
    // Filter out anything that isn't a valid GBNF terminal payload (control
    // chars, embedded backslashes/quotes), and dedupe while preserving
    // input order. Most servers ship safe ASCII names, but a hostile MCP
    // server could break the whole grammar by advertising a tool with a
    // raw `"` in it; cheaper to skip those than to escape them.
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut alternatives: Vec<String> = Vec::new();
    for n in names {
        if !is_safe_grammar_name(n) {
            continue;
        }
        if seen.insert(n.as_str()) {
            alternatives.push(format!("\"\\\"{}\\\"\"", n));
        }
    }
    if alternatives.is_empty() {
        for n in BUILTIN_TOOL_NAMES {
            alternatives.push(format!("\"\\\"{}\\\"\"", n));
        }
    }
    let tool_name_rule = alternatives.join(" | ");

    format!(
        r#"
root         ::= ws "{{" ws "\"name\"" ws ":" ws tool-name ws "," ws "\"arguments\"" ws ":" ws json-object ws "}}" ws "</tool_call>"
tool-name    ::= {tool_name_rule}
json-value   ::= json-string | json-number | json-boolean | "null" | json-object | json-array
json-object  ::= "{{" ws ( json-pair (ws "," ws json-pair)* )? ws "}}"
json-pair    ::= json-string ws ":" ws json-value
json-array   ::= "[" ws ( json-value (ws "," ws json-value)* )? ws "]"
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
"#
    )
}

/// Reject names that would corrupt the GBNF grammar literal. A safe name
/// is printable ASCII without quote/backslash/control characters and short
/// enough that we don't blow the parser's stack.
fn is_safe_grammar_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars().all(|c| {
            !c.is_control() && c != '"' && c != '\\' && c.is_ascii()
        })
}

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
    ///
    /// Uses the built-in tool-name list for the lazy GBNF grammar. The
    /// chat loop's MCP-aware path goes through [`Engine::complete_with_tools`]
    /// to inject MCP tool names into the grammar at runtime; everything
    /// else (raw text completion, plan drafting, etc.) keeps using this
    /// thin wrapper.
    pub fn complete<F>(
        &self,
        prompt: &str,
        max_tokens: u32,
        cancel: Arc<AtomicBool>,
        on_delta: F,
    ) -> Result<String, String>
    where
        F: FnMut(&str) -> bool,
    {
        self.complete_with_tools(prompt, max_tokens, &[], cancel, on_delta)
    }

    /// Same as [`Engine::complete`] but accepts a runtime allow-list of
    /// tool names that the lazy GBNF grammar will permit inside
    /// `<tool_call>...</tool_call>`. An empty `tool_names` list is treated
    /// as "use the built-in defaults" so non-chat callers don't have to
    /// know about this dimension.
    pub fn complete_with_tools<F>(
        &self,
        prompt: &str,
        max_tokens: u32,
        tool_names: &[String],
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
        // The lazy GBNF grammar sampler is intentionally NOT attached.
        // llama.cpp's grammar accept path throws a C++ exception ("Unexpected
        // empty grammar stack after accepting piece: ...") on certain compound
        // tokens. That exception unwinds across the FFI boundary into Rust,
        // which cannot catch a foreign exception and instead aborts the whole
        // process (SIGABRT via `__rust_foreign_exception`). Whether it fires is
        // data-dependent — it hinges on which token the model samples — so with
        // identical code/model it crashed reliably under the macOS Metal
        // backend yet stayed latent under Vulkan on Windows. Attaching it would
        // therefore make behaviour diverge per platform. Skipping it on every
        // platform keeps the sampler chain identical across Windows/macOS and
        // removes the crash. Tool calls still work via the lenient
        // `<tool_call>` parser in `tool_parser`; we only lose the hard grammar
        // guarantee on the JSON body. `tool_names` and the grammar builder are
        // kept wired up so this can be re-enabled once inference is isolated
        // from the host process (e.g. run in a subprocess that can crash
        // without taking the app down).
        let _grammar_src = build_tool_call_grammar(tool_names);

        let mut samplers: Vec<LlamaSampler> = Vec::with_capacity(5);
        samplers.push(LlamaSampler::penalties(64, 1.15, 0.0, 0.0));
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

