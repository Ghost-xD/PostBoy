# Ripple — Development Guide
NEVER USE NPM. USE YARN.
Follow existing code patterns. When in doubt, look at how a similar feature was built and mirror that approach.

---
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/postboy.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" yarn tauri build

## Adding a New Feature

1. **Backend** — Create a Rust module in `src-tauri/src/`, register commands in `lib.rs`. Follow the `Result<T, String>` return pattern used everywhere else.
2. **API layer** — Add a namespace in `src/lib/api/tauri.ts` wrapping `invoke()` calls.
3. **UI component** — Create a `*Panel.svelte` in `src/lib/components/`. Use scoped styles with CSS variables from `static/app.css`.
4. **Wire it up** — Extend the `showToolsPanel` union in `uiStore.ts`, add the import + tab button + render branch in `+page.svelte`.
5. **Keyboard shortcut** — Add the shortcut in `setupKeyboardShortcuts()` inside `+page.svelte`, add a menu item in `setupAppMenu()`, and document it in `KeyboardShortcuts.svelte`.
6. **Footer** — Decide whether the tool needs a quick-access button in the footer bar. Not every tool needs one; only add it if the tool is used frequently or benefits from persistent visibility.
7. **Tests** — Write tests in `src/lib/test/`. Mock `invoke` for contract tests, test pure logic directly.

---

## Rules

- Follow existing design patterns and code style — don't invent new conventions.
- Write tests before or alongside your implementation.
- All tests must pass: `npx vitest run`
- Rust code must compile: `cargo check` (from `src-tauri/`)
- Shortcuts must be wired in both the keyboard handler logic and the shortcut help modal.
- Use CSS variables for theming — don't hardcode colors.
- Keep state local to components; only use stores for cross-component shared state.

---

## Build & Deploy

```bash
cd Ripple
yarn dev              # dev server
cargo check           # Rust type-check
npx vitest run        # run all tests

node deploy.mjs       # production build + deploy (patch bump)
```

---

## Checklist

- [ ] Follows existing patterns (look at similar features)
- [ ] Tests written and passing
- [ ] Code compiles (`cargo check`)
- [ ] Shortcut added in keyboard handler + menu + shortcut modal
- [ ] Footer inclusion decided
- [ ] Scoped styles using CSS variables
