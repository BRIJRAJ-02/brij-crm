// Background jobs (spec 0008): each job is a row here that holds its status,
// progress and where it got to; Graphile Worker's queue (schema
// `graphile_worker`) only says when the next piece runs, and holds ids alone.
// `job_items` lists the ids an item job works through, each with its state.
// Both force row level security with the standard policy (hand written in the
// migration), and every index leads with the workspace.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, id, timestamptz, workspaceId } from './common.ts';
import { actorConstraints, members, workspaces } from './workspaces.ts';

/** Which Graphile runner a job's slices go to: `heavy` (one per workspace at a time) or `light`. */
export const jobLane = pgEnum('job_lane', ['heavy', 'light']);

/**
 * Where a job is (spec 0008, state transitions). `succeeded`, `failed` and
 * `cancelled` are finished: a finished job never changes again.
 */
export const jobStatus = pgEnum('job_status', [
  'preparing',
  'ready',
  'queued',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
]);

/** One item's state in its job: waiting, or how its batch decided it. */
export const jobItemState = pgEnum('job_item_state', ['pending', 'done', 'refused', 'skipped']);

const createdBy = actorColumns('created_by');

/** One background job: its kind, params, progress, checkpoint and the lease of the runner working on it. */
export const jobs = pgTable(
  'jobs',
  {
    workspaceId: workspaceId(),
    /** A uuid v7: the client's for a member job (the idempotent start key), `uuidv7()` for a system one. */
    id: id(),
    /** A registered kind (`dev.simulate`, …), checked by the registry in `packages/core`. */
    kind: text('kind').notNull(),
    lane: jobLane('lane').notNull(),
    status: jobStatus('status').notNull(),
    /** The kind's params, parsed by its schema at start and at every slice: ids and settings, never secrets. */
    params: jsonb('params').notNull(),
    /** What the job works on (`object`, `attribute`, `list`), so a feature can ask what runs on it. */
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    /** Coalescing: a waiting job of the same kind and key takes new items instead of a second job. */
    dedupeKey: text('dedupe_key'),
    /** A server side start that must happen once, such as `maintenance:2026-10-04`. */
    onceKey: text('once_key'),
    /** 0 for member jobs, 10 for system ones, so people's work goes first. */
    priority: smallint('priority').notNull(),
    /** When the job may next run: its start time, or Graphile's retry time after a failed try. */
    runAt: timestamptz('run_at').notNull().defaultNow(),
    /** Null when the kind can't know it (the bar is then indeterminate). */
    total: integer('total'),
    done: integer('done').notNull().default(0),
    refused: integer('refused').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    /** The resume point: the kind's own for a cursor job, `{ position }` for an item job. */
    checkpoint: jsonb('checkpoint'),
    /** The kind's summary, refusal groups included. */
    result: jsonb('result'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** Consecutive failed tries of the current batch; a batch that commits sets it back to 0. */
    attempts: smallint('attempts').notNull().default(0),
    /** The runner working on it now (`<hostname>:<pid>:<start time>`) and until when. */
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamptz('lease_until'),
    slices: integer('slices').notNull().default(0),
    /** When a `ready` job expires unconfirmed. */
    expiresAt: timestamptz('expires_at'),
    cancelRequestedAt: timestamptz('cancel_requested_at'),
    cancelRequestedByMemberId: uuid('cancel_requested_by_member_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByType: createdBy.type.notNull(),
    createdById: createdBy.id,
    createdByMemberId: createdBy.memberId,
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'jobs_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'jobs_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'jobs_cancel_requested_by',
      columns: [t.workspaceId, t.cancelRequestedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    ...actorConstraints('jobs', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    check('jobs_counts', sql`${t.done} >= 0 and ${t.refused} >= 0 and ${t.skipped} >= 0 and ${t.total} >= 0`),
    check('jobs_finished', sql`(${t.finishedAt} is null) = (${t.status} not in ('succeeded', 'failed', 'cancelled'))`),
    // At most one waiting job per kind and key (AC-110): two concurrent starts can't both make one.
    uniqueIndex('jobs_dedupe')
      .on(t.workspaceId, t.kind, t.dedupeKey)
      .where(sql`${t.status} = 'queued' and ${t.slices} = 0`),
    uniqueIndex('jobs_once')
      .on(t.workspaceId, t.kind, t.onceKey)
      .where(sql`${t.onceKey} is not null`),
    // "My jobs" and "all jobs", newest first.
    index('jobs_mine').on(t.workspaceId, t.createdByMemberId, t.createdAt.desc(), t.id),
    index('jobs_all').on(t.workspaceId, t.createdAt.desc(), t.id),
    // "Is something running on this attribute": unfinished jobs by subject.
    index('jobs_subject')
      .on(t.workspaceId, t.subjectId)
      .where(sql`${t.finishedAt} is null`),
    // Retention: finished jobs by age.
    index('jobs_finished_at')
      .on(t.workspaceId, t.finishedAt)
      .where(sql`${t.finishedAt} is not null`),
  ],
);

/** One id an item job works through, at its position, with the state its batch gave it. */
export const jobItems = pgTable(
  'job_items',
  {
    workspaceId: workspaceId(),
    jobId: uuid('job_id').notNull(),
    position: integer('position').notNull(),
    /** A record id, or another id the kind names. */
    itemId: uuid('item_id').notNull(),
    state: jobItemState('state').notNull().default('pending'),
    code: text('code'),
    message: text('message'),
  },
  (t) => [
    primaryKey({ name: 'job_items_pkey', columns: [t.workspaceId, t.jobId, t.position] }),
    foreignKey({
      name: 'job_items_job',
      columns: [t.workspaceId, t.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
    }).onDelete('cascade'),
    // A merged item is never added twice.
    uniqueIndex('job_items_item').on(t.workspaceId, t.jobId, t.itemId),
    // The refusal summary: refused items grouped by code.
    index('job_items_refused')
      .on(t.workspaceId, t.jobId, t.code)
      .where(sql`${t.state} = 'refused'`),
  ],
);
