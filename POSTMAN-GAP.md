# Postman Features Missing in Ripple

> Gap analysis as of June 2026. Ripple is a **local-first desktop API client** (Tauri + SvelteKit).
>
> This document lists **only what Postman has that Ripple lacks or partially covers**. For what Ripple actually ships (with caveats), see [Ripple differentiators](#ripple-differentiators-local-first) and [Ripple capabilities](#ripple-capabilities-implemented).
>
> **Out of scope:** cloud sync, hosted mocks, monitors, published documentation, Postman Flows, and Enterprise SSO.

---

## Summary of remaining gaps


| Area          | Still missing or partial                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Environments  | No global/env profiles or switcher — collection variables only                                                                          |
| Auth          | Akamai EdgeGrid, ASAP, inherit-from-folder                                                                                              |
| Protocols     | GraphQL introspection UI; gRPC streaming & `.proto` import; SOAP, MQTT, Socket.IO                                                       |
| Scripts       | No `pm.sendRequest`, cookies, crypto libs; HTTP scripts not persisted; WS/SSE scripts in stream body only; no collection/folder scripts |
| Organization  | Tags, versioning, Git sync, API Builder                                                                                                 |
| Automation    | Newman/CLI, CI integrations, scheduled runs, test pass/fail dashboard                                                                   |
| Import/export | No OpenAPI/HAR/WSDL/RAML export; no WSDL/RAML import                                                                                    |
| UI            | Light theme, multi-window, web/mobile clients                                                                                           |


---

## Protocols


| Feature                                  | Status                    |
| ---------------------------------------- | ------------------------- |
| GraphQL schema introspection UI          | ❌ Body type only today    |
| gRPC streaming (client / server / bidi)  | ❌ Unary + reflection only |
| gRPC `.proto` import / schema UI         | ❌                         |
| Save gRPC service & method to collection | ❌ Tab session only        |
| SOAP (WSDL, SOAPAction)                  | ❌                         |
| MQTT                                     | ❌                         |
| Socket.IO                                | ❌                         |


Ripple **does** support WebSocket (WS/WSS), SSE, and gRPC **unary** as first-class methods. Gaps vs Postman are mostly around gRPC streaming/schema tooling and non-HTTP protocols above.

### WebSocket & SSE (Ripple status)


| Feature                                                 | Status                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Connect / disconnect, message log                       | ✅                                                            |
| WebSocket binary send                                   | ✅ Base64 via `ws_send_binary`                                |
| WebSocket binary receive                                | ✅                                                            |
| Pre-request script (before connect)                     | ✅ Tab; persisted for saved WS/SSE requests via stream config |
| On-message script (`pm.message`)                        | ✅ Tab; persisted via stream config                           |
| SSE auto-reconnect, event-type filter                   | ✅ Persisted via stream config                                |
| Collection chain step (connect → send → wait → extract) | ✅ HTTP chains delegate to stream runner for WS/WSS/SSE       |
| Persist live session / message log to collection        | ❌ Stream **settings** only (`bodyType: stream`), not the log |


### Request building (other gaps)


| Feature                               | Status                                             |
| ------------------------------------- | -------------------------------------------------- |
| Bulk edit params / headers            | ❌                                                  |
| CA certificate store UI               | ⚠️ SSL verify toggle + client cert file paths only |


---

## Workspaces & Organization


| Feature                                     | Status                          |
| ------------------------------------------- | ------------------------------- |
| Tags on requests / collections              | ❌                               |
| Collection versioning with changelog        | ❌                               |
| Git integration                             | ❌                               |
| Spec Hub / design-first API Builder         | ❌ OpenAPI import only (one-way) |


---

## Environments & Variables


| Feature                                      | Status                 |
| -------------------------------------------- | ---------------------- |
| Global variables                             | ❌                      |
| Environment variables (Dev / Staging / Prod) | ❌                      |
| Environment switcher                         | ❌                      |
| Variable scopes beyond collection            | ❌                      |
| Secret variable type                         | ❌ Plain text in SQLite |
| Dynamic variables (`{{$randomInt}}`, etc.)   | ❌                      |
| Initial / current value split                | ❌                      |


---

## Authorization


| Feature                         | Status             |
| ------------------------------- | ------------------ |
| Akamai EdgeGrid                 | ❌                  |
| ASAP (Atlassian)                | ❌                  |
| Inherit auth from parent folder | ❌ Per-request only |
| Kerberos / SPNEGO (beyond NTLM) | ❌                  |


---

## Scripts, Tests & Assertions


| Feature                                      | Status                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pm.sendRequest()`                           | ❌                                                                                    |
| `pm.cookies` in scripts                      | ❌                                                                                    |
| Snippets library (crypto, lodash, moment, …) | ❌                                                                                    |
| Visualizer (script-driven response preview)  | ❌                                                                                    |
| Collection / folder-level scripts            | ❌                                                                                    |
| Persist scripts on save to collection        | ⚠️ WS/SSE only (inside stream JSON body); HTTP pre/test scripts are tab/session only |
| Sandboxed Node.js runtime                    | ❌ Browser sandbox                                                                    |
| Postman import of `event` script arrays      | ❌                                                                                    |
| Test results panel (structured pass/fail)    | ⚠️ Console log only                                                                  |


---

## Collection Runner & Automation


| Feature                                   | Status                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Collection Runner with JS test assertions | ⚠️ Chains run HTTP or stream steps and extract JSON; no script test execution in chains |
| Run delay / iteration controls in chains  | ⚠️ Limited vs Postman Runner                                                            |
| Newman / Postman CLI                      | ❌                                                                                       |
| CI/CD integrations                        | ❌                                                                                       |
| Scheduled collection runs                 | ❌                                                                                       |
| Structured run history & test analytics   | ❌                                                                                       |


---

## Performance & Load Testing


| Feature                         | Status               |
| ------------------------------- | -------------------- |
| Cloud-distributed virtual users | ❌ Local workers only |


---

## Integrations & Extensibility


| Feature                                       | Status |
| --------------------------------------------- | ------ |
| Integrations gallery (Slack, Jira, GitHub, …) | ❌      |
| Newman npm package                            | ❌      |
| VS Code / IDE extensions                      | ❌      |


---

## Import / Export


| Feature                                     | Status                                              |
| ------------------------------------------- | --------------------------------------------------- |
| Export to OpenAPI 3                         | ❌                                                   |
| Export to RAML / WSDL                       | ❌                                                   |
| Import from WSDL / RAML                     | ❌                                                   |
| Team export with separate environment files | ⚠️ Collection JSON; envs merged into vars on import |


---

## Suggested Priority

1. **Environments** — named profiles + switcher
2. **Persist HTTP scripts & gRPC fields** — save/load on collection + Postman `event` import (stream scripts already persist via `bodyType: stream`)
3. **Richer script runtime** — `pm.sendRequest`, cookies, crypto helpers
4. **gRPC streaming** + `.proto` import
5. **OpenAPI export**
6. **Newman-style CLI**
7. **Light theme**

---

*Last verified: June 2026 against the PostBoyFork codebase. Omit a gap row once Ripple matches Postman for that feature.*