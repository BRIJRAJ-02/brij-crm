# tools/data-gate

## Overview

The record store's prototype gate (AC-40, spec 0005). It draws the real DataGrid over 100,000 synthetic records and measures the store from `@crm/data/records` in headless Chromium through Playwright. It reports memory, scroll frames, the time to patch 50 records, and an edit's apply and rollback. The gate is private and never shipped. It lives here so `@crm/data` doesn't depend on `@crm/ui`, React or Playwright. Tagged `client`.

## Key files

| File | Owns |
|---|---|
| `harness/` | The browser page: `main.tsx` (the grid fed by `baseline`, `held` or `plain`, and `window.gate`) and `synthetic.ts` (20 columns, and a record made from its index) |
| `measure.ts` | `pnpm --filter @crm/data-gate gate --rounds=5 [--out=file.json]`. It builds the harness in production mode, then runs every source once per round in a rotating order. Each source is judged against the controls from its own round (`baseline` is the grid alone; `held` is the grid while the page holds every record). The load average is printed with the results |

## Gotchas

- Frame counts follow the machine's load. Read the per-round differences from the controls, not the absolute numbers.
- The TanStack DB store it was measured against is in git at 4bac1a0 (`packages/data/prototype/`). The numbers and the call are in `docs/specs/0005-core-loop/verify.md`.
