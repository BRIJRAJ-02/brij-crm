# Verify: Core loop · spec 0005 · updated 2026-10-08
_Steps derived from spec 0005's acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## AC-40: the record store's prototype gate

**Call: the plain store.** TanStack DB missed the gate on the layering rule, not on speed. Screens see the same interface either way (`RecordStore`, the id windows and the view in `packages/data/src/records/`).

### Why TanStack DB missed

TanStack DB's own optimistic transactions (0.11.3) break the layering rule four ways. `probeTanstackLayering()` in `packages/data/prototype/tanstack-store.ts` shows each one, run by `tanstack-layering.test.ts`. Both were removed after the gate, so check out commit 4bac1a0 to run them (`pnpm --filter @crm/data test`):

1. Refusing an edit rolls back every later pending edit to the same record too, even one to another cell.
2. A later edit's optimistic row is the whole row as it stood, so it carries the earlier edit's value. That value outlives the earlier edit's refusal.
3. A new server row under a pending edit doesn't show through, even in cells the edit never touched. This holds for flat rows too, not only nested `values`.
4. A sync write waits while any transaction on the collection is persisting, unless it's written with `immediate`.

To pass the edit checks, the TanStack store has to keep the layers itself, as the plain store does, then roll back and rebuild a record's transactions whenever its base changes. With that done, TanStack DB adds nothing the plain store lacks, and it costs more in every measure below.

### Method

- Ran `pnpm --filter @crm/data gate --rounds=5` at commit 4bac1a0 on 2026-10-08. Check out that commit to rerun the comparison with TanStack DB. The harness without TanStack DB now lives in `tools/data-gate` (`pnpm --filter @crm/data-gate gate`). It builds the harness (the real DataGrid, 20 columns, 100,000 synthetic records, a fake server answering a block of 100 in 20 ms) with React's production build. It then drives headless Chromium through Playwright, with a fresh browser for each source.
- It measured four sources. `baseline` is the grid's own 100,000 row story, with rows made from their index. `held` is a control: the same grid while the page holds all 100,000 records in a Map. The other two are `plain` and `tanstack`, each behind the same windows and view.
- The machine was busy, with other agents' test suites running in other worktrees. It has 8 cores. Load average (1, 5, 15 min) was 7.18 6.90 7.54 at the start and 7.85 7.64 7.55 at the end. After each round it was: 5.75 5.89 6.88; 8.09 6.87 7.04; 6.64 7.34 7.26; 7.88 8.20 7.72; 7.85 7.64 7.55.
- To work around the load, each round ran all four sources back to back, and the order rotated each round. Each store is judged against the controls from its own round: frames against `baseline` (or against `held` once every record is loaded, since its heap is the same size), and memory against `held`. Figures below are the median over the 5 rounds, with the range in brackets.
- The memory rerun: in that run, `held` built each id string twice (`idAt(index)` plus the record's own `id`), while the store reuses `row.id`, so the control's heap was 2.4 MB too high. With the fix (the Map keyed by `record.id`), I reran `pnpm --filter @crm/data-gate gate --rounds=3` (baseline, held and plain) on 2026-10-08. Load average was 8.66 6.88 6.93 at the start and 10.87 13.52 10.85 at the end, with a peak of 33.80 during round 3. The heap figures below come from that rerun where marked. Its frame figures are not used: at that load even the baseline dropped up to 146 of about 350 frames.

### Numbers

| Measure | baseline | held | plain | tanstack |
|---|---|---|---|---|
| JS heap after scrolling the whole table (MB) | 12.6 (12.6 to 12.6) | 70.3 (70.3 to 70.4), 2.4 MB too high | 69.7 (69.5 to 70.5) | 85.4 (85.3 to 86.8) |
| The same, rerun with `held` fixed (MB) | 12.5 (12.5 to 13.2) | 67.9 (67.3 to 68.1) | 72.0 (70.9 to 74.0) | not rerun |
| Normal scroll (1,500 px/s, 6 s), fresh view: frames over 25 ms, of about 340 | 12 (1 to 28) | 21 (16 to 36) | 5 (3 to 39) | 23 (15 to 39) |
| Normal scroll, every record loaded: frames over 25 ms | 7 (4 to 43) | 13 (8 to 26) | 32 (20 to 58) | 39 (32 to 75) |
| Long tasks during any scroll | 0 | 0 (one in 2 of 15 scrolls) | 0 | 0 |
| AC-7 step scroll: long tasks, most rows in the DOM | 0, 42 | 0, 42 | 0, 42 | 0, 42 |
| Patch 50 records, store and grid render: median, worst (ms) | | | 2.65, 4.3 | 3.00, 5.5 |
| Edit apply and render (ms) | | | 2.80 (2.70 to 3.00) | 4.40 (3.90 to 5.40) |
| Rollback and render (ms) | | | 2.30 (2.20 to 2.40) | 2.60 (2.50 to 3.20) |
| Rollback exact, in the store and on screen | | | yes, 5 of 5 | yes, 5 of 5 (with its own layers) |
| Confirmation keeps a second edit (same cell; other cell on the new base); refusal keeps a later edit | | | yes, 5 of 5 | yes, 5 of 5 (with its own layers) |

Each store against the controls from its own round:

| Per round | plain | tanstack |
|---|---|---|
| Heap after the whole table, minus the fixed held: the store's own cost (MB, rerun) | +4.1 (3.6 to 5.9) | about +17.5 (its 85.4 against the rerun's 67.9) |
| Heap after the whole table, minus plain in the same round (MB) | | +15.8 (14.9 to 16.3) |
| Fresh view scroll: frames over 25 ms, minus baseline | -7 (-23 to 35) | +11 (1 to 22) |
| Fresh view scroll: mean frame, minus baseline (ms) | -0.34 (-1.16 to 1.82) | +0.68 (0.05 to 1.08) |
| Every record loaded: frames over 25 ms, minus held | +14 (9 to 32) | +25 (6 to 67) |

Measured against plain in the same round, TanStack took 1.13× as long to patch and render (1.00 to 1.32), 1.50× to apply an edit (1.39 to 1.80) and 1.13× to roll one back (1.04 to 1.45).

### Against the pass line

- **Memory under 200 MB:** both pass. Plain is 70 to 74 MB with every record loaded. That is about 4 MB over the `held` control holding the same records, which is roughly one entry object and one layers array per record. TanStack carries about 16 MB more than plain.
- **Patch under 16 ms:** both pass. The worst plain patch in any round was 4.3 ms, against 5.5 ms for TanStack.
- **Rollback restores exactly:** plain passes. TanStack passes only with layers kept beside it, and fails on its own transactions (points 1 to 3 above).
- **No dropped frames at normal scroll:** this can't be judged as an absolute on a machine this busy. Even the baseline dropped 1 to 43 frames a scroll. Every frame over 25 ms was a single missed vsync (33 ms), and no store had a long task. Against its own round's controls:
  - In a fresh view, plain matched or beat the baseline in 3 of 5 rounds, with a median of -7. TanStack was worse than the baseline in all 5 rounds, with a median of +11.
  - With every record loaded, both stores missed more frames than `held` in every round: plain +14 (about 4% of frames), TanStack +25.

### Not measured cleanly

- The absolute frame line: other agents' suites ran at load 6 to 10 on 8 cores, so this needs a rerun on a quiet machine.
- Why a full store misses more frames than `held` while holding a heap within about 4 MB of it. The likely causes are GC from re-received rows and the reloaded blocks, but the gate doesn't separate them. `held` alone already misses more than `baseline`, so heap size counts for part of it.

- Plain's heap rose with how long its whole-table scroll took in the rerun: 70.9 MB at 60 s, 72.0 at 71 s and 74.0 at 86 s, against 69.7 at about 51 s in the first run. So some of the +4.1 MB may come from the run, not the store. The low end, 3.6 MB, is the better estimate of the store's own cost.

### Follow-ups for task 11

- The store keeps every body it ever loads, so memory grows with scrolling (70 MB at 100,000 records) instead of staying flat as rule 7 of `crm-frontend-state` asks. It also brings the extra missed frames above. Evicting bodies no window or pending layer refers to should fix both.
  - **Done in task 11** (2026-10-08): the store reference counts ids (a window's block holds its ids; a pending layer keeps its record) and evicts at zero. `pnpm --filter @crm/data-gate gate --rounds=1` (baseline, held, plain), load average 5.0 to 6.2 on 8 cores: JS heap after scrolling all 100,000 records was 12.7 MB for plain against 12.5 MB for the bare grid and 68.1 MB for `held` (before eviction plain was 70 to 74 MB). The store held 600 records (6 blocks) at the end. With every record scrolled past, plain missed 15 frames over 25 ms against baseline 13 and held 14 (one round, so read it as "no worse", not a measure). Patch 50 and render: 2.7 ms median; edit apply 3.1 ms, rollback 2.3 ms, every edit check held.

## AC-38: live updates between two browsers

**Locally: passes. Production: still to measure** (the variables and CSP below must be set first, then `e2e/live.flow.ts` runs against production from saved signed in browser states).

### Method

`pnpm --filter @crm/web test:flow e2e/live.flow.ts` against `pnpm dev:apps` (Postgres 5433, Centrifugo 8000/9000, the worker's relay woken by the api's poke). One person signs in twice, in two browser contexts on one workspace. The writer creates a person, makes one warm up edit, then 20 timed edits of one cell, then adds a column. Each change is timed from the writer's action (Enter, or Create) to the change in the reader's page, checked every frame. The flow also checks that the writer makes no `records.get` call (its own changes are never fetched back), and that dropping the reader's socket (Playwright's `routeWebSocket`) shows "Live updates are paused" (axe clean in light and dark), and that a change made meanwhile arrives once the socket is back.

### Numbers (2026-10-08, local, 22 changes per run)

| Run | Machine load (1 min) | p50 | p95 | max |
|---|---|---|---|---|
| Quiet | about 7 | 83 ms | 227 ms | 475 ms |
| Busy (other agents' suites and a Docker screenshot run) | 15 to 28 | 120 ms | 601 ms | 710 ms |

Every run stayed under the 1 second p95. The create is the slowest change each time (the new row is fetched and placed at the end).

### Production checklist

- Railway api: `CENTRIFUGO_TOKEN_SECRET` as a reference to the Centrifugo service's `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`.
- Railway centrifugo: `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` holds `https://brij-crm-phi.vercel.app`.
- Vercel Production: `VITE_REALTIME_URL=wss://<Centrifugo's public domain>/connection/websocket`.
- `apps/web/vercel.json`: `wss://<Centrifugo's public domain>` in the CSP's `connect-src` (the build refuses the deploy otherwise).
- Previews: no `VITE_REALTIME_URL`, so live updates are off and nothing shows.
