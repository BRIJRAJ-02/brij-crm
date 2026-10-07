# 0008. Letting the database sleep

## Summary

Neon's free plan suspends the compute (the database server) after 5 minutes with no activity, and the plan can't turn that off. Spec 0005 already lets the outbox relay go dormant after 3 quiet minutes and wakes it from the API after a write. Graphile Worker polls the queue every 2 seconds by default, so adding it would keep the compute awake all month. This child gives the whole worker (job runner and relay together) two states: awake, when it polls and listens as usual, and asleep, when it holds no connection at all. The API wakes it after a write and, at most once a minute, on any request from a signed in person, so it sleeps only when nobody uses the app; a timer wakes it for scheduled work.

## Why it matters

- Every poll is a query, and a query is activity, so the compute never reaches 5 quiet minutes while the worker is connected and polling. Graphile Worker 0.18.0 polls every 2 seconds (`pollInterval` 2,000 ms) and resets stale locks every few minutes.
- The free plan's monthly compute allowance is smaller than a month of the smallest compute always awake (about 100 compute unit hours against about 180 at the time of writing; check the figure in the Neon console). Running out stops the database until the month resets.
- Previews use Neon branches on the same plan, so the same holds there.

## States

```
awake → (idle long enough, and the check passes) → asleep → (wake call or timer) → waking → awake
awake → (connection lost) → waking (with backoff)
```

**Awake**: the two Graphile runners (LISTEN plus their 2 second poll), the relay in spec 0005's active state (LISTEN plus its safety poll backing off 1, 2, 5, 15, then every 60 seconds), the stale lock check and the backlog log once a minute. The idle clock restarts on every task call, every relay publish, and every wake call. The relay no longer goes dormant on its own: its 3 minute quiet rule becomes this idle clock, so it is active exactly while the worker is awake (spec 0007 AC-90).

**Going to sleep**: when the idle clock passes `WORKER_IDLE_SLEEP_SECONDS` (default 180) and nothing is running, one check on the direct connection (`crm_worker_user`):
- no unlocked queue row with `run_at` within the next 30 seconds;
- no queue row locked at all (a stale lock must be released first, by the minute check);
- no unpublished outbox row (`crm_outbox_workspaces(1)` is empty).

If the check passes, the worker reads the wake time: the earliest of the earliest unlocked queue `run_at`, the next cron time minus 30 seconds, the earliest live lease expiry, and 24 hours from now. It stops the runners (Graphile's graceful stop), sends the relay dormant (spec 0005's dormant state: connection closed, lock released, no query), ends both pools and the direct connection, sets the timer and logs `Worker asleep` with the wake time. If the check fails, the idle clock restarts.

**Asleep**: no connections and no queries. `/health` answers `asleep` from memory. The wake endpoint and the timer both start waking.

**Waking**: open the direct connection (with spec 0001's NOTIFY check), open the pools, wake the relay (spec 0005's `wake()`: it drains at once, so rows written while asleep go out first) and start the runners (Graphile checks its schema version, backfills the cron if a run was missed, and starts listening). Then `awake`. A failure retries with backoff (1, 2, 4 up to 30 seconds) and logs each failure; it never exits the process. This replaces spec 0001's "exit on a dropped direct connection, let Railway restart": a lost connection while awake also goes to waking.

`WORKER_IDLE_SLEEP_SECONDS=0` never sleeps: the worker is always awake and only the reconnect with backoff applies. Use it once Neon is on a paid plan, or to debug locally.

## The wake call

- One call, spec 0005's: the API's `createRelayWake` (`apps/api/src/realtime/wake.ts`) sends `POST <WORKER_INTERNAL_URL>/internal/outbox-wake` with the header `x-crm-wake: <WORKER_WAKE_SECRET>`. At most one request in flight and one queued, a 1 second timeout, a failure logged as a warning at most once a minute and otherwise ignored. It never slows or fails the request that sent it.
- The worker's endpoint checks the secret in constant time (401 without it) and now wakes the whole worker: runners and relay. A call to an awake worker only restarts its idle clock. It answers 204.
- When the API sends it:
  1. After the commit of a write whose hooks stored an outbox row (the `writeHooks` composer sets a flag on the request, as spec 0005 does today), or whose `startJob` queued a job (it sets the same flag).
  2. On any authenticated request (the `authed` and `member` bases), at most once a minute per API process, so the worker stays awake while anyone uses the app and the first change after a quiet spell isn't held up by a wake.
  3. From `jobs.get` and `jobs.list` when they return a job that is `queued` more than 5 seconds past its `run_at`: a lost wake heals as soon as someone looks.
- Without `WORKER_INTERNAL_URL` (allowed only locally, as spec 0005's env check enforces), the call does nothing.

## Timers

- Scheduled jobs: the earliest unlocked `run_at` sets the timer, so a job scheduled for tomorrow wakes the worker tomorrow.
- Retries: a retry's backoff is a future `run_at`, so it wakes the worker too.
- The daily cleanup: the next `0 3 * * *` UTC, minus 30 seconds, so Graphile's own schedule fires on time; if the worker wakes late, the one day fill runs it.
- A ceiling of 24 hours, so a bug in the wake time can never keep the worker asleep forever.
- Nothing else: pruning the outbox (spec 0007) runs only inside a relay pass while awake and in the daily cleanup, never on a timer of its own.

## What it rests on

AC-117 holds only while these stay true; each is checked in milestone 3 and recorded in `verify.md`:
- **Pools let go**: the API's and the worker's `pg` pools close a connection after 10 seconds idle (node-postgres's default `idleTimeoutMillis`; `createDatabase` sets none). A pool that kept connections open forever could keep the compute from counting as idle.
- **No timed probe**: nothing queries the database on a timer while nobody uses the app. Railway's health checks and every uptime monitor hit `/api/health` (no database) and the worker's `/health` (memory only), never `/api/health/ready`; the API runs no timer that queries; the browser's offline probe uses `/api/health` (spec 0006).

## What it costs

The compute stays awake for the time people use the app, plus about 8 minutes after the last request (up to 1 for the last wake call to arrive, 3 for the worker to sleep, 5 for Neon), plus one short wake a day for the cleanup. The first job or live event after an idle spell waits for the worker to connect: under a second when a request has just woken the compute, a few seconds more after a timer wakes a suspended compute.

## Checking it

- Tests: with a 2 second idle time against the test database, the worker's connections (runners and relay) disappear from `pg_stat_activity`, `/health` says `asleep`, a wake call brings them back, a job scheduled 5 seconds ahead wakes it, a read only session's requests send at most one wake call a minute, and a dropped connection while awake recovers without the process exiting.
- Production: after a quiet spell, the Neon console (or the Neon API's endpoint `current_state`) shows the compute suspended within 10 minutes of the last use; then a sign in, an edit and a test job in a preview all work. Recorded in `verify.md`.

## Rationale (short)

Closing every connection is the only state Neon is sure to treat as idle, whatever it counts as activity. One idle clock for the runner and the relay means one rule to reason about: the worker is awake exactly while someone uses the app or work is due. Waking on any request, not only on writes, costs one tiny call a minute per API process and keeps a person who only reads from paying the wake delay on their first edit. The runner's lease, the queue's durability and the outbox mean nothing is lost while asleep, only delayed until the next wake.
