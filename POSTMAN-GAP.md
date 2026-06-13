# Postman Features Missing in Ripple

> Gap analysis as of June 2026. Ripple is a **local-first desktop API client** (Tauri + SvelteKit).
>
> This document lists **only what Postman has that Ripple lacks or partially covers**. Fully implemented features are omitted. For Ripple-only capabilities, see [Ripple advantages](#what-ripple-has-that-postman-does-not).
>
> **Out of scope:** cloud sync, hosted mocks, monitors, published documentation, Postman Flows, and Enterprise SSO.

---

## Summary of remaining gaps

| Area | Still missing or partial |
|------|--------------------------|
| Environments | No global/env profiles or switcher — collection variables only |
| Auth | Akamai EdgeGrid, ASAP, inherit-from-folder |
| Protocols | GraphQL introspection UI; gRPC streaming & `.proto` import; SOAP, MQTT, Socket.IO |
| Scripts | No `pm.sendRequest`, cookies, crypto libs; not persisted; no collection/folder scripts |
| Organization | Tags, examples, versioning, Git sync, API Builder |
| Automation | Newman/CLI, CI integrations, scheduled runs, test pass/fail dashboard |
| Import/export | No OpenAPI/HAR/WSDL/RAML export; no HAR/WSDL/RAML import |
| UI | Light theme, multi-window, web/mobile clients |

---

## Protocols

| Feature | Status |
|---------|--------|
| GraphQL schema introspection UI | ❌ Body type only today |
| gRPC streaming (client / server / bidi) | ❌ Unary + reflection only |
| gRPC `.proto` import / schema UI | ❌ |
| Save gRPC service & method to collection | ❌ Tab session only |
| SOAP (WSDL, SOAPAction) | ❌ |
| MQTT | ❌ |
| Socket.IO | ❌ |

### WebSocket & SSE (partial — core connect works)

| Feature | Status |
|---------|--------|
| WebSocket send binary frames | ❌ Text send; binary receive only |
| WebSocket scripts | ❌ |
| WebSocket in collection chains | ❌ |
| Full WS/SSE session save to collection | ⚠️ URL, method, headers only |

### Request building (other gaps)

| Feature | Status |
|---------|--------|
| Bulk edit params / headers | ❌ |
| Postman Interceptor / traffic capture | ❌ |
| CA certificate store UI | ⚠️ SSL verify toggle + client cert file paths only |

---

## Workspaces & Organization

| Feature | Status |
|---------|--------|
| Tags on requests / collections | ❌ |
| Request examples (named response snapshots) | ❌ |
| Collection versioning with changelog | ❌ |
| Git integration | ❌ |
| Spec Hub / design-first API Builder | ❌ OpenAPI import only (one-way) |

---

## Environments & Variables

| Feature | Status |
|---------|--------|
| Global variables | ❌ |
| Environment variables (Dev / Staging / Prod) | ❌ |
| Environment switcher | ❌ |
| Variable scopes beyond collection | ❌ |
| Secret variable type | ❌ Plain text in SQLite |
| Dynamic variables (`{{$randomInt}}`, etc.) | ❌ |
| Initial / current value split | ❌ |

---

## Authorization

| Feature | Status |
|---------|--------|
| Akamai EdgeGrid | ❌ |
| ASAP (Atlassian) | ❌ |
| Inherit auth from parent folder | ❌ Per-request only |
| Kerberos / SPNEGO (beyond NTLM) | ❌ |

---

## Scripts, Tests & Assertions

| Feature | Status |
|---------|--------|
| `pm.sendRequest()` | ❌ |
| `pm.cookies` in scripts | ❌ |
| Snippets library (crypto, lodash, moment, …) | ❌ |
| Visualizer (script-driven response preview) | ❌ |
| Collection / folder-level scripts | ❌ |
| Persist scripts on save to collection | ❌ Tab + session only |
| Sandboxed Node.js runtime | ❌ Browser sandbox |
| Postman import of `event` script arrays | ❌ |
| Test results panel (structured pass/fail) | ⚠️ Console log only |

---

## Collection Runner & Automation

| Feature | Status |
|---------|--------|
| Collection Runner with JS test assertions | ⚠️ Chains run requests; no script tests in chain |
| Run delay / iteration controls in chains | ⚠️ Limited vs Postman Runner |
| Newman / Postman CLI | ❌ |
| CI/CD integrations | ❌ |
| Scheduled collection runs | ❌ |
| Structured run history & test analytics | ❌ |

---

## Performance & Load Testing

| Feature | Status |
|---------|--------|
| Cloud-distributed virtual users | ❌ Local workers only |

---

## Integrations & Extensibility

| Feature | Status |
|---------|--------|
| Integrations gallery (Slack, Jira, GitHub, …) | ❌ |
| Newman npm package | ❌ |
| VS Code / IDE extensions | ❌ |

---

## Import / Export

| Feature | Status |
|---------|--------|
| Export to OpenAPI 3 | ❌ |
| Export to RAML / WSDL | ❌ |
| Import from WSDL / RAML | ❌ |
| Import from HAR | ❌ |
| Team export with separate environment files | ⚠️ Collection JSON; envs merged into vars on import |

---

## History & Debugging

| Feature | Status |
|---------|--------|
| History filter by status / method | ⚠️ Basic search only |
| Network capture (Interceptor) | ❌ |
| Save response as example on request | ❌ |

---

## UI & Platform

| Feature | Status |
|---------|--------|
| Light theme | ❌ Dark only |
| Multi-window | ❌ |
| Web app | ❌ Desktop only (Tauri) |
| Mobile app | ❌ |

---

## AI Assistants

| Feature | Status |
|---------|--------|
| Postbot (cloud AI in editor) | ❌ |
| AI-generated tests from response | ❌ |

---

## What Ripple Has That Postman Does Not

- Fully offline, no account required
- Native Tauri/Rust desktop with local SQLite
- Full HTTP auth suite: Basic, Bearer, API Key, Digest, OAuth 2.0, AWS Sig V4, Hawk, NTLM, Mutual TLS
- WebSocket, SSE, and gRPC (unary) as first-class methods
- Pre-request & test scripts (tab-level, subset of `pm.*`)
- Request chains and local Load Test Lab with HTML reports
- Postman & Insomnia collection import, cURL import/generate
- Collection variables with `{{variable}}` autocomplete
- Cookie jar, response diff, per-request Docs tab, request history & console
- Built-in SQL client (PostgreSQL, MySQL, SQLite)
- Network diagnostics (DNS, ping, traceroute, port check)
- JWT and encode/decode utilities
- On-device LLM (GGUF) with tool calls + MCP server registry
- No telemetry by design

---

## Suggested Priority

1. **Environments** — named profiles + switcher
2. **Persist scripts & gRPC fields** — save/load + Postman `event` import
3. **Request examples** — named response snapshots
4. **Richer script runtime** — `pm.sendRequest`, cookies, crypto helpers
5. **gRPC streaming** + `.proto` import
6. **OpenAPI export**
7. **Newman-style CLI**
8. **Light theme**

---

*Last verified: June 2026. Omit a row here once Ripple matches Postman for that feature.*
