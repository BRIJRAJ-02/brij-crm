# packages/load

## Overview

The load harness (spec 0011, feature #12): `pnpm load:run <scenario>` plays simulated people at the People table through the real API (minted session cookies, the oRPC contract, the access door) and the real live connection (Centrifugo, one per user), on the load stack (`docker-compose.load.yml`), and prints how reads, writes, live delivery and the server did against `SCALE_BUDGET` (`@crm/core/scale-budget`). Never shipped, never run against anything but this machine. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `scripts/run.ts` | The `pnpm load:run` command: arguments, exit codes (0 pass, 1 a miss in a gate, 2 invalid, 3 setup refused) |
| `src/run.ts` | Setup checks before the warm up (local addresses, the sessions file's API, one session per 100 users, free record slots), learning the seeded objects as user 1, the threads, the collectors, the outbox reads after the window, the result file |
| `src/plan.ts` | The open model: users ramp over the 60 second warm up, exponential gaps at the budget's rate, the mix held by a Weyl sequence; the storm's bursts and its reconnect moment (`planStorm`); the hub's renames (`planHubEdits`) |
| `src/user.ts` | One simulated person: a view by position (`canJump`) or by cursor, its 100 row window and checkpoints, scroll, jump, filter or sort (aborting the old count), open, edit, create, a storm burst's edit, the hub's moves, opens and renames, and the `Holder` the live client reads and refetches through |
| `src/hub.ts` | The `hub` scenario's setup through the owner login: the hub's model and each user's own people from its Team (`dealPeople`, none shared) |
| `src/smoke.ts`, `scripts/smoke.ts` | The weekly smoke's verdict (`.github/workflows/load-smoke.yml`): warnings for budget misses, a failure for an invalid run or a crash, the table on the run's summary page |
| `src/live/user.ts` | One person's live updates, as the browser's: tokens through `realtime.*`, own echo skipped, stubs, held records refetched with the changed columns they show, coarse reload, the settle (1.5 s after the last create, delete or reorder, 5 s at most, then 0 to 2 s), the storm's reconnect |
| `src/live/stream.ts` | The seq contract and its books: the watermark from the head, held seqs, catch up after 0 to 2 s, recovery, the 10 second miss rule, and `trailingMisses` for seqs a user never heard of |
| `src/live/event.ts` | The change event parsed by hand, as the browser's parser does (no Zod per event per user) |
| `src/histogram.ts` | Event arrivals in 1 ms buckets per thread, merged and summed up by the nearest rank |
| `src/live/centrifuge.ts` | Centrifugo's client on `ws` with the API's `Origin`: the one module that imports `centrifuge` and `ws` |
| `src/outbox.ts` | After the window, through the owner login: the relay lag of every row committed in it, and the workspace's head at a moment |
| `src/tally.ts` | One measured thing's requests: the 10 second timeout, the worst outcome, the `Server-Timing` waits |
| `src/shapes.ts` | Each object's fixed view shapes, the editable attributes, a create's values, the columns a window reads |
| `src/drive.ts`, `src/thread.ts` | One worker thread's users (250 to a thread by default, `threadsFor`), dispatched at their planned moments; its samples, sent on time count and event loop delay |
| `src/collectors.ts` | `docker stats` of the stack's Postgres, PgBouncer's `SHOW POOLS`, host and Docker facts |
| `src/report.ts`, `src/result.ts` | The lines and verdicts, validity, the printed table, and `LoadResult` (`.load/results/*.json`) |
| `src/client.ts` | The contract client per user: its cookie, the API's origin, the `Server-Timing` pool wait |

## Commands

```bash
pnpm load:stack                 # the load stack (refuses under 11 GB of Docker memory)
pnpm load:seed --profile smoke  # 50,000 records and 50 users (crm, the default, is the million)
pnpm load:seed --profile smoke --users 1000   # the same records with 1,000 members, enough for thousand
pnpm load:run steady            # 100 users, 10 measured minutes; --users, --minutes, --seed, --threads
pnpm load:run spread            # the same over the whole object, cold cache
pnpm load:run storm             # steady, a burst of edits every 10 s, every live connection dropped mid window
pnpm load:run hub               # steady, half the edits move people to or from the hub, the hub renamed every 10 s
pnpm load:run thousand          # 1,000 users over 4 threads, steady, 5 measured minutes
pnpm load:reset                 # erase what the harness created and put the hub's Team back, so the next run starts clean
pnpm load:bench-hub-clear       # the hub's Team cleared in one write under 100 engine writers, then written back
pnpm --filter @crm/load test
```

## Reading the report

- Every time runs from the action's scheduled moment, not from when it was sent, so a server's queue shows.
- `read`, `open`, `edit` and `create` are judged at p95; `read by position`, `read by cursor` and `count` are reported only.
- `API pool wait` comes from the API's `Server-Timing` header (`LOAD_TIMING=on`, local only); `pooler wait` from PgBouncer's `maxwait`; `Postgres CPU` as a share of the container's 2 CPU cap, every 5 seconds.
- A run is invalid (exit 2) when a harness thread's event loop stalls past 50 ms at p99, it sends under 95% of its planned actions on time, or unexpected errors (any 401, 429, 400, 5xx, timeout or dropped connection) pass 0.1%. 409 and 422 are expected refusals, counted apart.
- `live delivery (commit to visible)` is judged at p95: from the write's commit (`at`, moved to our clock by the database clock offset) to each holder's `records.get` answer, for events that came live. `scheduled to visible` (from the writer's scheduled moment), `event arrival` (every subscriber, every event), deliveries after recovery or a catch up, and the settle rereads are reported.
- `relay lag` is judged: `published_at` minus `created_at` of every outbox row committed in the window; a row never published is a miss.
- `missed seqs` is judged and must be 0: a seq no event, stub or catch up covered within 10 seconds of its gap opening, plus seqs committed 10 seconds before the end that a user never heard of. Seqs filled by `realtime.catchUp` or Centrifugo's recovery are reported, not missed. `events applied` also gives the share of records events a user discarded as another object's (spec 0007's AC-91).
- A failed token or catch up call, a dropped WebSocket and a failed refetch are unexpected errors; the share is still of actions only.
- `storm` adds `edit inside bursts` (kept off the mix and the edit line) and the reconnect, from the drop to each user back, with how each came back.
- `hub` adds `hub renames` (user 1 renames the hub every 10 s; kept off the mix and the edit line), `hub moves` (on the edit line too), `hub moves while a rename ran` (their spans overlap), `hub open` (kept off the open line) and `writes out of retries (runWrite)` (503 `QUERY_CANCELLED` on a write). Run `pnpm load:reset` after it: it moves people on and off the hub and renames it.
- `thousand` prints every verdict but exits by validity only; the event loop line names each thread (`the main thread`, `thread 1` to `thread 4`), and one stalled thread makes the run invalid.
- `hub`, `storm` and `thousand` exit by validity only (0 or 2); `steady` and `spread` are the gates (1 on a judged miss).
- `pnpm load:bench-hub-clear` prints the clear's time, the other writes' times (all, and beside the clear), writes out of retries, and the WAL during the clear. It refuses while the Team isn't as seeded (run `pnpm load:reset`), and writes the Team back itself.

## Gotchas

- Imports from `@crm/core/load-local`, `load-files`, `load-stack` and `load-slots`, and the server statistics in `@crm/db/stats`, are allowed here only (`server({ loadHarness: true })`); minting (`@crm/core/load-sessions`) and the reset's erase (`@crm/core/load-reset`) stay refused.
- 429s count as unexpected (AC-203) though the browser's data layer retries them; the owner kept it that way (12 October 2026).
- Every user's live client adds the browser's own load: a refetch per frame of events it holds, coarse reloads and settle rereads (window and count). Those reads pass the 6 in flight gate too, so they draw 429s; the 429 line says what sent each (in milestone 3's runs, settles sent most).
- A seeded load database doesn't take migrations or logins that land after it was seeded (`pnpm load:seed` refuses a seeded one): with the data services up, run `DATABASE_URL_OWNER=postgres://crm_owner:crm_owner_local@localhost:5434/crm node packages/db/scripts/migrate.ts`, and for spec 0008's worker login the same owner URL with `DATABASE_URL=postgres://crm_app_user:local-only-load-app@localhost:6434/crm DATABASE_URL_DIRECT=postgres://crm_worker_user:local-only-load-worker@localhost:5434/crm node packages/db/scripts/worker-login.ts`, then start the api and worker.
- The api and worker images build from the working tree: after a change to `apps/api` or a package it imports, `docker compose -f docker-compose.load.yml -p crm-load build api worker` before a run.
- Windows read the columns on screen (`columnsOnScreen`), as the People table does; an open reads the whole record.
- The load stack is one Docker project (`crm-load`, its volume `crm-load-postgres`, fixed ports) for the whole machine, whichever worktree starts it: two lanes using it at once share one database and the `crm-load-api` and `crm-load-worker` images (the last build wins), so their numbers mix. Run one lane's load work at a time.
- Reading the hub's people and the moved people goes through the owner login as setup; every measured action still goes through the API.
- `LOAD_TEST_BLOCK_LOOP_MS` is a test flag that stalls every harness thread, to prove such a run is invalid. Never set it otherwise.

## Related specs

- [0011 Scale budget and load harness](../../docs/specs/0011-scale-budget-load-harness/index.md)
