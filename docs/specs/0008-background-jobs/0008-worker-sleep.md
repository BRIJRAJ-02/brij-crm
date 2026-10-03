# 0008. Letting the database sleep

## Summary

Neon's free plan suspends the compute (the database server) after 5 minutes with no activity, and the plan can't turn that off. A worker that polls the queue every 2 seconds and the outbox every second never lets it suspend, so the compute would run all month. This child gives the worker two states: awake, when it polls and listens as usual, and asleep, when it holds no connection at all. The API wakes it after any write, and a timer wakes it for scheduled work.

## Why it matters

- Every poll is a query, and a query is activity, so the compute never reaches 5 quiet minutes while the worker is connected and polling. Spec 0005's relay polls every second, and Graphile Worker polls every 2 seconds by default.
- The free plan's monthly compute allowance is smaller than a month of the smallest compute always awake (about 100 compute unit hours against about 180 at the time of writing; check the figure in the Neon console). Running out stops the database until the month resets.
- Previews use Neon branches on the same plan, so the same holds there.

## States

```
awake → (idle long enough, and the check passes) → asleep → (nudge or timer) → waking → awake
awake → (connection lost) → waking (with backoff)
```

**Awake**: the two Graphile runners (LISTEN plus their poll), the relay (LISTEN plus its 1 second poll), the stale lock check and the backlog log once a minute. The idle clock restarts on every task call, every relay publish, and every `/wake`.

**Going to sleep**: when the idle clock passes `WORKER_IDLE_SLEEP_SECONDS` and nothing is running, one check on the direct connection:
- no unlocked queue row with `run_at` within the next 30 seconds;
- no queue row locked at all (a stale lock must be released first, by the minute check);
- no unpublished outbox row (`crm_outbox_workspaces(1)` is empty).

If the check passes, the worker reads the wake time: the earliest of the earliest unlocked queue `run_at`, the next cron time minus 30 seconds, and 24 hours from now. It stops the runners (Graphile's graceful stop), stops the relay, ends both pools and the direct connection, sets the timer and logs `Worker asleep` with the wake time. If the check fails, the idle clock restarts.

**Asleep**: no connections and no queries. `/health` answers `asleep` from memory. `/wake` and the timer both start waking.

**Waking**: open the direct connection (with spec 0001's NOTIFY check), open the pools, start the relay (it polls at once, so rows written while asleep go out first) and the runners (Graphile checks its schema version, backfills the cron if a run was missed, and starts listening). Then `awake`. A failure retries with backoff (1, 2, 4 up to 30 seconds) and logs each failure; it never exits the process. This replaces spec 0001's "exit on a dropped direct connection, let Railway restart": a lost connection while awake also goes to waking.

`WORKER_IDLE_SLEEP_SECONDS=0` never sleeps: the worker is always awake and only the reconnect with backoff applies. That is the default, locally, and once Neon is on a paid plan.

## The nudge

- `apps/api/src/jobs/nudge.ts`: `createNudger({ url, fetch, clock, log })` returns `nudge()`. At most one request in flight and at most one per second; anything in between is folded into the next. `POST <WORKER_WAKE_URL>`, 1 second timeout, a failure logged as a warning at most once a minute and otherwise ignored. With no `WORKER_WAKE_URL`, `nudge()` does nothing.
- The `member` procedure base calls `nudge()` after every write procedure that succeeds (every such write stores an outbox row, spec 0005), without waiting for it.
- Self healing for a lost nudge: `jobs.get` and `jobs.list` call `nudge()` when they return a job that is `queued` with `run_at` more than 5 seconds ago. The page and the data layer read unfinished jobs, so a stuck job wakes the worker as soon as someone looks.
- A nudge to an awake worker only restarts its idle clock.

## Timers

- Scheduled jobs: the earliest unlocked `run_at` sets the timer, so a job scheduled for tomorrow wakes the worker tomorrow.
- Retries: a retry's backoff is a future `run_at`, so it wakes the worker too.
- The daily cleanup: the next `0 3 * * *` UTC, minus 30 seconds, so Graphile's own schedule fires on time; if the worker wakes late, the one day fill runs it.
- A ceiling of 24 hours, so a bug in the wake time can never keep the worker asleep forever.

## What it costs

The compute stays awake for the time people use the app, plus about 9 minutes after the last activity (4 for the worker to sleep, 5 for Neon), plus one short wake a day for the cleanup. The first job or live event after an idle spell waits for the worker to connect: under a second when a write has just woken the compute, a few seconds more after a timer wakes a suspended compute.

## Checking it

- Tests: with a 2 second idle time against the test database, the worker's connections disappear from `pg_stat_activity`, `/health` says `asleep`, a `/wake` brings them back, a job scheduled 5 seconds ahead wakes it, and a dropped connection while awake recovers without the process exiting.
- Production: after a quiet spell, the Neon console (or the Neon API's endpoint `current_state`) shows the compute suspended within 10 minutes of the last use; then a sign in, an edit and a test job in a preview all work. Recorded in `verify.md`.

## Rationale (short)

Closing every connection is the only state Neon is sure to treat as idle, whatever it counts as activity. The API already wakes the compute for any write, so letting it wake the worker too adds no extra wake, and the timers cover the work no request asks for. The runner's lease, the queue's durability and the outbox mean nothing is lost while asleep, only delayed until the next wake.
