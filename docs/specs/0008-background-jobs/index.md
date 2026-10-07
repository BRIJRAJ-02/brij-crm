# 0008. Background jobs: a fair, resumable job runner on Graphile Worker

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Long work (bulk edits, type changes, recomputing, the daily cleanup) runs in the worker, outside the request, so screens stay fast. Each job is a row in a tenant table that holds its status, progress and where it got to; Graphile Worker (a job queue that lives in Postgres) only decides when the next piece runs. Jobs run in short pieces of about 20 seconds, so a restart loses at most one batch, a cancel lands within a batch, and one workspace's huge job takes turns with everyone else's. Because Neon's free plan should be allowed to sleep, the worker (job runner and outbox relay together) closes every connection when nobody is using the app, and the API wakes it when someone is.

## Structure

- [0008-runner-and-kinds.md](0008-runner-and-kinds.md): the job contract every feature builds on: how a kind (a type of job) is declared, how the runner cuts work into slices and batches, leases, retries, item snapshots, coalescing, cancel, and the Graphile Worker binding with its exact rights.
- [0008-worker-sleep.md](0008-worker-sleep.md): how the worker lets the Neon compute sleep: awake and asleep states (the relay's active and dormant states from spec 0005 become the same thing), the wake call from the API, wake timers for scheduled work.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a member, I want a bulk change over thousands of records to run in the background with visible progress and a Cancel button, so I can keep working and stop it if I made a mistake.
- As a member, I want my job to finish even if the server restarts or a deploy lands halfway, so I never have to check whether half of it happened.
- As a member of a small workspace, I want my jobs to start promptly even while another workspace runs a huge import, so I'm never stuck behind a stranger.
- As an owner or admin, I want to see every job in my workspace, including the daily cleanup, and cancel any of them, so I can manage what runs.
- As a builder of a later feature (#14, #15, #16, #22, #28), I want one job contract with progress, cancel, resume, retries, snapshots and coalescing, so I write only the work itself.
- As the owner of this product, I want the database to sleep when nobody is using it, so the free Neon plan lasts the month.

**Acceptance criteria** (numbered after spec 0005's and the other features in flight, inside the range AC-102 to AC-131 reserved for #8):
- **AC-102**: A job is created and queued in the same transaction as the write that starts it: if the write rolls back, no job exists and nothing runs; if it commits, the job runs even when the API process dies right after. Starting a job again with the same client chosen id returns the job already made, not a second one.
- **AC-103**: A job survives a restart. On a graceful stop (SIGTERM, a deploy) the worker finishes the batch in hand, leaves the job queued, and a new worker carries on within 10 seconds of starting. After a hard kill (SIGKILL) the job carries on within 3 minutes of the worker coming back. In both cases no item is processed twice and none is skipped, checked on a 20,000 item test job by counting the effect on every item.
- **AC-104**: An unexpected error in a batch retries that batch with growing waits (about 3, 7, 20, 55 seconds and so on), up to the kind's attempt limit (8 for heavy kinds, 5 for light ones), and never redoes a batch that already committed. After the last attempt the job ends `failed` with `JOB_FAILED` and a plain message, the error is logged with the job id, and the progress made so far stays visible. A successful batch resets the count.
- **AC-105**: An expected refusal for one item (a value refused, a uniqueness clash, a record deleted since the snapshot) never fails the job. The item is marked refused or skipped with its code, the job carries on, and it ends `succeeded` with the counts. The result groups refusals by code, each with its count and up to 20 record ids.
- **AC-106**: A running job reports `done`, `refused`, `skipped` and `total` after every batch (`total` is empty for a kind that can't know it, and the bar is then indeterminate). Every viewer allowed to see the job sees its progress change at least every 3 seconds while it runs, through spec 0007's `jobs` change event (the job id in `item_ids`), stored at most once per second per job; the final state is always sent. The event names the job only on a channel whose every member may read it (spec 0009's rule); elsewhere it is coarse, and the viewers there refetch the unfinished jobs they hold.
- **AC-107**: The member who started a job, or a holder of `jobs.manage` (owners and admins, spec 0009), can cancel it. A job not yet running is cancelled at once. A running job stops before its next batch, within 5 seconds for kinds whose batches take under 5 seconds, and ends `cancelled` with the counts of what it did. Work already done stays done; undoing it belongs to the feature (for example #22's bulk delete undo). Cancelling a finished job answers 409 `JOB_FINISHED`; a kind that can't be cancelled answers 409 `JOB_NOT_CANCELLABLE`.
- **AC-108**: Work is fair between workspaces. While workspace A runs a heavy job over 200,000 items, workspace B's heavy job over 1,000 items starts within 30 seconds of being queued and finishes within 60 seconds of starting, and a light job in any workspace starts within 2 seconds. A workspace never runs more than one heavy slice at a time, and light jobs never wait behind heavy ones. Measured locally on the capped Docker stack with the test kind, numbers recorded in `verify.md`.
- **AC-109**: A job started with `confirm` first snapshots its target ids in the background (status `preparing`), then waits (status `ready`) showing the exact count. `jobs.confirm` queues it. A job left unconfirmed for 1 hour ends `cancelled` with `JOB_EXPIRED`. A confirmed job works on exactly the snapshotted ids, never on records created after the snapshot, and an item that changed since (deleted, for example) is checked again in its batch and skipped with a reason.
- **AC-110**: Starting a job with a coalescing key while a job of that kind and key is still waiting (`queued`, not yet started) adds the new items to that job and returns it instead of making a second one. A short start delay lets a burst of writes land in one job. At most one waiting job exists per kind and key.
- **AC-111**: A job can be started to run at a later time. It never runs before that time, and runs within 5 seconds after it while the worker is awake, or within 60 seconds when the worker had to wake for it.
- **AC-112**: Once a day at 03:00 UTC, the daily cleanup (1) purges records and list entries trashed more than 30 days ago, through the engine's purge, in batches of 500, one `maintenance.daily` job per workspace; (2) prunes the outbox through spec 0007's `crm_outbox_prune` (published rows older than `OUTBOX_RETENTION`, 24 hours), the same function the relay calls while awake; (3) deletes finished jobs older than 30 days and the done items of finished jobs; (4) queues again an unfinished job only when it is `queued` or `running` with `run_at` in the past, no live lease, and no queue row (read on the worker's `crm_worker` connection). A day missed while the worker was down or asleep runs once when it returns, never once per missed day, and a workspace never gets two cleanups for the same day.
- **AC-113**: Every job acts through the access door. A member's job runs as that member, entered again with spec 0009's `enterAsActor` at the start of every slice: if the member was removed, the job ends `failed` with `ACTOR_REMOVED`; if the workspace was deleted, it ends `cancelled` with `WORKSPACE_GONE`. System jobs run under spec 0009's `systemScope`, which only the worker can import (`@crm/core/system`). Item writes go through the engine and `outboxHook` like any other write.
- **AC-114**: A member sees the jobs they started; holders of `jobs.manage` (owners and admins) see every job in the workspace, system jobs included. Any other job id, a non member and an unknown workspace all answer the same 404 `NOT_FOUND`. Only the starter or a holder of `jobs.manage` may cancel or confirm.
- **AC-115**: The queue never crosses tenants. Every piece of job work runs inside `withWorkspace`. The queue (Graphile Worker's tables) holds only a workspace id and a job id per row. The API's login (`crm_app`) can add a job to the queue only through `crm_enqueue_job`; it can't read or change the queue, list workspace ids (`crm_outbox_workspaces` is revoked from it and `crm_workspace_ids` never granted) or delete outbox rows (`crm_outbox_prune` is never granted). Only the worker's login (`crm_worker`), which the relay also runs on, can. Guard tests prove each of these.
- **AC-116**: A workspace may hold at most 20 unfinished jobs started by members (system jobs don't count); one more answers 409 `LIMIT_REACHED`. A job holds at most 1,000,000 items; more answers 422 `JOB_TOO_LARGE`. Kind params are checked by the kind's schema on start (422 `CONFIG_INVALID`) and again at every slice.
- **AC-117**: With `WORKER_IDLE_SLEEP_SECONDS` above 0, the worker (job runner and relay) closes every database connection after that long with no work, no waiting queue rows, no unpublished outbox rows and no wake call, so the Neon compute can suspend. The API wakes it after a write that stored an outbox row or started a job, and on any authenticated request at most once a minute per API process, so it sleeps only when nobody uses the app; a job then starts within 5 seconds of its commit, and scheduled jobs and the daily cleanup wake it at their time. This holds on two assumptions, each checked: the API's and the worker's pools close an idle connection after 10 seconds (node-postgres's default; `createDatabase` sets none), and nothing probes the database on a timer (uptime monitors and Railway's health checks hit `/api/health` and the worker's `/health`, never `/api/health/ready`). On production the Neon compute is seen suspended within 10 minutes of the last use and the next sign in, edit and job still work; the check is recorded in `verify.md`.
- **AC-118**: Settings, Background jobs (`/w/$slug/settings/jobs`) lists unfinished jobs first, then those finished in the last 30 days, newest first, 50 at a time with "Show more": the kind's label, who started it ("System", or "A removed member" when the starter is no longer in the member list), status, a progress bar with "done of total", refused and skipped counts, started and finished times, the refusal summary, and Cancel (with a confirm step). It updates live, has loading, error with Retry, and empty states, works fully by keyboard with a visible focus ring, and meets contrast in light and dark. Members see only their own jobs there.
- **AC-119**: When a job the person started in this browser finishes while the app is open, a toast says how it ended ("Done", "Done, 6 refused", "Failed", "Cancelled") with a link to the job on the Background jobs page.
- **AC-120**: Each slice logs one JSON line when it starts and one when it ends (job id, kind, workspace id, slice number, batches, counts, duration, outcome), never params, values or messages that quote values. While awake, the worker logs the queue backlog and the oldest waiting job's age once a minute. `/health` on the worker answers its state (`awake` or `asleep`) without touching the database.
- **AC-121**: The queue keeps no history: a finished slice leaves no row behind, a final failure is recorded on the job and removed from the queue, a dead queue row (unlocked, its attempts used up) is deleted by the next daily cleanup, and a job's done and skipped items are deleted by the next daily cleanup after it finishes. Refused items stay with their job until the job is deleted, 30 days after it finished.
- **AC-122**: Every kind passes one shared contract test: its params schema is strict and holds no secrets; the queue payload holds ids only; replaying its last committed batch changes nothing (the batch is idempotent); and each runner call returns within 30 seconds.
- **AC-123**: The runner, the daily cleanup and the Background jobs page run in production on `brij-crm-phi.vercel.app`. The test kind (`dev.simulate`) is registered only locally and in previews, and production answers `NOT_FOUND` for it.

## Decision

**Chosen option**: Option 1: Graphile Worker as the engine that wakes and orders work, with a tenant `jobs` table as the truth about each job, long jobs cut into slices of about 20 seconds that queue themselves again, a heavy lane serialised per workspace and a separate light lane.

The API starts a job by writing a `jobs` row and calling `crm_enqueue_job(job_id)` in the same transaction; the worker's runner claims a lease on the job, runs batches (each one engine transaction that also saves the checkpoint and the progress), checks for a cancel between batches, and after about 20 seconds queues the next slice behind everyone already waiting.

Decisions taken from the brief's recommendations and the cross check of 8 October 2026:
- **Code emails stay in the request.** A sign in code is a live secret; a job would store it in the queue. Mail without secrets (invites, notifications, reminders) runs as light jobs when those features arrive. This answers spec 0005's follow up "code emails as jobs".
- **The worker sleeps on Neon's free plan** (`WORKER_IDLE_SLEEP_SECONDS`, 180 by default, the relay's 3 quiet minutes from spec 0005), and the relay is active exactly while the worker is awake.
- **A test kind in previews** (`dev.simulate`) proves progress, cancel, resume and fairness by clicking, since the first real user kinds belong to #14, #16 and #22.
- **Roles and system power come from spec 0009**: `members.role`, the `jobs.manage` permission, `enterAsActor` and `systemScope` from `@crm/core/system`. This spec adds no role column and no door entry of its own.
- **Job events are spec 0007's `jobs` kind**: the job id in `item_ids`, the starter in `actor_member_id`, and spec 0009's rule decides which channels may name it.

**Implementation skills**: `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `drizzle` (`lobehub/lobehub`, `.claude/skills/drizzle/`) · `use-railway` (`railwayapp/railway-skills`, `.claude/skills/use-railway/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `db-core` and `react-db` (`tanstack/db`, `.claude/skills/db-core/`, `.claude/skills/react-db/`) · `react-aria` (`.claude/skills/react-aria/`) · house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`, `crm-design-system`. No skill exists for Graphile Worker; its own documentation for the pinned version (0.18.0) is the reference.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Dependencies**:
- **Spec 0005 milestone 3** (hard prerequisite): the outbox, `outboxHook` composed by `writeHooks`, the relay with its active and dormant states, the API's wake call (`POST /internal/outbox-wake` on `WORKER_INTERNAL_URL`, header `x-crm-wake` holding `WORKER_WAKE_SECRET`) and the worker's endpoint for it. No temporary poll and no conditional migration: this spec starts after it.
- **Spec 0009 milestone 1**: `members.role` (with the owner backfill), `jobs.manage`, `enterAsActor` and `systemScope` in `@crm/core/system`, and the lint rule that lets `apps/api/src/jobs/**` import it.
- **Spec 0007 milestones 1 and 2**: the `jobs` kind in `ChangeEvent` and the outbox enum, `item_ids` and `actor_member_id`, `outboxHook` writing `jobs` rows from `Change.jobs`, the live router (`live.on('jobs', …)`), and the relay planning every row through spec 0009's `filterEvent`, so a job id never reaches a member who can't read it. **Spec 0007 milestone 3** (`crm_outbox_prune`, granted to the `crm_worker` role this spec creates in milestone 1) lands before milestone 3 here, whose daily cleanup calls it.
- **Spec 0006**: `data.jobs` uses the coarse coalescing (one refetch a second, jittered) for coarse `jobs` events.
- **#13**: `SettingsLayout`, if pulled forward; else the AppShell page frame.

**Build order across specs 0006 to 0009** (the same list in all four specs; one item at a time, each landed and checked before the next):
1. Spec 0005 milestone 3: the outbox, `outboxHook` and the `writeHooks` composer, the active and dormant relay woken by the API, the `workspace` channel.
2. Spec 0006 milestones 1 to 3.
3. Spec 0007 milestone 1: catch up from the outbox, and the outbox migration that adds every event kind.
4. Spec 0009 milestone 1: roles, the sealed scope, `@crm/core/system` (`enterAsActor`, `systemScope`), the pure policy functions.
5. Spec 0007 milestone 2: every kind of change live, each row planned through spec 0009's `filterEvent`.
6. Spec 0008 milestones 1 and 2: the job runner and the `crm_worker` login.
7. Spec 0007 milestone 3: the outbox pruned.
8. Spec 0008 milestone 3: the daily cleanup and the sleeping worker.
9. Spec 0009 milestone 2: hidden means absent.
10. Spec 0009 milestone 3 with spec 0007 milestone 4, in one release: audience channels, the stub, access changes.
11. Spec 0007 milestone 5: delivery measured at 100 and 1,000 online.

**Data model sketch** (the target; one migration in milestone 1, a second in milestone 3 for the cleanup's workspace listing):

| Table or object | Schema | Key | Columns and rules |
|---|---|---|---|
| `jobs` | `public` | (`workspace_id`, `id`) | `id` uuid v7 (client chosen for member jobs, the idempotent start key). `kind` text (a registered kind, checked by the registry; Zod `JobKind` in contracts). `lane` `job_lane` enum (`heavy`, `light`), from the kind. `status` `job_status` enum (`preparing`, `ready`, `queued`, `running`, `cancelling`, `succeeded`, `failed`, `cancelled`). `params` jsonb not null (the kind's Zod schema; ids and settings, never secrets). `subject_type` text null (`object`, `attribute`, `list`) and `subject_id` uuid null: what the job works on, so a feature can ask "is something running on this attribute". `dedupe_key` text null (coalescing). `once_key` text null (a server side start that must happen once, such as `maintenance:2026-10-04`). `priority` smallint (0 for member jobs, 10 for system ones). `run_at` timestamptz. `total`, `done`, `refused`, `skipped` integer (`total` null when unknown; the others default 0, all ≥ 0). `checkpoint` jsonb null (the kind's own resume point). `result` jsonb null (the kind's summary, refusal groups included). `error_code` text null, `error_message` text null. `attempts` smallint default 0 (consecutive failed tries of the current batch). `lease_owner` text null, `lease_until` timestamptz null. `slices` integer default 0. `expires_at` timestamptz null (for `ready`). `cancel_requested_at` timestamptz null, `cancel_requested_by_member_id` uuid null → members. `created_at`, `created_by` actor columns (member or system, with `actorConstraints`), `started_at`, `finished_at`, `updated_at`. Forced row level security: the standard policy, plus a `select` policy with the same workspace condition for `crm_queue` (so `crm_enqueue_job` reads the row under row level security). |
| `jobs` indexes | | | partial unique (`workspace_id`, `kind`, `dedupe_key`) where `status` = `queued` and `slices` = 0; unique (`workspace_id`, `kind`, `once_key`) where `once_key` is not null; (`workspace_id`, `created_by_member_id`, `created_at` desc, `id`) for "my jobs"; (`workspace_id`, `created_at` desc, `id`) for "all jobs"; (`workspace_id`, `subject_id`) where unfinished; (`workspace_id`, `finished_at`) where finished, for retention. |
| `job_items` | `public` | (`workspace_id`, `job_id`, `position`) | `item_id` uuid (a record id, or another id the kind names). `state` `job_item_state` enum (`pending`, `done`, `refused`, `skipped`). `code` text null, `message` text null. Unique (`workspace_id`, `job_id`, `item_id`), so a merged item is never added twice. Foreign key (`workspace_id`, `job_id`) → `jobs` on delete cascade. Index (`workspace_id`, `job_id`, `code`) where `state` = `refused`. Forced row level security, the standard policy. |
| `outbox` | `public` | existing | nothing added here: `jobs` rows use spec 0007's `jobs` kind, `item_ids` (the job ids) and `actor_member_id` (the starter; null for system jobs). |
| `graphile_worker.*` | `graphile_worker` | Graphile's own | `graphile-worker` 0.18.0 (schema migrations 000001 to 000020): the tables `_private_jobs`, `_private_job_queues`, `_private_tasks`, `_private_known_crontabs` and `migrations`, the view `jobs`, the functions `add_job`, `add_jobs`, `complete_jobs`, `force_unlock_workers`, `permanently_fail_jobs`, `remove_job`, `reschedule_jobs` and Graphile's internal ones. Installed and upgraded by Graphile's own migrations, run by `scripts/migrate.ts` as the owner before ours. No row level security; rows hold `{ workspaceId, jobId }` only. |
| `crm_worker` | role | | No login, `INHERIT`s `crm_app`, no `BYPASSRLS`. On Graphile's schema: `usage`; `select`, `insert`, `update`, `delete` on every table above and `select` on the view; `execute` on every function; never `create`. Execute on `crm_outbox_workspaces` (moved here from `crm_app`), `crm_workspace_ids` (milestone 3) and spec 0007's `crm_outbox_prune`. The worker's direct connection logs in as `crm_worker_user`, a login in this group made by `pnpm db:worker-login`; the relay runs on it. The worker's pooled `DATABASE_URL` stays the app login (the local PgBouncer knows only that one). |
| `crm_queue` | role | | No login, no bypass. Owns `crm_enqueue_job`. Exactly these rights, for Graphile 0.18.0, where `add_job` runs with its caller's rights and calls `add_jobs`: `usage` on schema `graphile_worker`; `execute` on `graphile_worker.add_job` and `graphile_worker.add_jobs`; `usage` on the type `graphile_worker.job_spec`; `select`, `insert` on `graphile_worker._private_tasks` and `graphile_worker._private_job_queues`; `select`, `insert`, `update` on `graphile_worker._private_jobs` (`add_jobs` clears the key of a locked row and upserts on the key); `select` on the `jobs` columns the function reads. No `delete`, nothing on `_private_known_crontabs` or `migrations`. Identity columns need no sequence grant. |
| `crm_sweep` | role | | No login, `BYPASSRLS`, `select (id, deleted_at)` on `workspaces` only. Owns `crm_workspace_ids`. |
| `crm_enqueue_job(job_id uuid, run_at timestamptz default null)` | function | | Security definer owned by `crm_queue`, execute granted to `crm_app` (so `crm_worker` inherits it). Reads the job under the caller's workspace setting (row level security still applies), refuses unless it is `queued`, `running` or `preparing`, and calls `graphile_worker.add_job` with task `crm_job_heavy` or `crm_job_light`, payload `{ workspaceId, jobId }`, queue `heavy:<workspace_id>` for heavy jobs (none for light), the job's priority, `run_at`, `max_attempts` 25, job key `crm-job:<id>` and `job_key_mode` `'replace'`, named explicitly on every path (see the runner child). A quoted `language sql` body (late bound, so a Graphile upgrade that recreates `add_job` never fails on it), `search_path = pg_catalog, pg_temp`, qualified names. |
| `crm_workspace_ids(after uuid, max integer)` | function | | Security definer owned by `crm_sweep`, execute granted to `crm_worker` only. Returns ids of workspaces not deleted, after `after`, in id order, at most `max` (clamped 1 to 500). Ids only. Same hardening as `crm_search_text`. |

**State transitions** (`jobs.status`):

```
preparing → ready → queued → running → succeeded | failed | cancelled
preparing → queued                      (snapshot done, started without confirm)
queued → running                        (first slice)
running → running                       (a slice ends and the next one is queued; status stays running)
preparing | ready | queued → cancelled  (cancel, expiry, or WORKSPACE_GONE)
running → cancelling → cancelled        (cancel seen before the next batch)
preparing | running → failed            (attempts used up, ACTOR_REMOVED, JOB_INVALID)
```

A finished job (`succeeded`, `failed`, `cancelled`) never changes again; it is deleted 30 days after `finished_at`.

**API surface** (oRPC on `/api/rpc`, all on `member` with `WorkspaceScoped` input; refusals as `{ code, message, data? }`):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `jobs.list` | `workspace`, `scope` (`mine`, `all`; `all` needs `jobs.manage`), `cursor?`, `limit` ≤ 50 | { jobs: JobView[], nextCursor? }, unfinished first, then newest first | member | 404 |
| `jobs.get` | `workspace`, `jobId` | JobView | the starter, or `jobs.manage` | 404 `NOT_FOUND` |
| `jobs.cancel` | `workspace`, `jobId` | JobView | the starter, or `jobs.manage` | 404; 409 `JOB_FINISHED`, `JOB_NOT_CANCELLABLE` |
| `jobs.confirm` | `workspace`, `jobId` | JobView (now `queued`) | the starter, or `jobs.manage` | 404; 409 `JOB_NOT_READY`, `JOB_EXPIRED`, `JOB_FINISHED` |
| `jobs.startTest` (local and previews only) | `workspace`, `id` uuid v7, `items` 1 to 200,000, `batchSize` ≤ 5,000, `batchMillis` 0 to 2,000, `failAtPosition?`, `refuseEvery?`, `confirm?` | JobView | `jobs.manage` | 404 in production; 409 `LIMIT_REACHED`; 422 `CONFIG_INVALID` |
| core `startJob(context, input)` (no procedure: each feature's own write procedure calls it inside its transaction) | `id`, `kind`, `params`, `subject?`, `items?` (ids), `snapshot?`, `confirm?`, `runAt?`, `dedupeKey?`, `onceKey?` | `{ jobId, merged: boolean }` | the feature's own check | 409 `LIMIT_REACHED`, 422 `JOB_TOO_LARGE`, `CONFIG_INVALID` |

`JobView`: `{ id, kind, label, status, subject?, total?, done, refused, skipped, startedBy: { type: 'member' | 'system', memberId? }, createdAt, startedAt?, finishedAt?, retryAt?, expiresAt?, error?: { code, message }, result?, cancellable }`.

**Status codes**: 404 `NOT_FOUND` (unknown job, a job you may not see, non member), 409 `JOB_FINISHED`, `JOB_NOT_CANCELLABLE`, `JOB_NOT_READY`, `JOB_EXPIRED`, `LIMIT_REACHED`, 422 `JOB_TOO_LARGE`, `CONFIG_INVALID`. On the job itself (`error.code`, never an HTTP answer): `JOB_FAILED`, `JOB_INVALID` (params no longer parse, or an unknown kind after a deploy), `ACTOR_REMOVED`, `WORKSPACE_GONE`, `JOB_EXPIRED`. New codes join `ERROR_MAP` in `packages/contracts`.

**The jobs change event** (spec 0007's `jobs` kind):

```json
{ "seq": 57, "at": "…", "kind": "jobs", "jobIds": ["…"], "coarse": false }
```

Ids only. `Change.jobs` holds `{ jobId, startedBy }`; `outboxHook` writes one `jobs` row per starter, with the job ids in `item_ids` and the starter in `actor_member_id` (null for system jobs), so an admin's cancel still names the starter. Spec 0009's `filterEvent` keeps a job id only on a channel whose every member is the starter or holds `jobs.manage`; elsewhere the event is `coarse` with no ids. The browser then calls `jobs.get` for named jobs, or, on a coarse event, refetches the unfinished jobs the tab holds (spec 0006's coalescing: at most once a second, jittered).

**Worker endpoints** (the worker's own HTTP server, no public domain, reached over Railway's private network):

| Path | Method | Does | Answers |
|---|---|---|---|
| `/health` | GET | the state, from memory only | `{ status: 'ok', state: 'awake' \| 'asleep', relay: { … } }` (spec 0007's relay numbers) |
| `/internal/outbox-wake` (spec 0005, kept) | POST | no body; checks the `x-crm-wake` header against `WORKER_WAKE_SECRET` in constant time; wakes the whole worker (runners and relay) if asleep, else restarts its idle clock | 204; 401 `UNAUTHENTICATED` without the right secret; 405 for another method (as shipped) |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| start | the job id | the client's uuid v7 for member jobs (the idempotent retry key); `uuidv7()` for system jobs |
| start | the lane, cancellable, attempt limit, batch size | the kind's definition in the registry (`packages/core/src/jobs/kinds/`) |
| start | the actor | `context.scope.actor` from the access door (member jobs) or `systemScope` from `@crm/core/system` (system jobs, spec 0009) |
| start | priority | 0 for member jobs, 10 for system jobs (constants in the runner) |
| start | `run_at` | `runAt` input, else `now()` plus the kind's start delay (0, or the coalescing window a kind declares, such as 1 second) |
| start | the limit check | `count(*)` of the workspace's unfinished member jobs, under the `workspace_counters` row lock, against 20 |
| start, snapshot | `total` | the number of `job_items` rows (explicit items, or the snapshot when it finishes); else the kind's own `total` or null |
| snapshot | which ids | the kind's `snapshot` query, keyset paged, 5,000 per transaction, with `created_at` ≤ the start's `asOf` |
| `ready` | `expires_at` | the time the snapshot finished plus 1 hour |
| enqueue | task, queue name, payload, job key, key mode | `crm_enqueue_job` from the job row: `crm_job_<lane>`, `heavy:<workspace_id>` or none, `{ workspaceId, jobId }`, `crm-job:<id>`, `replace` |
| slice | the actor's scope | `enterAsActor(deps, { workspaceId, actor })` from `@crm/core/system` for a member's job (spec 0009; `NOT_FOUND` becomes `ACTOR_REMOVED`), `systemScope(db, workspaceId)` for a system job |
| slice | the lease | `lease_owner` = this worker's id (`<hostname>:<pid>:<start time>`), `lease_until` = now + 60 seconds, extended after each batch |
| slice | when to stop | 20 seconds since the slice began (the budget), a cancel request, or a shutdown signal, checked between batches |
| batch | which items | `job_items` with `position` > `checkpoint.position`, `state` = `pending`, by position, `limit` the kind's batch size |
| batch | `done`, `refused`, `skipped`, item states, `checkpoint` | the kind's step outcome, written by the runner in the same engine transaction as the work |
| batch | the outbox rows | the engine's `Change` through the same `writeHooks` composer and `outboxHook` as the API (spec 0005) |
| progress event | whether to store one | the runner's last send time for that job, in its own closure: at most one per second, always the last |
| progress event | its starter | `Change.jobs[].startedBy` → `outbox.actor_member_id` |
| retry | `retryAt` shown | Graphile's `run_at` for the job key, read back into `jobs.run_at` when the runner records a failed try |
| retry | the wait | Graphile Worker's backoff, `exp(min(attempt, 10))` seconds |
| final failure | `attempts` limit | the kind's `maxAttempts` (8 heavy, 5 light), counted in `jobs.attempts`; Graphile's own limit (25) is only a backstop |
| see, cancel, confirm | who may | the starter (`created_by_member_id` = the actor), or `can(access, 'jobs.manage')` (spec 0009) |
| result | the refusal summary | `job_items` where `state` = `refused`, grouped by `code`: count and the first 20 `item_id` by position |
| list, page | the label | `JOB_KINDS[kind].label` in `packages/contracts` (for example "Daily cleanup", "Test job") |
| list, page | "started by" | `members.name` for `created_by_member_id` from the definitions store's members (spec 0006); "A removed member" when the id isn't there (the list holds active members only); "System" for system jobs |
| list | cursor | (`created_at`, `id`) of the last row, unfinished first in a separate first page |
| daily cleanup | when | Graphile cron item `0 3 * * *` with `?fill=1d`, on a worker running with `TZ=UTC` |
| daily cleanup | which workspaces | `crm_workspace_ids(after, 500)`, paged, on the worker's `crm_worker` connection |
| daily cleanup | once per day | `once_key` = `maintenance:<UTC date>` |
| daily cleanup | what is old | the engine's `RESTORE_WINDOW` (30 days) for trash; spec 0007's `OUTBOX_RETENTION` (24 hours) through `crm_outbox_prune` for the outbox; `finished_at` older than 30 days for jobs |
| daily cleanup | whether to queue a job again | `status` `queued` or `running`, `run_at` in the past, `lease_until` empty or past, `updated_at` older than an hour, and no row with key `crm-job:<id>` in `graphile_worker._private_jobs` (read through the runner's `queue` dependency on the `crm_worker` connection) |
| sleep | when to sleep | `WORKER_IDLE_SLEEP_SECONDS` (default 180) with no running slice, no queue row due, no unpublished outbox row and no wake call |
| sleep | when to wake | a wake call, or a timer for the earliest of: the next queue `run_at`, the next cron time (minus 30 seconds), a lease expiry, 24 hours |
| wake call | when the API sends one | after commit of a write whose hooks stored an outbox row or whose `startJob` queued a job (the `writeHooks` composer and `startJob` set one flag on the request); on any authenticated request at most once a minute per API process; from `jobs.get` and `jobs.list` when they return a job `queued` more than 5 seconds past its `run_at` |
| wake call | where and how | `POST <WORKER_INTERNAL_URL>/internal/outbox-wake` with `x-crm-wake: <WORKER_WAKE_SECRET>`; at most one in flight and one queued, 1 second timeout, failures logged at most once a minute and otherwise ignored (spec 0005's `createRelayWake`) |
| toast | which jobs to tell about | the ids this browser started, kept by `data.jobs` for the session |

**Key invariants**:
- The `jobs` row is the truth; the queue only says when to run next. A queue row stays until the runner call that took it returns, so a crash leaves it locked, never gone. If one is lost anyway, the job is delayed, never changed: the daily cleanup queues it again under the rule above.
- A job and its queue row are written in the same transaction as the write that starts them.
- Every batch is one engine transaction that does the work, writes the item states, the counters, the checkpoint and the outbox rows together. A batch either happened completely, with its checkpoint, or not at all.
- At most one runner works on a job at a time: the lease. A second queue row for the same job (a deploy overlap, a stale lock released) finds the lease held and queues itself again for `lease_until`.
- Every enqueue uses job key `crm-job:<id>` with `job_key_mode` `replace`, so a job has at most one available queue row.
- Every runner call returns within 30 seconds. A queue lock older than 2 minutes therefore belongs to a dead process, and the worker releases it on start and once a minute while awake.
- A workspace runs at most one heavy slice at a time (its own queue name), and a slice that ends queues its successor behind everything already waiting.
- Queue payloads hold a workspace id and a job id only. Params, values and messages live in the tenant tables, behind row level security.
- Only the worker builds a system scope, lists workspaces, reads the queue or prunes the outbox.
- A finished job never changes.

**Security model**:
- `jobs` and `job_items` are tenant tables with forced row level security; all job work runs inside `withWorkspace` as `crm_app` (the worker's pooled connection), so a job can't touch another workspace even if its code is wrong.
- The queue is the one place outside row level security, and holds only ids. `crm_app` (the API) can't read it or change it: it can only call `crm_enqueue_job`, which takes a job id, checks the job is in the caller's workspace and runnable, and builds the queue row itself, so the API can't choose a task, a payload or another workspace. `crm_queue` holds only the rights `add_job` needs in the pinned version.
- The worker's direct connection logs in as `crm_worker_user` (group `crm_worker`), the only login with queue rights, the only one that may run `crm_outbox_workspaces`, `crm_workspace_ids` and `crm_outbox_prune`, and the relay's login. The guard tests list the definer functions (`crm_search_text`, `crm_outbox_workspaces`, `crm_outbox_prune`, `crm_enqueue_job`, `crm_workspace_ids`), the roles and the exact grants, and fail if anyone else can reach them or if a fourth login can bypass row level security. The worker refuses to start if its direct login isn't in `crm_worker` or can bypass row level security.
- A member job runs as its member through `enterAsActor` at every slice, so a member removed or demoted is seen at the next slice. System jobs run under `systemScope`, which lint keeps to the worker entry, `apps/api/src/jobs/**`, `apps/api/src/realtime/**` and core scripts (spec 0009).
- Job visibility: the starter and holders of `jobs.manage`. Events carry ids only and name a job only to channels that may read it (spec 0009). Refusal messages are stored as the engine wrote them; spec 0009 AC-144 (messages never quote what the actor can't read) applies to them too.
- The worker has no public domain; the wake endpoint takes no body, checks the shared secret in constant time, and only makes the worker look at the queue and the outbox. `.railway/railway.ts` declares no domain for it, and a config test checks that.
- No params, values, codes or messages appear in logs.
- `security-access-reviewer` reviews milestones 1 and 3 before they land; `state-performance-reviewer` reviews milestones 2 and 3.

**Configuration required**:
- `DATABASE_URL_DIRECT` (worker): now the `crm_worker_user` login on the direct (unpooled) host. `pnpm db:worker-login` creates it (through `scripts/login.ts`, `--plain-password` on Neon) and `pnpm db:setup` runs it after the other two. Railway keeps it with `preserve()` as today. The worker's `DATABASE_URL` stays the API's (the app login, pooled).
- `WORKER_IDLE_SLEEP_SECONDS` (worker): seconds of idleness before the worker closes its connections; default 180 (spec 0005's relay goes dormant after 3 quiet minutes today, and this keeps that); `0` never sleeps (for a paid Neon plan, or to debug locally).
- `WORKER_INTERNAL_URL` and `WORKER_WAKE_SECRET` (api), `WORKER_WAKE_SECRET` (worker): as spec 0005 set them; nothing new.
- `TZ=UTC` (worker): cron times are UTC.
- `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` (worker): time between SIGTERM and SIGKILL, enough for the batch in hand.
- No new secrets. New pinned dependency: `graphile-worker` `0.18.0` (the latest release on npm on 8 October 2026; not yet in the catalog or `node_modules`), pinned exactly in the catalog. An upgrade is its own change: rerun the grant guard test, since a new version may rename its private tables.

**Critical test scenarios**:
- Happy path: a member starts the test job with 20,000 items in a preview; the Background jobs page shows progress moving and a second browser (the same member, and an admin) sees it too; it ends `succeeded` and the starter gets a toast, verifies **AC-102**, **AC-106**, **AC-118**, **AC-119**, **AC-123**.
- Transaction: a feature write that starts a job and then is refused leaves no job and no queue row; a retried start with the same id returns the same job, verifies **AC-102**.
- Restart: SIGTERM mid job, then a new worker; SIGKILL mid batch, then a new worker; every item's effect counted exactly once (a test kind writing to a test only effects table, in the real Postgres), verifies **AC-103**, **AC-122**.
- Failure: a batch that throws twice then passes retries with backoff and finishes; one that always throws ends `failed` after its limit with the counts kept; refused items appear grouped by code, verifies **AC-104**, **AC-105**.
- Cancel: cancel a queued job (at once) and a running one (before its next batch); cancel a finished one (409), verifies **AC-107**.
- Fairness: workspace A's 200,000 item heavy job, B's 1,000 item heavy job and a light job in C, with start and finish times measured, verifies **AC-108**.
- Snapshot: start with `confirm`, see `ready` with the count, confirm; another left alone expires after an hour (the clock injected), verifies **AC-109**.
- Coalescing and scheduling: three starts with one key within the delay make one job with all items; a job for 10 seconds from now doesn't run before then, verifies **AC-110**, **AC-111**.
- Queue keys (against 0.18.0): a hand over while the current row is locked leaves exactly one available row with the new `run_at`, and the locked row (key cleared by `add_jobs`) is deleted when the call returns; a lease requeue sets `run_at` to `lease_until`; an enqueue for a job whose unlocked row waits replaces its `run_at` instead of adding a second row; `crm_queue`'s grants equal the list above, verifies **AC-102**, **AC-103**, **AC-115**.
- Cleanup: trashed records 31 days old are purged, 29 days old kept; the outbox pruned through `crm_outbox_prune`; old jobs and dead queue rows deleted; a job with a live lease or a queue row is never queued again, one with neither is; a second run the same day does nothing; a missed day runs once, verifies **AC-112**, **AC-121**.
- Auth: a member reads another member's job (404), a non member (404), a member cancels someone else's job (404 since they can't see it), an admin cancels it (ok, and the event still names the starter); a removed member's running job fails `ACTOR_REMOVED`; a `jobs` event never names a job on a channel with a member who can't read it, verifies **AC-106**, **AC-113**, **AC-114**.
- Tenancy: `crm_app` can't select from or update the queue tables, can't run `crm_outbox_workspaces`, `crm_workspace_ids` or `crm_outbox_prune`; `crm_enqueue_job` refuses a job id from another workspace; the relay runs as `crm_worker_user`, verifies **AC-115**.
- Limits: the 21st member job and a 1,000,001 item job are refused, verifies **AC-116**.
- Sleep: with a short idle time the worker closes its connections (seen in `pg_stat_activity`), a write wakes it and its job starts within 5 seconds; a read only session wakes it once a minute at most; a scheduled job wakes it; the API's pool holds no connection 10 seconds after the last request; on production the compute suspends, verifies **AC-111**, **AC-117**.
- Logs and health: a slice's log lines carry no params; `/health` answers while asleep with no database query, verifies **AC-120**.

## Build plan

Tracer Bullet: each milestone ends with something you can click, locally and in a preview, and the page runs in production from milestone 1. The milestones sit in the build order above.

**Milestone 1: one job, start to finish, on a page** (after spec 0009 milestone 1 and spec 0007 milestone 2)
1. Migration: `graphile-worker` 0.18.0 pinned in the catalog; `scripts/migrate.ts` runs Graphile Worker's own migrations as the owner before ours and grants its rights to `crm_worker` and `crm_queue` after; enums, `jobs` (with the `crm_queue` select policy), `job_items`, the roles `crm_worker` and `crm_queue`, `crm_enqueue_job`; `crm_outbox_workspaces` granted to `crm_worker` and revoked from `crm_app`; the guard tests extended (tenant tables, the definer functions, the roles, the exact Graphile grants, the queue unreadable by `crm_app`), satisfies **AC-102**, **AC-115**
2. `pnpm db:worker-login`, `db:setup` updated, the worker's direct connection (and so the relay) switched to it locally, in previews and in production; the worker refuses to start if its direct login isn't in `crm_worker` or can bypass row level security, satisfies **AC-115**
3. Contracts: `JobKind`, `JOB_KINDS` labels, `JobView`, `QueuePayload` (strict, ids only), the new error codes, the `jobs.*` procedures, satisfies **AC-114**, **AC-116**, **AC-122**
4. Core: the kind registry and its contract test, `startJob` (limits, idempotent start, items), `getJob`, `listJobs`, `cancelJob`, `confirmJob` (visibility and cancel by the starter or `jobs.manage`), the runner (lease, slices, batches with checkpoint and progress in the engine transaction, cancel between batches, `enterAsActor` and `systemScope` from `@crm/core/system`, throttled `Change.jobs` through `outboxHook`), see [0008-runner-and-kinds.md](0008-runner-and-kinds.md), satisfies **AC-102**, **AC-105**, **AC-106**, **AC-107**, **AC-113**, **AC-114**, **AC-122**
5. The `dev.simulate` kind (synthetic items, `batchMillis`, `failAtPosition`, `refuseEvery`), registered only when `APP_ENV` is `local` or `preview`; `jobs.startTest`, satisfies **AC-123**
6. The worker: `apps/api/src/jobs/graphile.ts` as the one file in `apps/api` that imports `graphile-worker` (lint's vendor list), two runners on one pool (heavy 2, light 4), the tasks `crm_job_heavy` and `crm_job_light`, `job_key_mode` `replace` on every enqueue, graceful shutdown at a batch boundary, stale lock release on start and each minute, slice logs, `/health` state, satisfies **AC-103**, **AC-108**, **AC-120**
7. The api: `modules/jobs/router.ts` (thin, on `member`); `startJob` sets the request's wake flag, so the worker wakes after the commit, satisfies **AC-114**, **AC-117**
8. The data layer: `data.jobs` (one store per workspace, the `jobs` handler on spec 0007's live router: `jobs.get` for named jobs, the unfinished jobs it holds on a coarse event, the finish toast for jobs this browser started), satisfies **AC-106**, **AC-119**
9. The page: Settings, Background jobs, from library parts only (Table, ProgressBar, Badge, Button, Modal for the cancel confirm, RelativeTime, EmptyState, Toast; inside `SettingsLayout` if #13 has pulled it forward, else the AppShell page frame), "A removed member" for a starter no longer listed, plus "Run a test job" in previews; `ux-interaction-reviewer` and `design-system-guardian`, satisfies **AC-118**, **AC-119**
10. Deploy; run the test job in a preview, open the empty page in production; `security-access-reviewer` before it lands, satisfies **AC-115**, **AC-123**

**Milestone 2: dependable and fair**
11. Retries: failed tries counted on the job, backoff from Graphile, `retryAt` shown, the final failure recorded and removed from the queue; params checked again each slice (`JOB_INVALID`), satisfies **AC-104**, **AC-116**, **AC-121**
12. Snapshot and confirm: `preparing` slices filling `job_items` by keyset, `ready` with `expires_at`, `jobs.confirm`, expiry, items checked again in their batch and skipped with a reason, satisfies **AC-109**
13. Coalescing (`dedupe_key`, merged items, the start delay), `once_key`, and `runAt` scheduling, satisfies **AC-110**, **AC-111**
14. The restart tests (SIGTERM and SIGKILL, exactly once effects, a deploy overlap with two workers held apart by the lease) and the queue key tests against 0.18.0, satisfies **AC-103**
15. The fairness measurement on the capped local stack, written to `verify.md`; `state-performance-reviewer` before it lands, satisfies **AC-108**

**Milestone 3: the daily cleanup and a sleeping database** (after spec 0007 milestone 3)
16. Migration: `crm_sweep` and `crm_workspace_ids`, granted to `crm_worker` only; guard tests, satisfies **AC-112**, **AC-115**
17. Engine: `purgeDeleted`'s loop becomes `purgeBatch(context, …)` run by the runner, and its batch picks doomed records and locks their lists before the records, the order entry writes take (spec 0005's follow up; erasure gets the same order), satisfies **AC-112**
18. The daily cleanup: `crm_cron_daily` (cron `0 3 * * *` with one day of fill) prunes the outbox through `pruneOutbox` (spec 0007), deletes dead queue rows, and starts one `maintenance.daily` per workspace with `once_key`; the `maintenance.daily` kind (purge, job retention and item cleanup, and queueing again only the jobs the rule allows, as checkpoint phases), satisfies **AC-112**, **AC-121**
19. The worker lifecycle: awake and asleep, closing every connection, the relay active exactly while awake (its own dormancy replaced by the worker's idle clock), the wake timer, the wake endpoint waking the whole worker; the API's wake call after writes that stored an outbox row or started a job and on any authenticated request once a minute; Railway variables (`WORKER_IDLE_SLEEP_SECONDS`, `TZ`, draining), see [0008-worker-sleep.md](0008-worker-sleep.md), satisfies **AC-111**, **AC-117**
20. Deploy; watch the Neon compute suspend and wake in production and record it, with the two assumptions checked (no idle pool connection after 10 seconds, no timed probe); see the first daily cleanup on the page as an owner; `security-access-reviewer` and `state-performance-reviewer` before it lands; `verify.md` with every result, satisfies **AC-112**, **AC-117**, **AC-123**

## Consequences

**Positive**:
- Every later slow feature (#14, #15, #16, #22, #28, imports and exports) writes only its step function; progress, cancel, resume, retries, fairness and the page come free.
- A job can never describe work that rolled back, and never get lost after its write committed.
- One workspace's huge job takes turns with everyone else's, and short jobs have their own lane.
- The database can sleep, so the free Neon plan lasts the month.

**Negative / tradeoffs**:
- More moving parts than a plain queue: a lease, a checkpoint per kind, slices that queue themselves again, two lanes. Each kind must be written as resumable batches, which is harder than one long function.
- A third login (`crm_worker_user`) and two more definer functions; the queue is a deliberate gap in row level security, kept to ids. `crm_queue`'s grants name Graphile's private tables, so a Graphile upgrade may need new grants (the guard test fails first).
- Heavy work is capped at two slices at once on the one worker; a busy day with many workspaces running heavy jobs queues them (each waits its turn of 20 seconds). #12's load harness decides when to add a second worker replica, which the lease already allows.
- While the worker sleeps, the first live event or job after an idle spell waits for it to connect (and for Neon's cold start, a few hundred milliseconds to a few seconds). The once a minute wake on any request keeps this to the first request after a quiet spell.
- A job's progress reaches a member who shares a channel with people who can't read the job only as a coarse event, so their tab refetches every unfinished job it holds, up to once a second.
- Writing progress and an outbox row every batch adds a little write load and holds the workspace counter row for each batch, like any write (spec 0005).
- Cancel never undoes; features that promise undo (#22) build it on the job id.
- Code emails stay in the request, so a slow Resend still slows sign in (bounded by its timeout).
- Graphile Worker upgrades change its schema; the migrate script runs them, and the grants are applied again after each.

**Neutral**:
- Two migrations (milestones 1 and 3).
- `graphile-worker` joins the catalog and lint's vendor list; its only importers are `apps/api/src/jobs/graphile.ts` and `packages/db/scripts/migrate.ts`.
- The worker's wake endpoint (spec 0005's) now wakes the job runner too; Railway's worker service gains three variables.
- Spec 0005's relay moves inside the worker lifecycle: its active and dormant states become the worker's awake and asleep states.

## Follow-up

- [ ] **Spec 0005** (`/sync`): record that the relay starts and stops with the worker lifecycle (one idle clock, `WORKER_IDLE_SLEEP_SECONDS`), that the wake endpoint wakes the whole worker, that the API also wakes it on any authenticated request once a minute, that the worker's direct login is `crm_worker_user` and `crm_outbox_workspaces` moved from `crm_app` to `crm_worker`, and that code emails stay in the request.
- [ ] **#11**: a backlog gauge and the oldest waiting age as metrics, and a cron heartbeat check for `maintenance.daily`. Uptime monitors hit `/api/health` only, never `/api/health/ready`.
- [ ] **#12**: load the worker with many workspaces' heavy jobs at once; decide the heavy concurrency and when a second replica pays off; measure the per batch cost on the workspace counter row.
- [ ] **#14, #16, #22, #15, #28**: their kinds (`attributes.analyse`, `attributes.convert`, `computed.recompute`, `records.bulk_edit`, `records.bulk_delete`, `records.refresh_sort_keys`, reminders), each with the shared contract test.
- [ ] **#22**: the purge registry grows (notes, tasks, comments, files) as phases of `maintenance.daily`; bulk delete undo keys on the job id.
- [ ] **#36**: erasure as a light job that the privacy request starts.
- [ ] **Neon plan**: when production moves to a paid plan, set `WORKER_IDLE_SLEEP_SECONDS=0`; nothing else changes.
- [ ] **Spec 0020**: its note that the wake call should run only after writes that stored an outbox row is superseded: the API also wakes the worker on any authenticated request, once a minute per process (decided in the cross check of 8 October 2026).
- [ ] No community skill exists for Graphile Worker; `/sync` should add its conventions (the one wrapper, the two lanes, the 30 second rule, `job_key_mode` `replace`, the pinned version and its private table grants) to `apps/api/AGENTS.md`, area scoped.

## Open questions for the owner

None. Every call in this spec follows the owner decisions of 3 October 2026 or a recommendation already taken in the cross check of 8 October 2026.
