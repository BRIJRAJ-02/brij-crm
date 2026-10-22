// The outbox (spec 0005, change events; spec 0007 widens it to every kind):
// one row per object, list or kind a write touched, stored in the write's own
// transaction and numbered per workspace with no gaps, so an event can never
// describe a change that rolled back, nor miss one that committed. Ids only,
// never values. `actor_member_id` names the member whose write stored the row,
// read by the access filter for `jobs` and never published. The relay publishes the rows in `seq` order
// and stamps `published_at`; published rows are kept for `OUTBOX_RETENTION`
// (screens that were offline catch up from them), then pruned through
// `crm_outbox_prune` (`pruneOutbox`, on the worker's login only). Row level
// security and the grants (the app may
// only insert, read, and stamp `published_at` once, from null to a time) are
// hand written in the migration.
import { sql } from 'drizzle-orm';
import { bigint, boolean, foreignKey, index, jsonb, pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { objects } from './definitions.ts';
import { workspaces } from './workspaces.ts';

/**
 * What an outbox row names (spec 0007, `ChangeEvent` in `@crm/contracts`):
 * `records`, `definitions`, `entries`, `views`, `notes`, `tasks`, `members`,
 * `access`, `jobs`, (spec 0024) `meetings`, (spec 0035) `schedules`, (spec 0034) `nav`, a member's own sidebar, and
 * (spec 0038) `comments` and `notifications`, and `calendars`, a member's own calendar connections. Postgres can't drop an enum value, so a kind is only ever added.
 */
export const outboxKind = pgEnum('outbox_kind', [
  'records',
  'definitions',
  'entries',
  'views',
  'notes',
  'tasks',
  'members',
  'access',
  'jobs',
  'meetings',
  'schedules',
  'nav',
  'comments',
  'notifications',
  'calendars',
]);

/**
 * How long an outbox row is kept once published, as a Postgres interval
 * (spec 0007, AC-89): `pruneOutbox` passes `now() - OUTBOX_RETENTION` to
 * `crm_outbox_prune` as its cutoff. Lowering it only means screens away for
 * longer resync rather than catch up.
 */
export const OUTBOX_RETENTION = '24 hours';

/** One change event, waiting for the relay until `published_at` is set. */
export const outbox = pgTable(
  'outbox',
  {
    workspaceId: workspaceId(),
    /** `workspace_counters.outbox_seq + 1`, taken under that row's lock in the write transaction. */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    kind: outboxKind('kind').notNull(),
    /** The object the row is about; null for kinds with no object (`members`, `access`, `jobs`, say). */
    objectId: uuid('object_id'),
    /** The list the row is about (`entries`, a list's `definitions` or `views`). */
    listId: uuid('list_id'),
    recordIds: uuid('record_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    attributeIds: uuid('attribute_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /**
     * The ids of the row's own items: entry ids for `entries`, view, note, task,
     * job or meeting ids, thread ids for `comments`, member ids for `members`, `access`, `nav` and `notifications`;
     * empty for the rest.
     */
    itemIds: uuid('item_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /**
     * On a `records` row, the records the write created, moved to the trash
     * (or erased while live), and brought back: at most 200 across the three
     * (`MAX_LIFECYCLE_IDS`), else empty and the row coarse, so screens settle
     * counts and windows on these rather than guess (owner decision pending,
     * 12 Oct 2026, spec 0007). Empty for every other kind.
     */
    createdIds: uuid('created_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    deletedIds: uuid('deleted_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    restoredIds: uuid('restored_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** More than 1,000 records of the object changed: `record_ids` is empty, refetch what you hold of it. */
    coarse: boolean('coarse').notNull().default(false),
    /** The browser's id for the write, echoed so it can skip its own change. */
    mutationId: uuid('mutation_id'),
    /**
     * The member whose write stored the row (for `jobs`, the job's starter), or
     * null for the system or a key. Read by the access filter; never published.
     */
    actorMemberId: uuid('actor_member_id'),
    /**
     * The background job whose batch stored the row (spec 0022, milestone 3),
     * or null. Never published: a `records` event carries only `fromJob`, so a
     * job's id never reaches a member who may not read the job (spec 0009's
     * `jobs` rule). It lives as long as its row, which the outbox prunes after
     * about a day (spec 0007); the audit log (#36) will keep its own record.
     */
    jobId: uuid('job_id'),
    /**
     * The values this write replaced that its author never saw (spec 0006,
     * AC-46), on a `records` row: `{ by: { type, id }, cells: [{ recordId,
     * attributeId, versionId }] }`, ids only, `by` named once (owner decision,
     * 8 Oct 2026). Null when there were none, and past 200 cells (no notices
     * for a bulk overwrite). Never on a catch up.
     */
    replaced: jsonb('replaced'),
    /**
     * The commit time an event carries as `at`: `clock_timestamp()`, set by the
     * hook after it takes the counter row, so it follows `seq` order.
     */
    createdAt: timestamptz('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    publishedAt: timestamptz('published_at'),
  },
  (t) => [
    primaryKey({ name: 'outbox_pkey', columns: [t.workspaceId, t.seq] }),
    // A workspace's events go with it.
    foreignKey({ name: 'outbox_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    // An event names an object of its own workspace, as every cross table reference does. Objects are archived,
    // never deleted, today; should one be erased, its events go with it, so erasing a workspace's objects and then
    // the workspace itself never trips over its outbox.
    foreignKey({
      name: 'outbox_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }).onDelete('cascade'),
    // What the relay reads: a workspace's unpublished rows in order. The prune needs no index of its own: it walks
    // the primary key from each workspace's oldest row (spec 0007, milestone 3).
    index('outbox_pending')
      .on(t.workspaceId, t.seq)
      .where(sql`${t.publishedAt} is null`),
  ],
);
