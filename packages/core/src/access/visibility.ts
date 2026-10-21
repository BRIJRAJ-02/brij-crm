// Hidden means absent (spec 0009, milestone 2): the engine side of the data
// policy. The pure policy (`policy.ts`) says what a principal may see; these
// helpers apply it inside a write's or read's own transaction, at the
// engine's choke points: the record rule as SQL, far record visibility for
// links and reference values, and the refusals for an object or list the
// principal may not see or change.
//
// Every helper does nothing (no check, no statement, no SQL) under the open
// policy, so the statements the open policy sends stay exactly as they were
// (AC-149, pinned by `open-sql.test.ts`).
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { isUuid, uuidArray, uuidList } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { AttributeDef } from '../engine/values.ts';
import {
  fieldLevel,
  isOpen,
  objectLevel,
  readOnlyReason,
  recordRule,
  ruleMembers,
  type Access,
  type FieldLevel,
} from './policy.ts';

/** What a filter, sort or write naming an attribute the principal can't see answers: the unknown attribute's words. */
export const UNKNOWN_ATTRIBUTE = 'That attribute is not on this object.';
/** What naming an object the principal can't see answers. */
export const UNKNOWN_OBJECT = 'That object does not exist.';
/** What naming a list the principal can't see answers. */
export const UNKNOWN_LIST = 'That list does not exist.';
/** What naming a record the principal can't see answers. */
export const UNKNOWN_RECORD = 'That record does not exist.';
/** What naming an entry the principal can't see answers. */
export const UNKNOWN_ENTRY = 'That entry does not exist.';

/** A raw alias (fixed names only, never input). */
const alias = (name: string) => sql.raw(name);

/**
 * The principal's level on an attribute: an object's attribute by its object,
 * a list's (an entry's own value) by its list.
 */
export function attributeLevel(
  access: Access,
  attribute: Pick<AttributeDef, 'id' | 'objectId' | 'listId'>,
): FieldLevel {
  const parent = attribute.objectId ?? attribute.listId;
  if (parent === null) return 'hidden';
  return fieldLevel(access, { id: attribute.id, objectId: parent });
}

/** True when the principal may see the attribute (read or write). */
export function attributeVisible(access: Access, attribute: Pick<AttributeDef, 'id' | 'objectId' | 'listId'>): boolean {
  return isOpen(access) || attributeLevel(access, attribute) !== 'hidden';
}

/**
 * The condition a record rule adds on the record aliased `record` of object
 * `objectId` (spec 0009, the record rule predicate), or undefined when the
 * object has no rule: one of the record's current values of the rule's member
 * attribute names a member the rule matches. Written as `id in (...)` rather
 * than the spec's correlated `exists`: the same rows, measured about five
 * times faster on the million record seed. A rule naming something that
 * isn't an attribute id matches no record (fail closed).
 */
export function recordRuleSql(access: Access, objectId: string, record: string): SQL | undefined {
  const rule = recordRule(access, objectId);
  if (rule === undefined) return undefined;
  if (!isUuid(rule.attributeId)) return sql`false`;
  const members = ruleMembers(access, rule);
  if (members.length === 0) return sql`false`;
  const at = alias(record);
  // One semi join the planner can answer from `values_actor` alone (an index only scan of the rule's member ids,
  // then a probe per record), rather than a probe of the values per record. `actor_id` is the member's id on a
  // member value, and ids are unique across actors, so the actor type needs no check (it would cost the heap).
  return sql`${at}.id in (select rv.owner_id from "values" rv where rv.attribute_id = ${rule.attributeId}::uuid and rv.active_until is null and not rv.is_cleared and rv.actor_id = any(${uuidList(members)}))`;
}

/**
 * The condition that keeps a far record (aliased `far`, on one of `objectIds`)
 * only when the principal may see it: its object isn't at `none`, and it is
 * inside its object's record rule. Undefined when nothing narrows them.
 */
export function farVisibleSql(access: Access, objectIds: readonly string[], far: string): SQL | undefined {
  if (isOpen(access)) return undefined;
  const at = alias(far);
  const parts = objectIds.flatMap((objectId): SQL[] => {
    if (objectLevel(access, objectId) === 'none') return [sql`${at}.object_id <> ${objectId}::uuid`];
    const rule = recordRuleSql(access, objectId, far);
    return rule === undefined ? [] : [sql`(${at}.object_id <> ${objectId}::uuid or ${rule})`];
  });
  return parts.length === 0 ? undefined : sql.join(parts, sql` and `);
}

/**
 * The condition that keeps a record (aliased `record`, on any object) only
 * when the principal may see it: its object isn't at `none` (an object with
 * no entry takes the default level), and it is inside its object's record
 * rule. Undefined under the open policy. My tasks' "All tasks" reads it for
 * the task rule's linked record clause (spec 0019, AC-447).
 */
export function recordVisibleSql(access: Access, record: string): SQL | undefined {
  if (isOpen(access)) return undefined;
  const at = alias(record);
  const listed = Object.keys(access.data.objects).filter(isUuid);
  const seen = (objectId: string) => objectLevel(access, objectId) !== 'none';
  // The level an object with no entry gets: the default, anything unknown read as none.
  const byDefault = objectLevel({ data: { ...access.data, objects: {} } }, '') !== 'none';
  const parts: SQL[] = [];
  if (byDefault) {
    const denied = listed.filter((objectId) => !seen(objectId));
    if (denied.length > 0) parts.push(sql`${at}.object_id <> all(${uuidList(denied)})`);
  } else {
    const allowed = listed.filter(seen);
    if (allowed.length === 0) return sql`false`;
    parts.push(sql`${at}.object_id = any(${uuidList(allowed)})`);
  }
  for (const objectId of Object.keys(access.data.records)) {
    if (!isUuid(objectId) || !seen(objectId)) continue;
    const rule = recordRuleSql(access, objectId, record);
    if (rule !== undefined) parts.push(sql`(${at}.object_id <> ${objectId}::uuid or ${rule})`);
  }
  return parts.length === 0 ? sql`true` : sql.join(parts, sql` and `);
}

/**
 * Whether a field rule hides who changed things from the principal (spec
 * 0017): among `attributes` (an object's), Created by or Updated by is
 * hidden. Then a history read names nobody, since the newest version's actor
 * is the record's Updated by, and a create's its Created by. Never under the
 * open policy.
 */
export function hidesActors(
  access: Access,
  attributes: readonly Pick<AttributeDef, 'id' | 'objectId' | 'listId' | 'systemColumn'>[],
): boolean {
  if (isOpen(access)) return false;
  return attributes.some(
    (attribute) =>
      (attribute.systemColumn === 'created_by' || attribute.systemColumn === 'updated_by') &&
      !attributeVisible(access, attribute),
  );
}

/**
 * The attributes a field rule hides from the principal (a level the code
 * doesn't know hides too), as uuids: none under the open policy. Fields on an
 * object at `none` aren't listed; the object's own checks keep them out.
 */
export function hiddenFieldIds(access: Access): readonly string[] {
  if (isOpen(access)) return [];
  return Object.entries(access.data.fields).flatMap(([id, level]) =>
    level !== 'read' && level !== 'write' && isUuid(id) ? [id] : [],
  );
}

/** A record as far as visibility needs it. */
export interface RecordAt {
  readonly objectId: string;
  readonly recordId: string;
}

/**
 * Which of `records` the principal may see: those on an object not at
 * `none`, and, on an object with a record rule, those inside it (one query
 * per such object). Under the open policy, all of them, with no query.
 */
export async function visibleRecords(
  tx: WorkspaceTx,
  access: Access,
  records: readonly RecordAt[],
): Promise<ReadonlySet<string>> {
  if (isOpen(access)) return new Set(records.map((record) => record.recordId));
  const visible = new Set<string>();
  // Sets built in place (local to this call), never copied per record: a link write can name 70,000 records.
  const ruled = new Map<string, Set<string>>();
  for (const record of records) {
    if (objectLevel(access, record.objectId) === 'none') continue;
    if (recordRule(access, record.objectId) === undefined) {
      visible.add(record.recordId);
      continue;
    }
    const ids = ruled.get(record.objectId);
    if (ids === undefined) ruled.set(record.objectId, new Set([record.recordId]));
    else ids.add(record.recordId);
  }
  for (const [objectId, ids] of ruled) {
    const condition = recordRuleSql(access, objectId, 'r') ?? sql`true`;
    const rows = await tx.execute<{ id: string }>(
      sql`select r.id::text as id from records r where r.id = any(${uuidList([...ids])}) and r.object_id = ${objectId}::uuid and ${condition}`,
    );
    for (const row of rows.rows) visible.add(row.id);
  }
  return visible;
}

/** Refuses `NOT_FOUND` with `message` unless the principal may see the record. */
export async function checkRecordVisible(
  tx: WorkspaceTx,
  access: Access,
  record: RecordAt,
  message = UNKNOWN_RECORD,
): Promise<void> {
  if (isOpen(access)) return;
  const seen = await visibleRecords(tx, access, [record]);
  if (!seen.has(record.recordId)) throw refuse('NOT_FOUND', message);
}

/** An object's plural name, for the refusal on an object the principal may only read. */
async function pluralName(tx: WorkspaceTx, objectId: string): Promise<string> {
  const rows = await tx.execute<{ name: string }>(
    sql`select plural_name as name from objects where id = ${objectId}::uuid`,
  );
  return rows.rows[0]?.name ?? 'these records';
}

/**
 * The objects among `objectIds` the principal may only read, each with the
 * words a refused change gives (spec 0009): "You can view People but not
 * change them.", by object id. Empty under the open policy.
 */
export async function readOnlyReasons(
  tx: WorkspaceTx,
  access: Access,
  objectIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (isOpen(access)) return new Map();
  const readOnly = [...new Set(objectIds)].filter((id) => objectLevel(access, id) === 'read');
  if (readOnly.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; name: string }>(
    sql`select id::text, plural_name as name from objects where id = any(${uuidArray(readOnly)})`,
  );
  const names = new Map(rows.rows.map((row) => [row.id, row.name]));
  return new Map(readOnly.map((id) => [id, `You can view ${names.get(id) ?? 'these records'} but not change them.`]));
}

/** The objects the principal may change, or undefined under the open policy, where they may change every one. */
export async function writableObjects(tx: WorkspaceTx, access: Access): Promise<readonly string[] | undefined> {
  if (isOpen(access)) return undefined;
  const rows = await tx.execute<{ id: string }>(sql`select id::text from objects`);
  return rows.rows.map((row) => row.id).filter((id) => objectLevel(access, id) === 'write');
}

/**
 * Refuses unless the principal may `need` the object's records: `NOT_FOUND`
 * (as an unknown object) at `none`, and for a change on an object they may
 * only read, 403 `FORBIDDEN` with "You can view <plural name> but not change them."
 */
export async function checkObject(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  need: 'read' | 'write',
  message = UNKNOWN_OBJECT,
): Promise<void> {
  if (isOpen(access)) return;
  const level = objectLevel(access, objectId);
  if (level === 'none') throw refuse('NOT_FOUND', message);
  if (need === 'write' && level === 'read') {
    const reason = readOnlyReason(
      access,
      { id: '', objectId, title: '' },
      { id: objectId, pluralName: await pluralName(tx, objectId) },
    );
    throw refuse('FORBIDDEN', reason ?? 'You can view these records but not change them.');
  }
}

/**
 * Refuses unless the principal may `need` a list's entries: `NOT_FOUND` (as an
 * unknown list) when the list or its object is at `none`, and for a change
 * on a list they may only read, 403 `FORBIDDEN`.
 */
export function checkList(
  access: Access,
  list: { readonly id: string; readonly objectId: string; readonly name: string },
  need: 'read' | 'write',
  message = UNKNOWN_LIST,
): void {
  if (isOpen(access)) return;
  if (objectLevel(access, list.objectId) === 'none' || objectLevel(access, list.id) === 'none') {
    throw refuse('NOT_FOUND', message);
  }
  if (need === 'write' && objectLevel(access, list.id) === 'read') {
    throw refuse('FORBIDDEN', `You can view the entries of ${list.name} but not change them.`);
  }
}
