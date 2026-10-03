# 0008. Background jobs: a fair, resumable job runner on Graphile Worker

**Date**: 2026-10-03
**Status**: Proposed

## Summary

Long work (bulk edits, type changes, recomputing, the daily cleanup) runs in the worker, outside the request, so screens stay fast. Each job is a row in a tenant table that holds its status, progress and where it got to; Graphile Worker (a job queue that lives in Postgres) only decides when the next piece runs. Jobs run in short pieces of about 20 seconds, so a restart loses at most one batch, a cancel lands within a batch, and one workspace's huge job takes turns with everyone else's. Because Neon's free plan should be allowed to sleep, the worker closes its connections when there is nothing to do and the API wakes it when there is.

## Structure

- [0008-runner-and-kinds.md](0008-runner-and-kinds.md): the job contract every feature builds on: how a kind (a type of job) is declared, how the runner cuts work into slices and batches, leases, retries, item snapshots, coalescing, cancel, and the Graphile Worker binding.
- [0008-worker-sleep.md](0008-worker-sleep.md): how the worker lets the Neon compute sleep: awake and asleep states, the wake nudge from the API, wake timers for scheduled work, and how the outbox relay (spec 0005) joins the same lifecycle.

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
- **AC-106**: A running job reports `done`, `refused`, `skipped` and `total` after every batch (`total` is empty for a kind that can't know it, and the bar is then indeterminate). Every viewer allowed to see the job sees its progress change at least every 2 seconds while it runs, through a `jobs` change event sent at most once per second per job; the final state is always sent.
- **AC-107**: The member who started a job, or an owner or admin, can cancel it. A job not yet running is cancelled at once. A running job stops before its next batch, within 5 seconds for kinds whose batches take under 5 seconds, and ends `cancelled` with the counts of what it did. Work already done stays done; undoing it belongs to the feature (for example #22's bulk delete undo). Cancelling a finished job answers 409 `JOB_FINISHED`; a kind that can't be cancelled answers 409 `JOB_NOT_CANCELLABLE`.
- **AC-108**: Work is fair between workspaces. While workspace A runs a heavy job over 200,000 items, workspace B's heavy job over 1,000 items starts within 30 seconds of being queued and finishes within 60 seconds of starting, and a light job in any workspace starts within 2 seconds. A workspace never runs more than one heavy slice at a time, and light jobs never wait behind heavy ones. Measured locally on the capped Docker stack with the test kind, numbers recorded in `verify.md`.
- **AC-109**: A job started with `confirm` first snapshots its target ids in the background (status `preparing`), then waits (status `ready`) showing the exact count. `jobs.confirm` queues it. A job left unconfirmed for 1 hour ends `cancelled` with `JOB_EXPIRED`. A confirmed job works on exactly the snapshotted ids, never on records created after the snapshot, and an item that changed since (deleted, for example) is checked again in its batch and skipped with a reason.
- **AC-110**: Starting a job with a coalescing key while a job of that kind and key is still waiting (`queued`, not yet started) adds the new items to that job and returns it instead of making a second one. A short start delay lets a burst of writes land in one job. At most one waiting job exists per kind and key.
- **AC-111**: A job can be started to run at a later time. It never runs before that time, and runs within 5 seconds after it while the worker is awake, or within 60 seconds when the worker had to wake for it.
- **AC-112**: Once a day at 03:00 UTC, the daily cleanup runs one job per workspace that (1) purges records and list entries trashed more than 30 days ago, through the engine's purge, in batches of 500; (2) deletes published outbox rows older than 7 days; (3) deletes finished jobs older than 30 days and the done items of finished jobs. A day missed while the worker was down or asleep runs once when it returns, never once per missed day, and a workspace never gets two cleanups for the same day.
- **AC-113**: Every job acts through the access door. A member's job runs as that member, checked again at the start of every slice: if the member was removed, the job ends `failed` with `ACTOR_REMOVED`; if the workspace was deleted, it ends `cancelled` with `WORKSPACE_GONE`. System jobs run as the system actor, whose scope only the worker can build. Item writes go through the engine and the outbox hook like any other write.
- **AC-114**: A member sees the jobs they started; owners and admins see every job in the workspace, system jobs included. Any other job id, a non member and an unknown workspace all answer the same 404 `NOT_FOUND`. Only the starter, an owner or an admin may cancel or confirm.
- **AC-115**: The queue never crosses tenants. Every piece of job work runs inside `withWorkspace`. The queue (Graphile Worker's tables) holds only a workspace id and a job id per row. The API's login can add a job to the queue only through `crm_enqueue_job`, and can't read or change the queue; only the worker's login can, and only the worker's login can list workspace ids. Guard tests prove each of these.
- **AC-116**: A workspace may hold at most 20 unfinished jobs started by members (system jobs don't count); one more answers 409 `LIMIT_REACHED`. A job holds at most 1,000,000 items; more answers 422 `JOB_TOO_LARGE`. Kind params are checked by the kind's schema on start (422 `CONFIG_INVALID`) and again at every slice.
- **AC-117**: With `WORKER_IDLE_SLEEP_SECONDS` set, the worker closes every database connection after that long with no work, no waiting queue rows and no unpublished outbox rows, so the Neon compute can suspend. A write through the API wakes it (a nudge over Railway's private network), and its job starts within 5 seconds of the commit; scheduled jobs and the daily cleanup wake it at their time. On production the Neon compute is seen suspended within 10 minutes of the last use and the next sign in, edit and job still work; the check is recorded in `verify.md`.
- **AC-118**: Settings, Background jobs (`/w/$slug/settings/jobs`) lists unfinished jobs first, then those finished in the last 30 days, newest first, 50 at a time with "Show more": the kind's label, who started it (or "System"), status, a progress bar with "done of total", refused and skipped counts, started and finished times, the refusal summary, and Cancel (with a confirm step). It updates live, has loading, error with Retry, and empty states, works fully by keyboard with a visible focus ring, and meets contrast in light and dark. Members see only their own jobs there.
- **AC-119**: When a job the person started in this browser finishes while the app is open, a toast says how it ended ("Done", "Done, 6 refused", "Failed", "Cancelled") with a link to the job on the Background jobs page.
- **AC-120**: Each slice logs one JSON line when it starts and one when it ends (job id, kind, workspace id, slice number, batches, counts, duration, outcome), never params, values or messages that quote values. While awake, the worker logs the queue backlog and the oldest waiting job's age once a minute. `/health` on the worker answers its state (`awake` or `asleep`) without touching the database.
- **AC-121**: The queue keeps no history: a finished slice leaves no row behind, a final failure is recorded on the job and removed from the queue, and a job's done and skipped items are deleted by the next daily cleanup after it finishes. Refused items stay with their job until the job is deleted, 30 days after it finished.
- **AC-122**: Every kind passes one shared contract test: its params schema is strict and holds no secrets; the queue payload holds ids only; replaying its last committed batch changes nothing (the batch is idempotent); and each runner call returns within 30 seconds.
- **AC-123**: The runner, the daily cleanup and the Background jobs page run in production on `brij-crm-phi.vercel.app`. The test kind (`dev.simulate`) is registered only locally and in previews, and production answers `NOT_FOUND` for it.

## Decision

**Chosen option**: Option 1: Graphile Worker as the engine that wakes and orders work, with a tenant `jobs` table as the truth about each job, long jobs cut into slices of about 20 seconds that queue themselves again, a heavy lane serialised per workspace and a separate light lane.

The API starts a job by writing a `jobs` row and calling `crm_enqueue_job(job_id)` in the same transaction; the worker's runner claims a lease on the job, runs batches (each one engine transaction that also saves the checkpoint and the progress), checks for a cancel between batches, and after about 20 seconds queues the next slice behind everyone already waiting.

Decisions taken from the brief's recommendations and recorded here (the owner may still change them):
- **Code emails stay in the request.** A sign in code is a live secret; a job would store it in the queue. Mail without secrets (invites, notifications, reminders) runs as light jobs when those features arrive. This answers spec 0005's follow up "code emails as jobs".
- **The worker sleeps on Neon's free plan** (`WORKER_IDLE_SLEEP_SECONDS=240` in production and previews), and the relay (spec 0005) sleeps with it.
- **A test kind in previews** (`dev.simulate`) proves progress, cancel, resume and fairness by clicking, since the first real user kinds belong to #14, #16 and #22.
- **The thin role** (owner, admin, member, from the owner decisions of 3 October 2026) decides who sees and cancels every job. #13 adds `members.role`; if #8 lands first it adds exactly that column and backfill, never a second one.

**Implementation skills**: `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `drizzle` (`lobehub/lobehub`, `.claude/skills/drizzle/`) · `use-railway` (`railwayapp/railway-skills`, `.claude/skills/use-railway/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `db-core` and `react-db` (`tanstack/db`, `.claude/skills/db-core/`, `.claude/skills/react-db/`) · `react-aria` (`.claude/skills/react-aria/`) · house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`, `crm-design-system`. No skill exists for Graphile Worker; its own documentation for the pinned version is the reference.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (the target; one migration in milestone 1, a second in milestone 3 for the cleanup's workspace listing):

| Table or object | Schema | Key | Columns and rules |
|---|---|---|---|
| `jobs` | `public` | (`workspace_id`, `id`) | `id` uuid v7 (client chosen for member jobs, the idempotent start key). `kind` text (a registered kind, checked by the registry; Zod `JobKind` in contracts). `lane` `job_lane` enum (`heavy`, `light`), from the kind. `status` `job_status` enum (`preparing`, `ready`, `queued`, `running`, `cancelling`, `succeeded`, `failed`, `cancelled`). `params` jsonb not null (the kind's Zod schema; ids and settings, never secrets). `subject_type` text null (`object`, `attribute`, `list`) and `subject_id` uuid null: what the job works on, so a feature can ask "is something running on this attribute". `dedupe_key` text null (coalescing). `once_key` text null (a server side start that must happen once, such as `maintenance:2026-10-04`). `priority` smallint (0 for member jobs, 10 for system ones). `run_at` timestamptz. `total`, `done`, `refused`, `skipped` integer (`total` null when unknown; the others default 0, all ≥ 0). `checkpoint` jsonb null (the kind's own resume point). `result` jsonb null (the kind's summary, refusal groups included). `error_code` text null, `error_message` text null. `attempts` smallint default 0 (consecutive failed tries of the current batch). `lease_owner` text null, `lease_until` timestamptz null. `slices` integer default 0. `expires_at` timestamptz null (for `ready`). `cancel_requested_at` timestamptz null, `cancel_requested_by_member_id` uuid null → members. `created_at`, `created_by` actor columns (member or system, with `actorConstraints`), `started_at`, `finished_at`, `updated_at`. Forced row level security, the standard policy. |
| `jobs` indexes | | | partial unique (`workspace_id`, `kind`, `dedupe_key`) where `status` = `queued` and `slices` = 0; unique (`workspace_id`, `kind`, `once_key`) where `once_key` is not null; (`workspace_id`, `created_by_member_id`, `created_at` desc, `id`) for "my jobs"; (`workspace_id`, `created_at` desc, `id`) for "all jobs"; (`workspace_id`, `subject_id`) where unfinished; (`workspace_id`, `finished_at`) where finished, for retention. |
| `job_items` | `public` | (`workspace_id`, `job_id`, `position`) | `item_id` uuid (a record id, or another id the kind names). `state` `job_item_state` enum (`pending`, `done`, `refused`, `skipped`). `code` text null, `message` text null. Unique (`workspace_id`, `job_id`, `item_id`), so a merged item is never added twice. Foreign key (`workspace_id`, `job_id`) → `jobs` on delete cascade. Index (`workspace_id`, `job_id`, `code`) where `state` = `refused`. Forced row level security, the standard policy. |
| `outbox` | `public` | existing (spec 0005) | `kind` gains `jobs`; new `job_id` uuid null, set only on `jobs` rows. |
| `members` | `public` | existing | `role` `member_role` enum (`owner`, `admin`, `member`) not null default `member`; the workspace creator backfilled to `owner`. Added by #13 or by #8, whichever lands first (the same column). |
| `graphile_worker.*` | `graphile_worker` | Graphile's own | Installed and upgraded by Graphile Worker's own migrations, run by `scripts/migrate.ts` as the owner before ours. No row level security; rows hold `{ workspaceId, jobId }` only. |
| `crm_worker` | role | | No login, `INHERIT`s `crm_app`, plus usage and table, sequence and function rights on `graphile_worker`. The worker's direct connection logs in as `crm_worker_user` in this group. |
| `crm_queue` | role | | No login, no bypass. Owns `crm_enqueue_job`; usage on `graphile_worker`, execute on `graphile_worker.add_job`, `select` on the `jobs` columns the function reads. |
| `crm_sweep` | role | | No login, `BYPASSRLS`, `select (id, deleted_at)` on `workspaces` only. Owns `crm_workspace_ids`. |
| `crm_enqueue_job(job_id uuid, run_at timestamptz default null)` | function | | Security definer owned by `crm_queue`, execute granted to `crm_app` (so `crm_worker` inherits it). Reads the job under the caller's workspace setting (row level security still applies), refuses unless it is `queued`, `running` or `preparing`, and calls `graphile_worker.add_job` with task `crm_job_heavy` or `crm_job_light`, payload `{ workspaceId, jobId }`, queue `heavy:<workspace_id>` for heavy jobs (none for light), the job's priority, `run_at`, `max_attempts` 25 and job key `crm-job:<id>`. A quoted `language sql` body (late bound, so a Graphile upgrade that recreates `add_job` never fails on it), `search_path = pg_catalog, pg_temp`, qualified names. |
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
| `jobs.list` | `workspace`, `scope` (`mine`, `all`; `all` for owners and admins), `cursor?`, `limit` ≤ 50 | { jobs: JobView[], nextCursor? }, unfinished first, then newest first | member | 404 |
| `jobs.get` | `workspace`, `jobId` | JobView | member who may see it | 404 `NOT_FOUND` |
| `jobs.cancel` | `workspace`, `jobId` | JobView | starter, owner, admin | 404; 409 `JOB_FINISHED`, `JOB_NOT_CANCELLABLE` |
| `jobs.confirm` | `workspace`, `jobId` | JobView (now `queued`) | starter, owner, admin | 404; 409 `JOB_NOT_READY`, `JOB_EXPIRED`, `JOB_FINISHED` |
| `jobs.startTest` (local and previews only) | `workspace`, `id` uuid v7, `items` 1 to 200,000, `batchSize` ≤ 5,000, `batchMillis` 0 to 2,000, `failAtPosition?`, `refuseEvery?`, `confirm?` | JobView | owner, admin | 404 in production; 409 `LIMIT_REACHED`; 422 `CONFIG_INVALID` |
| core `startJob(context, input)` (no procedure: each feature's own write procedure calls it inside its transaction) | `id`, `kind`, `params`, `subject?`, `items?` (ids), `snapshot?`, `confirm?`, `runAt?`, `dedupeKey?`, `onceKey?` | `{ jobId, merged: boolean }` | the feature's own check | 409 `LIMIT_REACHED`, 422 `JOB_TOO_LARGE`, `CONFIG_INVALID` |

`JobView`: `{ id, kind, label, status, subject?, total?, done, refused, skipped, startedBy: { type: 'member' | 'system', memberId? }, createdAt, startedAt?, finishedAt?, retryAt?, expiresAt?, error?: { code, message }, result?, cancellable }`.

**Status codes**: 404 `NOT_FOUND` (unknown job, a job you may not see, non member), 409 `JOB_FINISHED`, `JOB_NOT_CANCELLABLE`, `JOB_NOT_READY`, `JOB_EXPIRED`, `LIMIT_REACHED`, 422 `JOB_TOO_LARGE`, `CONFIG_INVALID`. On the job itself (`error.code`, never an HTTP answer): `JOB_FAILED`, `JOB_INVALID` (params no longer parse, or an unknown kind after a deploy), `ACTOR_REMOVED`, `WORKSPACE_GONE`, `JOB_EXPIRED`. New codes join `ERROR_MAP` in `packages/contracts`.

**The jobs change event** (one outbox row, on `workspace:<id>`):

```json
{ "seq": 57, "kind": "jobs", "jobId": "…" }
```

Ids only: the browser calls `jobs.get`, so the visibility rule decides what each viewer sees. A viewer who may not see the job gets `NOT_FOUND` and drops it.

**Worker endpoints** (the worker's own HTTP server, no public domain, reached over Railway's private network):

| Path | Method | Does | Answers |
|---|---|---|---|
| `/health` | GET | the state, from memory only | `{ status: 'ok', state: 'awake' \| 'asleep' }` |
| `/wake` | POST | no input; wakes the worker if asleep, else nothing; at most one wake per second | 202 |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| start | the job id | the client's uuid v7 for member jobs (the idempotent retry key); `uuidv7()` for system jobs |
| start | the lane, cancellable, attempt limit, batch size | the kind's definition in the registry (`packages/core/src/jobs/kinds/`) |
| start | the actor | `context.scope.actor` from the access door (member jobs) or `SYSTEM_ACTOR` from the worker's own scope builder (system jobs) |
| start | priority | 0 for member jobs, 10 for system jobs (constants in the runner) |
| start | `run_at` | `runAt` input, else `now()` plus the kind's start delay (0, or the coalescing window a kind declares, such as 1 second) |
| start | the limit check | `count(*)` of the workspace's unfinished member jobs, under the `workspace_counters` row lock, against 20 |
| start, snapshot | `total` | the number of `job_items` rows (explicit items, or the snapshot when it finishes); else the kind's own `total` or null |
| snapshot | which ids | the kind's `snapshot` query, keyset paged, 5,000 per transaction, with `created_at` ≤ the start's `asOf` |
| `ready` | `expires_at` | the time the snapshot finished plus 1 hour |
| enqueue | task, queue name, payload, job key | `crm_enqueue_job` from the job row: `crm_job_<lane>`, `heavy:<workspace_id>` or none, `{ workspaceId, jobId }`, `crm-job:<id>` |
| slice | the actor's scope | the worker's door entry `enterAsJob(deps, job)`: the active `members` row for `created_by_member_id`, or the system scope |
| slice | the lease | `lease_owner` = this worker's id (`<hostname>:<pid>:<start time>`), `lease_until` = now + 60 seconds, extended after each batch |
| slice | when to stop | 20 seconds since the slice began (the budget), a cancel request, or a shutdown signal, checked between batches |
| batch | which items | `job_items` with `position` > `checkpoint.position`, `state` = `pending`, by position, `limit` the kind's batch size |
| batch | `done`, `refused`, `skipped`, item states, `checkpoint` | the kind's step outcome, written by the runner in the same engine transaction as the work |
| batch | the outbox row for item writes | the engine's `Change` through the same `writeHooks` composer as the API (spec 0005) |
| progress event | whether to send one | the runner's last send time for that job, in its own closure: at most one per second, always the last |
| retry | `retryAt` shown | Graphile's `run_at` for the job key, read back into `jobs.run_at` when the runner records a failed try |
| retry | the wait | Graphile Worker's backoff, `exp(min(attempt, 10))` seconds |
| final failure | `attempts` limit | the kind's `maxAttempts` (8 heavy, 5 light), counted in `jobs.attempts`; Graphile's own limit (25) is only a backstop |
| cancel | who may | `members.role` (owner, admin) or `created_by_member_id` = the actor |
| result | the refusal summary | `job_items` where `state` = `refused`, grouped by `code`: count and the first 20 `item_id` by position |
| list, page | the label | `JOB_KINDS[kind].label` in `packages/contracts` (for example "Daily cleanup", "Test job") |
| list, page | "started by" | `members.name` for `created_by_member_id` (from `members.list`, as the Owner column does), else "System" |
| list | cursor | (`created_at`, `id`) of the last row, unfinished first in a separate first page |
| daily cleanup | when | Graphile cron item `0 3 * * *` with `?fill=1d`, on a worker running with `TZ=UTC` |
| daily cleanup | which workspaces | `crm_workspace_ids(after, 500)`, paged |
| daily cleanup | once per day | `once_key` = `maintenance:<UTC date>` |
| daily cleanup | what is old | the engine's `RESTORE_WINDOW` (30 days) for trash; `published_at` older than 7 days for the outbox; `finished_at` older than 30 days for jobs |
| sleep | when to sleep | `WORKER_IDLE_SLEEP_SECONDS` with no running slice, no queue row due, no unpublished outbox row and no wake |
| sleep | when to wake | a `/wake` nudge, or a timer for the earliest of: the next queue `run_at`, the next cron time (minus 30 seconds), a lease expiry |
| nudge | where | `WORKER_WAKE_URL` on the API; sent after every successful write procedure, at most once per second, 1 second timeout, failures logged and ignored |
| toast | which jobs to tell about | the ids this browser started, kept by `data.jobs` for the session |

**Key invariants**:
- The `jobs` row is the truth; the queue only says when to run next. A queue row stays until the runner call that took it returns, so a crash leaves it locked, never gone. If one is lost anyway, the job is delayed, never changed: the daily cleanup queues again any unfinished job in its workspace untouched for an hour.
- A job and its queue row are written in the same transaction as the write that starts them.
- Every batch is one engine transaction that does the work, writes the item states, the counters, the checkpoint and the outbox rows together. A batch either happened completely, with its checkpoint, or not at all.
- At most one runner works on a job at a time: the lease. A second queue row for the same job (a deploy overlap, a stale lock released) finds the lease held and queues itself again for `lease_until`.
- Every runner call returns within 30 seconds. A queue lock older than 2 minutes therefore belongs to a dead process, and the worker releases it on start and once a minute while awake.
- A workspace runs at most one heavy slice at a time (its own queue name), and a slice that ends queues its successor behind everything already waiting.
- Queue payloads hold a workspace id and a job id only. Params, values and messages live in the tenant tables, behind row level security.
- Only the worker builds a system scope or lists workspaces.
- A finished job never changes.

**Security model**:
- `jobs` and `job_items` are tenant tables with forced row level security; all job work runs inside `withWorkspace` as `crm_app` (the worker's pooled connection), so a job can't touch another workspace even if its code is wrong.
- The queue is the one place outside row level security, and holds only ids. `crm_app` (the API) can't read it or change it: it can only call `crm_enqueue_job`, which takes a job id, checks the job is in the caller's workspace and runnable, and builds the queue row itself, so the API can't choose a task, a payload or another workspace. The worker logs in as `crm_worker_user` (group `crm_worker`), the only login with queue rights.
- `crm_workspace_ids` returns ids only and is executable by `crm_worker` alone. The guard tests list the definer functions (`crm_search_text`, `crm_outbox_workspaces`, `crm_enqueue_job`, `crm_workspace_ids`) and the roles, and fail if anyone else can reach them or if a fourth login can bypass row level security.
- A member job runs as its member through the door's job entry, checked at every slice; when #9 adds roles and rules there, a member who loses a permission stops their running jobs at the next slice. System jobs run as the system actor, which `apps/api` code outside `src/jobs/` can't build (the contract walking test checks it).
- Job visibility: starter, owners, admins. Events carry the job id only. Refusal messages are stored as the engine wrote them; #9's follow up (messages that quote other records' values) applies to them too.
- The worker has no public domain; `/wake` takes no input and only makes the worker look at the queue. `.railway/railway.ts` declares no domain for it, and a config test checks that.
- No params, values, codes or messages appear in logs.
- `security-access-reviewer` reviews milestones 1 and 3 before they land; `state-performance-reviewer` reviews milestones 2 and 3.

**Configuration required**:
- `DATABASE_URL_DIRECT` (worker): now the `crm_worker_user` login on the direct (unpooled) host. `pnpm db:worker-login` creates it (through `scripts/login.ts`, `--plain-password` on Neon) and `pnpm db:setup` runs it after the other two. Railway keeps it with `preserve()` as today.
- `WORKER_IDLE_SLEEP_SECONDS` (worker): seconds of idleness before the worker closes its connections; `0` never sleeps (the default, and locally). `240` in production and previews while Neon is on the free plan; `0` once production moves to a paid plan.
- `WORKER_WAKE_URL` (api): the worker's `/wake` over Railway's private network (`http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:<worker port>/wake`), `http://localhost:3001/wake` locally. Required whenever the worker may sleep; the worker logs a warning at start when it sleeps and the API has none, and the API logs one when it is unset outside local.
- `TZ=UTC` (worker): cron times are UTC.
- `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` (worker): time between SIGTERM and SIGKILL, enough for the batch in hand.
- No new secrets. New pinned dependency: `graphile-worker` (the current release at build time, pinned exactly in the catalog).

**Critical test scenarios**:
- Happy path: a member starts the test job with 20,000 items in a preview; the Background jobs page shows progress moving and a second browser sees it too; it ends `succeeded` and the starter gets a toast, verifies **AC-102**, **AC-106**, **AC-118**, **AC-119**, **AC-123**.
- Transaction: a feature write that starts a job and then is refused leaves no job and no queue row; a retried start with the same id returns the same job, verifies **AC-102**.
- Restart: SIGTERM mid job, then a new worker; SIGKILL mid batch, then a new worker; every item's effect counted exactly once (a test kind writing to a test only effects table, in the real Postgres), verifies **AC-103**, **AC-122**.
- Failure: a batch that throws twice then passes retries with backoff and finishes; one that always throws ends `failed` after its limit with the counts kept; refused items appear grouped by code, verifies **AC-104**, **AC-105**.
- Cancel: cancel a queued job (at once) and a running one (before its next batch); cancel a finished one (409), verifies **AC-107**.
- Fairness: workspace A's 200,000 item heavy job, B's 1,000 item heavy job and a light job in C, with start and finish times measured, verifies **AC-108**.
- Snapshot: start with `confirm`, see `ready` with the count, confirm; another left alone expires after an hour (the clock injected), verifies **AC-109**.
- Coalescing and scheduling: three starts with one key within the delay make one job with all items; a job for 10 seconds from now doesn't run before then, verifies **AC-110**, **AC-111**.
- Cleanup: trashed records 31 days old are purged, 29 days old kept; outbox rows and old jobs pruned; a second run the same day does nothing; a missed day runs once, verifies **AC-112**, **AC-121**.
- Auth: a member reads another member's job (404), a non member (404), a member cancels someone else's job (404 since they can't see it), an admin cancels it (ok); a removed member's running job fails `ACTOR_REMOVED`, verifies **AC-113**, **AC-114**.
- Tenancy: `crm_app` can't select from or update the queue tables; `crm_enqueue_job` refuses a job id from another workspace; `crm_workspace_ids` refuses `crm_app`, verifies **AC-115**.
- Limits: the 21st member job and a 1,000,001 item job are refused, verifies **AC-116**.
- Sleep: with a short idle time the worker closes its connections (seen in `pg_stat_activity`), a write wakes it and its job starts within 5 seconds; a scheduled job wakes it; on production the compute suspends, verifies **AC-111**, **AC-117**.
- Logs and health: a slice's log lines carry no params; `/health` answers while asleep with no database query, verifies **AC-120**.

## Build plan

Tracer Bullet: each milestone ends with something you can click, locally and in a preview, and the page runs in production from milestone 1.

**Milestone 1: one job, start to finish, on a page**
1. Migration: `graphile-worker` pinned in the catalog; `scripts/migrate.ts` runs Graphile Worker's own migrations as the owner before ours and grants its rights to `crm_worker` after; enums, `jobs`, `job_items`, `outbox.job_id` and the `jobs` kind (folded into spec 0005's outbox migration if that one hasn't been written yet, else a statement of its own; until the outbox exists the runner skips the event), the roles `crm_worker` and `crm_queue`, `crm_enqueue_job`, `members.role` if #13 hasn't added it; the guard tests extended (tenant tables, the definer functions, the roles, the queue unreadable by `crm_app`), satisfies **AC-102**, **AC-115**
2. `pnpm db:worker-login`, `db:setup` updated, the worker's direct connection switched to it locally, in previews and in production; the worker refuses to start if its direct login can bypass row level security, satisfies **AC-115**
3. Contracts: `JobKind`, `JOB_KINDS` labels, `JobView`, `QueuePayload` (strict, ids only), the new error codes, the `jobs.*` procedures, satisfies **AC-114**, **AC-116**, **AC-122**
4. Core: the kind registry and its contract test, `startJob` (limits, idempotent start, items), `getJob`, `listJobs`, `cancelJob`, `confirmJob`, the door's `enterAsJob`, and the runner (lease, slices, batches with checkpoint and progress in the engine transaction, cancel between batches, throttled `jobs` events through the outbox hook), see [0008-runner-and-kinds.md](0008-runner-and-kinds.md), satisfies **AC-102**, **AC-105**, **AC-106**, **AC-107**, **AC-113**, **AC-114**, **AC-122**
5. The `dev.simulate` kind (synthetic items, `batchMillis`, `failAtPosition`, `refuseEvery`), registered only when `APP_ENV` is `local` or `preview`; `jobs.startTest`, satisfies **AC-123**
6. The worker: `apps/api/src/jobs/graphile.ts` as the one file in `apps/api` that imports `graphile-worker` (lint's vendor list), two runners on one pool (heavy 2, light 4), the tasks `crm_job_heavy` and `crm_job_light`, graceful shutdown at a batch boundary, stale lock release on start and each minute, slice logs, `/health` state, satisfies **AC-103**, **AC-108**, **AC-120**
7. The api: `modules/jobs/router.ts` (thin, on `member`), satisfies **AC-114**
8. The data layer: `data.jobs` (one store per workspace, `jobs.get` on `jobs` events, the finish toast for jobs this browser started; until spec 0005's outbox lands it refetches unfinished jobs every 2 seconds instead), satisfies **AC-106**, **AC-119**
9. The page: Settings, Background jobs, from library parts only (Table, ProgressBar, Badge, Button, Modal for the cancel confirm, RelativeTime, EmptyState, Toast; inside `SettingsLayout` if #13 has pulled it forward, else the AppShell page frame), plus "Run a test job" in previews; `ux-interaction-reviewer` and `design-system-guardian`, satisfies **AC-118**, **AC-119**
10. Deploy; run the test job in a preview, open the empty page in production; `security-access-reviewer` before it lands, satisfies **AC-115**, **AC-123**

**Milestone 2: dependable and fair**
11. Retries: failed tries counted on the job, backoff from Graphile, `retryAt` shown, the final failure recorded and removed from the queue; params checked again each slice (`JOB_INVALID`), satisfies **AC-104**, **AC-116**, **AC-121**
12. Snapshot and confirm: `preparing` slices filling `job_items` by keyset, `ready` with `expires_at`, `jobs.confirm`, expiry, items checked again in their batch and skipped with a reason, satisfies **AC-109**
13. Coalescing (`dedupe_key`, merged items, the start delay), `once_key`, and `runAt` scheduling, satisfies **AC-110**, **AC-111**
14. The restart tests (SIGTERM and SIGKILL, exactly once effects, a deploy overlap with two workers held apart by the lease), satisfies **AC-103**
15. The fairness measurement on the capped local stack, written to `verify.md`; `state-performance-reviewer` before it lands, satisfies **AC-108**

**Milestone 3: the daily cleanup and a sleeping database**
16. Migration: `crm_sweep` and `crm_workspace_ids`; guard tests, satisfies **AC-112**, **AC-115**
17. Engine: `purgeDeleted`'s loop becomes `purgeBatch(context, …)` run by the runner, and its batch picks doomed records and locks their lists before the records, the order entry writes take (spec 0005's follow up; erasure gets the same order), satisfies **AC-112**
18. The `maintenance.daily` kind (purge, outbox prune, job retention and item cleanup, and queueing again any unfinished job untouched for an hour, as checkpoint phases) and the `crm_cron_daily` fan out with `once_key`, cron `0 3 * * *` with one day of fill, satisfies **AC-112**, **AC-121**
19. The worker lifecycle: awake and asleep, closing every connection, the wake timer, `/wake`, and the relay (spec 0005) started and stopped with it; the API's nudge after write procedures; Railway variables (`WORKER_IDLE_SLEEP_SECONDS`, `WORKER_WAKE_URL`, `TZ`, draining), see [0008-worker-sleep.md](0008-worker-sleep.md), satisfies **AC-111**, **AC-117**
20. Deploy; watch the Neon compute suspend and wake in production and record it, see the first daily cleanup on the page as an owner; `security-access-reviewer` and `state-performance-reviewer` before it lands; `verify.md` with every result, satisfies **AC-112**, **AC-117**, **AC-123**

## Consequences

**Positive**:
- Every later slow feature (#14, #15, #16, #22, #28, imports and exports) writes only its step function; progress, cancel, resume, retries, fairness and the page come free.
- A job can never describe work that rolled back, and never get lost after its write committed.
- One workspace's huge job takes turns with everyone else's, and short jobs have their own lane.
- The database can sleep, so the free Neon plan lasts the month.

**Negative / tradeoffs**:
- More moving parts than a plain queue: a lease, a checkpoint per kind, slices that queue themselves again, two lanes. Each kind must be written as resumable batches, which is harder than one long function.
- A third login (`crm_worker_user`) and two more definer functions; the queue is a deliberate gap in row level security, kept to ids.
- Heavy work is capped at two slices at once on the one worker; a busy day with many workspaces running heavy jobs queues them (each waits its turn of 20 seconds). #12's load harness decides when to add a second worker replica, which the lease already allows.
- While the worker sleeps, the first live event or job after an idle spell waits for it to connect (and for Neon's cold start, a few hundred milliseconds to a few seconds).
- Writing progress and an outbox row every batch adds a little write load and holds the workspace counter row for each batch, like any write (spec 0005).
- Cancel never undoes; features that promise undo (#22) build it on the job id.
- Code emails stay in the request, so a slow Resend still slows sign in (bounded by its timeout).
- Graphile Worker upgrades change its schema; the migrate script runs them, and the grants are applied again after each.

**Neutral**:
- Two migrations (milestones 1 and 3).
- `graphile-worker` joins the catalog and lint's vendor list; its only importers are `apps/api/src/jobs/graphile.ts` and `packages/db/scripts/migrate.ts`.
- The worker gains `/wake` and a sleeping state; Railway's worker service gains four variables.
- Spec 0005's relay moves inside the worker lifecycle and stops polling while asleep.

## Follow-up

- [ ] **Spec 0005**: record that the relay starts and stops with the worker lifecycle, that the outbox gains `kind: 'jobs'` and `job_id`, and that code emails stay in the request (`/sync`).
- [ ] **#11**: a backlog gauge and the oldest waiting age as metrics, a cron heartbeat check for `maintenance.daily`, and an uptime check on `/api/health/ready` that never queries the database more often than every 10 minutes (or it keeps Neon awake).
- [ ] **#12**: load the worker with many workspaces' heavy jobs at once; decide the heavy concurrency and when a second replica pays off; measure the per batch cost on the workspace counter row.
- [ ] **#13**: one `members.role` column; whichever of #8 and #13 lands first adds it.
- [ ] **#14, #16, #22, #15, #28**: their kinds (`attributes.analyse`, `attributes.convert`, `computed.recompute`, `records.bulk_edit`, `records.bulk_delete`, `records.refresh_sort_keys`, reminders), each with the shared contract test.
- [ ] **#22**: the purge registry grows (notes, tasks, comments, files) as phases of `maintenance.daily`; bulk delete undo keys on the job id.
- [ ] **#9**: permission checks in `enterAsJob`; refusal messages that quote values in `job_items.message`.
- [ ] **#36**: erasure as a light job that the privacy request starts.
- [ ] **Neon plan**: when production moves to a paid plan, set `WORKER_IDLE_SLEEP_SECONDS=0`; nothing else changes.
- [ ] No community skill exists for Graphile Worker; `/sync` should add its conventions (the one wrapper, the two lanes, the 30 second rule) to `apps/api/AGENTS.md`, area scoped.
