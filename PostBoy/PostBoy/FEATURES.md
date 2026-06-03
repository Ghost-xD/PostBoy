# Ripple — Product Feature Sheet

> A plain-English inventory of every customer-facing feature in Ripple, with
> a delivery status against each.
>
> **App version:** `0.0.16`
> **Edition:** Ripple — Tauri 2.0 Edition
> **Document type:** Business / product overview (paired with `TECH_SHEET.md` for engineering detail)
> **Last updated:** 2026-06-01

## Legend

| Status | Meaning |
| --- | --- |
| **Done** | Shipped, in the default build, exercised by users. |
| **WIP** | Built and usable, but iteration or polish still expected. |
| **Optional** | Done and shipping, but can be excluded at build time via a feature flag (used to ship a slimmer distributable). |
| **Pending** | Identified, scoped, not yet started or not yet released. |

---

## 1. Product positioning

Ripple is a desktop API workbench. In a single application a developer can:

1. Compose and send HTTP requests (REST, GraphQL, file uploads).
2. Work with real-time protocols (WebSocket, Server-Sent Events).
3. Run SQL against PostgreSQL, MySQL, and SQLite.
4. Triage responses with built-in tools (JSON tree, graph view, diff, JWT decoder, encode/decode, network diagnostics, snapshots).
5. Manage saved requests, collections, environments, cookies, and history — all stored locally in a single SQLite file.
6. *Optionally* drive the entire app by chatting with an on-device LLM ("Son of Anton") that runs offline, with no cloud calls.

The product is **local-first**: no account, no sync server, no telemetry pipeline. Distribution is a self-hosted updater or a private GitHub release channel.

---

## 2. Master feature inventory

### 2.1 HTTP client

| # | Feature | Status |
| --- | --- | --- |
| 1 | Send GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD requests | Done |
| 2 | URL bar with auto-send on Enter | Done |
| 3 | Method picker dropdown (`Ctrl+M`) | Done |
| 4 | Paste-a-cURL parser (`curl …` line auto-fills method, URL, headers, body) | Done |
| 5 | Query parameter editor with per-row enable/disable | Done |
| 6 | Header editor with per-row enable/disable | Done |
| 7 | `{{variable}}` interpolation for URL, headers, params, body, auth | Done |
| 8 | JSON request body (with auto-format `Ctrl+Shift+F`) | Done |
| 9 | XML request body (with auto-format) | Done |
| 10 | YAML request body | Done |
| 11 | HTML request body (with auto-format) | Done |
| 12 | JavaScript request body | Done |
| 13 | Plain-text request body | Done |
| 14 | Form Data (`multipart/form-data`) — text and file fields, OS file picker | Done |
| 15 | Form URL-encoded body | Done |
| 16 | GraphQL body (separate `query` and `variables` editors) | Done |
| 17 | Binary / single-file upload streamed from disk | Done |
| 18 | "No body" mode | Done |
| 19 | No Auth, Basic Auth, Bearer Token, API Key (in header or query) | Done |
| 20 | Configurable request timeout (1–300 s) | Done |
| 21 | Follow-redirects toggle + max-redirects cap (1–50) | Done |
| 22 | SSL certificate verification toggle (accept self-signed) | Done |
| 23 | HTTP/HTTPS proxy support (toggle + URL) | Done |

### 2.2 Response viewer

| # | Feature | Status |
| --- | --- | --- |
| 24 | Status bar: status code, status text, response time, byte size, timestamp | Done |
| 25 | Preview tabs: Preview / Headers / Console / Diff | Done |
| 26 | Raw preview mode | Done |
| 27 | Tree preview mode (custom JSON tree viewer) | Done |
| 28 | Graph preview mode (interactive JSON graph with pan/zoom shortcuts) | Done |
| 29 | Binary preview (images, audio, video, PDF, fonts, zip, gzip, wasm, protobuf, octet-stream, vendor MIME) | Done |
| 30 | Large-response truncation with "show full" toggle | Done |
| 31 | In-response search bar with next/previous match (`Ctrl+F`) | Done |
| 32 | Side-by-side response diff (current vs. saved comparison) | Done |
| 33 | Console log of request/response events, errors, system messages | Done |
| 34 | Export response as standalone HTML snapshot (`Ctrl+Shift+S`) | Done |
| 35 | Copy response to clipboard | Done |
| 36 | Download response to file | Done |
| 37 | Copy request as cURL (`Ctrl+Shift+K`) | Done |
| 38 | Generate request code in `fetch`, `axios`, Python `requests`, C# `HttpClient`, cURL (`Ctrl+Shift+G`) | Done |

### 2.3 Tabs & workspace

| # | Feature | Status |
| --- | --- | --- |
| 39 | Unlimited tabs, each with its own request, response, body, WS/SSE state | Done |
| 40 | New tab (`Ctrl+T`), close tab (`Ctrl+W`), cycle tabs (`Ctrl+Tab` / `Ctrl+Shift+Tab`) | Done |
| 41 | Tabs and full UI state auto-saved and restored on restart | Done |
| 42 | Per-tab Markdown "Docs" editor (`Ctrl+D`) with edit/preview toggle (`Ctrl+Shift+D`) | Done |
| 43 | Drag-to-resize for left sidebar, right sidebar, and bottom response panel | Done |
| 44 | Collapsible sidebars (`Ctrl+Shift+[` / `Ctrl+Shift+]`) | Done |
| 45 | Response panel position toggle: bottom ↔ right (`Ctrl+Shift+L`) | Done |
| 46 | Tools panel with its own fullscreen mode | Done |
| 47 | Unified search picker (`Ctrl+F`) that jumps to Collections, History, or response search | Done |
| 48 | Dark theme | Done |
| 49 | Light theme | **Pending** *(called out in README and tech sheet as a known roadmap item)* |

### 2.4 Collections, requests, history, variables

| # | Feature | Status |
| --- | --- | --- |
| 50 | Nested / hierarchical collections (folders inside folders) | Done |
| 51 | Create, rename, delete, reorder, move collections | Done |
| 52 | Per-collection variables (`key + value`, scoped, interpolated at send-time) | Done |
| 53 | Per-collection cookie jar (see §2.7) | Done |
| 54 | Save a request to a collection (method, URL, headers, params, body, auth, description, sort order) | Done |
| 55 | Reorder requests inside a collection (manual sort) | Done |
| 56 | Move a request to another collection | Done |
| 57 | Rename, delete a saved request | Done |
| 58 | Full request history with method, URL, status code, response time, payload, response headers + truncated body, timestamp | Done |
| 59 | "Load from history" rehydrates a tab; clear single entry or clear all | Done |
| 60 | "Extract from response" modal — pick a JSON path from the last response and store it directly as a collection variable | Done |
| 61 | Unresolved-variable warnings; variable count helpers | Done |

### 2.5 Import / Export

| # | Feature | Status |
| --- | --- | --- |
| 62 | Import Postman v2.1 collections | Done |
| 63 | Import Insomnia v4 export bundles | Done |
| 64 | Re-import Ripple native exports | Done |
| 65 | Import OpenAPI 2.0 / Swagger and OpenAPI 3.x specs (each operation becomes a saved request) — `Ctrl+Shift+O` | Done |
| 66 | Export all collections to JSON | Done |
| 67 | Export a single collection to JSON | Done |
| 68 | Export response as standalone HTML snapshot | Done |

### 2.6 Request Chains (multi-step workflows)

| # | Feature | Status |
| --- | --- | --- |
| 69 | Build a chain of saved requests as ordered steps | Done |
| 70 | Per-step JSON-path extractions that write values into collection variables | Done |
| 71 | Auto-suggested variable names from extracted paths | Done |
| 72 | Run a single step or the entire chain | Done |
| 73 | Per-step status (pending / running / success / error / skipped), HTTP status, URL, extracted values | Done |
| 74 | Later steps see variables set by earlier steps | Done |

### 2.7 Real-time protocols

| # | Feature | Status |
| --- | --- | --- |
| 75 | WebSocket: connect/disconnect from the URL bar (`Ctrl+Enter`) | Done |
| 76 | WebSocket: send text or binary frames; per-tab message log with sent/received counts | Done |
| 77 | WebSocket: optional custom headers on connect | Done |
| 78 | WebSocket: auto-scroll log, clear messages (`Ctrl+L`) | Done |
| 79 | SSE: persistent connection with auto-reconnect (connecting / connected / reconnecting / disconnected / error) | Done |
| 80 | SSE: filter log by event type (event types auto-derived from received messages) | Done |
| 81 | SSE: optional custom headers; clear events (`Ctrl+L`) | Done |

### 2.8 SQL Runner

| # | Feature | Status |
| --- | --- | --- |
| 82 | Connect to PostgreSQL, MySQL, SQLite with saved connection profiles | Done |
| 83 | Run any SQL statement; SELECT returns columns + typed rows + row count + execution time | Done |
| 84 | DML returns affected-rows count | Done |
| 85 | Query history with timestamp, execution time, row count, and per-entry error | Done |
| 86 | Disconnect on demand; pooled connections managed in the Rust backend | Done |

### 2.9 Cookie Jar

| # | Feature | Status |
| --- | --- | --- |
| 87 | Per-collection cookie storage | Done |
| 88 | Cookie fields: domain, path, name, value, expires, `secure`, `http_only`, `same_site` (Lax / Strict / None) | Done |
| 89 | Bulk import from response `Set-Cookie` headers | Done |
| 90 | View, filter, edit, delete individual cookies | Done |
| 91 | Clear all cookies in a collection; clear cookies globally | Done |
| 92 | Expiry-aware (`isExpired`, `getCookiesForUrl`) | Done |

### 2.10 Network Diagnostics

| # | Feature | Status |
| --- | --- | --- |
| 93 | DNS resolve (all addresses + lookup duration) | Done |
| 94 | Port check (TCP open/closed with duration & error) | Done |
| 95 | Ping (resolved IP, reachable yes/no, latency in ms) | Done |
| 96 | Trace route (hop list with IP, hostname, latency, timed-out flag) | Done |

### 2.11 Diff / Compare Tool

| # | Feature | Status |
| --- | --- | --- |
| 97 | Standalone side-by-side diff editor (`Ctrl+Shift+B`) with its own fullscreen | Done |
| 98 | Side-by-side line diff (adds / removes / modifications) | Done |
| 99 | Configurable context lines, "show only changes" mode | Done |
| 100 | Word-wrap toggle, ignore-whitespace toggle, format-JSON toggle (`Ctrl+J`) | Done |
| 101 | Per-line inline character diff | Done |
| 102 | Next/previous change navigation (`Alt+N` / `Alt+P`) | Done |
| 103 | Customisable left/right labels, per-side copy | Done |
| 104 | Send a response into the diff tool as either side | Done |

### 2.12 JWT Decoder

| # | Feature | Status |
| --- | --- | --- |
| 105 | Paste JWT (with or without `Bearer` prefix) — decode header / payload / signature | Done |
| 106 | Validity errors ("Invalid JWT: expected 3 parts…", etc.) | Done |
| 107 | Expiry computation: absolute date, `isExpired`, human "expires in" string | Done |
| 108 | Copy header / payload / signature | Done |
| 109 | Opens with `Ctrl+Shift+J` | Done |

### 2.13 Encode / Decode panel

| # | Feature | Status |
| --- | --- | --- |
| 110 | Base64 encode / decode | Done |
| 111 | URL encode / decode | Done |
| 112 | Reactive — output updates as you type; inline errors | Done |
| 113 | Swap input/output, copy output | Done |
| 114 | `Ctrl+D` toggle encode↔decode, `Ctrl+M` toggle base64↔URL | Done |
| 115 | Opens with `Ctrl+Shift+E` | Done |

### 2.14 Settings

| # | Feature | Status |
| --- | --- | --- |
| 116 | Request timeout setting (1–300 s, default 30 s) | Done |
| 117 | Follow-redirects toggle + max-redirects cap | Done |
| 118 | SSL verification toggle | Done |
| 119 | Proxy enable/disable + proxy URL | Done |
| 120 | Reset-to-defaults with "Saved" indicator | Done |
| 121 | Opens with `Ctrl+,` | Done |

### 2.15 Son of Anton — local LLM chatbot

> Ships as an **Optional** feature: present in default builds, can be excluded with `--no-default-features` to produce a smaller distributable that removes the LLM stack entirely. The UI hides every chatbot affordance when the feature is absent.

| # | Feature | Status |
| --- | --- | --- |
| 122 | On-device LLM inference (no cloud round-trips) | Optional (Done in default build) |
| 123 | Curated downloadable model catalog (Hermes 3 Llama 3.1 8B, Qwen 2.5 7B, Qwen 2.5 Coder 7B, Phi 3.5 Mini — all Q4_K_M GGUF) | Optional (Done) |
| 124 | Model download with progress, pause, resume, cancel, delete | Optional (Done) |
| 125 | GPU acceleration when the build supports it; clean CPU fallback otherwise | Optional (Done) |
| 126 | Streaming token output with Stop / Cancel button | Optional (Done) |
| 127 | Tool-calling: `list_collections`, `list_requests`, `inspect_request`, `get_request`, `run_request`, `get_variables`, `set_variable`, `get_history`, `get_last_response` (9 tools) | Optional (Done) |
| 128 | Grammar-constrained tool-call generation (well-formed JSON guaranteed once `<tool_call>` is emitted) | Optional (Done) |
| 129 | Resolves saved requests by name first (with global fallback) so the model can use the names users actually see | Optional (Done) |
| 130 | Tool response bodies truncated to 32 KB to protect context window | Optional (Done) |
| 131 | Chat panel sub-tabs: Chat / Action Log / History / Models | Optional (Done) |
| 132 | Action log records every tool call, argument bag, and result | Optional (Done) |
| 133 | Composer autocomplete ranked by past user phrases, saved request names with verbs, collection names, built-in starter templates | Optional (Done) |
| 134 | Persistent multi-chat history (save, load, delete, delete-all) | Optional (Done) |
| 135 | "New chat" / reset conversation | Optional (Done) |
| 136 | Suggestion corpus refreshed after each saved turn | Optional (Done) |
| 137 | `ai_supported` probe so the UI can hide everything when the feature is excluded at build time | Optional (Done) |
| 138 | README documentation of C++ build prerequisites (cmake, MSVC / clang) for the chatbot build | **Pending** *(known roadmap item from chatbot plan)* |

### 2.16 Persistence

| # | Feature | Status |
| --- | --- | --- |
| 139 | Single local SQLite database (`ripple.db`) under the OS app-data directory | Done |
| 140 | Schema migrations (collections, requests, history, settings, variables, sort order + folder nesting, request descriptions, cookies, chat history) | Done |
| 141 | Auto-restore of tabs, UI state, panel sizes, collapsed state across restarts | Done |

### 2.17 Updates & distribution

| # | Feature | Status |
| --- | --- | --- |
| 142 | Self-hosted update channel via a `latest.json` manifest on a LAN/HTTP host (`UPDATE_SERVER` build-time env var) | Done |
| 143 | Private GitHub release channel (`UPDATE_TOKEN` build-time env var) — fetches the latest release manifest via the GitHub API | Done |
| 144 | Silent startup update check; UI-triggered download and install with progress events | Done |
| 145 | Restart hand-off after install (Tauri process plugin) | Done |
| 146 | Default build with embedded LLM stack | Done |
| 147 | Slim build (`--no-default-features`) that removes the LLM stack entirely | Done |

### 2.18 Shell / window behavior

| # | Feature | Status |
| --- | --- | --- |
| 148 | Splashscreen window shown while the database initializes; closes once the main window mounts | Done |
| 149 | External link / file opener (`tauri-plugin-opener`) | Done |
| 150 | OS save/open file dialogs (`tauri-plugin-dialog`) | Done |
| 151 | File system access for binary uploads and exports (`tauri-plugin-fs`) | Done |
| 152 | DevTools enabled in production builds (`Ctrl+Shift+I`) | Done |
| 153 | Multi-window support (spawn additional main windows) | **Pending** *(not implemented; single main window today)* |

### 2.19 Keyboard shortcut catalog

| # | Feature | Status |
| --- | --- | --- |
| 154 | In-app shortcut panel, searchable (`Ctrl+/`) | Done |
| 155 | Send (Enter / `Ctrl+Enter`), Save (`Ctrl+S`), Method picker (`Ctrl+M`) | Done |
| 156 | Tab navigation, sidebar focus, Body/Headers/Params/Auth/Docs tab jumps | Done |
| 157 | Body-type quick-keys after `Ctrl+B` (J / X / Y / H / T / F / U / I / G / N) | Done |
| 158 | Response tab jumps (`Alt+1..4`, `Alt+T/R/G`) | Done |
| 159 | Graph view: zoom in/out/fit, close, trackpad pinch | Done |
| 160 | WebSocket / SSE shortcuts (connect, send, clear) | Done |
| 161 | Tool launchers: Son of Anton, JWT, Encode/Decode, Cookie Jar, Diagnostics, Diff Tool | Done |
| 162 | Format body, copy as cURL, generate code, HTML snapshot, OpenAPI import | Done |
| 163 | General: Settings, shortcut panel, sidebar collapse, response-panel toggle, Esc to close | Done |

### 2.20 Quality & testing infrastructure

| # | Feature | Status |
| --- | --- | --- |
| 164 | Vitest 4 unit/component tests with v8 coverage and UI runner | Done |
| 165 | In-memory SQLite (`better-sqlite3`) for database tests — never touches a real `ripple.db` | Done |
| 166 | `@testing-library/svelte` for component tests | Done |
| 167 | Playwright installed for browser automation / integration scaffold | Done |
| 168 | `BUILDING.md` and `HOW_TO_RUN_TESTS.md` cover the dev workflow | Done |

---

## 3. Status summary

| Status | Count | Examples |
| --- | --- | --- |
| **Done** | 150 | HTTP client, response viewer, collections, history, variables, cookies, WebSocket, SSE, SQL runner, diagnostics, diff tool, JWT decoder, encode/decode, import/export, request chains, persistence, updates |
| **Optional (Done in default build)** | 16 | Entire Son of Anton chatbot stack |
| **WIP** | 0 | — |
| **Pending** | 3 | Light theme · README docs for chatbot C++ build deps · Multi-window support |

## 4. Out of scope (explicitly not planned)

The following were considered and deliberately excluded from the current product:

- Cloud-hosted LLMs (the chatbot is local-only by design).
- RAG / retrieval over collections by the chatbot.
- Model fine-tuning inside the app.
- Multi-user / team-sync collaboration server.
- Telemetry, analytics, or any external "phone-home".
- Downloading any external executable at runtime (the LLM runs in-process via a statically linked library, so there is no separate binary and no SmartScreen prompt).

---

## 5. Companion documents

- `TECH_SHEET.md` — engineering-level feature sheet (file paths, Rust modules, Tauri commands, DB migrations).
- `README.md` — user-facing intro, install, shortcuts.
- `BUILDING.md` — how to build the default and slim editions.
- `HOW_TO_RUN_TESTS.md` — dev workflow for the test suite.
- `.cursor/plans/optional_ai_chatbot_plan_fef2167c.plan.md` — the original delivery plan for Son of Anton (almost entirely completed; one documentation item remains).
