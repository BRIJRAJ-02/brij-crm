# packages/load

## Overview

The load harness (spec 0011, feature #12): `pnpm load:run <scenario>` plays simulated people at the People table through the real API (minted session cookies, the oRPC contract, the access door), on the load stack (`docker-compose.load.yml`), and prints how reads, writes and the server did against `SCALE_BUDGET` (`@crm/core/scale-budget`). Never shipped, never run against anything but this machine. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `scripts/run.ts` | The `pnpm load:run` command: arguments, exit codes (0 pass, 1 a miss in a gate, 2 invalid, 3 setup refused) |
| `src/run.ts` | Setup checks before the warm up (local addresses, the sessions file's API, one session per 100 users, free record slots), learning the seeded objects as user 1, the threads, the collectors, the result file |
| `src/plan.ts` | The open model: users ramp over the 60 second warm up, exponential gaps at the budget's rate, the mix held by a Weyl sequence |
| `src/user.ts` | One simulated person: a view by position (`canJump`) or by cursor, its 100 row window and checkpoints, scroll, jump, filter or sort (aborting the old count), open, edit, create |
| `src/shapes.ts` | Each object's fixed view shapes, the editable attributes, a create's values, the columns a window reads |
| `src/drive.ts`, `src/thread.ts` | One worker thread's users, dispatched at their planned moments; its samples, sent on time count and event loop delay |
| `src/collectors.ts` | `docker stats` of the stack's Postgres, PgBouncer's `SHOW POOLS`, host and Docker facts |
| `src/report.ts`, `src/result.ts` | The lines and verdicts, validity, the printed table, and `LoadResult` (`.load/results/*.json`) |
| `src/client.ts` | The contract client per user: its cookie, the API's origin, the `Server-Timing` pool wait |

## Commands

```bash
pnpm load:stack                 # the load stack (refuses under 11 GB of Docker memory)
pnpm load:seed --profile smoke  # 50,000 records and 50 users (crm, the default, is the million)
pnpm load:run steady            # 100 users, 10 measured minutes; --users, --minutes, --seed, --threads
pnpm load:run spread            # the same over the whole object, cold cache
pnpm load:reset                 # erase what the harness created, so the slots come back
pnpm --filter @crm/load test
```

## Reading the report

- Every time runs from the action's scheduled moment, not from when it was sent, so a server's queue shows.
- `read`, `open`, `edit` and `create` are judged at p95; `read by position`, `read by cursor` and `count` are reported only.
- `API pool wait` comes from the API's `Server-Timing` header (`LOAD_TIMING=on`, local only); `pooler wait` from PgBouncer's `maxwait`; `Postgres CPU` as a share of the container's 2 CPU cap, every 5 seconds.
- A run is invalid (exit 2) when a harness thread's event loop stalls past 50 ms at p99, it sends under 95% of its planned actions on time, or unexpected errors (any 401, 429, 400, 5xx, timeout or dropped connection) pass 0.1%. 409 and 422 are expected refusals, counted apart.
- `live delivery` and `relay lag` say "not built yet" until milestone 3.

## Gotchas

- Imports from `@crm/core/load-local`, `load-files`, `load-stack` and `load-slots`, and the server statistics in `@crm/db/stats`, are allowed here only (`server({ loadHarness: true })`); minting (`@crm/core/load-sessions`) and the reset's erase (`@crm/core/load-reset`) stay refused.
- 429s count as unexpected (AC-203) though the browser's data layer retries them; verify.md asks the owner which it should be.
- Windows read the columns on screen (`columnsOnScreen`), as the People table does; an open reads the whole record.
- `LOAD_TEST_BLOCK_LOOP_MS` is a test flag that stalls every harness thread, to prove such a run is invalid. Never set it otherwise.

## Related specs

- [0011 Scale budget and load harness](../../docs/specs/0011-scale-budget-load-harness/index.md)
