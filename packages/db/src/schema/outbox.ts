// The outbox (spec 0005, change events): one row per object a write touched,
// stored in the write's own transaction and numbered per workspace with no
// gaps, so an event can never describe a change that rolled back, nor miss one
// that committed. Ids only, never values, and no actor columns: who and when
// live on the records and values. The relay publishes the rows in `seq` order
// and stamps `published_at`; published rows are kept for `OUTBOX_RETENTION`
// (screens that were offline catch up from them), then pruned by the relay
// through `crm_outbox_prune`. Row level security and the grants (the app may
// only insert, read, and set `published_at`) are hand written in the migration.
import { sql } from 'drizzle-orm';
import { bigint, boolean, foreignKey, index, pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { workspaces } from './workspaces.ts';

/**
 * What an outbox row names: `records` (refetch these records of the object,
 * or all you hold of it when `coarse`) or `definitions` (refetch the object's
 * attributes). Lists add `entries` when they get screens.
 */
export const outboxKind = pgEnum('outbox_kind', ['records', 'definitions']);

/**
 * How long a published outbox row is kept, as a Postgres interval. The
 * migration hard codes the same interval in `crm_outbox_prune` (the app can't
 * pass a cutoff, so it can't widen it); a test keeps the two in step.
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
    objectId: uuid('object_id').notNull(),
    recordIds: uuid('record_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    attributeIds: uuid('attribute_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** More than 1,000 records of the object changed: `record_ids` is empty, refetch what you hold of it. */
    coarse: boolean('coarse').notNull().default(false),
    /** The browser's id for the write, echoed so it can skip its own change. */
    mutationId: uuid('mutation_id'),
    /** When the row was written (`clock_timestamp()`), not when its transaction began. */
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
    // What the relay reads: a workspace's unpublished rows in order.
    index('outbox_pending')
      .on(t.workspaceId, t.seq)
      .where(sql`${t.publishedAt} is null`),
    // What the prune reads: published rows, oldest first.
    index('outbox_published')
      .on(t.publishedAt)
      .where(sql`${t.publishedAt} is not null`),
  ],
);
