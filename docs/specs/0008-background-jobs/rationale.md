# 0008. Background jobs: decision record

## Context

> ⚠️ Premise note: Graphile Worker polls the database every 2 seconds, and every poll is activity, so Neon's free compute would never suspend, and a month of an always awake compute is more than the free plan's monthly allowance. Spec 0005 already met this for the relay (active while there is work, dormant after 3 quiet minutes, woken by the API after a write). The right framing: the whole worker must hold no connection when there is no work, and something else must wake it. This spec extends the relay's lifecycle to the job runner, with one idle clock for both.

> ⚠️ Premise note: spec 0005's follow up asks for code emails as jobs. A sign in code exists in plain form only at the moment it is sent; a job would have to store it in the queue, which sits outside row level security and keeps failed rows. The code email stays in the request, where the person is waiting for it anyway.

Scope feature #8 asks for long work outside the request: a job survives a restart, retries on failure, reports progress, can be cancelled, and one workspace's huge job never slows another workspace's work. Spec 0001 chose Graphile Worker (a job queue that lives in Postgres) in the API image's `worker` entrypoint, so a job can be queued in the same transaction as its write. Nothing is built yet: the worker opens a direct connection and serves `/health`.

Six features wait on it, and each needs something different from the same contract: #14 converts an attribute's values in batches of 5,000 with a catch up pass and live progress on the attribute; #16 recomputes lookups and rollups after commit, coalesced, within 5 seconds; #22 runs bulk edits and deletes over "all matching", which needs the matching ids snapshotted first so the confirm step can show an exact count, with cancel between batches and a refusal summary, and a daily purge per workspace; #15 refreshes stored sort keys past 10,000 records; #28 sends reminders at a time; spec 0005 needs outbox pruning and the purge order fix.

Forces: every tenant table forces row level security, so anything that reads across workspaces (the queue, a daily fan out) is a deliberate hole that must stay small. The worker is one Railway replica on a small budget, and Railway deploys send SIGTERM and may overlap two instances briefly. Neon's free plan stays (the owner's decision), and its compute suspends after 5 minutes without activity. The scale target is a million records per workspace and 100 people online. The house rules require every write, jobs included, to pass the access door, write its change event in the same transaction, and never put values in an event.

## Options considered

### Option 1: Graphile Worker for scheduling, a tenant `jobs` table for the truth, sliced jobs (chosen)

Graphile Worker holds one row per pending slice with ids only; our `jobs` and `job_items` tables (row level security) hold status, params, progress, checkpoints and items. Long jobs run in slices of about 20 seconds that queue themselves again; heavy slices are serialised per workspace; light jobs have their own lane.

**Pros**: progress and params stay inside tenant security; exact resume from a checkpoint saved with each batch; round robin fairness from Graphile's plain ordering; cancel between batches; the page and the API read one table.
**Cons**: more code than a plain queue (a lease, slices, two lanes); every kind must be written as resumable batches.

### Option 2: Graphile Worker alone, one task call per job

Each job is one Graphile task that runs to the end, with progress written to a side table and Graphile's own retries.

**Pros**: least code; Graphile's documented model.
**Cons**: a one hour import holds a slot for an hour, so fairness needs one queue per workspace and still lets a few workspaces fill every slot; a restart reruns the whole task unless every task handles resume itself; cancel needs an abort signal inside every task; params sit in the queue outside row level security.

### Option 3: our own queue on a tenant table with `SKIP LOCKED`

The `jobs` table is the queue: workers claim rows with `select … for update skip locked`, and LISTEN, backoff and cron are ours.

**Pros**: one table, inside row level security; full control of fairness.
**Cons**: claiming across workspaces needs a definer function or a bypassing role anyway; we rebuild LISTEN wake up, backoff, stale lock recovery and a cron with catch up, which Graphile already proves; spec 0001 chose Graphile for exactly this.

### Option 4: a hosted durable job service (Inngest, Trigger.dev)

**Pros**: steps, retries, cron and a dashboard without running anything.
**Cons**: rejected in spec 0001: per step costs, a vendor in every write path, the job can't be queued in the write's transaction, and the service must reach the database or the API from outside.

## Rationale

Option 1 is the only one that meets all four "Done when" points without building a scheduler: the checkpoint in the batch's transaction gives survival and exact resume, Graphile's backoff gives retries, the batch boundary gives progress and cancel, and slices plus one heavy queue per workspace give fairness. It keeps Graphile, which spec 0001 chose because a job queued in its write's transaction can't be lost, and keeps everything sensitive behind row level security, leaving only ids in the queue. Option 2 fails fairness and resume at the million record scale; option 3 rebuilds what Graphile already gets right; option 4 was already rejected.

Per decision (the brief's recommendations, taken):
- Graphile for when, our table for what: the queue stays ids only, and the page reads one tenant table.
- Slices of 20 seconds that queue themselves again: round robin without a scheduler, and every call ends inside 30 seconds, which makes stale locks easy to tell from live ones.
- One heavy queue per workspace, two heavy slots, four light slots: a workspace never holds more than one heavy slot, and short work never waits behind long work. The runner up was a weighted scheduler of our own; not needed at 100 people online, and #12 will measure.
- A lease on the job row: covers deploy overlap and released stale locks, which Graphile's own lock can't see across two queue rows.
- Batches as one engine transaction with their progress: exact resume, and the outbox event for the batch's writes comes free.
- Item snapshots in `job_items`: the confirm step shows an exact count (#22), and items are checked again in their batch so a stale snapshot never writes blindly.
- Coalescing by key into a waiting job: #16's recomputes stay one job per attribute per burst.
- Cancel stops, never undoes: undo is a feature promise (#22's bulk delete undo), not a runner one.
- The API enqueues only through `crm_enqueue_job`, and the worker logs in as its own role (`crm_worker`): a bug in tenant code can't read or rewrite the queue, list workspaces or delete outbox rows. `crm_outbox_workspaces` moves from `crm_app` to it, and the relay runs on it (settled in the cross check of 8 October 2026). The runner up was granting the queue to `crm_app`; simpler, but it turns every SQL injection into cross tenant queue access.
- `crm_queue` holds exactly the rights `add_job` needs in the pinned version, named table by table: `add_job` runs with its caller's rights, so a broad grant would hand the API's definer function more of the queue than it uses. A guard test pins the list, so an upgrade fails loudly.
- `job_key_mode` `replace` on every enqueue: the hand over and the lease requeue run while their own queue row is locked, and `replace` then clears that row's key and inserts a fresh row at the new time; `preserve_run_at` could keep an old time on the rare path where an unlocked row waits.
- Roles, `jobs.manage`, `enterAsActor` and `systemScope` from spec 0009, not a column or entry point of our own: one owner per concept, and a job's member is checked by the same door as a request.
- Job events as spec 0007's `jobs` kind, delivered by spec 0009's rule: a job id never reaches a member who can't read the job; the cost is a coarse refetch for members who share a channel with people who can't.
- A definer function to list workspaces for the daily fan out, rather than giving the worker the identity login: the worker never sees sessions.
- The daily cleanup per workspace at 03:00 UTC, once per day by `once_key`, one day of fill.
- Retention: finished jobs 30 days, done items at the next cleanup. The outbox is spec 0007's: published rows are kept 24 hours (`OUTBOX_RETENTION`, the catch up window), and the daily cleanup calls the same `crm_outbox_prune` the relay calls while awake.
- The worker sleeps when idle and the API wakes it: the only design under which the free Neon compute can suspend. The runner up was accepting an always awake compute; it runs out of the free allowance within the month.
- The API wakes it on writes and, once a minute per process, on any signed in request: the worker sleeps only when nobody uses the app, and a person who has been reading doesn't wait for a wake on their first edit. The runner up was waking on writes only, which saves a little compute but puts a cold wake in front of the first change of a session.
- Code emails stay in the request (see the premise note).
- A preview only test kind proves the runner by clicking, since the first user kinds belong to later features.

## Evidence

- The worker on `feat/core-loop` (`apps/api/src/worker.ts`) opens the pooled and direct connections, proves NOTIFY arrives and serves `/health`. Spec 0005 milestone 3, in flight, adds the relay with its active and dormant states (`apps/api/src/realtime/relay.ts`, dormant after 3 quiet minutes, a safety poll backing off to every 60 seconds) and the wake endpoint `POST /internal/outbox-wake` with the `x-crm-wake` secret header (`WORKER_INTERNAL_URL`, `WORKER_WAKE_SECRET`); the worker checks its direct connection's role. `graphile-worker` isn't in the catalog or `node_modules`.
- `graphile-worker` 0.18.0 (npm, 8 October 2026): schema migrations 000001 to 000020; the queue lives in `_private_jobs`, `_private_job_queues`, `_private_tasks` and `_private_known_crontabs`; `add_job` is `plpgsql` without `security definer` and calls `add_jobs`, which takes `job_key_mode` `replace`, `preserve_run_at` or `unsafe_dedupe`; `pollInterval` defaults to 2,000 ms.
- `DATABASE_URL_DIRECT` is the app login on the direct host (`.env.example`), so the worker has no rights beyond `crm_app` today; the local PgBouncer knows only the app login.
- `createDatabase` (`packages/db/src/client.ts`) sets no `idleTimeoutMillis`, so node-postgres's 10 second default applies.
- The engine's `purgeDeleted` already purges in batches of 500 with `skip locked`, one transaction per batch, "a system job (#8 schedules it)", and loops itself; it locks records before their lists, the reverse of entry writes (spec 0005's follow up).
- `runWrite` runs hooks inside the write's transaction and retries deadlocks three times; `setValuesBatch` caps at 500 records under per record savepoints, the pattern item batches reuse.
- `.railway/railway.ts` declares no domain for the worker, so it is reachable only on Railway's private network.
- The library already has Table, ProgressBar, Meter, Badge, Modal, EmptyState, Toast and RelativeTime; `SettingsLayout` is in milestone 4, which #13 pulls forward.
- Neon's documentation (read 3 October 2026) says computes suspend after 5 minutes of inactivity, that the free plan can't turn it off, and that a client connecting or a query wakes it; it doesn't say whether idle open connections count, which is why the worker closes them all.
