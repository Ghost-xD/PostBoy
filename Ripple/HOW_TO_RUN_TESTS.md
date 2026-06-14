# Ripple - How to Run Tests

All commands run from `Ripple/`.

## Commands

```bash
yarn test              # Run all tests once (vitest run)
yarn test:watch        # Watch mode — re-runs on file changes
yarn test:ui           # Browser-based Vitest UI
yarn test:coverage     # Run with coverage report
```

## Run a Single File

```bash
yarn test src/lib/test/websocket.test.ts
yarn test src/lib/stores/appState.test.ts
```

## Run Tests Matching a Name

```bash
yarn test -t "should create collection"
```

## Test Files (7 suites, 195 tests)

| File | Tests | Covers |
|------|------:|--------|
| `src/lib/test/websocket.test.ts` | 28 | WS message types, connection states, tab isolation, API wrapper, URL handling, shortcuts |
| `src/lib/api/tauri.test.ts` | 19 | `invoke` wrappers — db, http, fileOps, app, ws |
| `src/lib/test/api-collection.test.ts` | 29 | Collection loading, request execution, response handling, HTTP methods, headers, status codes |
| `src/lib/test/import-export.test.ts` | 29 | Postman/Ripple export & import, file ops, data validation, error handling |
| `src/lib/test/database-schema.test.ts` | 34 | SQLite schema, table existence, CRUD for collections/requests/history/settings, data integrity |
| `src/lib/test/ui-components.test.ts` | 43 | Request builder, sidebars, tab management, headers, body, response display, save dialog, shortcuts, themes |
| `src/lib/stores/appState.test.ts` | 13 | Tab store, collection store, history store, settings store |

## Configuration

**`vitest.config.js`** — test runner config:
- Pattern: `src/**/*.{test,spec}.{js,ts}`
- Environment: `jsdom` (simulated browser DOM)
- Setup file: `src/lib/test/setup.ts` (mocks `window.__TAURI__` so tests run without the Tauri runtime)

## Test Environment

- **Runner:** Vitest (Jest-compatible API)
- **DOM:** jsdom — no real browser or Tauri runtime needed
- **Tauri mocks:** `vi.mock('@tauri-apps/api/core')` stubs `invoke` calls
- **Globals:** `describe`, `it`, `expect`, `vi` available without imports (configured via `globals: true`)

## Watch Mode Keys

While `yarn test:watch` is running:

| Key | Action |
|-----|--------|
| `a` | Run all tests |
| `f` | Run only failed tests |
| `p` | Filter by filename |
| `t` | Filter by test name |
| `q` | Quit |

## Adding New Tests

1. Create a `.test.ts` file anywhere under `src/`
2. Import `describe`, `it`, `expect`, `vi` from `vitest`
3. Mock Tauri with `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))`
4. Run `yarn test` to verify

## CI Usage

```bash
yarn test --reporter=json --outputFile=test-results.json
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot find module" | `yarn install` |
| Tests timeout | `yarn test --testTimeout=10000` |
| Stale cache | `yarn test --clearCache` |
| Verbose output | `yarn test --reporter=verbose` |
