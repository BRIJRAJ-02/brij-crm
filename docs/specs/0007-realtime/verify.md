# Verify: Realtime · spec 0007 · updated 2026-10-12

_Steps derived from spec 0007's acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Milestone 3: the outbox pruned

Built 12 October 2026 (steps 12 to 14), on top of spec 0008 milestones 1 and 2. Migration 0031 (`0031_outbox_prune.sql`, renumbered at landing if another lands first) replaces 0020's `crm_outbox_prune(max)`, which the app could run, with `crm_outbox_prune(before, max)`, the worker's alone. The deploy in step 14 is the lead's.

### Before production prunes (owner)

Production's worker still logs in as the app login (spec 0008 `verify.md`, "To turn jobs on in production"), and only `crm_worker` may run the new function. So after this deploy production prunes nothing: the worker logs `relay.prune.off` at boot, and the outbox keeps every row. Steps 1 to 3 there (`pnpm db:worker-login`, then the worker's `DATABASE_URL_DIRECT` on Railway, then a redeploy) turn it on, and `relay.prune.off` is then gone from the log. Production writes little, so the rows kept meanwhile cost little storage.

During the deploy itself, the old worker's relay calls the dropped `crm_outbox_prune(integer)` until it is replaced. Each call fails, is logged as a warning (at most once a minute) and deletes nothing.

### The prune under load (AC-89, step 14)

The owner waived the million record seed (12 October 2026), so the run prunes 200,000 rows on a local database of its own, and the million row run is waived with it.

**How it was measured**:
- **Database**: `crm_test_prune_lab` on the local Docker Postgres 18.6, migrated to 0031. The machine has 8 cores, shared with other build lanes (load average 7 to 13).
- **Rows to prune**: 200,000, made and published two days ago, 50,000 in each of 4 workspaces.
- **Steady state** (runs 3 and 4): a day's worth of rows kept as well, 1,000,000 published two hours ago in 20 more workspaces, so the table holds 1.2 million rows.
- **Writes**: 10 more workspaces, made through `createWorkspace`, where 4 writers commit about 47 writes a second for 30 seconds. Each write is its own transaction: the counter row, an outbox row, `pg_notify`, then the poke.
- **The relay**: the worker's own (`createRelay` with the real reader on the worker login, spec 0009's audiences on the app pool, the local Centrifugo's `/api/batch`), with production's settings and the review fixes.
- **Lag**: each live row's `published_at - created_at`, read from Postgres. "While pruning" covers the rows made before the round's last batch ended.

| Measure | Run 1 | Run 2 | Run 3 (1.2M rows) | Run 4 (1.2M rows, a snapshot held) | Target |
|---|---|---|---|---|---|
| Rows pruned, batches | 200,000 in 21 | 200,000 in 21 | 200,000 in 21 | 200,000 in 21 | |
| The whole round | 1.44 s | 1.14 s | 1.62 s | 1.62 s | |
| One batch of 10,000: median, slowest | 56 ms, 108 ms | 46 ms, 57 ms | 69 ms, 78 ms | 70 ms, 79 ms | |
| Relay lag while pruning: p50, p95, max | 49, 108, 182 ms | 39, 95, 98 ms | 30, 91, 110 ms | 46, 111, 147 ms | p95 ≤ 250 ms (AC-78) |
| Relay lag after the round: p50, p95, max | 12, 28, 113 ms | 9, 20, 36 ms | 10, 19, 90 ms | 10, 19, 204 ms | p95 ≤ 250 ms |
| Rows past retention left, unpublished left | 0, 0 | 0, 0 | 0, 0 | 0, 0 | 0, 0 |

Run 1 used the function as first built, before the review changed its delete to whole key lookups. Runs 2 to 4 used the final function. In run 4, a repeatable read snapshot was taken after seeding and held for the whole run.

Publishing waits behind at most one batch, as designed: the worst row while pruning waited about one batch plus its own publish. A round on a million rows is 100 batches over 100 passes, each costing about the same, so the lag while it runs should match these runs for about 5 times as long.

**A call with nothing to delete** walks one row per workspace that has outbox rows. It took 48 ms with 2,003 such workspaces, and under 3 ms with the 20 workspaces of the 1.2M row table.

**A snapshot older than the deleted rows** (a report or a dump running through a large prune) stops Postgres from marking deleted index entries dead, so every walk crosses them all. With a snapshot taken before 1.2 million rows were deleted:
- Before the slow batch rule, 21 batches took 324 ms at the median and 474 ms at the slowest, and lag while pruning reached a p95 of 3.9 s.
- With the rule, a batch over 250 ms ends its round. The round stopped after one batch of 570 ms, and lag for the whole run had a p95 of 20 ms (627 ms at worst, for the 24 rows written during that batch). The remaining 190,000 rows waited for the next round.

### AC to test map (milestone 3)

| AC | Tests |
|---|---|
| AC-89 | `packages/db/src/guards.test.ts`, the `crm_outbox_prune` block, covers:<br>- published rows made before the cutoff go from the oldest `seq` up, stopping at an unpublished row, a newer row, or an unpublished first row<br>- a null cutoff deletes nothing, and a row from the last hour never goes, whatever the cutoff<br>- at most `max` rows a call, clamped to 1 to 10,000<br>- the app and the identity login are refused (42501), and the app can't delete outbox rows itself<br>- it is the only `crm_outbox_prune`, owned by `crm_relay` and executable by `crm_worker` alone<br>- every definer function has its fixed search path and a standard SQL body (but `crm_enqueue_job`), and the prune's lock wait is 1 second<br><br>`packages/db/src/outbox.test.ts`: `pruneOutbox` on the reader and on a worker pool (the daily cleanup's shape), refused on the app pool.<br><br>`packages/core/src/realtime/catch-up.test.ts`: a catch up from a `seq` the real prune took answers `reset: true`, and one from the oldest row kept doesn't.<br><br>The load runs above. |
| AC-89, AC-90 | `apps/api/src/realtime/relay.test.ts`, the pruning block, covers:<br>- one batch after each pass while batches come back full, never two without a pass between, and never before the pass's own call<br>- a round waits for a quiet pass, or starts on a busy one once it has been due for another `pruneEveryMs`<br>- a new round comes only `pruneEveryMs` after the last ended, none while dormant, and one at the first pass after a wake<br>- a slow batch ends the round<br>- nothing is pruned when the relay is told not to (a login outside `crm_worker`) |

### Results

| Check | Result |
|---|---|
| `pnpm check` | pass (12 October 2026) |
| `node packages/db/scripts/journal.ts c1f2b57`, then drizzle-kit generate | the journal is in order, and generate finds no schema changes |
| packages/db | pass, 154 tests (13 October 2026) |
| packages/core, run on its own | pass. In the full run, `query.test.ts` and `links.test.ts` timed out under other lanes' load (load average 12 to 20); each passes alone (161 and 37 tests) |
| apps/api | pass, 478 of 480. The 2 failures were in spec 0008's `jobs/restart.test.ts`, which spawns worker processes and timed out at load average 25; that file passes alone (3 of 3) |
| Deploy, and the first `relay.prune` line in production | pending: the lead deploys, and production prunes only once its worker is on `crm_worker_user` (above) |
