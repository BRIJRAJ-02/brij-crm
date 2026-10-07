# 0008. The runner and the job kinds

## Summary

A feature declares a kind (a type of job): its params schema, its lane, and one step function that does one batch. The runner does everything else: it claims the job, runs batches for about 20 seconds, saves where it got to in the same transaction as each batch, checks for a cancel between batches, and queues the next slice behind everyone already waiting. Graphile Worker only wakes the runner and orders the slices.

## Where the code lives

| Path | Owns |
|---|---|
| `packages/contracts/src/jobs.ts` | `JobKind`, `JOB_KINDS` (label, lane, cancellable per kind, for the screens), `JobView`, `QueuePayload`, the `jobs.*` contract |
| `packages/core/src/jobs/registry.ts` | `defineKind()`, the registry, and the shared contract test every kind passes |
| `packages/core/src/jobs/service.ts` | `startJob`, `getJob`, `listJobs`, `cancelJob`, `confirmJob`, `startTestJob` |
| `packages/core/src/jobs/runner.ts` | `createRunner(deps)`: one slice of one job (pure; the clock, the database, the hooks, the scope makers from `@crm/core/system`, the `queue` reader, the log and the shutdown signal come in as arguments) |
| `packages/core/src/jobs/kinds/` | One file per kind: `dev-simulate.ts`, `maintenance-daily.ts`, and later each feature's own |
| `@crm/core/system` (spec 0009) | `enterAsActor` and `systemScope`, the only ways a slice gets a scope; nothing is added to the door here |
| `packages/db/src/queue.ts` | `createQueueReader(direct)`: `rows(workspaceId, jobIds)` (which jobs have a queue row, by key `crm-job:<id>`), `deleteDead()` (unlocked rows whose attempts are used up, through `graphile_worker.complete_jobs`); built on the worker's `crm_worker` connection |
| `apps/api/src/jobs/graphile.ts` | The only file in `apps/api` that imports `graphile-worker`: the two runners, the tasks, the cron, stale lock release |
| `apps/api/src/jobs/lifecycle.ts` | Awake and asleep (see [0008-worker-sleep.md](0008-worker-sleep.md)) |
| `apps/api/src/modules/jobs/router.ts` | The thin `jobs.*` handlers |
| `packages/data/src/jobs/` | `data.jobs`: the store, the event patch, the finish toast |

## Declaring a kind

```ts
// packages/core/src/jobs/registry.ts (the shape; names are the contract)
export interface KindDefinition<P> {
  readonly kind: JobKind;                 // 'dev.simulate', 'maintenance.daily', …
  readonly lane: 'heavy' | 'light';
  readonly actor: 'member' | 'system';    // who may start it
  readonly params: z.ZodType<P>;          // strict object; ids and settings, never secrets
  readonly cancellable: boolean;
  readonly maxAttempts: number;           // 8 heavy, 5 light unless the kind says less
  readonly batchSize: number;             // 1 to 5,000; default 500
  readonly startDelayMs?: number;         // the coalescing window, for kinds started by writes
  readonly snapshot?: (tx: WorkspaceTx, params: P, after: string | undefined, limit: number) => Promise<readonly string[]>;
  readonly step: (context: WriteContext, input: StepInput<P>) => Promise<StepOutcome>;
}

export interface StepInput<P> {
  readonly job: { readonly id: string; readonly params: P; readonly checkpoint: unknown };
  readonly items?: readonly { readonly position: number; readonly itemId: string }[]; // item jobs only
  readonly limit: number;                                                          // the batch size
}

export type StepOutcome = {
  readonly checkpoint: unknown;           // where the next batch starts (cursor jobs); item jobs may leave it
  readonly finished: boolean;             // nothing left to do
  readonly items?: readonly { readonly position: number; readonly state: 'done' | 'refused' | 'skipped'; readonly code?: string; readonly message?: string }[];
  readonly counts?: { readonly done: number; readonly refused?: number; readonly skipped?: number }; // cursor jobs
  readonly result?: unknown;              // merged into jobs.result (the kind's summary)
};
```

- **Item jobs** carry a list of ids in `job_items` (given at start, merged by coalescing, or built by the snapshot). The runner hands each batch its items and records each item's state.
- **Cursor jobs** carry no items. The step reads its own `checkpoint` (a phase and a keyset cursor) and returns the next one. `maintenance.daily` is one.
- A step works only through the `WriteContext` it is given: engine inner functions (`updateRecord` under `context.perRecord`, `purgeBatch`, …) or plain statements on `context.tx`. It never opens its own transaction, never sleeps, and never calls the network.
- A step must be idempotent for its batch: the shared contract test runs a batch, rolls the progress back to before it, and runs it again; the second run must change nothing (item jobs get this from item states; cursor jobs from a keyset cursor over rows the batch itself removes or marks).

## Starting a job

`startJob(context, input)` runs inside the caller's write transaction (a feature's procedure, or the worker's cron fan out):

1. Parse `params` with the kind's schema (422 `CONFIG_INVALID`). Refuse more than 1,000,000 items (422 `JOB_TOO_LARGE`).
2. If a job with this `id` exists, return it (the idempotent replay). If `onceKey` is given and a job of this kind has it, return that one.
3. If `dedupeKey` is given and a waiting job (`queued`, `slices` = 0) of this kind has it, lock it (`for update`), append the items after its last position with `on conflict do nothing`, update `total`, and return it with `merged: true`.
4. For a member job, count the workspace's unfinished member jobs under the `workspace_counters` row lock (taken last, as every write takes it) and refuse the 21st (409 `LIMIT_REACHED`).
5. Insert the `jobs` row: `queued`, or `preparing` when the kind has a snapshot and the start asks for one. Insert explicit items in chunks of 5,000 positions.
6. `select crm_enqueue_job(id, run_at)` and record `{ jobId, startedBy }` in `Change.jobs`, so `outboxHook` writes a `jobs` row (spec 0007) with the starter in `actor_member_id`. Mark the request so the API wakes the worker after the commit (the same flag the `writeHooks` composer sets when it stores an outbox row).

The partial unique indexes back steps 2 and 3, so two concurrent starts can't both create a job for the same key; the loser retries through `runWrite` and finds the winner.

## One slice

A Graphile task call (`crm_job_heavy` or `crm_job_light`) parses its payload with `QueuePayload` and hands `{ workspaceId, jobId }` to `runner.runSlice()`:

1. **Claim.** In one short transaction under `withWorkspace`: lock the job row, and return at once if it is finished, or `ready` (waiting for a confirm). If `lease_until` is in the future and `lease_owner` isn't this worker, queue the job again with `crm_enqueue_job(id, lease_until)` and return (see Queue keys below). Otherwise set the lease (60 seconds), `status = 'running'` (from `queued`), `started_at` if empty, `slices = slices + 1`.
2. **Who.** Build the scope: `enterAsActor(deps, { workspaceId, actor })` from `@crm/core/system` for a member's job (spec 0009; it reads the member's current role and rules), `systemScope(db, workspaceId)` for a system job. `NOT_FOUND` from `enterAsActor` (the member was removed) ends the job `failed` with `ACTOR_REMOVED`; a deleted workspace ends it `cancelled` with `WORKSPACE_GONE`. Parse the params again; a failure ends it `failed` with `JOB_INVALID`.
3. **Batches.** Until the job is finished, 20 seconds have passed, or the shutdown signal is set:
   - In one `runWrite` with the API's `writeHooks` composer: read the job row again `for no key update`; if `cancel_requested_at` is set, stop (step 5). Load the batch's pending items. Call the kind's `step`. Write the item states (`update job_items … from (values …)`), the counters, the checkpoint, `attempts = 0`, `lease_until = now + 60 seconds`, `updated_at`. Merge `result`. When the step says `finished`, set `succeeded` and `finished_at` in the same transaction.
   - `outboxHook` writes the item work's `records` rows as for any write. A `jobs` row is added when a second has passed since the last one for this job, and always on the final batch: `Change.jobs` (`{ jobId, startedBy }[]`, the field spec 0007 lists for this kind) is filled through `context.record({ jobs })`, and `outboxHook` writes one `kind: 'jobs'` row per starter, the job ids in `item_ids` and the starter in `actor_member_id`. The hooks come in as a dependency (the API's `writeHooks` composer), so `packages/core` never imports `apps/api`.
4. **Hand over.** If the job isn't finished: in one short transaction, clear the lease and call `crm_enqueue_job(id)` (the new queue row lands behind every row already waiting, since Graphile orders by priority, then `run_at`, then id; see Queue keys for what happens to the row this call holds). Return.
5. **Cancel.** Seen in step 3: set `cancelled`, `finished_at`, clear the lease, send the final `jobs` event. Return.

The current queue row is removed only when the call returns, so a crash anywhere above leaves it locked; the stale lock release runs it again, the lease keeps a duplicate out, and the checkpoint resumes the work.

## Snapshot

A job started in `preparing` runs snapshot slices on the heavy lane: each batch calls the kind's `snapshot(tx, params, after, 5000)` (a keyset read, `created_at ≤ asOf` from the params), inserts the ids at the next positions, and saves `after` as the checkpoint. When a page comes back short, `total` is set and the job moves to `ready` (`expires_at` = now + 1 hour) when the start asked for a confirm, else to `queued`. `jobs.confirm` moves `ready` to `queued` and enqueues it. The daily cleanup and every `jobs.get` treat a `ready` job past `expires_at` as expired: it ends `cancelled` with `JOB_EXPIRED` and its items are deleted by the next cleanup.

Each item is checked again in its batch (the step reads the record under its lock), so a record deleted or changed since the snapshot is skipped or refused with a code, never written blindly.

## Cancel

`cancelJob(scope, jobId)`:
- Not visible to the actor: 404. Finished: 409 `JOB_FINISHED`. Kind not cancellable: 409 `JOB_NOT_CANCELLABLE`.
- `preparing`, `ready`, `queued` (no slice running): `cancelled` at once, `finished_at` set. The queue row is left alone (the API can't touch the queue); when it runs, the claim finds the job finished and returns at once.
- `running`: `cancelling`, `cancel_requested_at`, `cancel_requested_by_member_id`. The runner sees it before its next batch. The cancel's own update waits at most one batch for the row lock.

## Retries and failure

- The runner catches an error from a batch. A refusal from the engine outside an item (the whole batch refused) counts as an error too.
- In a fresh transaction it adds 1 to `attempts` and, below the kind's `maxAttempts`, rethrows, so Graphile waits `exp(min(attempt, 10))` seconds and calls again (the lease is cleared first so the retry can claim it). The runner copies Graphile's next `run_at` into `jobs.run_at` for the page's "Retrying at".
- At `maxAttempts` it sets `failed`, `JOB_FAILED`, "This job stopped after repeated errors. What it finished is kept.", logs the error with `errorFields()`, and returns normally, so Graphile deletes the queue row.
- Graphile's own `max_attempts` (25) is only a backstop for errors before the runner can count (the database unreachable). A queue row that reaches it is logged as an error; the daily cleanup queues the job again.

## Lanes, queues and fairness

| Lane | Task | Queue name | Concurrency | Slice budget | Use |
|---|---|---|---|---|---|
| heavy | `crm_job_heavy` | `heavy:<workspace_id>` | 2 | 20 seconds | snapshots, bulk work, conversions, the daily cleanup |
| light | `crm_job_light` | none | 4 | 20 seconds, and each call ends by 30 | recomputes, mail without secrets, reminders, small follow ups |

- Two Graphile runners in one process share one pool on the direct connection, logged in as `crm_worker_user` (max 4 connections: the LISTEN client plus short queue queries; the `queue` reader and `pruneOutbox` use it too). Graphile only hands a runner the tasks it knows, so the light runner never picks up heavy work.
- Tenant work runs on the worker's pooled `DATABASE_URL`, the app login (raised to 8 connections: six slices, two spare). The relay keeps its own direct connection, also as `crm_worker_user` (spec 0005's outbox reader).
- A named queue runs one row at a time, so a workspace holds at most one heavy slot. With two heavy slots and slices of 20 seconds, a newly queued heavy job waits at most one slice for each workspace queued ahead of it, divided by two.
- Priority: member jobs 0, system jobs 10, so the daily cleanup yields to people's work.
- Every runner call returns within 30 seconds: the batch loop stops at 20 seconds, and a batch must take under 5 (a kind's batch size is chosen for that; the contract test times the test kind's batch on the seed).

## Queue keys and rights (`graphile-worker` 0.18.0)

Pinned: `graphile-worker` 0.18.0, the latest release on 8 October 2026 (not yet in the catalog or `node_modules`). Its schema (migrations 000001 to 000020) keeps the queue in `graphile_worker._private_jobs`, with `_private_job_queues`, `_private_tasks`, `_private_known_crontabs` and `migrations` beside it, and a view `graphile_worker.jobs`. `add_job` is `plpgsql` running with its caller's rights; it calls `add_jobs`, which inserts missing task and queue names, clears the key of any row with the same key that is not available (locked, or its attempts used up) and sets that row's attempts to its maximum, then inserts the new row or, on a key clash with an available row, replaces it.

Every enqueue goes through `crm_enqueue_job` with job key `crm-job:<id>` and `job_key_mode` `'replace'`, named explicitly:

| Path | Queue state when it runs | What `replace` does | Why not `preserve_run_at` |
|---|---|---|---|
| start (`startJob`), confirm (`jobs.confirm`) | no row for the key | inserts one row at `run_at` | no difference here; one mode everywhere keeps it simple |
| hand over (end of a slice) | the row this call holds is locked | clears that row's key (it is deleted when the call returns), inserts a new row at `now()`, behind every row already waiting | the new row must take the new time, not keep an old one |
| lease requeue (claim found another runner's live lease) | the row this call holds is locked | the same: a new row at `lease_until` | the same |
| daily requeue | no row (the rule checks it first) | inserts one row | the same |
| an enqueue while an unlocked row waits (a race between confirm and a stale lock release) | one available row | replaces its `run_at`, payload and attempts; never a second row | `preserve_run_at` would keep a stale time |

`unsafe_dedupe` is never used. A hand over or lease requeue whose process dies before the call returns leaves a locked row without a key; the stale lock release unlocks it with its attempts used up, so Graphile never runs it again, and the daily cleanup deletes it (`deleteDead`).

`crm_queue`, the owner of `crm_enqueue_job`, holds exactly what that path needs: `usage` on schema `graphile_worker`; `execute` on `add_job` and `add_jobs`; `usage` on the type `job_spec`; `select`, `insert` on `_private_tasks` and `_private_job_queues`; `select`, `insert`, `update` on `_private_jobs`. `crm_worker` holds every right on the schema's tables and functions but `create`. A guard test reads `information_schema.role_table_grants` and `routine_privileges` and compares both lists exactly, so an upgrade that renames a private table fails it before anything else does.

## Stale locks

On start and once a minute while awake, the worker calls `graphile_worker.force_unlock_workers()` for the worker ids holding queue or job locks older than 2 minutes. No live call is that old, so only a dead process's locks are released. A released row runs again unless its attempts are used up (a row whose key a hand over cleared); the lease decides who works, and the daily cleanup deletes the dead rows.

## Cron

`graphile.ts` gives Graphile one crontab line: `0 3 * * * crm_cron_daily ?fill=1d&id=maintenance_daily`. The `crm_cron_daily` task (light lane, system, on the worker's `crm_worker` connection) first calls spec 0007's `pruneOutbox` (`crm_outbox_prune(now() - OUTBOX_RETENTION, 10000)`, the function the relay calls while awake) until a batch comes back short, then deletes dead queue rows (`deleteDead`), then pages `crm_workspace_ids(after, 500)` and, per workspace, calls `startJob` in that workspace (under `systemScope`) with kind `maintenance.daily` and `onceKey = 'maintenance:<UTC date>'`. Graphile's `known_crontabs` keeps one run per day across restarts and wakes; `fill=1d` runs a missed day once. The outbox is pruned once for every workspace here, because `crm_outbox_prune` works across workspaces and only `crm_worker` may call it.

## The kinds in this spec

**`dev.simulate`** (heavy, member, cancellable, registered only when `APP_ENV` is `local` or `preview`): items are `items` synthetic uuids. Each batch waits `batchMillis` (an injected clock, so tests don't sleep), marks its items done, refuses every `refuseEvery`th with `SIMULATED_REFUSAL`, and throws once at `failAtPosition` (the throw recorded in `checkpoint`, so the retry passes). With `confirm`, it goes through `preparing` and `ready` first. A test only sibling, `test.effects` (registered by the test setup only), writes one row per item to a test table so the restart tests can count effects.

**`maintenance.daily`** (heavy, system, not cancellable, batch 500): a cursor job with phases in its checkpoint (the outbox is not one: the fan out above prunes it for every workspace):
1. `purge`: `purgeBatch(context, { cutoff: now - RESTORE_WINDOW, batchSize })` until it removes less than a batch. Locks lists, then records, in the order entry writes take them.
2. `jobs`: delete finished jobs with `finished_at` older than 30 days (their items go with them), 500 at a time; delete `done` and `skipped` items of finished jobs, 5,000 at a time; end expired `ready` jobs.
3. `requeue`: for unfinished jobs that are `queued` or `running`, with `run_at` in the past, `lease_until` empty or past and `updated_at` older than an hour, ask the runner's `queue.rows(workspaceId, jobIds)` (a read on the `crm_worker` connection) which still have a queue row, and call `crm_enqueue_job` only for those that have none. A job with a live lease or a waiting row is never queued twice.
Its result is the counts per phase, shown on the page for owners and admins. Later features add phases (#22's notes, tasks, comments and files).

## Tests

- Real Postgres (no mocked database), the runner driven directly with an injected clock: every scenario in the index's critical test list that doesn't need a browser.
- The shared kind contract test, run for every registered kind.
- Graphile in the loop: start the real runners against the test database, run the test kinds end to end, kill and restart.
- Guard tests: the queue tables unreadable by `crm_app`; `crm_enqueue_job` refuses another workspace's job and a finished one; `crm_queue`'s and `crm_worker`'s grants on `graphile_worker` equal the lists above for 0.18.0.
- Queue keys, against the pinned 0.18.0: a hand over while the current row is locked leaves one available row at the new time and the old row deleted when the call returns; a lease requeue lands at `lease_until`; an enqueue over a waiting unlocked row replaces it; a hand over whose process is killed leaves a dead row that never runs and that `deleteDead` removes.

## Rationale (short)

The progress, the checkpoint and the work share one transaction, so resuming is exact without any kind having to reason about crashes. Slices that queue themselves again turn Graphile's plain ordering into round robin, and the per workspace queue name caps a workspace at one heavy slot, which together meet "a huge import never slows another workspace" without a scheduler of our own. The lease covers what Graphile's locks can't: two rows for one job during a deploy overlap or after a stale lock release.
