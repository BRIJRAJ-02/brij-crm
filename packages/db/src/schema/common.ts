// Columns and rules every tenant table shares (spec 0004): the workspace, the
// audit columns, and how an actor (who did something) is stored.
import { sql } from 'drizzle-orm';
import { check, pgEnum, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { AttributeType } from '@crm/contracts/values';

/** Who did something: a member, an API key, an automation, or the system (whose id is null). */
export const actorType = pgEnum('actor_type', ['member', 'api_key', 'automation', 'system']);

/** Every attribute type the field set knows (spec 0003), mirrored from `@crm/contracts/values`. */
export const attributeType = pgEnum('attribute_type', AttributeType.options as [AttributeType, ...AttributeType[]]);

/** The `records` column a system attribute reads, instead of value rows. */
export const systemColumn = pgEnum('system_column', ['id', 'created_at', 'created_by', 'updated_at', 'updated_by']);

/** A new id, time ordered (Postgres 18's `uuidv7()`), so inserts stay local in every index. */
export const id = () =>
  uuid('id')
    .notNull()
    .default(sql`uuidv7()`);

/** The tenant column. Every tenant table has it, and every index leads with it. */
export const workspaceId = () => uuid('workspace_id').notNull();

/** A timestamp with time zone and microseconds. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, precision: 6 });

/** The three columns of one actor: its type, its id, and the id again when it's a member, for the foreign key. */
export function actorColumns<P extends string>(prefix: P) {
  return {
    type: actorType(`${prefix}_type`),
    id: uuid(`${prefix}_id`),
    memberId: uuid(`${prefix}_member_id`),
  };
}

/** Created and updated, with who, on every definition, record, entry and link row. */
export function auditColumns() {
  const created = actorColumns('created_by');
  const updated = actorColumns('updated_by');
  return {
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByType: created.type.notNull(),
    createdById: created.id,
    createdByMemberId: created.memberId,
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByType: updated.type.notNull(),
    updatedById: updated.id,
    updatedByMemberId: updated.memberId,
  };
}

/**
 * The rule one actor's columns obey: an absent actor has nothing set; the system has
 * no id; a member's id is repeated in `*_member_id` (which carries the
 * foreign key); an API key or automation has an id and no member id.
 */
export function actorCheck(name: string, actor: { type: AnyPgColumn; id: AnyPgColumn; memberId: AnyPgColumn }) {
  const { type, id, memberId } = actor;
  return check(
    name,
    sql`(${type} is null and ${id} is null and ${memberId} is null)
      or (${type} = 'system' and ${id} is null and ${memberId} is null)
      or (${type} = 'member' and ${id} is not null and ${memberId} = ${id})
      or (${type} in ('api_key', 'automation') and ${id} is not null and ${memberId} is null)`,
  );
}
