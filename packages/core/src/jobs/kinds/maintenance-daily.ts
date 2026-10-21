// `maintenance.daily` (spec 0008, The kinds in this spec; milestone 3,
// AC-112, AC-121): the daily cleanup in one workspace. The worker's cron
// starts one a day per workspace (`daily.ts`), the system's, on the heavy
// lane, never cancelled. A cursor job whose checkpoint walks six phases, one
// batch a step, each its own transaction under row level security:
// 1. `purge`: records and list entries trashed more than 30 days ago, through
//    the engine's `purgeBatch` (lists locked before records), 500 a batch.
// 1b. `notes_tasks` (spec 0019, AC-445): notes, then tasks, deleted more
//    than 30 days ago, removed for good, 500 a batch (a task takes its links).
// 1c. `emails` (the emails lane): a queued email still waiting after a day
//    ends `failed` (`queue_lost`), then emails made more than 30 days ago go,
//    whatever became of them, 500 a batch. A sent one kept only its kind, key
//    and outcome; one never sent goes too, with what it would have said.
// 2. `expired`: jobs left `ready` past their hour end `cancelled` with
//    `JOB_EXPIRED` (the queue row at the expiry normally does it first).
// 3. `items`: the items of jobs that finished since the last cleanup, all
//    but the refused ones, which stay with their job's summary.
// 4. `jobs`: jobs finished more than 30 days ago, their items first.
// 5. `requeue`: an unfinished job that should be running but has no queue
//    row (a lost row) is queued again, and only then (AC-112's rule).
// The outbox is no phase: the fan out prunes it once for every workspace.
// Its result holds the totals per phase; `done` counts every row it removed.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { purgeBatch, type RemovedCounts } from '../../engine/deletion.ts';
import { RESTORE_WINDOW } from '../../engine/limits.ts';
import type { WriteContext } from '../../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition, type StepOutcome } from '../registry.ts';
import { ENDINGS } from '../runner.ts';
import { FINISHED_KEPT, tryEnqueue } from '../service.ts';

/** The kind's name, as `JOB_KINDS` lists it. */
export const MAINTENANCE_DAILY = 'maintenance.daily';

/** Which of a workspace's jobs still have a queue row: the worker's queue connection answers it (crm_worker). */
export interface QueueRows {
  rows(workspaceId: string, jobIds: readonly string[]): Promise<readonly string[]>;
}

/** The cleanup's params: the UTC day it is for (its once key names the same day). */
export const MaintenanceParams = z.strictObject({ day: z.iso.date() });
/** The cleanup's params. */
export type MaintenanceParams = z.infer<typeof MaintenanceParams>;

/** The phases, in the order they run. */
const PHASES = ['purge', 'notes_tasks', 'emails', 'expired', 'items', 'jobs', 'requeue'] as const;

/** How many items one `items` or `jobs` batch deletes at most, and how many finished jobs one `items` batch visits. */
const ITEM_BATCH = 5_000;
const JOBS_VISITED = 50;

/** How long a queued email's row is kept, sent or not: as long as a finished job. */
const EMAILS_KEPT = '30 days';

/** How long a job must have gone untouched before the requeue rule looks at it. */
const REQUEUE_AFTER = '1 hour';

const Count = z.number().int().min(0);

/** What the cleanup removed or did so far, per phase. */
const Totals = z.object({
  records: Count,
  entries: Count,
  values: Count,
  links: Count,
  // Added by spec 0019: a checkpoint stored before them reads as none removed yet.
  notes: Count.default(0),
  tasks: Count.default(0),
  // Added by the emails lane: a checkpoint stored before it reads as none removed yet.
  emails: Count.default(0),
  expired: Count,
  items: Count,
  jobs: Count,
  requeued: Count,
});
type Totals = z.infer<typeof Totals>;

const NO_TOTALS: Totals = {
  records: 0,
  entries: 0,
  values: 0,
  links: 0,
  notes: 0,
  tasks: 0,
  emails: 0,
  expired: 0,
  items: 0,
  jobs: 0,
  requeued: 0,
};

/**
 * Where the cleanup got to: its phase, the totals, the last finished job the
 * `items` phase handled (its `finished_at` as Postgres wrote it, and its id),
 * the job it is part way through with the last item position it reached,
 * the time that phase starts from (the last successful cleanup's start), and
 * the last job id the `requeue` phase looked at.
 */
const Checkpoint = z.object({
  phase: z.enum(PHASES),
  totals: Totals,
  since: z.string().optional(),
  finished: z.object({ at: z.string(), id: z.uuid() }).optional(),
  current: z.object({ at: z.string(), id: z.uuid(), position: z.number().int().min(0) }).optional(),
  after: z.uuid().optional(),
});
type Checkpoint = z.infer<typeof Checkpoint>;

/** The checkpoint as stored, or the start of the first phase (a job's first batch, or one that no longer parses). */
function readCheckpoint(checkpoint: unknown): Checkpoint {
  const parsed = Checkpoint.safeParse(checkpoint);
  return parsed.success ? parsed.data : { phase: 'purge', totals: NO_TOTALS };
}

/** The next phase's start, or the end. */
function nextPhase(at: Checkpoint, totals: Totals): Checkpoint | undefined {
  const next = PHASES[PHASES.indexOf(at.phase) + 1];
  return next === undefined ? undefined : { phase: next, totals };
}

/** One batch's outcome: `done` rows removed or queued, the totals as the result, and where the next batch starts. */
function outcome(next: Checkpoint | undefined, at: Checkpoint, totals: Totals, done: number): StepOutcome {
  return {
    finished: next === undefined,
    checkpoint: next ?? { ...at, totals },
    counts: { done },
    result: { cleanup: totals },
  };
}

const plus = (totals: Totals, more: Partial<Totals>): Totals => ({
  records: totals.records + (more.records ?? 0),
  entries: totals.entries + (more.entries ?? 0),
  values: totals.values + (more.values ?? 0),
  links: totals.links + (more.links ?? 0),
  notes: totals.notes + (more.notes ?? 0),
  tasks: totals.tasks + (more.tasks ?? 0),
  emails: totals.emails + (more.emails ?? 0),
  expired: totals.expired + (more.expired ?? 0),
  items: totals.items + (more.items ?? 0),
  jobs: totals.jobs + (more.jobs ?? 0),
  requeued: totals.requeued + (more.requeued ?? 0),
});

/** Phase 1: one purge batch; the phase ends with the first batch that comes back short. */
async function purge(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const { counts, full }: { counts: RemovedCounts; full: boolean } = await purgeBatch(context, { batchSize: limit });
  const totals = plus(at.totals, counts);
  const next = full ? { ...at, totals } : nextPhase(at, totals);
  return outcome(next, at, totals, counts.records + counts.entries);
}

/**
 * Phase 1b (spec 0019, AC-445): deleted notes, then deleted tasks, past the
 * restore window, `limit` a batch through their `*_trashed` indexes; a task
 * takes its links with it. Nothing else names them, so no event is stored.
 */
async function notesAndTasks(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const { tx } = context;
  const notes = await tx.execute(sql`
    delete from notes where id in (
      select id from notes where deleted_at < now() - ${RESTORE_WINDOW}::interval order by deleted_at limit ${limit}
    )
  `);
  const noteCount = notes.rowCount ?? 0;
  const tasks =
    noteCount < limit
      ? await tx.execute(sql`
          delete from tasks where id in (
            select id from tasks where deleted_at < now() - ${RESTORE_WINDOW}::interval order by deleted_at
            limit ${limit - noteCount}
          )
        `)
      : undefined;
  const taskCount = tasks?.rowCount ?? 0;
  const totals = plus(at.totals, { notes: noteCount, tasks: taskCount });
  const full = noteCount + taskCount >= limit;
  return outcome(full ? { ...at, totals } : nextPhase(at, totals), at, totals, noteCount + taskCount);
}

/**
 * Phase 1c (the emails lane): a queued email still waiting after a day has
 * lost its queue row (every try lands within about ten hours), so it ends
 * `failed` with `queue_lost`, what it said blanked; then emails made more
 * than `EMAILS_KEPT` ago go, whatever became of them. `limit` a batch each,
 * through `emails_created`.
 */
async function oldEmails(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const lost = await context.tx.execute(sql`
    update emails set status = 'failed', error_code = 'queue_lost', params = '{}'::jsonb, to_address = null,
      updated_at = now()
    where id in (
      select id from emails where status = 'queued' and created_at < now() - interval '1 day'
      order by created_at limit ${limit}
    )
  `);
  const removed = await context.tx.execute(sql`
    delete from emails where id in (
      select id from emails where created_at < now() - ${EMAILS_KEPT}::interval order by created_at limit ${limit}
    )
  `);
  const count = (lost.rowCount ?? 0) + (removed.rowCount ?? 0);
  const totals = plus(at.totals, { emails: removed.rowCount ?? 0 });
  const full = (lost.rowCount ?? 0) >= limit || (removed.rowCount ?? 0) >= limit;
  return outcome(full ? { ...at, totals } : nextPhase(at, totals), at, totals, count);
}

/** Phase 2: ends jobs left `ready` past their hour, as the queue row at their expiry would, with their events. */
async function expired(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const { tx, scope } = context;
  const ended = await tx.execute<{ id: string; created_by_member_id: string | null }>(sql`
    update jobs j
    set status = 'cancelled', error_code = 'JOB_EXPIRED', error_message = ${ENDINGS.JOB_EXPIRED},
      finished_at = now(), lease_owner = null, lease_until = null, updated_at = now()
    from (
      select id from jobs
      where workspace_id = ${scope.workspaceId} and finished_at is null and status = 'ready' and expires_at <= now()
      order by id limit ${limit}
      for no key update skip locked
    ) due
    where j.workspace_id = ${scope.workspaceId} and j.id = due.id
    returning j.id::text, j.created_by_member_id::text
  `);
  if (ended.rows.length > 0) {
    context.record({ jobs: ended.rows.map((row) => ({ jobId: row.id, startedBy: row.created_by_member_id })) });
  }
  const totals = plus(at.totals, { expired: ended.rows.length });
  const next = ended.rows.length === limit ? { ...at, totals } : nextPhase(at, totals);
  return outcome(next, at, totals, ended.rows.length);
}

/**
 * Phase 3: the items of jobs that finished since the last successful cleanup
 * began (every finished job, the first time), all but the refused ones, in
 * the order the jobs finished. A batch walks at most 5,000 item positions
 * (by the primary key, in windows that never revisit one) over at most 50
 * jobs, so its cost is bounded whatever the items' states: a job with a
 * million refused items costs 200 short batches once, never a rescan.
 */
async function items(context: WriteContext, at: Checkpoint, jobId: string): Promise<StepOutcome> {
  const { tx, scope } = context;
  let since = at.since;
  if (since === undefined) {
    // The last cleanup that finished began after every job it cleaned had finished; a minute earlier still, since a
    // job's finished_at is its last transaction's start, which may come just before a commit that cleanup missed.
    const [last] = await tx
      .execute<{ since: string | null }>(
        sql`
        select (max(started_at) - interval '1 minute')::text as since from jobs
        where workspace_id = ${scope.workspaceId} and kind = ${MAINTENANCE_DAILY} and status = 'succeeded'
          and id <> ${jobId}
      `,
      )
      .then((result) => result.rows);
    since = last?.since ?? '-infinity';
  }
  // The job in hand first (its next window), then the ones that finished after it.
  const from = at.current ?? at.finished;
  const jobs = await tx.execute<{ id: string; at: string }>(sql`
    select id::text, finished_at::text as at from jobs
    where workspace_id = ${scope.workspaceId} and finished_at is not null and finished_at >= ${since}::timestamptz
      ${from === undefined ? sql`` : sql`and (finished_at, id) >= (${from.at}::timestamptz, ${from.id}::uuid)`}
    order by finished_at, id
    limit ${JOBS_VISITED}
  `);
  let budget = ITEM_BATCH;
  let removed = 0;
  let finished = at.finished;
  let current: Checkpoint['current'];
  for (const job of jobs.rows) {
    // Already done: the cursor's own row comes back through `>=`.
    if (at.current === undefined && job.id === at.finished?.id) continue;
    const after = at.current?.id === job.id ? at.current.position : 0;
    const [top] = await tx
      .execute<{ max: number }>(
        sql`select coalesce(max(position), 0)::int as max from job_items
            where workspace_id = ${scope.workspaceId} and job_id = ${job.id}`,
      )
      .then((result) => result.rows);
    const last = top?.max ?? 0;
    const end = Math.min(last, after + budget);
    if (end > after) {
      const gone = await tx.execute(sql`
        delete from job_items
        where workspace_id = ${scope.workspaceId} and job_id = ${job.id}
          and position > ${after} and position <= ${end} and state <> 'refused'
      `);
      removed += gone.rowCount ?? 0;
      budget -= end - after;
    }
    if (end < last) {
      current = { at: job.at, id: job.id, position: end };
      break;
    }
    finished = { at: job.at, id: job.id };
    if (budget <= 0) break;
  }
  const totals = plus(at.totals, { items: removed });
  const more = current !== undefined || budget <= 0 || jobs.rows.length === JOBS_VISITED;
  const next = more
    ? {
        phase: at.phase,
        totals,
        since,
        ...(finished === undefined ? {} : { finished }),
        ...(current === undefined ? {} : { current }),
      }
    : nextPhase(at, totals);
  return outcome(next, at, totals, removed);
}

/**
 * Phase 4: jobs finished more than 30 days ago (`FINISHED_KEPT`), 500 at a
 * time, their items first, at most 5,000 a batch, so a job with a million
 * refused items never goes in one statement.
 */
async function oldJobs(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const { tx, scope } = context;
  const old = await tx.execute<{ id: string }>(sql`
    select id::text from jobs
    where workspace_id = ${scope.workspaceId} and finished_at < now() - ${FINISHED_KEPT}::interval
    order by finished_at, id limit ${limit}
  `);
  const ids = old.rows.map((row) => row.id);
  if (ids.length === 0) return outcome(nextPhase(at, at.totals), at, at.totals, 0);
  const list = sql`(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`;
  const gone = await tx.execute(sql`
    delete from job_items i
    using (
      select job_id, position from job_items
      where workspace_id = ${scope.workspaceId} and job_id in ${list}
      limit ${ITEM_BATCH}
    ) doomed
    where i.workspace_id = ${scope.workspaceId} and i.job_id = doomed.job_id and i.position = doomed.position
  `);
  const itemsGone = gone.rowCount ?? 0;
  let jobsGone = 0;
  if (itemsGone < ITEM_BATCH) {
    const deleted = await tx.execute(
      sql`delete from jobs where workspace_id = ${scope.workspaceId} and id in ${list} and finished_at is not null`,
    );
    jobsGone = deleted.rowCount ?? 0;
  }
  const totals = plus(at.totals, { items: itemsGone, jobs: jobsGone });
  const more = itemsGone === ITEM_BATCH || ids.length === limit;
  return outcome(more ? { ...at, totals } : nextPhase(at, totals), at, totals, itemsGone + jobsGone);
}

/**
 * Phase 5 (AC-112's rule): an unfinished job `queued`, `running` or
 * `cancelling` (its next slice ends it), due, with
 * no live lease and untouched for an hour, is queued again only when the
 * queue holds no row for it (read on the worker's crm_worker connection).
 * Its row stays locked here while the queue is read, so a slice claiming it
 * meanwhile waits, and one already holding it is skipped.
 */
async function requeue(
  context: WriteContext,
  at: Checkpoint,
  limit: number,
  queue: QueueRows | undefined,
): Promise<StepOutcome> {
  const { tx, scope } = context;
  const stuck = await tx.execute<{ id: string }>(sql`
    select id::text from jobs
    where workspace_id = ${scope.workspaceId} and finished_at is null
      and status in ('queued', 'running', 'cancelling')
      and run_at < now() and (lease_until is null or lease_until < now())
      and updated_at < now() - ${REQUEUE_AFTER}::interval
      ${at.after === undefined ? sql`` : sql`and id > ${at.after}::uuid`}
    order by id limit ${limit}
    for no key update skip locked
  `);
  const ids = stuck.rows.map((row) => row.id);
  let requeued = 0;
  if (ids.length > 0) {
    // Only the worker runs a step, with its queue connection; nothing else may read the queue.
    if (queue === undefined) throw new Error('The daily cleanup reads the queue, so only the worker runs it.');
    const queued = new Set(await queue.rows(scope.workspaceId, ids));
    for (const id of ids) {
      if (queued.has(id)) continue;
      if (await tryEnqueue(tx, id)) requeued += 1;
    }
  }
  const totals = plus(at.totals, { requeued });
  const last = ids.at(-1);
  const next = ids.length === limit && last !== undefined ? { ...at, totals, after: last } : nextPhase(at, totals);
  return outcome(next, at, totals, requeued);
}

/**
 * The daily cleanup's kind. `queue` is the worker's (which jobs have a
 * queue row); the api registers the kind without one, to show and refuse to
 * cancel its jobs, and never runs a step.
 */
export function maintenanceDaily(queue?: QueueRows): KindDefinition<MaintenanceParams> {
  return defineKind<MaintenanceParams>({
    kind: MAINTENANCE_DAILY,
    lane: 'heavy',
    actor: 'system',
    mode: 'cursor',
    params: MaintenanceParams,
    cancellable: false,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 500,
    sample: { day: '2026-10-15' },
    async step(context, { job, limit }) {
      const at = readCheckpoint(job.checkpoint);
      switch (at.phase) {
        case 'purge':
          return purge(context, at, limit);
        case 'notes_tasks':
          return notesAndTasks(context, at, limit);
        case 'emails':
          return oldEmails(context, at, limit);
        case 'expired':
          return expired(context, at, limit);
        case 'items':
          return items(context, at, job.id);
        case 'jobs':
          return oldJobs(context, at, limit);
        case 'requeue':
          return requeue(context, at, limit, queue);
      }
    },
  });
}
