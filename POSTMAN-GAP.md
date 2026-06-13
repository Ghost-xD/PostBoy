# Postman Features Missing in Ripple

> Gap analysis as of June 2026. Ripple is a **local-first desktop API client** (Tauri + SvelteKit). Postman is a **cloud-connected platform** with team workflows, hosted services, and a much broader integration surface.
>
> This document lists what **Postman has** that **Ripple does not** (or only partially covers). For what Ripple adds beyond Postman, see [Ripple advantages](#what-ripple-has-that-postman-does-not).

---

## Verified protocol support in Ripple (codebase audit)

This section was re-verified against the repo — not assumed from Postman docs.

| Protocol | In Ripple? | Where / how |
|----------|------------|-------------|
| **HTTP/REST** | ✅ Yes | `RequestBuilder.svelte`, `http_client.rs` — GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD |
| **GraphQL** | ⚠️ Partial | GraphQL **body type** (query + variables JSON). No schema introspection explorer. |
| **WebSocket** | ✅ Yes | Method **WS / WSS** in `MethodSelect.svelte` → `WebSocketPanel.svelte` → Rust `ws_client.rs` (`ws_connect`, `ws_send`, `ws_disconnect`). Text send, text + binary receive, custom headers, per-tab message log. |
| **SSE** | ✅ Yes | Method **SSE** in `MethodSelect.svelte` → `SsePanel.svelte` → Rust `sse_client.rs` (`sse_connect`, `sse_disconnect`). Auto-reconnect, `Last-Event-ID` resume, event-type filter, custom headers. |
| **gRPC** | ❌ No | No gRPC client, `.proto` import, or service/method UI. (`protobuf` appears only as a **binary response MIME** label, not a protocol client.) |
| **SOAP** | ❌ No | XML body type only — not a SOAP client. |
| **MQTT** | ❌ No | — |
| **Socket.IO** | ❌ No | — |

**How to use WebSocket / SSE in Ripple:** pick **WS**, **WSS**, or **SSE** from the method dropdown (same bar as GET/POST), enter the URL, optionally set headers on the Headers tab, then **Connect** (`Ctrl+Enter`). The request builder swaps to `WebSocketPanel` or `SsePanel` instead of the HTTP response panel.

**Tests:** `src/lib/test/websocket.test.ts`, `src/lib/test/sse.test.ts`

---

## Summary

| Category | Postman | Ripple |
|----------|---------|--------|
| Cloud & collaboration | Full platform | Local SQLite only |
| Environments | Named envs + switcher | Collection-scoped variables only |
| Auth types | 10+ including OAuth 2 | Basic, Bearer, API Key |
| Scripts & tests | JavaScript pre/post-request | None |
| Hosted services | Mocks, monitors, published docs | None |
| **Protocols (see verified table above)** | REST, GraphQL, **gRPC**, SOAP, WS, SSE, MQTT, Socket.IO | REST, GraphQL body, **WS, SSE** ✅ — **no gRPC** |
| CLI / CI | Newman, Postman CLI | None |
| Visual workflows | Flows (node editor) | Linear request chains |

---

## Cloud, Teams & Collaboration

| Feature | Postman | Ripple |
|---------|---------|--------|
| Postman Cloud account & sign-in | ✅ | ❌ No accounts |
| Cloud sync across devices | ✅ | ❌ Local `ripple.db` only |
| Shared workspaces (team / personal / public) | ✅ | ❌ |
| Real-time co-editing | ✅ | ❌ |
| Collection & environment sharing via link | ✅ | ❌ Manual JSON export/import |
| Fork & pull-request style collection updates | ✅ | ❌ |
| @mentions & comments on requests/collections | ✅ | ❌ |
| Activity feed & audit trail | ✅ | ❌ |
| Role-based access (Admin, Editor, Viewer) | ✅ | ❌ Single-user desktop |
| SSO / SAML (Enterprise) | ✅ | ❌ |
| SCIM user provisioning (Enterprise) | ✅ | ❌ |
| Private API Network / public workspace discovery | ✅ | ❌ |
| Partner Workspaces | ✅ | ❌ |

---

## Workspaces & Organization

| Feature | Postman | Ripple |
|---------|---------|--------|
| Multiple workspace types (Personal, Team, Partner, Public) | ✅ | ❌ Single local workspace |
| Workspace overview & analytics | ✅ | ❌ |
| Tags on requests/collections | ✅ | ❌ |
| Request examples (saved response snapshots per request) | ✅ | ❌ History only; no named examples |
| Collection-level versioning with changelog | ✅ | ❌ |
| Git integration (sync collections to GitHub/GitLab/Bitbucket) | ✅ | ❌ |
| Spec Hub / API definition as source of truth | ✅ | ❌ OpenAPI import only (one-way) |
| API Builder (design-first from spec) | ✅ | ❌ |
| Private API Network publishing | ✅ | ❌ |

---

## Environments & Variables

| Feature | Postman | Ripple |
|---------|---------|--------|
| **Global variables** | ✅ | ❌ |
| **Environment variables** (Dev / Staging / Prod profiles) | ✅ | ❌ |
| **Environment switcher** in UI | ✅ | ❌ |
| Collection variables | ✅ | ✅ |
| Variable scopes (global → env → collection → local) | ✅ | ⚠️ Collection only |
| Variable types (default / secret) | ✅ | ❌ All plain text in SQLite |
| Postman Vault (encrypted secrets, Enterprise) | ✅ | ❌ |
| Dynamic variables (`{{$randomInt}}`, `{{$timestamp}}`, etc.) | ✅ | ❌ |
| Persist variable values per environment on send | ✅ | ⚠️ Single collection var store |
| `{{variable}}` autocomplete | ✅ | ✅ (recent) |
| Initial / current value split for env vars | ✅ | ❌ |

---

## Authorization (Request Auth)

| Feature | Postman | Ripple |
|---------|---------|--------|
| No Auth | ✅ | ✅ |
| Basic Auth | ✅ | ✅ |
| Bearer Token | ✅ | ✅ |
| API Key (header / query) | ✅ | ✅ |
| **OAuth 2.0** (Authorization Code, PKCE, Client Credentials, Password, Implicit) | ✅ | ❌ OAuth exists only for **MCP servers**, not API requests |
| **OAuth 2.0 helper** (auto token refresh, auth URL flow in app) | ✅ | ❌ Token refresh via custom chain only |
| Digest Auth | ✅ | ❌ |
| Hawk Authentication | ✅ | ❌ |
| AWS Signature v4 | ✅ | ❌ |
| NTLM / Kerberos | ✅ | ❌ |
| **Mutual TLS / Client certificates** | ✅ | ❌ |
| Akamai EdgeGrid | ✅ | ❌ |
| ASAP (Atlassian) | ✅ | ❌ |
| Inherit auth from parent folder | ✅ | ❌ Per-request auth only |

---

## Request Building & Protocols

### Ripple already supports (not gaps)

| Feature | Postman | Ripple |
|---------|---------|--------|
| REST / HTTP | ✅ | ✅ |
| WebSocket (WS / WSS) | ✅ | ✅ First-class method + dedicated panel |
| Server-Sent Events (SSE) | ✅ | ✅ First-class method + dedicated panel |
| GraphQL request body | ✅ | ⚠️ Body type only (no schema explorer) |

### WebSocket & SSE — sub-feature gaps vs Postman

Ripple **has** WebSocket and SSE. These rows are **Postman extras** Ripple lacks or only partially matches:

| Feature | Postman | Ripple |
|---------|---------|--------|
| WebSocket connect / message log | ✅ | ✅ |
| WebSocket custom handshake headers | ✅ | ✅ |
| WebSocket send **binary** frames | ✅ | ❌ Send text only; binary **receive** shows byte count |
| WebSocket scripts (pre/post on messages) | ✅ | ❌ |
| WebSocket in Collection Runner | ✅ | ❌ |
| SSE connect / event log | ✅ | ✅ |
| SSE auto-reconnect | ✅ | ✅ With `Last-Event-ID` resume |
| SSE filter by event type | ✅ | ✅ |
| SSE custom headers | ✅ | ✅ |
| Save WS/SSE tab to collection | ✅ | ⚠️ Can save URL/method/headers; not full session replay |

### Protocols Ripple does not support

| Feature | Postman | Ripple |
|---------|---------|--------|
| **gRPC** (`.proto`, services, unary/streaming) | ✅ | ❌ **Not implemented** |
| **SOAP** (WSDL, SOAPAction) | ✅ | ❌ XML body only |
| **MQTT** | ✅ | ❌ |
| **Socket.IO** | ✅ | ❌ |
| GraphQL schema introspection UI | ✅ | ❌ |
| HTTP/2 & HTTP/3 explicit controls | ✅ | ⚠️ Follows system/Tauri defaults |
| Request duplication with examples | ✅ | ⚠️ Duplicate request in collection |
| Disable individual query params / headers (checkbox) | ✅ | ✅ |
| Bulk edit params/headers | ✅ | ❌ |
| Save request as template | ✅ | ⚠️ Header templates only |
| Postman Interceptor / Proxy (capture browser traffic) | ✅ | ❌ |
| Postman Proxy (capture device traffic) | ✅ | ❌ |
| Certificate management UI (CA + client certs) | ✅ | ❌ SSL verify toggle only |
| Protocol-specific settings per collection | ✅ | ⚠️ App-level settings only |

---

## Scripts, Tests & Assertions

| Feature | Postman | Ripple |
|---------|---------|--------|
| **Pre-request scripts** (JavaScript) | ✅ | ❌ |
| **Post-response / Tests scripts** (JavaScript) | ✅ | ❌ |
| **`pm.test()` assertion library** | ✅ | ❌ |
| **`pm.expect()` Chai-style assertions** | ✅ | ❌ |
| Test results tab per request | ✅ | ❌ |
| Snippets library (crypto, lodash, moment, etc.) | ✅ | ❌ |
| Visualizer (custom response preview via script) | ✅ | ❌ |
| Script-defined dynamic variables | ✅ | ❌ |
| Collection/folder-level pre-request & test scripts | ✅ | ❌ |
| Sandboxed Node.js for scripts | ✅ | ❌ |

---

## Collection Runner & Automation

| Feature | Postman | Ripple |
|---------|---------|--------|
| **Collection Runner** with iterations & data file | ✅ | ⚠️ **Request chains** (sequential, no JS tests) |
| Run folder / collection with delay between requests | ✅ | ⚠️ Chain runner only |
| Data-driven runs (CSV/JSON) in Runner | ✅ | ✅ Load Test Lab (separate UI) |
| Pass/fail summary from tests | ✅ | ❌ |
| Export run results | ✅ | ⚠️ Load test HTML report only |
| **Newman** (CLI collection runner) | ✅ | ❌ |
| **Postman CLI** (`postman collection run`) | ✅ | ❌ |
| CI/CD native integrations (GitHub Actions, Jenkins, etc.) | ✅ | ❌ |
| Scheduled collection runs | ✅ | ❌ |
| Collection run history with test analytics | ✅ | ❌ |

---

## Mock Servers

| Feature | Postman | Ripple |
|---------|---------|--------|
| Cloud mock server from collection | ✅ | ❌ |
| Mock matching rules (URL, method, headers, body) | ✅ | ❌ |
| Example-based mock responses | ✅ | ❌ |
| x-mock-response-id header routing | ✅ | ❌ |
| Local mock server | ✅ | ❌ |

---

## Monitors

| Feature | Postman | Ripple |
|---------|---------|--------|
| Scheduled monitor (cron) on cloud | ✅ | ❌ |
| Email / Slack / PagerDuty alerts on failure | ✅ | ❌ |
| Monitor run history & uptime metrics | ✅ | ❌ |
| Regional monitor execution | ✅ | ❌ |

---

## API Documentation

| Feature | Postman | Ripple |
|---------|---------|--------|
| **Publish public documentation** (hosted URL) | ✅ | ❌ |
| Auto-generated docs from collection | ✅ | ❌ |
| Custom domain for docs | ✅ | ❌ |
| Try-it-now on published docs | ✅ | ❌ |
| Documentation versioning | ✅ | ❌ |
| Per-request Markdown docs (private) | ✅ | ✅ Docs tab per request |
| OpenAPI export from collection | ✅ | ⚠️ Import OpenAPI only |
| Document sidebar navigation & search | ✅ | ❌ |

---

## Performance & Load Testing

| Feature | Postman | Ripple |
|---------|---------|--------|
| Postman Performance (cloud load tests) | ✅ | ⚠️ **Local Load Test Lab** (different product shape) |
| Performance test scenarios from collection | ✅ | ✅ Chain / per-endpoint modes |
| Cloud-distributed virtual users | ✅ | ❌ Local workers only |
| Performance test reports in Postman Cloud | ✅ | ✅ Local HTML export |

> Ripple’s load testing is **local and self-contained**, not Postman’s cloud Performance product. Feature parity is partial, not missing entirely.

---

## Integrations & Extensibility

| Feature | Postman | Ripple |
|---------|---------|--------|
| Integrations gallery (Slack, Jira, GitHub, etc.) | ✅ | ❌ |
| Webhooks on monitor/collection events | ✅ | ❌ |
| Postman API (manage collections programmatically in cloud) | ✅ | ❌ |
| Postman Flows (visual automation) | ✅ | ❌ Linear chains only |
| **Newman** npm package | ✅ | ❌ |
| VS Code extension | ✅ | ❌ |
| IDE plugins (IntelliJ, etc.) | ✅ | ❌ |
| **MCP server registry in chat** | ❌ | ✅ Ripple-specific |
| **On-device LLM with tool calls** | ⚠️ Postbot (cloud) | ✅ Optional local GGUF chatbot |

---

## Import / Export Gaps

| Feature | Postman | Ripple |
|---------|---------|--------|
| Export to OpenAPI 3 | ✅ | ❌ |
| Export to RAML / WSDL | ✅ | ❌ |
| Import from WSDL / RAML | ✅ | ❌ |
| Import from HAR | ✅ | ❌ |
| Import from cURL (single) | ✅ | ✅ |
| Import Postman Collection v2.1 | ✅ | ✅ |
| Import Insomnia v4 | ❌ | ✅ |
| Team export with environments | ✅ | ⚠️ Collection JSON; envs merged into vars on import |

---

## History & Debugging

| Feature | Postman | Ripple |
|---------|---------|--------|
| Request history | ✅ | ✅ |
| History search & filter by status/method | ✅ | ⚠️ Basic search |
| Console (shared across tabs) | ✅ | ✅ Per-request console tab |
| Network capture (Interceptor) | ✅ | ❌ |
| **Save response as example** on request | ✅ | ❌ |
| Response comparison | ✅ | ✅ Diff tool + response diff |

---

## UI & Platform

| Feature | Postman | Ripple |
|---------|---------|--------|
| Light theme | ✅ | ❌ Dark only |
| Multi-window | ✅ | ❌ Planned |
| Web app | ✅ | ❌ Desktop only (Tauri) |
| Mobile app (Postman mobile) | ✅ | ❌ |
| Customizable sidebar layout presets | ✅ | ⚠️ Drag-resize panels |
| Postman Agent (desktop helper for Interceptor) | ✅ | ❌ N/A |
| In-app onboarding & learning center | ✅ | ❌ |
| Postman Academy / templates marketplace | ✅ | ❌ |

---

## Enterprise & Governance

| Feature | Postman | Ripple |
|---------|---------|--------|
| Domain capture & team discovery | ✅ | ❌ |
| API security warnings (PII, secrets in collection) | ✅ | ❌ |
| Secret Scanner | ✅ | ❌ |
| Custom roles & permissions | ✅ | ❌ |
| SAML SSO | ✅ | ❌ |
| Audit logs (Enterprise) | ✅ | ❌ |
| On-premises Postman (Enterprise) | ✅ | N/A — Ripple is local-by-design |
| Usage & billing analytics | ✅ | ❌ |
| Service account tokens | ✅ | ❌ |

---

## AI Assistants

| Feature | Postman | Ripple |
|---------|---------|--------|
| Postbot (cloud AI in editor) | ✅ | ❌ |
| AI-generated tests from response | ✅ | ❌ |
| AI-generated documentation | ✅ | ❌ |
| Natural language → request (cloud) | ✅ | ⚠️ Local chatbot with tool calls |
| AI load-test plan drafting | ❌ | ✅ Local LLM (optional) |

---

## What Ripple Has That Postman Does Not

These are **not** Postman gaps — listed for context so this file isn’t one-sided:

- Fully offline, no account required
- Native Tauri/Rust desktop with local SQLite
- **WebSocket (WS/WSS) and SSE as first-class methods** — not bolted on; Rust backends (`ws_client.rs`, `sse_client.rs`), dedicated panels, keyboard shortcuts
- Built-in **SQL client** (PostgreSQL, MySQL, SQLite)
- **Network diagnostics** (DNS, ping, traceroute, port check)
- **JWT decoder** and encode/decode utilities
- **Standalone diff tool**
- **Cookie jar** with auto inject/capture per collection
- **Local load test lab** with probe + AI analysis
- **On-device LLM** (GGUF) with request/collection tools
- **MCP server integration** in chat
- **No telemetry** by design
- Self-hosted app updater

---

## Suggested Priority (If Closing Gaps)

If the goal is “Postman parity for daily API work” without becoming a cloud platform:

1. **Environments** — named profiles + switcher (highest daily-use impact)
2. **OAuth 2.0** for API auth (Authorization Code + Client Credentials)
3. **Pre-request / test scripts** — even a limited sandbox would unlock Collection Runner parity
4. **Client certificates** — common in enterprise APIs
5. **Request examples** — save response snapshots on the request
6. **OpenAPI export** — round-trip with import
7. **Newman-style CLI** — for CI pipelines
8. **Light theme** — polish

Lower priority unless targeting teams: cloud sync, mocks, monitors, published docs, Flows, Enterprise SSO.

---

*Last verified against Ripple codebase: June 2026 (`MethodSelect.svelte`, `WebSocketPanel.svelte`, `SsePanel.svelte`, `ws_client.rs`, `sse_client.rs`, `RequestBuilder.svelte`). Update this file when major features ship.*
