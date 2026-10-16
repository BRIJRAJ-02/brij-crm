# 0008. Background jobs: verification

## Milestone 1

Built 12 October 2026 (steps 1 to 9); deploy (step 10) pending. Milestone 1 deploys safely with no owner action: production's worker keeps today's direct login (not in `crm_worker`) and `JOBS_RUNNER` defaults to `off` there, so it boots with the relay as before, the jobs' runners off (`jobs.off` in its log, `jobs: 'off'` on `/health`), and Neon's compute free to suspend. The API stores and queues jobs either way; none runs in production until the steps below, and no production kind exists yet (`dev.simulate` is local and preview only).

### To turn jobs on in production (owner, with milestone 3's sleep)

1. Make the worker's own login on Neon, as the owner, with production's variables: `DATABASE_URL_DIRECT=<the direct host, user crm_worker_user, a new password> pnpm db:worker-login -- --plain-password` (Neon refuses a SCRAM verifier; `DATABASE_URL` and `DATABASE_URL_OWNER` as production holds them).
2. Set Railway's worker `DATABASE_URL_DIRECT` to that login, in production and in `preview-base` (each preview already makes its own in `preview.yml`).
3. Redeploy the worker and check its log: no `jobs.off` for the login (with `JOBS_RUNNER` still off, the one reason left is "JOBS_RUNNER is off").
4. Once milestone 3's sleep has landed (or to accept the compute hours sooner), set the worker's `JOBS_RUNNER=on`, redeploy, and check `/health` answers `jobs: 'on'` and the log shows `jobs.runners.started`.
5. Then land milestone 3's contract migration, which takes `crm_outbox_workspaces` from `crm_app` (AC-115 in full).

### Local development

The shared `crm` database needs `pnpm db:migrate`, then `pnpm db:worker-login`, and the root `.env`'s `DATABASE_URL_DIRECT` switched to `crm_worker_user` (`.env.example` shows it). Until then a local worker runs its relay with the jobs off and says so.

### Results

| Check | Result |
|---|---|
| db, core, contracts, api, data suites; web's node tests | pass (12 October 2026) |
| Graphile in the loop: a job start to finish, and a graceful stop handed back and finished, every item once | pass (`apps/api/src/jobs/graphile.test.ts`) |
| The worker boots on the worker login (jobs on), on the app login (jobs off) and with `JOBS_RUNNER=off` | pass (`apps/api/src/worker.test.ts`) |
| Run the test job in a preview, open the empty page in production | pending (step 10) |

## Milestone 2

Built 12 October 2026 (steps 11 to 15). No migration: the columns milestone 2 uses (`dedupe_key`, `once_key`, `expires_at`, `checkpoint`, `run_at`) and their indexes came with 0028. Production is unchanged in behaviour: `JOBS_RUNNER` stays off there and no production kind exists yet; `dev.simulate_light` is local and preview only, like `dev.simulate`.

### Fairness (AC-108, step 15)

Measured with `pnpm load:jobs` (`packages/core/scripts/jobs-fairness.ts`) on the load stack: the worker container capped at 1 vCPU and 512 MB, Postgres at 2 vCPU and 8 GB, the worker built from this branch. Docker Desktop had 8 CPUs and 7.7 GB, under the 11 GB `pnpm load:stack` asks for, so the data services and the worker were started with `docker compose -f docker-compose.load.yml -p crm-load up -d` directly, as spec 0011's runs were (the caps are ceilings; the worker used about 70 MB). Other build lanes were running their suites at the same time (load average 6 to 32 on 8 cores), so the times are pessimistic.

The run fills both heavy slots first: A's job over 200,000 items and D's over 100,000 (batches of 500, 200 ms each), plus a second, 1,000 item heavy job in A. After 25 seconds, B's 1,000 item heavy job is queued; then E fills all four light slots with long light jobs (20,000 items each); then a light job of 100 items in C arrives every 3 seconds, 8 in all. "Queued" is the job's `created_at`, the start transaction's time; for A's and D's starts that includes inserting their items.

Runs 3 and 4 are after the reviews' fixes (light slices of 1 second, the heavy lane polling every half second); runs 1 and 2, before them, had no E and light slices of 20 seconds.

| Measure | Run 3 | Run 4 | Runs 1, 2 | Target |
|---|---|---|---|---|
| B's heavy job (1,000 items): queued to started | 13.54 s | 9.65 s | 14.16 s, 15.07 s | under 30 s |
| B's heavy job: started to finished | 0.96 s | 0.50 s | 0.45 s, 0.52 s | under 60 s |
| A's second heavy job: queued to started (it waits behind A's own) | 17.02 s | 13.35 s | 16.62 s, 18.42 s | |
| Light jobs in C: slowest queued to started (of 8) | 1.14 s (E holding every light slot) | 0.19 s (E holding every light slot) | 0.06 s, 0.03 s (light lane idle) | under 2 s |
| Most heavy slices at once, per workspace (sampled every 100 ms) | A 1, B 1, D 1 | A 1, B 1, D 1 | the same | at most 1 |
| A's big job, items done by the end of the run (about 70 s) | 89,000 | 104,000 | 91,000, 82,500 | |
| Queue rows left once every job ended | not read | 0 | 0, 0 | 0 (AC-121) |

B waited for one of the two heavy slices to end (A's and D's slices take 20 seconds each) and then went ahead of A's and D's next slices, as the hand over queues each next slice behind everything already waiting. A first run with light slices of 2 seconds had C's slowest light start at 2.59 s with E holding the lane, so light slices are 1 second. Light jobs never wait on the heavy lane.

How long a heavy job waits grows with the workspaces ahead of it: with N workspaces each running heavy work, a newly queued heavy job waits about (N / 2) × 20 seconds for a slot (two heavy slots, 20 second slices). So past about 3 busy workspaces at once, AC-108's 30 seconds no longer holds on one worker; #12's load harness decides the heavy concurrency and when a second worker replica pays off.

### Restarts (AC-103, step 14)

Real worker processes (`apps/api/test/jobs-worker.ts`, the worker's own wiring through `apps/api/src/jobs/runner.ts`) run a 20,000 item `test.effects` job, which writes one row per item in each batch's transaction; after each case every item has exactly one effect row.

| Case | Result |
|---|---|
| SIGTERM mid job: the batch in hand finishes, the slice ends `stopped`, the job waits with one unlocked queue row and no lease | a new worker carried on 0.84 to 0.86 s after it was started (3 runs; target 10 s) |
| SIGKILL mid batch: the batch in hand rolls back with its effects | a new worker carried on 1.0 to 3.5 s after it was started, with shortened timings (slices 1 s, locks stale after 2 s, checked every 0.5 s, leases 3 s). With production's (20 s, 120 s, 60 s, 60 s) a killed worker's lock is stale 2 minutes after its slice began and the next minutely release frees it, so the job carries on within 3 minutes |
| Deploy overlap: two workers, and a second queue row for a running light job | the second row's slice finds the lease held, logs `job.leased-elsewhere`, and queues itself for when the lease ends; every item once |

### AC to test map (milestone 2)

| AC | Tests |
|---|---|
| AC-103 | `apps/api/src/jobs/restart.test.ts` (SIGTERM, SIGKILL, deploy overlap); `apps/api/src/jobs/graphile.test.ts` (graceful stop in process); `packages/core/src/jobs/jobs.test.ts` (a lease held elsewhere requeues at `lease_until`; two slices of one runner kept apart); `packages/db/src/queue.test.ts` (queue keys: a hand over while locked, a dead row after a killed hand over, replace over a waiting row) |
| AC-104 | `dependable.test.ts`: retries with growing waits then `JOB_FAILED` with the progress kept, `retryAt` shown, a committed batch resets the count; `jobs.test.ts`: no committed batch redone |
| AC-108 | `pnpm load:jobs` on the load stack (above) |
| AC-109 | `dependable.test.ts`: a 12,000 item snapshot in pages of 5,000, `ready` with the count and `expires_at`, one queue row at the expiry, confirm then exactly those items once; expiry `JOB_EXPIRED` with the clock injected; confirm too early, too late, by another member, after a cancel; only the targets that existed at `asOf`, one deleted since skipped with its reason; `JOB_TOO_LARGE` past the item limit; `packages/data/src/jobs/store.test.ts`: confirm optimistic, rolled back and read again when refused |
| AC-110 | `dependable.test.ts`: three starts in one job with all items once and the start delay on the job and its queue row; two racing starts make one job; another member's key apart; a new job once the first slice ran; other params refused |
| AC-111 | `dependable.test.ts`: `runAt` on the job and its queue row; `graphile.test.ts`: never before its time, started within 5 seconds of it while awake (the wake case belongs to milestone 3) |
| AC-116 | `dependable.test.ts`: params checked again each slice (`JOB_INVALID`) |
| AC-121 | `graphile.test.ts`: a job that keeps failing ends `failed` and leaves no queue row; the fairness run left none |
| AC-124 | `dependable.test.ts`: a step's `failed` ends the job at once with its items and counts, no retry; `onFailed` runs as the system for that, `JOB_FAILED`, `ACTOR_REMOVED` and `JOB_INVALID` (with no params), with its own outbox row; never for a cancel or `WORKSPACE_GONE`; a hook that throws leaves the job unfinished and the retry ends it with the hook, on every path |
| AC-125 | `jobs.test.ts` (milestone 1); `dependable.test.ts`: a system kind with a once key from a member's write |
| AC-126 | `dependable.test.ts`: a `countsTowardLimit: false` kind left out of the count and never `LIMIT_REACHED`, and a start without its key throws |

### Results

| Check | Result |
|---|---|
| db, core, contracts, api, data suites; web's node tests | pass (12 October 2026) |
| Fairness on the load stack | pass, 4 runs (above) |
| Restart tests | pass, 3 runs in a row after the reviews' fixes; one earlier run timed out while the machine was loaded by other lanes (load average about 22), and passed on its own after |

## Milestone 3

Built 15 October 2026 (steps 16 to 19, and step 20 short of the deploy). Migration `0034_workspace_sweep` (renumbered at landing if another lands first): the role `crm_sweep` and the definer function `crm_workspace_ids`.

Production is unchanged in behaviour until the owner turns the jobs on. Its worker still logs in as the app login (not in `crm_worker`) and `JOBS_RUNNER` is off there, so it boots exactly as before: the jobs' runners off (`jobs.off`), no crontab, no lifecycle, and the relay with its own 3 minute dormancy (`selfDormant` stays true with the jobs off). The migration adds three partial indexes (small tables today, built under a 5 second lock timeout), a role and a function nobody but `crm_worker` may call. The api's once a minute wake on signed in requests is off in production (`WORKER_WAKE_ON_USE` unset is `off` there), so an idle tab can't keep the relay polling; the overdue read's wake (at most every 10 seconds) has nothing to find, since no job is started in production yet. `maintenance.daily` is registered everywhere, but nothing starts one until a runner with the crontab runs.

### Owner steps: turning the jobs on in production

Milestone 1's steps 1 to 3 first (unchanged): the worker's own login on Neon (`pnpm db:worker-login -- --plain-password` with production's variables), Railway's worker `DATABASE_URL_DIRECT` set to it in production and in `preview-base`, and a redeploy whose log shows no `jobs.off` for the login. Then:

1. Apply the Railway config (`railway config plan`, then `railway config apply`, linked to `production`, then to `preview-base`). The worker gains `TZ=UTC`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`, and the preserved `JOBS_RUNNER` and `WORKER_IDLE_SLEEP_SECONDS` (unset means 180 seconds).
2. Set the worker's `JOBS_RUNNER=on` and the api's `WORKER_WAKE_ON_USE=on` in production, and redeploy both. Check the log for `jobs.runners.started` and `worker.sleep` with `idleSeconds: 180`, and `/health` (Railway's private network, or the service's logs) for `jobs: 'on'` and `state: 'awake'`.
3. Check the sleep. Leave the app unused for 10 minutes. The worker logs `Worker asleep` with its `wakeAt` about 3 minutes after the last request (the next 02:59:30 UTC when nothing is scheduled), and `/health` answers `state: 'asleep'`. In the Neon console (or the Neon API's endpoint `current_state`), the production compute shows `Idle` (suspended) within 10 minutes of the last use (AC-117).
4. Check the wake. Sign in, edit a record, and start nothing else: the edit saves, a second browser sees it live, and the worker logs `Worker awake` with `reason: 'wake call'`. The compute shows `Active` again.
5. Check an idle tab: leave one signed in tab open on a list for an hour, with nobody using it, both shown and hidden. A hidden tab lets its connection go after 5 minutes; a shown one renews its tokens once an hour, and renewals never wake the worker, so the compute should suspend; record what the console shows. Confirm the hour long tokens (index.md, the second reviews' calls).
6. Check the two assumptions on production, and record them here: no idle pool connection after 10 seconds (Neon's monitoring shows no open connections while the worker sleeps and nobody uses the app), and no timed probe (uptime monitors hit `/api/health`, never `/api/health/ready`; Railway runs the api's `/api/health/ready` check only during a deploy).
7. The first daily cleanup. After the next 03:00 UTC, the worker logs `daily.cleanup` (or `Worker awake` with `reason: 'timer'` at 02:59:30, then `daily.cleanup`). As an owner, Settings, Background jobs shows "Daily cleanup", started by System, `Done` with the rows it removed. Record the time it finished and its count.
8. Then the milestone 3 contract migration (index.md, Follow-up): take `crm_outbox_workspaces` from `crm_app` once every environment's worker runs on `crm_worker_user`.

A preview runs the jobs already (`JOBS_RUNNER` unset is `on` there, and each preview makes its own worker login). With the sleep, a preview's worker also sleeps after 3 idle minutes; its Neon branch suspends the same way.

### Local development

Nothing new to set up: `WORKER_IDLE_SLEEP_SECONDS` unset sleeps after 180 idle seconds with the jobs on. Set it to `0` to keep a local worker always awake while debugging.

### AC to test map (milestone 3)

| AC | Tests |
|---|---|
| AC-111 | `apps/api/src/jobs/sleep.test.ts`: a job scheduled 40 seconds ahead lets the real worker sleep and its timer wakes it to run the job, within 60 seconds of its time; `lifecycle.test.ts`: the wake time is the next due row |
| AC-112 | `packages/core/src/jobs/maintenance.test.ts`: one cleanup per workspace a day as the system (a second run the same day starts none, the next day starts one); the outbox pruned until a batch comes back short, dead rows deleted once, a continuation when the budget runs out; trash past 30 days purged, 29 days kept; ready jobs past their hour ended `JOB_EXPIRED` with their event; only a due job with no live lease, untouched for an hour and with no queue row queued again; a replayed batch removes nothing new. `apps/api/src/jobs/graphile.test.ts`: a day missed three days running runs once, for the last 03:00 UTC, and its continuation runs after it. `packages/core/src/engine/links.test.ts`: a purge batch waits on a list an entry write holds before it takes the record, and both purge picks read `records_trashed_at` and `list_entries_trashed_at` in order with no full sort. `maintenance.test.ts` also: a 12,001 item job, every other one refused, walked in windows with every refused item kept; another workspace's trash, old jobs and expired ready job left alone. `packages/db/src/guards.test.ts`, `roles.test.ts`: `crm_workspace_ids` |
| AC-115 | `packages/db/src/guards.test.ts`: five definer functions, each owned by its own role and hardened; only `crm_relay`, `crm_search` and `crm_sweep` bypass row level security; `crm_sweep` reads `workspaces.id` and `deleted_at` and nothing else; `crm_workspace_ids` is executable by `crm_worker` alone (the app and the identity login refused); `roles.test.ts`: the migration's closing check refuses every widening |
| AC-117 | `apps/api/src/jobs/sleep.test.ts`: the real worker with a 2 second idle time closes every connection (none left in `pg_stat_activity`), answers `asleep` from memory, and a wake call after a job's commit runs it within 5 seconds; `lifecycle.test.ts`: no sleep while a task runs, a row is locked or due within 30 seconds, or an outbox row waits; a wake that lands while closing; a failed wake retried with backoff; a lost runner reconnects; a runner that fails while its sibling starts fails that wake; a task that ran while it closed wakes it straight back; 0 never sleeps; `relay.test.ts`: the relay under the lifecycle never goes dormant on its own and sleeps and wakes when told; `modules/jobs.test.ts`: signed in requests send the once a minute wake but Centrifugo's token renewals don't, and a read of an overdue job wakes the worker; `env.test.ts`: `WORKER_WAKE_ON_USE` off in production unless set; `wake.test.ts`: at most one call a minute; `graphile.test.ts`: a runner that stops on its own (a breaking `worker:migrate`) reports a failure and our own stop doesn't; `packages/data/src/live/live.test.ts`: a tab hidden 5 minutes lets its connection go and connects, subscribes and catches up when shown; `relay.test.ts`: only a workspace failing at the longest wait for a quiet spell is named stuck; `queue.test.ts`: only the runners' own tasks count in the sleep check; `packages/db/src/client.test.ts`: the pool closes an idle connection after about 10 seconds by itself |
| AC-121 | `maintenance.test.ts`: a finished job keeps its refused items and loses the rest; jobs finished more than 30 days ago go with their items; `packages/db/src/queue.test.ts`: dead rows deleted, the waiting, locked and new rows kept |
| AC-123 | pending (the deploy, steps above) |

### Results

| Check | Result |
|---|---|
| `pnpm check` | pass (15 October 2026) |
| db, core, api suites | pass (15 October 2026): db 179, core 693, api 517 tests |
| `node packages/db/scripts/journal.ts 512a025` | pass (33 entries); drizzle-kit generate reports no changes |
| The real sleeping worker (`sleep.test.ts`, its own database) | pass, 57 seconds |
| Production: the compute suspends and wakes, an idle tab, the two assumptions, the first daily cleanup | pending (owner steps 3 to 7) |
