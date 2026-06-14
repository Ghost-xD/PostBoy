# Ripple — Technical Feature Sheet

> Generated from a sweep of the README plus the live codebase
> (`src-tauri/src/**`, `src/lib/**`, `package.json`, DB migrations,
> keyboard-shortcut catalog, AI tool registry).
>
> **App version at time of writing:** `0.0.16`
> **Edition:** Ripple — Tauri 2.0 Edition

---

## 1. Product summary

Ripple is a desktop API client for sending HTTP requests, working with
real-time protocols (WebSocket, SSE), running SQL against three database
engines, and triaging responses with a suite of built-in developer
tools. It also ships with an **on-device LLM "Son of Anton"** that can
drive the app via tool-calls (list collections, run saved requests,
read history, …) with zero network round-trips to a cloud model.

Everything is local-first: a single SQLite file (`ripple.db`) under
the OS-standard app data dir holds collections, requests, history,
variables, cookies, settings, and chat sessions. Multiple windows are
not currently spawned; a single main window plus a transient
splashscreen handle startup.

---

## 2. Tech stack at a glance

| Layer | Technology |
| --- | --- |
| Desktop shell | **Tauri 2.0** (`@tauri-apps/api ^2`, CLI `^2.10.1`) |
| Frontend framework | **SvelteKit ^2.9** running **Svelte 5** (runes) |
| Frontend build | Vite `^6.0`, TypeScript `~5.6` |
| Code editor | **Monaco Editor** (`monaco-editor`) — request JSON body, scripts, response preview |
| JSON graph view | `jsoncrack-react` (React 19 island, embedded via root) |
| Markdown rendering | Custom renderer in `src/lib/utils/markdownRenderer.ts` |
| Diffing | `diff ^9` + custom side-by-side engine in `diffEngine.ts` |
| Backend language | **Rust** (Tauri commands + native clients) |
| HTTP client | `reqwest` (async, with redirect/proxy/SSL config) |
| WebSocket | `tokio-tungstenite` (via `ws_client.rs`) |
| SSE | Custom streaming client (`sse_client.rs`) with auto-reconnect |
| SQL drivers | `tokio-postgres`, `mysql_async`, `rusqlite` |
| Storage | SQLite via `tauri-plugin-sql` + direct `rusqlite` migrations |
| LLM runtime | **`llama-cpp-2`** (GGUF inference, optional `chatbot` feature flag) |
| Tauri plugins | `sql`, `dialog`, `fs`, `log`, `shell`, `updater`, `process`, `opener` |
| Testing | Vitest `^4`, `@testing-library/svelte`, Playwright, `better-sqlite3` (in-memory) |

---

## 3. HTTP client

### Methods & request building
- Sends **GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD**.
- Method picker (`MethodSelect.svelte`) opens via `Ctrl+M`.
- URL bar with autosend on `Enter`, focus & select via `Ctrl+I`.
- **CURL parser** (`utils/curlParser.ts`) lets users paste a full
  `curl …` line and have method/URL/headers/body extracted into the
  active tab.

### Query parameters & headers
- Key/value editors with add/remove, blank-row auto-extension, and
  per-row enable/disable semantics.
- Both panes flow through the `{{variable}}` interpolator before the
  request is sent.

### Request bodies (10 modes)
| Mode | Notes |
| --- | --- |
| **JSON** | Monaco (`JsonEditor.svelte`) — syntax highlighting, `{{variable}}` autocomplete, sensitive-field masking, auto-format on paste/blur, format button (`Ctrl+Shift+F`) |
| **XML** | `VariableInput` textarea, auto-format |
| **YAML** | `VariableInput` textarea |
| **HTML** | `VariableInput` textarea, auto-format |
| **JavaScript** | `VariableInput` textarea |
| **Plain text** | Raw textarea |
| **Form Data** (`multipart/form-data`) | Per-row `text` or `file` type; file paths are dialog-picked and read on the Rust side |
| **Form URL Encoded** | Key/value editor, encoded server-side |
| **GraphQL** | Separate `query` and `variables` editors merged into one JSON body |
| **Binary / File** | Single-file upload streamed from disk |
| **No body** | Explicit "no body" choice |

### Authorization
- **No Auth**
- **Basic Auth** (username + password)
- **Bearer Token**
- **API Key** (placed in header **or** query param)

### Response viewer
- **Status bar:** status code + status text, response time (ms),
  formatted byte size, request timestamp.
- **Preview tabs:** Preview / Headers / Console / Diff.
- **Preview modes:** Raw, Tree (custom `JsonTreeViewer`), Graph
  (`jsoncrack-react` with pan/zoom keyboard shortcuts).
- **Binary preview:** detects images, audio, video, PDF, fonts,
  `application/octet-stream`, `application/zip|gzip|wasm`,
  `application/vnd.*`, protobuf, etc. and renders or summarises
  appropriately (`BinaryPreview.svelte`).
- **Large-response handling:** preview truncates at the threshold in
  `responseUtils.ts` (`LARGE_RESPONSE_THRESHOLD`/`TRUNCATED_PREVIEW_SIZE`)
  with a "show full" toggle.
- **In-response search:** `Ctrl+F` opens `ResponseSearchBar` with
  next/previous match navigation via Monaco's find controller
  (`ResponseViewer.svelte`).
- **Response diff:** side-by-side diff of the current response vs a
  saved comparison (`ResponseDiff.svelte`).
- **Console tab:** logs from `consoleStore` capturing request/response
  events, errors, and system messages.
- **Snapshot export:** `Ctrl+Shift+S` writes a standalone HTML snapshot
  of the response (`snapshotExporter.ts`) via the Tauri file dialog.
- **Copy response** and **download response** buttons (plus copy-as-curl
  / generate-code from the request side).

### Code generation
`src/lib/utils/codeGenerator.ts` produces equivalent snippets for the
active tab:
- `fetch` (JavaScript/TypeScript)
- `axios` (Node.js)
- `requests` (Python)
- `HttpClient` (C#)
- `curl`

Triggered with `Ctrl+Shift+G` (snippets) or `Ctrl+Shift+K` (cURL).

---

## 4. Tabs and workspace

- Unlimited tabs (`tabStore.ts`); each tab carries its own request,
  response, WS state, SSE state, body content per mode, and
  description.
- `Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+Tab` / `Ctrl+Shift+Tab`
  cycle tabs.
- **Tabs and full UI state persist** across restarts (auto-save +
  restore-on-mount). `enableAutoSave()` debounces writes; UI panel
  sizes/positions/collapsed state are saved via `getUIState` /
  `restoreUIState`.
- **Docs tab per request:** every tab has a Markdown "Docs" editor
  (`Ctrl+D`) with toggle between edit and preview (`Ctrl+Shift+D`)
  rendered through the in-app Markdown renderer.

### Layout & ergonomics
- **Drag-to-resize** left sidebar, right sidebar, and bottom response
  panel.
- **Collapsible sidebars** (`Ctrl+Shift+[` and `Ctrl+Shift+]`).
- **Response panel position toggle** (bottom ↔ right) via
  `Ctrl+Shift+L`.
- **Tools panel** with its own fullscreen mode
  (`Ctrl+Shift+Enter` while open).
- **Search picker** (`Ctrl+F` outside the response) jumps focus to
  Collections, History, or the Response search bar.
- **Dark theme** is the only theme today (light is a known roadmap
  item).

---

## 5. Collections, requests, history, variables

### Collections
- Hierarchical: collections support `parent_id` so folders nest
  (`db_create_folder`, `db_move_collection`).
- CRUD: create, rename, delete, reorder, move between parents.
- **Per-collection variables** scoped via `collection_variables`
  table; resolved at send-time through `{{var}}` interpolation
  (see `variableStore.ts`).
- **Per-collection cookie jar** (see §10).

### Saved requests
- Belong to a collection (nullable).
- Persist method, URL, headers, params, body type/content, auth type
  and auth data (as JSON), free-text **description**, and a
  `sort_order` for manual ordering.
- Reorder within a collection, move to another collection, rename in
  place, delete.

### History
- Every executed request is recorded with method, URL, status code,
  response time, full request payload, **response headers + truncated
  body**, and executed-at timestamp.
- "Load from history" rehydrates a tab; clear individual entries or
  clear all.

### Variables
- Stored per collection with `key + value` (unique per collection).
- Reads from `interpolate()` / `interpolateKeyValues()`.
- Helpers: `getUnresolvedVariables`, `countVariablesInText`,
  `flattenJsonPaths`, `getValueAtPath` (used to extract values from
  a response into a variable).
- A modal flow lets you pick a JSON path from the last response and
  store it directly as a collection variable.

---

## 6. Import / Export

### Import sources
- **Postman v2.1** collections (`utils/collectionImporter.ts`,
  format autodetected).
- **Insomnia v4** export bundles.
- **Ripple** native export (re-import).
- **OpenAPI 2.0 (Swagger) and 3.x** specs via
  `utils/openApiParser.ts`, triggered with `Ctrl+Shift+O` — every
  operation becomes a saved request inside a new collection.

### Export targets
- Export **all** collections to JSON (`db_export_collections`).
- Export a **single** collection (`db_export_single_collection`).
- Export the current response as a **standalone HTML snapshot**
  (`Ctrl+Shift+S`).

Both flows use the Tauri save/open dialog plugin.

---

## 7. Request Chains

`src/lib/components/RequestChainPanel.svelte` + `utils/chainRunner.ts`:

- Build a **chain** of saved requests as ordered steps.
- Each step can declare **JSON-path extractions** that pull a value
  out of the response and write it into a collection variable
  (auto-suggested variable name).
- Run a single step or the entire chain; results pane shows per-step
  status (`pending | running | success | error | skipped`), HTTP
  status, request URL, and the resolved/extracted values.
- Variables produced by earlier steps are visible to later steps
  thanks to `getAvailableVarsForStep` and the shared variable store.

---

## 8. Real-time protocols

### WebSocket (`WebSocketPanel.svelte`, `ws_client.rs`)
- Connect/disconnect from the URL bar (`Ctrl+Enter`).
- Send text or binary frames; per-tab message log with sent/received
  counts.
- Optional custom headers on connect (passed through the upgrade
  request).
- Auto-scroll log, clear messages (`Ctrl+L`).

### Server-Sent Events (`SsePanel.svelte`, `sse_client.rs`)
- Persistent connection with **auto-reconnect** (status:
  `connecting | connected | reconnecting | disconnected | error`).
- Filter the log by `eventType`; eventTypes are auto-derived from the
  received messages.
- Optional custom headers on connect; clear events (`Ctrl+L`).

---

## 9. SQL Runner (`SqlRunnerPanel.svelte`, `sql_client.rs`)

- Connect to **PostgreSQL**, **MySQL**, or **SQLite** with saved
  connection profiles (host, port, db, user, password, friendly name)
  persisted to settings.
- Run any SQL statement; SELECT returns columns + typed rows + row
  count + execution time, DML returns `affected_rows`.
- **Query history** with timestamp, execution time, row count, and
  error per entry.
- Disconnect on demand; connection pool managed inside `SqlClientState`
  (`Arc<Mutex<HashMap<…>>>`).

---

## 10. Cookie Jar (`CookieJarPanel.svelte`)

- Per-collection cookie storage (table `cookies`, unique on
  `(collection_id, domain, path, name)`).
- Fields: domain, path, name, value, expires, `secure`, `http_only`,
  `same_site` (`Lax|Strict|None`).
- Bulk import via response `Set-Cookie` headers (the cookie store
  exposes `isExpired`, `getCookiesForUrl`, etc.).
- View / filter / edit / delete individual cookies; clear all cookies
  in a collection or clear cookies globally.

---

## 11. Network Diagnostics (`DiagnosticsPanel.svelte`, `net_client.rs`)

Four built-in network tools, all backed by Rust:

| Tool | Output |
| --- | --- |
| **DNS resolve** | All resolved addresses + lookup duration |
| **Port check** | TCP open/closed for `host:port` with duration & error |
| **Ping** | Resolved IP, reachable yes/no, latency in ms |
| **Trace route** | Hop list with IP, hostname, latency, timed-out flag |

Open with `Ctrl+Shift+N`.

---

## 12. Diff / Compare Tool (`DiffTool.svelte`, `utils/diffEngine.ts`)

- Standalone side-by-side diff editor (`Ctrl+Shift+B`) with its own
  fullscreen.
- **Side-by-side line diff** with adds/removes/modifications,
  configurable context lines, "show only changes" mode,
  word-wrap toggle, ignore-whitespace toggle, format-JSON toggle
  (`Ctrl+J`), per-line **inline character diff**.
- Next/previous change navigation (`Alt+N` / `Alt+P`).
- Customisable left/right labels and per-side copy.
- A response can be sent into the diff tool as either side.

---

## 13. JWT Decoder (`JwtDecoderPanel.svelte`)

- Paste a JWT (with or without `Bearer` prefix).
- Decodes header, payload, and signature; reports validity errors
  ("Invalid JWT: expected 3 parts…", etc.).
- Computes expiry: absolute `Date`, `isExpired`, and human "expires in"
  string.
- Copy buttons for header / payload / signature.
- Opens with `Ctrl+Shift+J`.

---

## 14. Encode / Decode panel (`EncoderPanel.svelte`)

- **Base64** encode/decode and **URL** encode/decode.
- Reactive — output updates as you type; errors shown inline.
- Swap input/output, copy output.
- `Ctrl+D` toggles encode↔decode, `Ctrl+M` toggles base64↔URL.
- Opens with `Ctrl+Shift+E`.

---

## 15. Settings panel (`SettingsPanel.svelte`)

Persisted in the `settings` table (key/value).

**Request**
- Request timeout (1–300 s, default 30 s).
- Follow redirects toggle with max-redirects cap (1–50).
- SSL certificate verification toggle (off → accepts self-signed).

**Proxy**
- Enable/disable.
- Proxy URL (`http://proxy.example.com:8080`-style).

Reset-to-defaults button with a transient "Saved" indicator.
Opens with `Ctrl+,`.

---

## 16. Son of Anton — local LLM chatbot (optional `chatbot` Cargo feature)

The chatbot ships only in builds compiled with `--features chatbot`.
The frontend probes the `ai_supported` command and hides every
chatbot affordance when the feature is off.

### Inference engine (`src-tauri/src/ai/engine.rs`)
- Wraps **`llama-cpp-2`** (GGUF), backend is a process-wide singleton.
- Loads a model from disk, sharing it via `Arc<LlamaModel>`; spawns a
  fresh `LlamaContext` per chat with `n_gpu_layers = 999` so the build
  uses GPU if it was compiled with one (clean CPU fallback otherwise).
- Sampler chain: repetition penalty (window 64, 1.15), top-k 40,
  top-p 0.95, temperature 0.6, seeded distribution.
- **Lazy GBNF grammar sampler** kicks in only after `<tool_call>` is
  emitted, then forces well-formed `{"name": <tool>, "arguments": {…}}`
  using only the registered tool names, terminated by `</tool_call>`.
- Cancellation via `Arc<AtomicBool>` (UI Stop button) and per-token
  `on_delta` streaming callback.

### Models (`src-tauri/resources/models.json`)
Curated downloadable catalog with progress, pause/resume, cancel, and
delete:
- Hermes 3 Llama 3.1 8B (Q4_K_M) — *recommended for tools*
- Qwen 2.5 7B Instruct (Q4_K_M) — general purpose
- Qwen 2.5 Coder 7B Instruct (Q4_K_M) — code-tuned; *not recommended for tools* (fabricates tool responses)
- Phi 3.5 Mini Instruct (Q4_K_M)

Each entry declares `contextSize`, `supportsTools`,
`toolCallStyle`, and one or more download URLs (HuggingFace, with a
Kaggle slot reserved).

### Tool calls (`src-tauri/src/ai/tools.rs`)
Nine tools exposed to the model; their JSON schemas are embedded into
the system prompt:
- `list_collections`
- `list_requests` (optionally scoped to a `collection_id`)
- `inspect_request` (read-only request definition)
- `get_request`
- `run_request` (**only tool that touches the network**)
- `get_variables`
- `set_variable`
- `get_history`
- `get_last_response`

The dispatcher resolves a request by **name first** (with global
fallback) before falling back to a numeric id, because small models
routinely hallucinate ids. Tool response bodies are truncated to
32 KB to protect the context window.

### Chat UX (`ChatbotPanel.svelte`)
- Sub-tabs: **Chat / Action Log / History / Models**.
- Streaming tokens render live; action log records every tool call,
  argument bag, and result.
- **Composer autocomplete** ranks suggestions by:
  1. past user phrases (frequency-weighted),
  2. saved request names expanded with verbs (`hit`, `run`,
     `inspect`, `get`),
  3. collection names (and "list requests in …" templates),
  4. built-in starter templates.
- Stop/cancel streaming, reset conversation, new chat.
- **Persistent chat history** in `chat_sessions` / `chat_messages`
  (migration v7) with save, load, delete, delete-all.
- Suggestion corpus refreshed after each saved turn.

### Tauri commands exposed (chatbot build only)
`ai_supported`, `ai_get_status`, `ai_list_models`, `ai_list_installed`,
`ai_download_model`, `ai_cancel_download`, `ai_pause_download`,
`ai_resume_download`, `ai_delete_model`, `ai_load_engine`,
`ai_unload_engine`, `ai_chat_send`, `ai_chat_cancel`,
`ai_get_action_log`, `ai_clear_action_log`, `ai_list_chats`,
`ai_get_chat`, `ai_save_chat`, `ai_delete_chat`,
`ai_delete_all_chats`, `ai_get_suggestion_corpus`.

---

## 17. Persistence & database

SQLite file `ripple.db` under the OS app data dir. Schema is
managed in `src-tauri/src/database/mod.rs` with **7 migrations**:

1. `create_initial_tables` — collections, requests, history, settings.
2. `add_default_values_to_text_columns` — backfill NULLs.
3. `create_collection_variables_table`.
4. `add_sort_order_and_parent_id` — request ordering + collection
   folder nesting.
5. `add_request_description`.
6. `create_cookies_table`.
7. `create_chat_history` — chat sessions, chat messages, and the
   `idx_chat_messages_session` index.

Migrations are registered both through `tauri-plugin-sql`
(`get_migrations`) and applied directly via `rusqlite` at startup
(`initialize_database`) for the AI side of the app.

---

## 18. Updates / release channel

`src-tauri/src/lib.rs` supports **two update sources**, chosen at
build time via env vars:

- `UPDATE_SERVER=…` — point at a LAN/HTTP host serving a
  `latest.json` manifest.
- `UPDATE_TOKEN=…` — GitHub token for the private repo
  `moodysaroha/postboy`; the app fetches `latest.json` from the
  latest release via the GitHub API, then locally re-serves it so the
  Tauri updater can verify and download the installer.

On startup the app silently checks for a newer version and emits
`update-available`; the user can trigger `perform_update` to download
and install (with `update-status` events for the UI).

Built on `tauri-plugin-updater` + `tauri-plugin-process` for the
restart hand-off.

---

## 19. Window / shell behavior

- **Splashscreen window** (inline `splashscreen.html`, 500×400,
  centered, undecorated, always-on-top, skipped from taskbar) shown
  while the database initializes; closed once the main window mounts.
- `tauri-plugin-opener` lets the app open external links and files.
- `tauri-plugin-shell` is available for shell invocations.
- `tauri-plugin-dialog` powers all save/open file dialogs.
- `tauri-plugin-fs` + Rust `std::fs` for binary uploads and exports.
- DevTools enabled in production (Cargo `devtools` feature) →
  `Ctrl+Shift+I` works in shipped builds.

---

## 20. Keyboard shortcut catalog

(From `KeyboardShortcuts.svelte` — searchable in-app via `Ctrl+/`.)

**Actions**
- `Enter` (URL field) — send request
- `Ctrl+Enter` — send request (anywhere)
- `Ctrl+S` — save request
- `Ctrl+M` — open method dropdown

**Navigation**
- `Ctrl+T` / `Ctrl+W` — new / close tab
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — next / previous tab
- `Ctrl+I` — focus & select URL input
- `Ctrl+H` / `Ctrl+B` / `Ctrl+P` / `Ctrl+Shift+A` — Headers / Body /
  Params / Auth tabs
- `Ctrl+D` — Docs tab; `Ctrl+Shift+D` — toggle Docs edit/preview
- `Ctrl+Shift+C` / `Ctrl+Shift+H` — Collections / History sidebar

**Body type (within 2 s of `Ctrl+B`)**
- `J` JSON · `X` XML · `Y` YAML · `H` HTML · `T` Text
- `F` Form Data · `U` Form URL Encoded · `I` Binary · `G` GraphQL · `N` None

**Response tabs**
- `Ctrl+F` — search picker (Collections / History / Response)
- `Alt+1` Preview · `Alt+2` Headers · `Alt+3` Console · `Alt+4` Diff
- `Alt+T` Tree · `Alt+R` Raw · `Alt+G` Graph

**Graph view**
- `Ctrl+=` zoom in · `Ctrl+-` zoom out · `Ctrl+0` fit · `Esc` close · trackpad pinch

**WebSocket**
- `Ctrl+Enter` connect/disconnect · `Enter` send · `Ctrl+L` clear

**SSE**
- `Ctrl+Enter` connect/disconnect · `Ctrl+L` clear

**Tools**
- `Ctrl+Shift+M` Son of Anton · `Ctrl+Shift+Enter` toggle Tools fullscreen
- `Ctrl+Shift+J` JWT Decoder
- `Ctrl+Shift+E` Encode/Decode (sub: `Ctrl+D` toggle direction, `Ctrl+M` toggle mode)
- `Ctrl+Shift+X` Cookie Jar
- `Ctrl+Shift+N` Network Diagnostics
- `Ctrl+Shift+B` Diff Tool (sub: `Alt+N`/`Alt+P` next/prev change, `Ctrl+J` format JSON)
- `Ctrl+Shift+F` format body · `Ctrl+Shift+K` copy as cURL ·
  `Ctrl+Shift+G` generate code · `Ctrl+Shift+S` HTML snapshot ·
  `Ctrl+Shift+O` import OpenAPI / Swagger

**General**
- `Ctrl+,` Settings · `Ctrl+/` shortcut panel
- `Ctrl+Shift+[` / `Ctrl+Shift+]` collapse panels
- `Ctrl+Shift+L` toggle response panel position
- `Escape` close panel / modal

---

## 21. Testing & quality

- **Vitest 4** with v8 coverage and a UI runner.
- `@testing-library/svelte` for component tests.
- **`better-sqlite3` in-memory** instances back the database tests so
  no real `ripple.db` is touched.
- Playwright is installed (browser automation/integration scaffold).
- Existing test suites live under `src/lib/test/` and `src/lib/utils/*.test.ts`
  (collection import, variable store, cookie store, chain runner,
  app state, database schema, Tauri command wrappers, UI components,
  etc.).
- `BUILDING.md` and `HOW_TO_RUN_TESTS.md` cover the dev workflow.

---

## 22. Build & feature flags

- **Default build** (`yarn tauri dev` / `yarn tauri build`) compiles
  with `--features chatbot` and ships the LLM stack.
- **Slim build** with `--no-default-features` (`cargo build` in
  `src-tauri/`) removes the `ai` module entirely; the UI hides every
  chatbot affordance based on the `ai_supported` probe — useful when
  packaging a smaller distributable that does not need llama.cpp.
- Update channel is wired at compile time via `UPDATE_SERVER` or
  `UPDATE_TOKEN` env vars (see §18).

---

## 23. Cross-reference: where each feature lives

| Feature | Primary frontend file(s) | Primary backend file(s) |
| --- | --- | --- |
| HTTP requests | `RequestBuilder.svelte`, `ResponsePanel.svelte` | `http_client.rs` |
| Tabs / persistence | `tabStore.ts`, `uiStore.ts` | `database/mod.rs` (settings) |
| Collections / requests / history | `CollectionsSidebar.svelte`, `HistorySidebar.svelte` | `commands/mod.rs`, `database/mod.rs` |
| Variables | `variableStore.ts` | `db_*_variable` commands |
| Cookies | `CookieJarPanel.svelte`, `cookieStore.ts` | `db_*_cookie` commands |
| WebSocket | `WebSocketPanel.svelte`, `wsStore.ts` | `ws_client.rs` |
| SSE | `SsePanel.svelte`, `sseStore.ts` | `sse_client.rs` |
| SQL Runner | `SqlRunnerPanel.svelte` | `sql_client.rs` |
| Network diagnostics | `DiagnosticsPanel.svelte` | `net_client.rs` |
| JWT / Encode-decode | `JwtDecoderPanel.svelte`, `EncoderPanel.svelte`, `encodingUtils.ts` | — |
| Diff tool | `DiffTool.svelte`, `ResponseDiff.svelte`, `diffEngine.ts` | — |
| Request chains | `RequestChainPanel.svelte`, `chainRunner.ts` | reuses `http_client.rs` |
| Import / export | `collectionImporter.ts`, `openApiParser.ts`, `snapshotExporter.ts` | `db_*_import/export_*` commands |
| Code generation | `codeGenerator.ts`, `curlParser.ts` | — |
| LLM chatbot | `ChatbotPanel.svelte`, `chatbotStore.ts` | `ai/engine.rs`, `ai/tools.rs`, `ai/tool_parser.rs`, `ai/commands.rs`, `ai/model.rs` |
| Updates / splash / lifecycle | `+page.svelte` | `lib.rs` |

---

_Last updated: 2026-06-01. Generated by walking the repository so this
file reflects what the code actually does, not just what the README
remembers._
