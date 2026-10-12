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
