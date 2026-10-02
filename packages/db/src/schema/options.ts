// The options of a select or status attribute (spec 0004, AC-4). A value row
// stores the option's id, so renaming, recolouring, reordering or archiving an
// option changes one row here and rewrites no record.
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  interval,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { attributes } from './definitions.ts';
import { actorConstraints } from './workspaces.ts';

/** What a status stage means: still open, won or lost. Select options have none. */
export const optionOutcome = pgEnum('option_outcome', ['open', 'won', 'lost']);

/** One option of a select or status attribute, in its attribute's order. */
export const attributeOptions = pgTable(
  'attribute_options',
  {
    workspaceId: workspaceId(),
    id: id(),
    attributeId: uuid('attribute_id').notNull(),
    label: text('label').notNull(),
    hue: text('hue').notNull(),
    position: integer('position').notNull(),
    /** Status stages only: whether a record here is still open, won or lost. */
    outcome: optionOutcome('outcome'),
    /** Status stages only: how long a record should sit here before it counts as stuck. */
    targetTimeInStage: interval('target_time_in_stage'),
    archivedAt: timestamptz('archived_at'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'attribute_options_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'attribute_options_attribute',
      columns: [t.workspaceId, t.attributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    // So a value can point at an option of its own attribute only.
    uniqueIndex('attribute_options_of_attribute').on(t.workspaceId, t.attributeId, t.id),
    uniqueIndex('attribute_options_label')
      .on(t.workspaceId, t.attributeId, sql`lower(${t.label})`)
      .where(sql`${t.archivedAt} is null`),
    index('attribute_options_order').on(t.workspaceId, t.attributeId, t.position),
    ...actorConstraints('attribute_options', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('attribute_options', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
