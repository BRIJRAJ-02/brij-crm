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

The run fills both heavy slots first: A's job over 200,000 items and D's over 100,000 (batches of 500, 200 ms each), plus a second, 1,000 item heavy job in A. After 25 seconds, B's 1,000 item heavy job is queued, then a light job of 100 items in C every 3 seconds, 8 in all. "Queued" is the job's `created_at`, the start transaction's time; for A's and D's starts that includes inserting their items.

| Measure | Run 1 | Run 2 | Target |
|---|---|---|---|
| B's heavy job (1,000 items): queued to started | 14.16 s | 15.07 s | under 30 s |
| B's heavy job: started to finished | 0.45 s | 0.52 s | under 60 s |
| A's second heavy job: queued to started (it waits behind A's own) | 16.62 s | 18.42 s | |
| Light jobs in C: slowest queued to started (of 8) | 0.06 s | 0.03 s | under 2 s |
| Most heavy slices at once, per workspace (sampled every 100 ms) | A 1, B 1, D 1 | A 1, B 1, D 1 | at most 1 |
| A's big job, items done by the end of the run (about 70 s) | 91,000 | 82,500 | |
| Queue rows left once every job ended | 0 | 0 | 0 (AC-121) |

B waited for one of the two heavy slices to end (A's and D's slices take 20 seconds each) and then went ahead of A's and D's next slices, as the hand over queues each next slice behind everything already waiting. Light jobs never waited on the heavy lane.

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
| Fairness on the load stack | pass, twice (above) |
| Restart tests | pass, 3 runs in a row |
