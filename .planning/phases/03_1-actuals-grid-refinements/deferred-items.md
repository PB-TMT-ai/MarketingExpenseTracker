# Deferred Items — Phase 03_1 (Actuals Grid Refinements)

Out-of-scope discoveries logged during execution. NOT fixed in the plan that found them.

## DEF-03_1-02-01 — No ESLint configured in the project

- **Found during:** Plan 03_1-02, Task 2 (GRID-09 hot-path refactor) verification.
- **Issue:** The plan's `<verify>` command runs `npx eslint "app/(app)/actuals/actuals-grid.tsx"`, but the project has no ESLint wired up: no `lint` npm script, no `eslint`/`eslint-config-next` devDependency, and no `eslint.config.*` / `.eslintrc*` at the repo root. `npx eslint` therefore downloads a bare global eslint@10 and fails with "ESLint couldn't find an eslint.config file."
- **Impact:** The eslint gate cannot run. The TypeScript gate (`npx tsc --noEmit`) DID pass clean on the refactor, which is the meaningful correctness check for this client-only change. `next build` (which runs Next's own lint+typecheck) remains available as a fuller gate.
- **Disposition:** Out of scope for Task 2 (pre-existing project condition, not a regression introduced by the refactor). Adding an ESLint config is a tooling task for a future chore, not part of GRID-09.
- **Suggested fix (future chore):** `npm i -D eslint eslint-config-next` and add a flat `eslint.config.mjs` extending `next/core-web-vitals` + a `"lint": "next lint"` (or `eslint .`) script.
