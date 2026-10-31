// `maintenance.daily` (spec 0008, The kinds in this spec; milestone 3,
// AC-112, AC-121): the daily cleanup in one workspace. The worker's cron
// starts one a day per workspace (`daily.ts`), the system's, on the heavy
// lane, never cancelled. A cursor job whose checkpoint walks these phases, one
// batch a step, each its own transaction under row level security:
// 1. `purge`: records and list entries trashed more than 30 days ago, through
//    the engine's `purgeBatch` (lists locked before records), 500 a batch.
// 1b. `notes_tasks` (spec 0019, AC-445): notes, then tasks, deleted more
//    than 30 days ago, removed for good, 500 a batch (a task takes its links).
// 1c. `emails` (the emails lane): a queued email still waiting after a day
//    ends `failed` (`queue_lost`), then emails made more than 30 days ago go,
//    whatever became of them, 500 a batch. A sent one kept only its kind, key
//    and outcome; one never sent goes too, with what it would have said.
// 1c2. `webhooks` (spec 0064, AC-6425): webhook deliveries made more than 30 days ago, 500 a batch.
// 1d. `nav` (spec 0034, AC-940): each member's stored sidebar loses the views
//    and records that point at nothing any more, 500 rows a batch.
// 1e. `notifications` (spec 0038, AC-1175): notifications marked done more
//    than 90 days ago, 500 a batch. Unread and read ones stay until done.
// 1e2. `task_due` (migration 0135): each active assignee of an open task due on
//    the job's day (UTC) gets one `task_due` notification, 500 tasks a batch by
//    id; a second run of the day finds them notified and writes nothing.
// 1f. `views` (spec 0047): booking page view rows past a year.
// 1g. `profile_counts` (spec 0051, AC-5128): link page views and presses past
//    a year, the person's rather than the workspace's, through a definer.
// 1h. `link_pages` (26 Oct 2026): every active member with a sign in and no link page here gets one, as the
//    membership's own transaction would have made it (`ensureLinkPage`): the retry for one that failed there.
// 1i. `released_handles` (migration 0126): handles held 90 days after their person's account was deleted are freed,
//    the person's rather than the workspace's, through a definer.
// 2. `expired`: jobs left `ready` past their hour end `cancelled` with
//    `JOB_EXPIRED` (the queue row at the expiry normally does it first).
// 3. `items`: the items of jobs that finished since the last cleanup, all
//    but the refused ones, which stay with their job's summary.
// 4. `jobs`: jobs finished more than 30 days ago, their items first.
// 5. `requeue`: an unfinished job that should be running but has no queue
//    row (a lost row) is queued again, and only then (AC-112's rule).
// 6. `exports`: export files past their 7 days (spec 0023), chunks and all.
// 7. `imports` (spec 0040, AC-1145): an import's staged rows and outcomes once
//    its undo window has closed, and imports never started after 24 hours.
// 8. `uploads` (#32): files visitors uploaded to forms that no submission took within a day, or whose
//    submission is gone, removed from the blob store and then their rows, 100 a batch. Skipped where the host
//    has no store to remove from (the rows then wait).
// 9. `record_files` (27 Oct 2026): a record's own copy of a file, removed once no live value and no history row on
//    its cell names its id, and the row is at least a day old (so a file just uploaded onto a cell, or just
//    copied by filing, is never swept before its value lands). Lazy, exactly as `uploads` is: clearing a cell,
//    overwriting it, trashing or restoring a record and value history never delete bytes themselves.
// The outbox is no phase: the fan out prunes it once for every workspace.
// Its result holds the totals per phase; `done` counts every row it removed.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { purgeBatch, type RemovedCounts } from '../../engine/deletion.ts';
import { pruneNavRows } from '../../navigation/navigation.ts';
import { notifyTasksDue } from '../../notifications/notify.ts';
import { SPAM_FILES_KEPT_DAYS, UPLOAD_KEPT_HOURS, WEBHOOK_LOG_DAYS } from '@crm/contracts';
import { ensureLinkPage, publicProfilesOf } from '../../booking/handles.ts';
import { RESTORE_WINDOW } from '../../engine/limits.ts';
import type { WriteContext } from '../../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition, type StepOutcome } from '../registry.ts';
import type { UploadStore } from '../../forms/uploads.ts';
import { findOrphanRecordFiles } from '../../records/files.ts';
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
const PHASES = [
  'purge',
  'notes_tasks',
  'emails',
  'webhooks',
  'nav',
  'notifications',
  'task_due',
  'views',
  'profile_counts',
  'link_pages',
  'released_handles',
  'expired',
  'items',
  'jobs',
  'requeue',
  'exports',
  'imports',
  'uploads',
  'record_files',
] as const;

/** How long a booking page's view counts are kept (spec 0047, AC-1628): a year, by day. */
const PAGE_VIEWS_KEPT_DAYS = 365;

/** How long a done notification is kept (spec 0038, AC-1175). */
const DONE_NOTIFICATIONS_KEPT = '90 days';

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
  // Added by spec 0064: webhook deliveries past their 30 days.
  webhooks: Count.default(0),
  // Added by spec 0034: the sidebars that lost an item pointing at nothing.
  sidebars: Count.default(0),
  // Added by spec 0038.
  notifications: Count.default(0),
  /** Assignees told a task is due today (migration 0135); 0 in an older checkpoint. */
  tasksDue: Count.default(0),
  // Added by spec 0047: booking page view rows past a year.
  views: Count.default(0),
  // Added by spec 0051: link page view and press rows past a year.
  profileCounts: Count.default(0),
  // Added 26 Oct 2026: the link pages a membership's own transaction didn't make.
  linkPages: Count.default(0),
  /** Members it tried and still couldn't make a page for (20 live pages, a failure): tried again tomorrow. */
  linkPagesMissed: Count.default(0),
  /** Handles freed 90 days after their person's account was deleted (migration 0126); 0 in an older checkpoint. */
  handles: Count.default(0),
  expired: Count,
  items: Count,
  jobs: Count,
  requeued: Count,
  /** Export files past their 7 days (spec 0023's submissions export); a checkpoint from before them reads 0. */
  exports: Count.default(0),
  /** Import rows past their undo window, and imports never started (spec 0040); 0 in an older checkpoint. */
  imports: Count.default(0),
  /** Form upload files removed from the store (#32); 0 in an older checkpoint. */
  uploads: Count.default(0),
  /** Record files removed from the store (27 Oct 2026); 0 in an older checkpoint. */
  recordFiles: Count.default(0),
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
  webhooks: 0,
  sidebars: 0,
  notifications: 0,
  tasksDue: 0,
  views: 0,
  profileCounts: 0,
  linkPages: 0,
  linkPagesMissed: 0,
  handles: 0,
  expired: 0,
  items: 0,
  jobs: 0,
  requeued: 0,
  exports: 0,
  imports: 0,
  uploads: 0,
  recordFiles: 0,
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
  webhooks: totals.webhooks + (more.webhooks ?? 0),
  sidebars: totals.sidebars + (more.sidebars ?? 0),
  notifications: totals.notifications + (more.notifications ?? 0),
  tasksDue: totals.tasksDue + (more.tasksDue ?? 0),
  views: totals.views + (more.views ?? 0),
  profileCounts: totals.profileCounts + (more.profileCounts ?? 0),
  linkPages: totals.linkPages + (more.linkPages ?? 0),
  linkPagesMissed: totals.linkPagesMissed + (more.linkPagesMissed ?? 0),
  handles: totals.handles + (more.handles ?? 0),
  expired: totals.expired + (more.expired ?? 0),
  items: totals.items + (more.items ?? 0),
  jobs: totals.jobs + (more.jobs ?? 0),
  requeued: totals.requeued + (more.requeued ?? 0),
  exports: totals.exports + (more.exports ?? 0),
  imports: totals.imports + (more.imports ?? 0),
  uploads: totals.uploads + (more.uploads ?? 0),
  recordFiles: totals.recordFiles + (more.recordFiles ?? 0),
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

/**
 * Phase 1c2 (spec 0064, AC-6425): webhook deliveries made more than `WEBHOOK_LOG_DAYS` ago go, whatever became of
 * them, `limit` a batch through `webhook_deliveries_created`. A waiting try of one finds it gone and sends nothing.
 */
async function oldWebhookDeliveries(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const removed = await context.tx.execute(sql`
    delete from webhook_deliveries where (workspace_id, id) in (
      select workspace_id, id from webhook_deliveries where created_at < now() - make_interval(days => ${WEBHOOK_LOG_DAYS})
      order by created_at limit ${limit}
    )
  `);
  const count = removed.rowCount ?? 0;
  const totals = plus(at.totals, { webhooks: count });
  return outcome(count >= limit ? { ...at, totals } : nextPhase(at, totals), at, totals, count);
}

/**
 * Phase 1d (spec 0034, AC-940): the members' stored sidebars, `limit` rows a batch by member id, each losing the
 * views and records that point at nothing any more (a view deleted, a record purged, today's purge included). Their
 * items were already left out of every read, so no event is stored, and none is needed: a browser takes a read at
 * the row's new version as newer than the copy it holds.
 */
async function navRows(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const { seen, changed, last } = await pruneNavRows(context, at.after, limit);
  const totals = plus(at.totals, { sidebars: changed });
  const next = seen === limit && last !== undefined ? { ...at, totals, after: last } : nextPhase(at, totals);
  return outcome(next, at, totals, changed);
}

/**
 * Phase 1e (spec 0038, AC-1175): notifications marked done more than 90 days
 * ago, `limit` a batch. Only their member ever saw them, in Done, where they
 * simply stop showing; no event is stored.
 */
async function oldNotifications(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const removed = await context.tx.execute(sql`
    delete from notifications where id in (
      select id from notifications where done_at < now() - ${DONE_NOTIFICATIONS_KEPT}::interval
      order by done_at limit ${limit}
    )
  `);
  const count = removed.rowCount ?? 0;
  const totals = plus(at.totals, { notifications: count });
  return outcome(count >= limit ? { ...at, totals } : nextPhase(at, totals), at, totals, count);
}

/**
 * Phase 1e2 (migration 0135): the open tasks due on the job's day, `limit` a
 * batch by id, each active assignee told once (`notifyTasksDue`). Their
 * inboxes hear of it through the write's `notifications` outbox row.
 */
async function tasksDue(context: WriteContext, at: Checkpoint, day: string, limit: number): Promise<StepOutcome> {
  const batch = await notifyTasksDue(context, { day, ...(at.after === undefined ? {} : { after: at.after }), limit });
  const totals = plus(at.totals, { tasksDue: batch.notified });
  const next =
    batch.picked === limit && batch.last !== undefined ? { ...at, totals, after: batch.last } : nextPhase(at, totals);
  return outcome(next, at, totals, batch.notified);
}

/**
 * Phase 1f (spec 0047, AC-1628): booking page view rows older than a year,
 * `limit` a batch, oldest days first. Counts only; no event is stored.
 */
async function oldPageViews(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const removed = await context.tx.execute(sql`
    delete from booking_page_views where (workspace_id, page_id, day, visitor) in (
      select workspace_id, page_id, day, visitor from booking_page_views
      where workspace_id = ${context.scope.workspaceId}
        and day < (now() at time zone 'UTC')::date - ${PAGE_VIEWS_KEPT_DAYS}::integer
      order by day limit ${limit}
    )
  `);
  const count = removed.rowCount ?? 0;
  const totals = plus(at.totals, { views: count });
  return outcome(count >= limit ? { ...at, totals } : nextPhase(at, totals), at, totals, count);
}

/**
 * Phase 1g (spec 0051, AC-5128): link page view and press rows older than a year, `limit` of each a batch, through
 * `crm_profile_counts`' sweep. They are a person's, not a workspace's, so whichever workspace's cleanup runs first
 * takes them; the others find none.
 */
async function oldProfileCounts(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const swept = await context.tx.execute<{ readonly gone: number } & Record<string, unknown>>(
    sql`select crm_sweep_profile_counts(${limit}::integer) as gone`,
  );
  const count = swept.rows[0]?.gone ?? 0;
  const totals = plus(at.totals, { profileCounts: count });
  return outcome(count >= limit ? { ...at, totals } : nextPhase(at, totals), at, totals, count);
}

/**
 * Phase 1i (migration 0126): handles held more than 90 days after their person's account was deleted, `limit` a batch,
 * through `crm_sweep_released_handles`. They are nobody's workspace's, so whichever cleanup runs first frees them.
 */
async function releasedHandles(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const swept = await context.tx.execute<{ readonly gone: number } & Record<string, unknown>>(
    sql`select crm_sweep_released_handles(${limit}::integer) as gone`,
  );
  const count = swept.rows[0]?.gone ?? 0;
  const totals = plus(at.totals, { handles: count });
  return outcome(count >= limit ? { ...at, totals } : nextPhase(at, totals), at, totals, count);
}

/** How many members one `link_pages` batch looks at: few, since each page made holds its person's lock to commit. */
const LINK_PAGE_BATCH = 25;

/**
 * Phase 1h (26 Oct 2026): the active members with a sign in, `LINK_PAGE_BATCH` at a time by id, and a link page
 * made for each one who has none here (`ensureLinkPage`, which never throws and answers nothing for one it can't
 * make, such as a person with 20 live pages). Tried again tomorrow for any still without one.
 */
async function missingLinkPages(context: WriteContext, at: Checkpoint): Promise<StepOutcome> {
  const { tx, scope } = context;
  const found = await tx.execute<{ id: string; user_id: string; name: string; email: string }>(sql`
    select id::text, user_id::text, name, email from members
    where workspace_id = ${scope.workspaceId} and status = 'active' and user_id is not null
      ${at.after === undefined ? sql`` : sql`and id > ${at.after}::uuid`}
    order by id limit ${LINK_PAGE_BATCH}
  `);
  const held = await publicProfilesOf(
    tx,
    scope.workspaceId,
    found.rows.map((row) => row.user_id),
  );
  let made = 0;
  let missed = 0;
  for (const row of found.rows) {
    if (held.has(row.user_id)) continue;
    const handle = await ensureLinkPage(tx, {
      userId: row.user_id,
      workspaceId: scope.workspaceId,
      name: row.name,
      email: row.email,
    });
    if (handle === undefined) missed += 1;
    else made += 1;
  }
  const totals = plus(at.totals, { linkPages: made, linkPagesMissed: missed });
  const last = found.rows.at(-1)?.id;
  const next =
    found.rows.length === LINK_PAGE_BATCH && last !== undefined
      ? { ...at, totals, after: last }
      : nextPhase(at, totals);
  return outcome(next, at, totals, made);
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

/** How many expired export files one batch deletes: each cascades to its chunks, so a batch stays small. */
const EXPORTS_BATCH = 20;

/** Phase 6: export files past their expiry, `EXPORTS_BATCH` at a time, their chunks with them (the foreign key cascades). */
async function expiredExports(context: WriteContext, at: Checkpoint): Promise<StepOutcome> {
  const gone = await context.tx.execute(sql`
    delete from exports where id in (
      select id from exports where expires_at < now() order by expires_at limit ${EXPORTS_BATCH}
    )`);
  const removed = gone.rowCount ?? 0;
  const totals = plus(at.totals, { exports: removed });
  return outcome(removed === EXPORTS_BATCH ? { ...at, totals } : nextPhase(at, totals), at, totals, removed);
}

/** How long an import never started is kept (AC-1145). */
const STAGING_KEPT = '24 hours';

/**
 * Phase 7 (spec 0040, AC-1145): an import's staged rows, `limit` at a time,
 * once its undo window has closed and neither its job nor its undo runs;
 * then imports left unstarted for 24 hours, with their rows. A closed import keeps its row (its file name
 * and counts' place) for the jobs page.
 */
async function oldImports(context: WriteContext, at: Checkpoint, limit: number): Promise<StepOutcome> {
  const { tx } = context;
  const gone = await tx.execute(sql`
    delete from import_rows where id in (
      select r.id from import_rows r
      join imports i on i.workspace_id = r.workspace_id and i.id = r.import_id
      where i.undo_until < now() and not exists (
        select 1 from jobs j
        where j.workspace_id = i.workspace_id and j.id in (i.job_id, i.undo_job_id) and j.finished_at is null
      )
      limit ${limit}
    )`);
  const removed = gone.rowCount ?? 0;
  if (removed === limit) {
    const totals = plus(at.totals, { imports: removed });
    return outcome({ ...at, totals }, at, totals, removed);
  }
  // Imports never started, a few at a time with their staged rows (the foreign key cascades). Each is taken
  // with the lock a start takes, skipping one a start holds, so a start and the cleanup never cross.
  const unstarted = await tx.execute(sql`
    delete from imports where id in (
      select id from imports where status = 'staging' and created_at < now() - ${STAGING_KEPT}::interval
      order by created_at limit ${IMPORTS_BATCH} for update skip locked
    )`);
  const dropped = unstarted.rowCount ?? 0;
  const totals = plus(at.totals, { imports: removed + dropped });
  return outcome(dropped === IMPORTS_BATCH ? { ...at, totals } : nextPhase(at, totals), at, totals, removed + dropped);
}

/** How many unstarted imports one batch deletes: each cascades to up to 100,000 staged rows. */
const IMPORTS_BATCH = 2;

/** How many orphaned upload files one batch removes. */
const UPLOADS_BATCH = 100;

/** How long an upload waits for its submission: `UPLOAD_KEPT_HOURS`, as an interval. */
const UPLOAD_WAIT = `${String(UPLOAD_KEPT_HOURS)} hours`;

/** How long a spam submission keeps its files, as an interval. */
const SPAM_WAIT = `${String(SPAM_FILES_KEPT_DAYS)} days`;

/**
 * Phase 8 (#32): uploads no submission took within a day, whose submission is gone (a deleted submission leaves
 * its upload row on purpose), or whose submission was judged spam more than 30 days ago (its answer then names a
 * file that is gone, as a deleted file's does). The files go from the store first, then the rows, in one transaction: a store that
 * fails rolls the rows back and the job retries, and a file already gone is no error. Without a store the phase
 * does nothing and the rows wait.
 */
async function orphanUploads(
  context: WriteContext,
  at: Checkpoint,
  store: UploadStore | undefined,
): Promise<StepOutcome> {
  const { tx, scope } = context;
  if (store === undefined) return outcome(nextPhase(at, at.totals), at, at.totals, 0);
  const orphans = await tx.execute<{ id: string; pathname: string }>(sql`
    select u.id::text, u.pathname from form_uploads u
    where u.workspace_id = ${scope.workspaceId} and (
      (u.submission_id is null and u.created_at < now() - ${UPLOAD_WAIT}::interval)
      or (u.submission_id is not null and not exists (
        select 1 from form_submissions s where s.workspace_id = u.workspace_id and s.id = u.submission_id))
      -- One our spam check caught keeps its files 30 days (SPAM_FILES_KEPT_DAYS), from when it arrived, which is when
      -- it was caught; one a member marked as spam keeps them.
      or exists (
        select 1 from form_submissions s where s.workspace_id = u.workspace_id and s.id = u.submission_id
          and s.state = 'spam' and coalesce(s.spam ->> 'marked', 'false') <> 'true'
          and s.received_at < now() - ${SPAM_WAIT}::interval)
    )
    order by u.created_at limit ${UPLOADS_BATCH}
    for update skip locked
  `);
  if (orphans.rows.length > 0) {
    await store.remove(orphans.rows.map((row) => row.pathname));
    const ids = JSON.stringify(orphans.rows.map((row) => row.id));
    await tx.execute(sql`
      delete from form_uploads
      where workspace_id = ${scope.workspaceId} and id in (select jsonb_array_elements_text(${ids}::jsonb)::uuid)
    `);
  }
  const removed = orphans.rows.length;
  const totals = plus(at.totals, { uploads: removed });
  return outcome(removed === UPLOADS_BATCH ? { ...at, totals } : nextPhase(at, totals), at, totals, removed);
}

/**
 * Phase 9 (27 Oct 2026): a record's own copy of a file whose cell no longer names it, live or in history. Nothing
 * deletes these bytes eagerly: a cleared or overwritten cell, a trashed record and a restore all leave the history
 * row that names the id, and the file goes only once that row has gone too (an erase, a purge, or history past
 * retention). The day's grace keeps a file just uploaded onto a cell, whose value is still being written, safe.
 * The files go from the store first, then the rows, in one transaction, as `orphanUploads` does. Without a store
 * the phase does nothing and the rows wait.
 */
async function orphanRecordFiles(
  context: WriteContext,
  at: Checkpoint,
  store: UploadStore | undefined,
): Promise<StepOutcome> {
  const { tx, scope } = context;
  if (store === undefined) return outcome(nextPhase(at, at.totals), at, at.totals, 0);
  const orphans = await findOrphanRecordFiles(tx, {
    workspaceId: scope.workspaceId,
    limit: UPLOADS_BATCH,
    graceHours: UPLOAD_KEPT_HOURS,
  });
  if (orphans.length > 0) {
    await store.remove(orphans.map((row) => row.pathname));
    const ids = JSON.stringify(orphans.map((row) => row.id));
    await tx.execute(sql`
      delete from record_files
      where workspace_id = ${scope.workspaceId} and id in (select jsonb_array_elements_text(${ids}::jsonb)::uuid)
    `);
  }
  const removed = orphans.length;
  const totals = plus(at.totals, { recordFiles: removed });
  return outcome(removed === UPLOADS_BATCH ? { ...at, totals } : nextPhase(at, totals), at, totals, removed);
}

/**
 * The daily cleanup's kind. `queue` is the worker's (which jobs have a
 * queue row); the api registers the kind without one, to show and refuse to
 * cancel its jobs, and never runs a step.
 */
export function maintenanceDaily(queue?: QueueRows, uploads?: UploadStore): KindDefinition<MaintenanceParams> {
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
        case 'webhooks':
          return oldWebhookDeliveries(context, at, limit);
        case 'nav':
          return navRows(context, at, limit);
        case 'notifications':
          return oldNotifications(context, at, limit);
        case 'task_due':
          return tasksDue(context, at, job.params.day, limit);
        case 'views':
          return oldPageViews(context, at, limit);
        case 'profile_counts':
          return oldProfileCounts(context, at, limit);
        case 'link_pages':
          return missingLinkPages(context, at);
        case 'released_handles':
          return releasedHandles(context, at, limit);
        case 'expired':
          return expired(context, at, limit);
        case 'items':
          return items(context, at, job.id);
        case 'jobs':
          return oldJobs(context, at, limit);
        case 'requeue':
          return requeue(context, at, limit, queue);
        case 'exports':
          return expiredExports(context, at);
        case 'imports':
          return oldImports(context, at, limit);
        case 'uploads':
          return orphanUploads(context, at, uploads);
        case 'record_files':
          return orphanRecordFiles(context, at, uploads);
      }
    },
  });
}
