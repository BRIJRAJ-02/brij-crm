// Columns and rules every tenant table shares (spec 0004): the workspace, the
// audit columns, and how an actor (who did something) is stored.
import { sql } from 'drizzle-orm';
import { check, pgEnum, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { AttributeType } from '@crm/contracts/values';

/**
 * Who did something: a member, an API key, an automation, a form (spec 0023:
 * its submissions' writes), a booking page (spec 0025: the records a
 * visitor's booking writes, its id the page's), the system (whose id is
 * null), or calendar sync (spec 0024, whose id is null too). A table's actor
 * checks admit `calendar` only where calendar sync writes (`actorCheck`'s
 * `withCalendar`), so nothing else can store it by mistake.
 */
export const actorType = pgEnum('actor_type', [
  'member',
  'api_key',
  'automation',
  'system',
  'calendar',
  'form',
  'booking',
]);

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

/**
 * The actor types a table stores when its checks don't admit calendar sync:
 * every table but calendar sync's own. A form (spec 0023) writes the records
 * and values its submissions make, and a booking page (spec 0025) the people
 * and companies a visitor's booking makes, so both are among them.
 */
export type StoredActorType = 'member' | 'api_key' | 'automation' | 'system' | 'form' | 'booking';

/** Every actor type, calendar sync's too (spec 0024): what calendar sync's own tables store. */
export type CalendarActorType = StoredActorType | 'calendar';

/**
 * The three columns of one actor: its type, its id, and the id again when it's
 * a member, for the foreign key. The type reads as `StoredActorType` unless the
 * table's checks admit calendar sync (`withCalendar`, with `actorCheck`'s option).
 */
export function actorColumns<P extends string>(prefix: P) {
  return {
    type: actorType(`${prefix}_type`).$type<StoredActorType>(),
    id: uuid(`${prefix}_id`),
    memberId: uuid(`${prefix}_member_id`),
  };
}

/**
 * An actor's type on a calendar sync table (spec 0024), whose checks admit the
 * `calendar` actor: put in place of `auditColumns()`'s `createdByType` or
 * `updatedByType`.
 */
export function calendarActorType(prefix: 'created_by' | 'updated_by') {
  return actorType(`${prefix}_type`).$type<CalendarActorType>().notNull();
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
 * foreign key); any other actor (an API key, an automation, a form, a booking page) has an id
 * and no member id. The last branch names only the two types it excludes, so a
 * new actor type needs no constraint rewritten (and a migration that adds the
 * type never uses its new value in the same transaction). With `withCalendar`,
 * calendar sync (spec 0024) may act too, with no id like the system. Both
 * compare as text, so a check never names an enum value added beside it in
 * one migration.
 */
export function actorCheck(
  name: string,
  actor: { type: AnyPgColumn; id: AnyPgColumn; memberId: AnyPgColumn },
  options: { readonly withCalendar?: boolean } = {},
) {
  const { type, id, memberId } = actor;
  const noId = options.withCalendar === true ? sql`${type}::text in ('system', 'calendar')` : sql`${type} = 'system'`;
  return check(
    name,
    sql`(${type} is null and ${id} is null and ${memberId} is null)
      or (${noId} and ${id} is null and ${memberId} is null)
      or (${type} = 'member' and ${id} is not null and ${memberId} = ${id})
      or (${type}::text not in ('member', 'system', 'calendar') and ${id} is not null and ${memberId} is null)`,
  );
}
