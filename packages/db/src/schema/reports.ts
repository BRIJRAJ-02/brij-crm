// Saved reports (the reports lane, spec 0050 reserved): a chart's definition and nothing else. Every number a
// report shows is read through `records.aggregate` and `records.aggregateGroups` when it is opened, so the access
// door and record rules decide what each reader sees; no figure is stored here. A tenant table under forced row
// level security.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, workspaceId } from './common.ts';
import { objects } from './definitions.ts';
import { actorConstraints, members } from './workspaces.ts';

/** The most bytes of settings one report stores. */
export const REPORT_CONFIG_MAX_BYTES = 16_384;

/** One saved report: shared with the workspace, shown to whoever may read its object. */
export const reports = pgTable(
  'reports',
  {
    workspaceId: workspaceId(),
    /** A UUID v7 the browser mints (the idempotent create key, and what Undo puts back under). */
    id: uuid('id').notNull(),
    objectId: uuid('object_id').notNull(),
    /** 1 to 100 characters, stored trimmed. */
    name: text('name').notNull(),
    /** `ReportConfig` (`@crm/contracts`): measure, group by, filter snapshot, chart type and win chances. */
    config: jsonb('config').notNull(),
    /** Who made it: they, and a holder of `views.manage`, change or delete it. */
    creatorMemberId: uuid('creator_member_id'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'reports_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'reports_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    foreignKey({
      name: 'reports_creator',
      columns: [t.workspaceId, t.creatorMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // The page's list: a workspace's reports, oldest first.
    index('reports_by_created').on(t.workspaceId, t.createdAt, t.id),
    index('reports_by_object').on(t.workspaceId, t.objectId),
    check('reports_name', sql`char_length(${t.name}) between 1 and 100 and ${t.name} = btrim(${t.name})`),
    check('reports_config', sql`jsonb_typeof(${t.config}) = 'object' and octet_length(${t.config}::text) <= 16384`),
    ...actorConstraints('reports', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('reports', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
