//! Prompt construction + tool-call extraction.
//!
//! Tool calling here is done at the prompt level (not via OpenAI's
//! `/v1/chat/completions` `tools` field, since `llama-cpp-2` is a low-level
//! crate and doesn't implement that layer). We inject the tool registry into
//! the system message in the format Qwen 2.5 was natively trained on:
//!
//! ```text
//! <tool_call>
//! {"name": "...", "arguments": {...}}
//! </tool_call>
//! ```
//!
//! After the model emits a complete `<tool_call>...</tool_call>` block we stop
//! generation, dispatch the tool, append a `<tool_response>...</tool_response>`
//! message, and re-enter the model.
//!
//! Tools are always injected — there is no user-facing toggle. The system
//! prompt makes clear that tools are **opt-in per turn**, so the model is
//! free to just chat for greetings and meta questions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ParsedToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
    /// Everything in the assistant output BEFORE the tool call.
    pub preamble: String,
}

/// Format Qwen-style ChatML. Both Qwen 2.5 and Phi 3.5 GGUFs accept this
/// format reliably in our tested setups; the model registry's
/// `toolCallStyle` field can be used to switch styles later.
pub fn build_prompt(messages: &[ChatMessage], system_prefix: &str, tools_json: &str) -> String {
    let mut out = String::new();

    let mut system_text = String::new();
    if !system_prefix.trim().is_empty() {
        system_text.push_str(system_prefix.trim());
        system_text.push('\n');
    }
    system_text.push_str(
        "\n# Tools\n\
You have tools to inspect and run the user's saved HTTP API requests. Use \
them whenever the user's request needs data you don't already have or an \
action you can't do with words. For pure greetings, small talk, or \
follow-ups answerable from the existing context, just reply.\n\n\
## Rules\n\n\
1. **Never ask the user for information you can fetch yourself.** That \
includes ids (collection, request), names, URLs, methods, headers, request \
bodies, response bodies, history entries, variables, and statuses. If a \
tool can produce it, call the tool — never ask the user for it.\n\n\
2. **Resolve names with `list_*` first OR pass them directly.** When the \
user refers to something by name (e.g. \"the <collection-name> collection\", \
\"my <request-name> request\"), you have two options: (a) call the matching \
`list_*` tool, find the entry whose name matches case-insensitively (prefer \
substring match), and use its id; or (b) for `get_request` / `run_request`, \
pass the user's phrase directly as `name` (and optionally `collection_id`) — \
the tool resolves it server-side via case-insensitive substring match. \
Never fabricate an id.\n\n\
3. **Map paraphrases to tools.** \"APIs\", \"endpoints\", \"requests\", \
\"calls\" all refer to saved requests (`list_requests`, `inspect_request`, \
`run_request`). \"Collections\", \"folders\", \"groups\" refer to \
collections (`list_collections`). \"History\", \"recent\", \"last call/run\" \
refer to `get_history` / `get_last_response`. \"Variables\", \"env vars\", \
\"config\" refer to `get_variables` / `set_variable`.\n\n\
3a. **`inspect_request` vs `run_request` — pick correctly.** Whenever the \
user wants the live RESULT of a saved request (a token, a response body, \
data the API returns), use **`run_request`**. Trigger phrases include: \
*hit, call, run, execute, send, fire, test, invoke, fetch, get me the X, \
get the X token, give me the X, what does X return, X please*. Use \
`inspect_request` ONLY when the user explicitly asks to *see / show / \
inspect / look at* the saved DEFINITION (URL, body, headers) without \
sending it. If unsure, prefer `run_request`. For instance, \"can you get \
me the access token from my <auth-request> api\" → run_request, NOT \
inspect_request — the user wants the token (a live response value), not \
the saved definition. The two tools return clearly different payloads: \
`run_request` →\n\
`{\"kind\":\"http_response\",\"status\":...,\"body\":...}`; \
`inspect_request` →\n\
`{\"kind\":\"saved_request_definition\",\"request_definition\":{...}}`.\n\n\
4. **Chain tools until the question is fully answered.** Don't stop after \
the first call when more are needed. E.g. \"list APIs under my \
<collection-name> collection\" → `list_collections` → match name → \
`list_requests` with that id → reply. \"Run my <request-name> and show me \
the response\" → resolve id → `run_request` → summarize. \"List every \
saved request\" / \"show all my requests across all collections\" → call \
`list_requests` with NO arguments (omit `collection_id`); the tool will \
return every request across every collection in one call — do NOT refuse \
and do NOT ask which collection. You can call up to ~12 tools per turn.\n\n\
5. **Use tool results before replying.** Integrate the data into your \
answer. Never re-ask the user for something a result already contains.\n\n\
6. **Don't invent data.** If a tool returns an empty list, no match, or an \
`{\"error\": ...}` payload, say so plainly. **Quote the error string \
verbatim** (e.g. `the tool reported: \"<exact error>\"`) — never paraphrase \
to something generic like \"please check the URL and try again\". Never \
fabricate ids, URLs, status codes, or response bodies. **Only describe a \
status, response headers, or response body if you saw them inside a \
`{\"kind\":\"http_response\", ...}` tool result.** A \
`{\"kind\":\"saved_request_definition\", ...}` payload is NOT a response — \
do not present its `body_content` / `headers` as if the request had been \
sent. If the user asked for a result and you only have a definition, call \
`run_request`.\n\n\
7. **Ask back only when truly stuck.** A clarifying question is acceptable \
only if (a) zero matches were found, (b) multiple equally-good matches \
exist and there's no sensible default, or (c) the user's *intent* is \
genuinely ambiguous (not just an identifier). Otherwise, act.\n\n\
8. **Be concise.** Lead with the answer. For HTTP responses, lead with the \
status code, then the few most relevant fields. Summarize long bodies — \
don't dump them.\n\n\
8a. **Single-value asks → single value.** When the user asks for ONE \
specific field from a response (e.g. \"give me the access token\", \"what's \
the user id\", \"the etag please\", \"get me the X token\"), reply with \
just the raw value, no labels, no markdown bold, no bullet list, no \
status code, no other fields the user did not ask for. The user is going \
to copy-paste it. Do not surround it in code fences or quote it. Example: \
user says \"give me the access token\" → assistant replies with the token \
string and nothing else.\n\n\
9. **NEVER fabricate an HTTP response.** Status codes, headers, response \
bodies, and request definitions MUST come from a fresh `<tool_call>` in \
THIS turn — never from memory, imagination, or pattern-matching against \
earlier assistant turns in the transcript. The chat history may show \
formatted blocks like `✓ 200 OK ... **Headers** ... **Body**` that look \
like things you said; those came from real tool executions in earlier \
turns. **They are not templates to mimic.** If the user asks to hit / run \
/ inspect / fetch / call a request — even one you handled in an earlier \
turn — you MUST emit `<tool_call>` again. The network may have changed, \
the data may have changed, the user may now be on a different VPN. Do not \
guess a response. The only acceptable non-tool reply to a \"hit X\" / \
\"run X\" / \"fetch X\" type request is when the tool genuinely cannot be \
resolved (no matching saved request) — and in that case, ask the user \
which saved request they mean.\n\n\
10. **NEVER invent saved-request or collection names — including in \
\"suggestions\".** When the user asks you to suggest follow-up requests, \
related calls, next steps, or anything similar, every named entity you \
mention (request name, collection name, id, URL, method) MUST come from a \
`<tool_call>` result you saw in THIS conversation. The names and example \
strings appearing in this system prompt and in the tool *descriptions* \
above are illustrative placeholders — they are NOT names in the user's \
database and MUST NEVER appear in your replies. If a `list_requests` / \
`list_collections` returned an empty list, say so plainly (\"you have no \
saved requests in this collection yet\") and, if the user asked for ideas, \
phrase them as generic categories the user could add (\"a login request\", \
\"a request to fetch user details\") — never as if they already exist. \
Same rule for response bodies and URLs: never present `https://api.example.\
com/...` or any URL the user hasn't actually saved.\n\n\
11. **NEVER write `<tool_response>` yourself. EVER.** Tool responses are \
emitted by the SERVER, never by you. Your only protocol move is emitting \
`<tool_call>...</tool_call>` and then stopping — the runtime executes the \
tool and inserts the `<tool_response>...</tool_response>` block into the \
next user turn before you continue. If you find yourself about to type \
`<tool_response>`, STOP: that means you are about to fabricate data. \
Instead, emit a real `<tool_call>` for the same intent, or — if you \
already have a tool result in this conversation — just answer in prose. \
Writing a fake `<tool_response>` (even one that looks plausible) is the \
single most damaging mistake you can make, because it poisons the chat \
history and every later turn will build on the lie.\n\n\
12. **Handling tool errors.** If a `<tool_response>` contains an `error` \
field, do NOT parrot the error back to the user as your final answer. \
Take ONE of these actions, in order:\n\
  a. If the error is about a missing or wrong argument and you can infer \
the correct value from earlier tool results in this conversation (e.g. a \
prior `list_requests` gave you the id/name), retry the same tool with \
corrected arguments — emit a new `<tool_call>`.\n\
  b. If the error names a specific missing field and you cannot infer it, \
ask the user the one missing detail in plain prose (one short sentence). \
Do NOT include the raw error text in your question.\n\
  c. Only if neither retry nor a one-line clarifying question is possible, \
explain in your own words what went wrong and what the user could try \
next — never quote the raw `error` string.\n\n\
## Tool-call format\n\n\
When you need a tool, emit exactly:\n\
<tool_call>\n\
{\"name\": \"<tool_name>\", \"arguments\": { ... }}\n\
</tool_call>\n\n\
…and stop. The system runs the tool and feeds the result back inside \
<tool_response> tags, after which you may continue, call another tool, or \
write the final reply. Never wrap a non-tool reply in <tool_call>, and \
never call a tool when the user is just saying hi.\n\n\
## Available tools\n",
    );
    system_text.push_str(tools_json);
    system_text.push('\n');

    out.push_str("<|im_start|>system\n");
    out.push_str(&system_text);
    out.push_str("<|im_end|>\n");

    for msg in messages {
        let role = match msg.role.as_str() {
            "tool" => "user", // wrap tool results as a user turn
            r => r,
        };
        // Rewrite assistant turns that LOOK like formatted tool results so
        // the model knows they came from real tool executions, not free
        // generation. Without this, smaller / code-tuned models
        // pattern-match the format and fabricate fresh "200 OK" responses
        // for new turns without ever calling `run_request`.
        let content_owned;
        let content_ref: &str = if role == "assistant" && looks_like_tool_result(&msg.content) {
            content_owned = format!(
                "[NOTE TO ASSISTANT: the formatted block below was emitted by a real \
                 `run_request` / `inspect_request` tool call in an earlier turn. It is \
                 NOT something you generated from imagination, and it is NOT a template \
                 you may reuse for new questions. If the user asks to hit/run/inspect \
                 anything in their next message, you MUST call the tool again.]\n\n{}",
                msg.content
            );
            &content_owned
        } else {
            &msg.content
        };
        out.push_str("<|im_start|>");
        out.push_str(role);
        out.push('\n');
        out.push_str(content_ref);
        out.push_str("<|im_end|>\n");
    }

    out.push_str("<|im_start|>assistant\n");
    out
}

/// Heuristic: does this assistant message look like the structured markdown
/// our backend's `format_tool_result_for_user` emits for `run_request` /
/// `inspect_request` short-circuits? Matches:
///   - leading status glyph (`✓` / `✗` / `↪`) from run_request, OR
///   - leading `**` from inspect_request's `**METHOD NAME**` header,
/// AND a fenced code block with the `http` or `json` language tag.
fn looks_like_tool_result(content: &str) -> bool {
    let trimmed = content.trim_start();

    // Raw `<tool_response>` tags inside an assistant turn are NEVER a real
    // tool result (the server emits them as user-role messages, not
    // assistant-role). If we still see one in the history, it was either
    // a coder-tuned model role-playing both sides, or a leftover from
    // before `strip_fake_tool_responses` shipped. Treat it as a fake
    // result so the prompt builder slaps the warning prefix on it.
    if content.contains("<tool_response>") {
        return true;
    }

    let has_known_prefix = trimmed.starts_with('✓')
        || trimmed.starts_with('✗')
        || trimmed.starts_with('↪')
        || trimmed.starts_with("**");
    if !has_known_prefix {
        return false;
    }
    content.contains("```http\n") || content.contains("```json\n")
}

/// Detect a tool call in `text`. Tries the canonical `<tool_call>...</tool_call>`
/// envelope first, then falls back to the bare-JSON form some smaller models
/// emit (they sometimes drop the wrapping tags). The bare-JSON fallback only
/// fires when the *entire* assistant output, after trimming, is a single
/// JSON object that has a `"name"` field — that way regular chat replies
/// that happen to mention `{`/`}` are not misinterpreted as tools.
pub fn try_extract_tool_call(text: &str) -> Option<ParsedToolCall> {
    if let Some(open) = text.find("<tool_call>") {
        let after_open = open + "<tool_call>".len();
        if let Some(close_rel) = text[after_open..].find("</tool_call>") {
            let json_body = text[after_open..after_open + close_rel].trim();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_body) {
                if let Some(name) = parsed.get("name").and_then(|v| v.as_str()) {
                    return Some(ParsedToolCall {
                        name: name.to_string(),
                        arguments: parsed
                            .get("arguments")
                            .cloned()
                            .unwrap_or(serde_json::json!({})),
                        preamble: text[..open].to_string(),
                    });
                }
            }
        }
    }

    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(name) = parsed.get("name").and_then(|v| v.as_str()) {
                return Some(ParsedToolCall {
                    name: name.to_string(),
                    arguments: parsed
                        .get("arguments")
                        .cloned()
                        .unwrap_or(serde_json::json!({})),
                    preamble: String::new(),
                });
            }
        }
    }

    None
}

/// Light-weight check used during streaming: returns `true` once a complete
/// closing tag has been observed so generation can stop early.
pub fn has_complete_tool_call(buf: &str) -> bool {
    buf.contains("<tool_call>") && buf.contains("</tool_call>")
}

/// Some models (notably Qwen 2.5 *Coder* 7B and other code-fine-tunes) are
/// trained on tool-call transcripts and will happily generate *both* halves
/// of the protocol — emitting a `<tool_response>{...}</tool_response>` block
/// as if a tool had been called, even when no `<tool_call>` was made.
/// Those fake responses then get persisted as real assistant turns and
/// poison every subsequent turn in the chat (the model sees a "successful"
/// past tool exchange and builds on it).
///
/// This stripper removes every `<tool_response>...</tool_response>` block
/// from a finished assistant turn. If anything was stripped, a single
/// `[note: model fabricated a tool result; ignored]` line is prepended so
/// the user understands why the reply looks abbreviated.
///
/// Tolerates unclosed tags (deletes from the open tag to end-of-string) so
/// truncated hallucinations can't leak either.
pub fn strip_fake_tool_responses(text: &str) -> String {
    const OPEN: &str = "<tool_response>";
    const CLOSE: &str = "</tool_response>";

    if !text.contains(OPEN) {
        return text.to_string();
    }

    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    let mut stripped_any = false;

    while let Some(open_rel) = text[cursor..].find(OPEN) {
        let open_abs = cursor + open_rel;
        out.push_str(&text[cursor..open_abs]);
        stripped_any = true;

        let after_open = open_abs + OPEN.len();
        match text[after_open..].find(CLOSE) {
            Some(close_rel) => {
                cursor = after_open + close_rel + CLOSE.len();
            }
            None => {
                // Unclosed fake tag — drop everything to the end so we
                // don't leak a half-formed JSON object.
                cursor = text.len();
                break;
            }
        }
    }
    out.push_str(&text[cursor..]);

    if stripped_any {
        let trimmed = out.trim();
        if trimmed.is_empty() {
            "[note: model fabricated a tool result; ignored]".to_string()
        } else {
            format!("[note: model fabricated a tool result; ignored]\n\n{}", trimmed)
        }
    } else {
        out
    }
}

#[cfg(test)]
mod strip_tests {
    use super::*;

    #[test]
    fn passes_through_clean_text() {
        let s = "hello world";
        assert_eq!(strip_fake_tool_responses(s), "hello world");
    }

    #[test]
    fn strips_well_formed_fake_response() {
        let s = "<tool_response>\n{\"kind\":\"x\"}\n</tool_response>\n\nReal prose here.";
        let out = strip_fake_tool_responses(s);
        assert!(out.starts_with("[note: model fabricated"));
        assert!(out.contains("Real prose here."));
        assert!(!out.contains("<tool_response>"));
    }

    #[test]
    fn strips_unclosed_fake_response() {
        let s = "ok prefix <tool_response>\n{ bad json no close";
        let out = strip_fake_tool_responses(s);
        assert!(out.starts_with("[note: model fabricated"));
        assert!(out.contains("ok prefix"));
        assert!(!out.contains("<tool_response>"));
        assert!(!out.contains("bad json"));
    }

    #[test]
    fn collapses_to_note_when_nothing_else_remains() {
        let s = "<tool_response>{}</tool_response>";
        assert_eq!(
            strip_fake_tool_responses(s),
            "[note: model fabricated a tool result; ignored]"
        );
    }

    #[test]
    fn handles_multiple_blocks() {
        let s = "<tool_response>{}</tool_response>middle<tool_response>{}</tool_response>tail";
        let out = strip_fake_tool_responses(s);
        assert!(!out.contains("<tool_response>"));
        assert!(out.contains("middle"));
        assert!(out.contains("tail"));
    }
}

pub fn try_direct_single_field_answer(
    user_text: &str,
    tool_name: &str,
    result: &serde_json::Value,
) -> Option<String> {
    if tool_name != "run_request" {
        return None;
    }
    if result.get("kind").and_then(|v| v.as_str()) != Some("http_response") {
        return None;
    }

    let aliases = requested_single_field_aliases(user_text)?;
    let body = result.get("body").and_then(|v| v.as_str())?;
    let body_json = serde_json::from_str::<serde_json::Value>(body).ok()?;

    find_json_field_value(&body_json, aliases)
}

fn requested_single_field_aliases(user_text: &str) -> Option<&'static [&'static str]> {
    let compact = normalize_identifier(user_text);
    if compact.contains("accesstoken") || contains_words_in_order(user_text, &["access", "token"]) {
        return Some(&["accesstoken"]);
    }

    None
}

fn normalize_identifier(text: &str) -> String {
    text.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn contains_words_in_order(text: &str, expected: &[&str]) -> bool {
    let words: Vec<String> = text
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.to_ascii_lowercase())
        .collect();

    let mut pos = 0;
    for word in words {
        if pos < expected.len() && word == expected[pos] {
            pos += 1;
        }
    }

    pos == expected.len()
}

fn find_json_field_value(value: &serde_json::Value, aliases: &[&str]) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                let normalized_key = normalize_identifier(key);
                if aliases.contains(&normalized_key.as_str()) {
                    return scalar_json_value(value);
                }
            }

            map.values()
                .find_map(|value| find_json_field_value(value, aliases))
        }
        serde_json::Value::Array(items) => items
            .iter()
            .find_map(|value| find_json_field_value(value, aliases)),
        _ => None,
    }
}

fn scalar_json_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(_) | serde_json::Value::Bool(_) => Some(value.to_string()),
        _ => None,
    }
}

/// Format a tool result so the model sees it on its next turn.
pub fn format_tool_response(name: &str, value: &serde_json::Value) -> String {
    format!(
        "<tool_response>\n{{\"name\": \"{}\", \"result\": {}}}\n</tool_response>",
        name,
        serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_only_access_token_for_single_value_request() {
        let result = json!({
            "kind": "http_response",
            "status": 200,
            "body": r#"{"accessToken":"jwt-value","tokenType":"Bearer","expiresIn":3600}"#,
        });

        assert_eq!(
            try_direct_single_field_answer(
                "give me access token from get irp token api",
                "run_request",
                &result,
            ),
            Some("jwt-value".to_string())
        );
    }

    #[test]
    fn leaves_unspecified_response_summaries_to_the_model() {
        let result = json!({
            "kind": "http_response",
            "status": 200,
            "body": r#"{"accessToken":"jwt-value","tokenType":"Bearer","expiresIn":3600}"#,
        });

        assert_eq!(
            try_direct_single_field_answer("run get irp token api", "run_request", &result),
            None
        );
    }
}
