# Postman Features Missing in Ripple

> This document lists **only what Postman has that Ripple lacks or partially covers**. For what Ripple actually ships (with caveats), see [Ripple differentiators](#ripple-differentiators-local-first) and [Ripple capabilities](#ripple-capabilities-implemented).
>
> **Out of scope:** cloud sync, hosted mocks, monitors, published documentation, Postman Flows, and Enterprise SSO.

---

## Summary of remaining gaps


| Area          | Still missing or partial                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Environments  | ✅ Profiles, switcher, env import/export, secret variables, dynamic `{{$…}}` vars, globals |
| Protocols     | GraphQL introspection UI; gRPC streaming & `.proto` import; SOAP, MQTT, Socket.IO                                                       |
| Scripts       | ✅ `pm.sendRequest`, cookies, crypto libs; ❌ HTTP scripts not persisted; WS/SSE scripts in stream body only; no collection/folder scripts |
| Organization  | Tags, versioning, Git sync, API Builder                                                                                                 |
| Automation    | Newman/CLI, CI integrations, scheduled runs, test pass/fail dashboard                                                                   |
| Import/export | ✅ Collection + env export (Ripple v2 / Postman v2.1); ❌ OpenAPI/HAR/WSDL/RAML export; no WSDL/RAML import                               |

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

Ripple now has **Postman-style named environments** (SQLite `environments` + `environment_variables` tables). Active environment variables **override** collection variables on key conflicts. Scripts expose `pm.environment` and `pm.collectionVariables` separately.


| Feature                                      | Status                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Global variables                             | ✅ **Tools → Globals** (`Ctrl+Shift+Y`) — key/value pairs available in every request |
| Environment variables (Dev / Staging / Prod) | ✅ Create, rename, duplicate, delete in **Tools → Environments** (`Ctrl+Shift+V`)             |
| Environment switcher                         | ✅ Request bar dropdown (left of Send); persists active env in settings                       |
| Initial / current value split                | ✅ Per env var; **Reset values** restores current from initial                                |
| Variable scopes beyond collection            | ⚠️ Global + collection + active environment — no local or data-file scopes                    |
| Secret variable type                         | ✅ Complete: UI toggle, masking (••••), click-to-reveal, works in interpolation |
| Dynamic variables (`{{$randomInt}}`, etc.)   | ✅ Full Postman compatibility — 25+ generators with fresh values on each request           |
| Postman environment import / export          | ✅ `.postman_environment.json` via Environments panel                                       |
| Chain run environment selection              | ✅ **▶** on a chain prompts for environment; sets active env before run                       |
| Auto-sync extracted tokens to environment    | ⚠️ Chain steps and token refresh write to collection **and** active env when one is selected |


**Typical workflow:** put stable config in the environment (`baseUrl`, `apiKey`, `sessionId`); use `{{var}}` in request URLs, headers, and bodies; run **GetLicense** (or token refresh) to populate `apiToken`; switch environments from the request bar or chain picker.

---

## Scripts, Tests & Assertions


| Feature                                      | Status                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pm.sendRequest()`                           | ✅ Complete: Full HTTP client with async/await, cookies API, crypto utils (base64, SHA1/256, UUID, random) |
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
| Environment picker when running a chain   | ✅ Sidebar **▶** and **Run Chain** prompt for target environment                         |
| Run delay / iteration controls in chains  | ⚠️ Limited vs Postman Runner                                                            |
| Newman / Postman CLI                      | ❌                                                                                       |
| CI/CD integrations                        | ❌                                                                                       |
| Scheduled collection runs                 | ❌                                                                                       |
| Structured run history & test analytics   | ❌                                                                                       |

---

## Integrations & Extensibility


| Feature                                       | Status |
| --------------------------------------------- | ------ |
| Integrations gallery (Slack, Jira, GitHub, …) | ❌      |
| Newman npm package                            | ❌      |
| VS Code / IDE extensions                      | ❌      |


---

## Import / Export


| Feature                                     | Status                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Export collection (Ripple native)           | ✅ v2 JSON: requests, collection variables, chains, token-refresh config                      |
| Export collection (Postman v2.1)            | ✅ Per-collection from sidebar; bulk **File → Export Collections**                           |
| Import collection (Ripple / Postman)        | ✅ Sidebar import + **File → Import**; Ripple v2 restores chains and token refresh            |
| Export / import Postman environment file  | ✅ Environments panel                                                                          |
| Export to OpenAPI 3                         | ❌                                                                                            |
| Export to RAML / WSDL                       | ❌                                                                                            |
| Import from WSDL / RAML                     | ❌                                                                                            |
| Team export with separate environment files | ⚠️ Collections and envs export separately; no single Postman “team bundle” zip               |


---

## Suggested Priority

1. **Persist HTTP scripts & gRPC fields** — save/load on collection + Postman `event` import (stream scripts already persist via `bodyType: stream`)
2. **gRPC streaming** + `.proto` import  
3. **OpenAPI export**

---

*Last verified: June 2026 against the Fork codebase. Environments, collection export (Ripple v2 / Postman v2.1), and chain environment picker verified in this pass.*