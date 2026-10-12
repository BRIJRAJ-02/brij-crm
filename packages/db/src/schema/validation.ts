// Validation rules (spec 0013): what a valid value of an attribute looks
// like, as definition rows that travel with the attribute. The engine runs
// the rules a write touches under the record lock; `attributes.rule_count`
// says whether an object has any, so a write to one with none reads nothing
// more. Rules are hard deleted: they are definitions, and the outbox event
// records the change.
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
import { RULE_KINDS } from '@crm/contracts/validation';
import { auditColumns, timestamptz, workspaceId } from './common.ts';
import { attributes, objects } from './definitions.ts';
import { actorConstraints, members } from './workspaces.ts';

/** Every kind of rule (`RULE_KINDS` in `@crm/contracts/validation`). */
export const validationRuleKind = pgEnum('validation_rule_kind', RULE_KINDS);

/** One rule on one attribute of an object, in its attribute's order. */
export const validationRules = pgTable(
  'validation_rules',
  {
    workspaceId: workspaceId(),
    /** A UUID v7 the browser mints, kept across edits. */
    id: uuid('id').notNull(),
    objectId: uuid('object_id').notNull(),
    /** The attribute the rule checks. */
    attributeId: uuid('attribute_id').notNull(),
    kind: validationRuleKind('kind').notNull(),
    /** `RuleParams[kind]`, checked by `checkRuleSettings` before it gets here. */
    params: jsonb('params').notNull(),
    /** Only when…: a filter group on the object's own attributes, at most 10 conditions, 2 deep. */
    condition: jsonb('condition'),
    /** The rule's own message, shown instead of the generated one. */
    message: text('message'),
    position: smallint('position').notNull(),
    /** Up by one whenever the kind, the settings or the condition change (not the message). */
    version: integer('version').notNull().default(1),
    /** The background count (milestone 3): how many records break the rule, up to 20 of them, and when. */
    breakingCount: integer('breaking_count'),
    breakingSample: uuid('breaking_sample').array(),
    countedAt: timestamptz('counted_at'),
    countedVersion: integer('counted_version'),
    countedByMemberId: uuid('counted_by_member_id'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'validation_rules_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'validation_rules_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    foreignKey({
      name: 'validation_rules_attribute',
      columns: [t.workspaceId, t.attributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    foreignKey({
      name: 'validation_rules_counted_by',
      columns: [t.workspaceId, t.countedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    index('validation_rules_by_attribute').on(t.workspaceId, t.objectId, t.attributeId, t.position),
    // At most one Required When per attribute (spec 0013, AC-260).
    uniqueIndex('validation_rules_one_required_when')
      .on(t.workspaceId, t.attributeId)
      .where(sql`${t.kind} = 'required_when'`),
    check('validation_rules_message', sql`${t.message} is null or char_length(${t.message}) between 1 and 200`),
    check('validation_rules_position', sql`${t.position} >= 0`),
    check(
      'validation_rules_sample',
      sql`${t.breakingSample} is null or coalesce(array_length(${t.breakingSample}, 1), 0) <= 20`,
    ),
    ...actorConstraints('validation_rules', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('validation_rules', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
