# PostBoy

A fast, native desktop API client built with **Tauri 2**, **Rust**, and **SvelteKit**. All data stays local in **SQLite** — no accounts, no cloud, no telemetry.

![PostBoy](PostBoy/PostBoy/app-icon.png)

## Features

### Request Building
- **HTTP methods:** GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
- **Body types:** JSON, XML, YAML, HTML, plain text, form-data (text + file), x-www-form-urlencoded, GraphQL (query + variables), binary/file, none
- **Authentication:** Basic, Bearer token, API key (custom header + value)
- **cURL support:** Paste a cURL command into the URL field to auto-parse (including `-F` form fields and `$(base64 ...)` file patterns); copy any request as cURL
- **Variable interpolation:** Use `{{variableName}}` in URLs, params, headers, body, and auth fields — resolved at send time from collection variables
- **Auto-format body:** Pretty-print JSON, XML, and HTML with `Ctrl+Shift+F`
- **Unresolved variable warnings:** Logged to console before send if any `{{var}}` can't be resolved

### Collections & Variables
- **Search collections** — filter by collection name, request name, URL, or method (`Ctrl+F` when sidebar focused)
- Create, rename, and delete collections with nested requests
- **Collection-scoped variables** — key/value pairs persisted in SQLite, used for interpolation
- **Token refresh** — configure a saved request + JSON path-to-variable mappings per collection; run refresh to update variables automatically (supports form-urlencoded and JSON bodies, with auth)
- Save, update, and duplicate requests within collections
- **Import collections** from Postman v2.1, Insomnia v4, or PostBoy JSON (auto-detected) — preserves requests, folders, variables, and auth
- Export collections as PostBoy JSON or Postman v2.1 format

### Response Viewing
- **Preview modes:** Tree view (expandable JSON), Raw (CodeMirror with syntax highlighting), and **Graph** (interactive node graph via JSONCrack — fullscreen with zoom/pan)
- **Response headers** tab
- **Console** with timestamped app logs (info, warn, error, debug, system)
- **Response diff** — pin a previous response and compare line-by-line
- **Copy response** — full body or granular copy from tree view
- **Save to variable** — pick any JSON path from the response and save its value to a collection variable

### Code Generation
Generate request snippets in:
- JavaScript (fetch)
- Python (requests)
- Node.js (axios)
- C# (HttpClient)
- cURL

### SSE (Server-Sent Events)
- Connect to SSE endpoints with live event stream
- Auto-reconnect with configurable retry (up to 10 attempts)
- Event type badges, filter by event type, copy event data
- Last-Event-ID tracking for resumable streams

### Cookie Jar
- Auto-capture cookies from HTTP responses (`Set-Cookie` headers)
- Auto-inject matching cookies into outgoing requests
- Per-collection cookie storage persisted in SQLite
- Domain/path/secure matching per RFC 6265 basics
- Add, edit, delete, and clear cookies manually
- Expiry-aware filtering and visual indicators
- Access via `Ctrl+Shift+X` or Tools menu

### History
- Last 50 requests stored with full request + response metadata
- Search by URL, filter by method
- Click to restore into a new tab with the original response
- Single delete or clear all

### Tabs & Workspace
- Multiple request tabs with method-colored indicators
- Tab state persists across sessions (auto-save to SQLite)
- Resizable left sidebar, response panel (dock right or bottom)
- Collapsible sidebars with drag handles

### Auto-Updates
- In-app update detection via Tauri updater plugin
- Update banner with one-click install and relaunch
- Supports private GitHub release feeds with token auth

### Keyboard Shortcuts

**Actions**

| Shortcut | Action |
|----------|--------|
| `Enter` | Send request (in URL field) |
| `Ctrl+Enter` | Send request (anywhere) |
| `Ctrl+S` | Save request |
| `Ctrl+M` | Open request method dropdown |

**Navigation**

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close current tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+I` | Focus & select URL input |
| `Ctrl+H` | Headers tab |
| `Ctrl+D` | Docs tab |
| `Ctrl+Shift+D` | Toggle Docs edit / preview |
| `Ctrl+B` | Body tab |
| `Ctrl+P` | Params tab |
| `Ctrl+Shift+A` | Auth tab |
| `Ctrl+Shift+C` | Collections sidebar |
| `Ctrl+Shift+H` | History sidebar |
| `Ctrl+F` | Open search picker (Collections / History / Response) |

**Body Types** (press key within 2s of `Ctrl+B`)

| Key | Body Type |
|-----|-----------|
| `J` | JSON |
| `X` | XML |
| `Y` | YAML |
| `H` | HTML |
| `T` | Plain Text |
| `F` | Form Data |
| `U` | Form URL Encoded |
| `I` | Binary / File |
| `G` | GraphQL |
| `N` | No Body |

**Response Tabs**

| Shortcut | Action |
|----------|--------|
| `Alt+1` / `2` / `3` / `4` | Preview / Headers / Console / Diff |
| `Alt+T` / `R` / `G` | Tree / Raw / Graph view |

**Graph View**

| Shortcut | Action |
|----------|--------|
| `Ctrl+=` / `-` / `0` | Zoom in / out / fit |
| Two-finger pinch | Trackpad zoom |
| `Esc` | Close graph |

**WebSocket**

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Connect / Disconnect |
| `Enter` | Send message (in composer) |
| `Ctrl+L` | Clear messages |

**SSE (Server-Sent Events)**

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Connect / Disconnect |
| `Ctrl+L` | Clear events |

**Tools**

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+J` | JWT Decoder |
| `Ctrl+Shift+E` | Base64 / URL Encoder |
| `Ctrl+Shift+X` | Cookie Jar |
| `Ctrl+Shift+F` | Format body (JSON/XML/HTML) |
| `Ctrl+Shift+K` | Copy as cURL |
| `Ctrl+Shift+G` | Generate code snippet |
| `Ctrl+Shift+S` | Export as HTML snapshot |
| `Ctrl+Shift+O` | Import OpenAPI / Swagger spec |
| `Ctrl+Shift+Q` | SQL Query Runner |
| `Ctrl+Shift+B` | Diff Tool |

**Diff Tool**

| Shortcut | Action |
|----------|--------|
| `Alt+N` | Next difference |
| `Alt+P` | Previous difference |
| `Ctrl+J` | Toggle JSON format |
**General**

| Shortcut | Action |
|----------|--------|
| `Ctrl+,` | Settings |
| `Ctrl+/` | Toggle shortcuts panel |
| `Ctrl+Shift+[` | Collapse / expand collections panel |
| `Ctrl+Shift+]` | Collapse / expand response panel |
| `Ctrl+Shift+L` | Toggle response panel position |
| `Esc` | Close panel / modal |

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Yarn](https://yarnpkg.com/)
- [Rust](https://www.rust-lang.org/tools/install) stable (1.70+)
- **For the AI Chatbot feature only** (default-on, see [AI Chatbot](#ai-chatbot-optional)):
  - CMake 3.18+
  - A C/C++ toolchain — MSVC on Windows, Xcode CLT on macOS, build-essential on Linux

## Quick Start

```bash
git clone https://github.com/Ghost-xD/PostBoy.git
cd postboy/PostBoy/PostBoy

yarn install
yarn tauri dev
```

| Command | What it does |
|---------|--------------|
| `yarn tauri dev` | Desktop app with hot reload |
| `yarn dev` | Frontend only (Vite dev server) |
| `yarn tauri build` | Production build (MSI, NSIS, DMG, AppImage, deb) |
| `yarn tauri build -- --no-default-features` | Production build **without** the AI Chatbot (no CMake / C++ toolchain required) |
| `yarn test` | Run tests |
| `yarn test -- --coverage` | Run tests with coverage report |
| `yarn check` | Svelte type checking |

## AI Chatbot (optional)

PostBoy ships with an optional, fully-local AI chatbot that can list collections, run saved requests, summarize responses, and edit variables — all by calling the same code paths the UI uses. It runs entirely on your CPU via embedded [llama.cpp](https://github.com/ggml-org/llama.cpp) (no external binaries, no cloud, no telemetry).

### Enable / disable at build time

The chatbot is gated behind the `chatbot` Cargo feature, which is **on by default**.

```bash
# Full build (chatbot included — requires CMake + C/C++ compiler).
yarn tauri build

# Build without the chatbot — no CMake or native toolchain needed.
yarn tauri build -- --no-default-features
```

When built without the feature, the UI hides every chatbot entry point automatically (a single always-on Tauri command `ai_supported` reports the build flag to the frontend).

### Using the chatbot

1. Open with `Ctrl+Shift+I` (or **Tools → AI Chatbot**).
2. Switch to the **Models** tab → pick a model → **Download**.
   - Downloads try **Hugging Face** first, then **Kaggle** as a fallback.
   - Files land in `<app data>/ai/models/`. About 400 MB – 2.5 GB per model depending on size.
3. Click **Load** to load the model into RAM (first load is the slow one).
4. Switch back to **Chat** and ask things like:
   - *"List my collections"*
   - *"Run the `getUsers` request from My API"*
   - *"Why did my last request fail?"*

Tool calls are executed immediately (full autonomy) but every call is recorded in the **Action Log** tab for review. Toggle **Tools** off in the chat input row to make the model describe instead of act.

### Supported models (out of the box)

| Model | Size | Best for |
|-------|------|----------|
| Qwen 2.5 0.5B Instruct (Q4_K_M) | ~400 MB | Fastest. Good for short tool-only tasks on weak CPUs. |
| Qwen 2.5 1.5B Instruct (Q4_K_M) | ~1.0 GB | Recommended default — strong tool-calling, runs fast on most laptops. |
| Phi 3.5 Mini Instruct (Q4_K_M) | ~2.4 GB | Best reasoning of the three; slower. |

Adding a new model is a JSON entry away — edit [`PostBoy/PostBoy/src-tauri/resources/models.json`](PostBoy/PostBoy/src-tauri/resources/models.json) with the GGUF download URLs.

## Deploy (Self-Hosted Update Server)

Two-step process — build first, then push to server.

```bash
# Step 1: Build
node deploy.mjs build                # bump patch (0.0.19 → 0.0.20), build, stage to deploy/
node deploy.mjs build --bump=minor   # bump minor (0.0.19 → 0.1.0)
node deploy.mjs build --bump=major   # bump major (0.0.19 → 1.0.0)

# Step 2: Push
node deploy.mjs push                 # SCP deploy/ folder to update server
node deploy.mjs push --dry-run       # show what would be pushed without uploading
```

`build` bumps the version in `tauri.conf.json`, compiles the app, generates `latest.json`, and stages everything into `deploy/`. `push` verifies that the version in `tauri.conf.json`, `latest.json`, and the artifact filenames all match, then SCPs to the update server. Existing users get the update on next app launch.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | SvelteKit, TypeScript, CodeMirror 6 |
| Backend | Rust, Tauri 2, reqwest |
| Build | Vite, Cargo |

## Repository Layout

```
postboy/
├── .github/workflows/    # CI/CD release pipeline
└── PostBoy/PostBoy/
    ├── src/
    │   ├── routes/        # SvelteKit pages (+page.svelte)
    │   └── lib/
    │       ├── components/ # UI components
    │       ├── stores/     # Svelte stores (tabs, UI, variables, console)
    │       ├── utils/      # cURL parser, code generator, helpers
    │       └── test/       # Vitest unit tests
    ├── src-tauri/
    │   ├── src/            # Rust backend (HTTP client, DB commands, updater)
    │   └── migrations/     # SQLite schema migrations
    └── static/             # Icons, splash screen, favicon
```

## Roadmap

### Protocol & Connectivity
- ✅ **WebSocket support** — Connect, send/receive messages, view message history in real-time - pending testing
- ⬜ **gRPC support** — Import `.proto` files, call unary and streaming RPCs, view typed request/response
- ✅ **Server-Sent Events (SSE)** — Listen to SSE endpoints with live message stream and auto-reconnect
- ⬜ **Proxy & certificate management** — HTTP/SOCKS proxy per request or global; client certificates (mTLS) for secure endpoints
- ✅ **Cookie jar** — Persist, view, and manage cookies across requests within a collection
- ✅ **DNS & connectivity diagnostics** — Resolve hostname, show IP, check port, trace route to debug reachability issues
- ✅ **Beyond Compare-style diff tool** — Side-by-side text/JSON/{any code file} comparison with inline highlighting, character-level diffs, minimap navigator, bidirectional block transfer, and editable panels *(to be enhanced further)*

### Workflow & Productivity
- ⬜ **Environment switcher** — Dev / Staging / Prod environments with variable overrides, quick toggle from toolbar
- ⬜ **Pre-request & post-request scripts** — JavaScript snippets that run before/after each request (set variables, assertions, conditional logic)
- ✅ **Request chaining** — Run a sequence of requests in order, passing data between them with JSON path variable extraction; chain builder UI in Collections sidebar
- ⬜ **Collection runner** — Execute all requests in a collection sequentially or in parallel with summary report and timing
- ⬜ **Request replay with mutations** — Replay a failed request with tweaked headers/body/params in one click
- ⬜ **Bulk parameterized requests** — Run the same request with a CSV/JSON of parameters (e.g., test 100 user IDs), show results in a table with pass/fail
- ⬜ **Scheduled / cron requests** — Fire a request every N seconds/minutes and log results; useful for polling, health checks, watching for state changes
- ⬜ **Response body transformations** — JQ/JSONPath expressions to extract and reshape response data inline
- ⬜ **Request comparison** — Diff two requests side by side (different envs, different params) to spot what changed

### Auth & Security
- ⬜ **OAuth 2.0 flow** — Authorization code, client credentials, PKCE with built-in token management and refresh
- ✅ **JWT decoder** — Click any Bearer token or response field to decode JWT payload, show expiry, issuer, claims inline
- ✅ **Base64 / URL encode-decode** — Built-in utility panel for common encoding tasks
- ⬜ **Certificate & TLS inspector** — Show the full cert chain, expiry dates, protocol version, cipher suite for any endpoint

### Contract & Validation
- ⬜ **API testing & assertions** — Define pass/fail assertions on status, headers, body, and response time; batch run with test report
- ⬜ **Request body schema validation** — JSON Schema validation with inline error highlighting
- ✅ **OpenAPI schema import** — Import Swagger/OpenAPI spec and auto-generate request templates for every endpoint
- ⬜ **Response contract validation** — Validate responses against an OpenAPI schema or JSON Schema; flag extra fields, missing required fields, wrong types
- ⬜ **Breaking change detection** — Compare current response schema against a saved baseline, highlight added/removed/changed fields

### Debugging & Observability
- ⬜ **Response time profiling** — Track response times for the same endpoint over multiple calls, show trend line and P50/P95/P99
- ⬜ **Header inspector with warnings** — Flag missing CORS headers, incorrect content-type, missing cache-control, security headers with suggestions
- ⬜ **Response analytics** — Charts showing response times, status codes, and payload sizes over history
- ⬜ **Load testing** — Configurable concurrent requests with response time distribution charts and error rate tracking

### Data & Database
- ✅ **SQL query runner** — Connect to Postgres/MySQL/SQLite directly from PostBoy, run queries, view results in a table
- ⬜ **Response-to-DB diff** — Compare an API response against a direct DB query to catch serialization bugs, missing fields, or stale cache

### Import, Export & Collaboration
- ✅ **Postman / Insomnia import** — Full import of Postman v2.1 and Insomnia v4 collections with requests, variables, and auth (auto-detected from file)
- ⬜ **API documentation generator** — Generate OpenAPI / Swagger spec from saved requests in a collection
- ✅ **Shareable request snapshots** — Export a single request + response as a self-contained HTML file for sharing
- ⬜ **Request annotations** — Add notes, tags, and comments to requests for team context
- ⬜ **Collaborative sharing** — Export collection as shareable link or encrypted file

### Editor & UX
- ✅ **Large response handling** — Pagination/virtualization for huge JSON responses
- ✅ **Response body type detection** — Preview images, PDFs, and other binary response types
- ✅ **File upload for binary/form-data** — Native file picker for binary body and form-data file fields
- ✅ **Response search** — `Ctrl+F` to search within response body with highlighting
- ⬜ **GraphQL schema introspection** — Auto-complete for GraphQL queries from endpoint schema
- ✅ **Request documentation** — Markdown notes and descriptions per request and collection
- ✅ **Settings panel** — Proxy configuration, request timeout, SSL & redirect preferences
- ⬜ **Mock server** — Serve mock responses locally for frontend development
- ⬜ **Plugin system** — Extend PostBoy with user scripts and community plugins

## Contributing

Issues and pull requests are welcome.

## License

MIT
