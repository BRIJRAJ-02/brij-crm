// Unique attributes (spec 0004, AC-10): each item's normalised key, which a
// partial unique index on current values refuses twice. Only the types listed
// can be unique.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { toCanonicalDecimal, type AttributeType } from '@crm/contracts/values';
import type { ItemColumns } from './columns.ts';
import { uuidArray } from './ids.ts';
import { postgresError, refuse } from './refusals.ts';
import type { AttributeDef } from './values.ts';
import { recordRule, type Access } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';

/** Rows updated per statement when keys are filled in. */
const BATCH = 10_000;

/** The types an attribute can be unique on. */
export const UNIQUE_TYPES: readonly AttributeType[] = ['text', 'email', 'domain', 'url', 'phone', 'number'];

/** A url with its scheme and host lowercased and its path, query and fragment kept as typed. */
function normaliseUrl(text: string): string {
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return text;
  }
}

/** The normalised key one item of a unique attribute is compared by. */
export function uniqueKeyOf(type: AttributeType, item: ItemColumns): string | null {
  switch (type) {
    case 'text':
      return item.textValue === null ? null : item.textValue.trim().toLowerCase();
    case 'email':
    case 'domain':
    case 'phone':
      return item.textValue;
    case 'url':
      return item.textValue === null ? null : normaliseUrl(item.textValue);
    case 'number':
      return item.numberValue === null ? null : (toCanonicalDecimal(item.numberValue) ?? item.numberValue);
    default:
      return null;
  }
}

const EMPTY_ITEM: ItemColumns = {
  textValue: null,
  numberValue: null,
  dateValue: null,
  timestampValue: null,
  boolValue: null,
  optionId: null,
  actorType: null,
  actorId: null,
  jsonValue: null,
};

/**
 * Gives every current value of an attribute its unique key, refusing first
 * with the duplicates if any live records share one (AC-10). A deleted
 * record's keys go to `held_unique_key`, so they don't block anyone until a
 * restore takes them back. The same goes for list entries: a removed entry, or
 * one whose record is in the trash, holds its keys.
 *
 * The refusal lists the duplicate values only when the actor sees the
 * attribute and every record of its object (no record rule there); otherwise
 * it gives their count, so it never quotes a value of a record the actor
 * can't read (spec 0009, AC-144).
 */
export async function fillUniqueKeys(tx: WorkspaceTx, attribute: AttributeDef, access: Access): Promise<void> {
  const rows = await tx.execute<{ id: string; text: string | null; number: string | null; deleted: boolean }>(sql`
    select v.id::text as id, v.text_value as text, v.number_value::text as number,
      coalesce(r.deleted_at, e.deleted_at, er.deleted_at) is not null as deleted
    from "values" v
    left join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
    left join list_entries e on e.workspace_id = v.workspace_id and e.id = v.entry_id
    left join records er on er.workspace_id = e.workspace_id and er.id = e.record_id
    where v.attribute_id = ${attribute.id} and v.active_until is null and not v.is_cleared
  `);
  const keyed = rows.rows.map((row) => ({
    id: row.id,
    deleted: row.deleted,
    key: uniqueKeyOf(attribute.type, { ...EMPTY_ITEM, textValue: row.text, numberValue: row.number }),
  }));
  const counts = new Map<string, number>();
  for (const row of keyed) {
    if (row.deleted || row.key === null) continue;
    counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  }
  const duplicates = [...counts].filter(([, n]) => n > 1);
  const seesEvery =
    attributeVisible(access, attribute) &&
    (attribute.objectId === null || recordRule(access, attribute.objectId) === undefined);
  if (duplicates.length > 0 && !seesEvery) {
    const many = duplicates.length === 1 ? '1 value is' : `${String(duplicates.length)} values are`;
    throw refuse(
      'UNIQUE_HAS_DUPLICATES',
      `${attribute.title} can't be unique yet: ${many} used by more than one record. Merge or change them first.`,
      attribute.id,
    );
  }
  if (duplicates.length > 0) {
    const shown = duplicates
      .slice(0, 10)
      .map(([key, n]) => `${key} (${String(n)} records)`)
      .join(', ');
    throw refuse(
      'UNIQUE_HAS_DUPLICATES',
      `${attribute.title} can't be unique yet: ${shown}${duplicates.length > 10 ? ', and more' : ''}. Merge or change them first.`,
      attribute.id,
    );
  }
  for (let start = 0; start < keyed.length; start += BATCH) {
    const batch = keyed.slice(start, start + BATCH);
    const rowsSql = sql.join(
      batch.map((row) => sql`(${row.id}::uuid, ${row.deleted ? null : row.key}, ${row.deleted ? row.key : null})`),
      sql`, `,
    );
    await tx.execute(sql`
      update "values" v set unique_key = data.live, held_unique_key = data.held
      from (values ${rowsSql}) as data(id, live, held)
      where v.id = data.id
    `);
  }
}

/** Drops every key of an attribute, live and held: it stops being checked for uniqueness. */
export async function clearUniqueKeys(tx: WorkspaceTx, attributeId: string): Promise<void> {
  await tx.execute(sql`
    update "values" set unique_key = null, held_unique_key = null
    where attribute_id = ${attributeId} and (unique_key is not null or held_unique_key is not null)
  `);
}

/**
 * Moves the current unique keys of some owners (a record going to the trash,
 * and its entries) into `held_unique_key`, so they block no one meanwhile.
 */
export async function holdUniqueKeys(tx: WorkspaceTx, ownerIds: readonly string[]): Promise<void> {
  if (ownerIds.length === 0) return;
  await tx.execute(sql`
    update "values" set held_unique_key = unique_key, unique_key = null
    where owner_id = any(${uuidArray(ownerIds)}) and active_until is null and unique_key is not null
  `);
}

/**
 * Moves held keys back on a restore. Refuses with `UNIQUE_CONFLICT`, listing
 * the values, when another record took one of them meanwhile (AC-8). Only the
 * attributes the actor can see are named (spec 0009, AC-144); the other
 * record never is.
 */
export async function releaseUniqueKeys(tx: WorkspaceTx, access: Access, ownerIds: readonly string[]): Promise<void> {
  if (ownerIds.length === 0) return;
  const owners = uuidArray(ownerIds);
  const found = await tx.execute<{
    id: string;
    object_id: string | null;
    list_id: string | null;
    title: string;
    key: string;
  }>(sql`
    select a.id::text, a.object_id::text, a.list_id::text, a.title, v.held_unique_key as key
    from "values" v join attributes a on a.workspace_id = v.workspace_id and a.id = v.attribute_id
    where v.owner_id = any(${owners}) and v.active_until is null and v.held_unique_key is not null
      and exists (
        select 1 from "values" o
        where o.workspace_id = v.workspace_id and o.attribute_id = v.attribute_id
          and o.unique_key = v.held_unique_key and o.active_until is null
      )
    order by a.title, v.held_unique_key
  `);
  const taken = {
    rows: found.rows.filter((row) =>
      attributeVisible(access, { id: row.id, objectId: row.object_id, listId: row.list_id }),
    ),
  };
  const conflict = () =>
    refuse(
      'UNIQUE_CONFLICT',
      `Another record now has ${taken.rows.map((row) => `${row.title} ${row.key}`).join(', ') || 'one of its unique values'}. Change that record first, then restore this one.`,
    );
  if (found.rows.length > 0) throw conflict();
  try {
    await tx.execute(sql`
      update "values" set unique_key = held_unique_key, held_unique_key = null
      where owner_id = any(${owners}) and active_until is null and held_unique_key is not null
    `);
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'values_unique') throw conflict();
    throw error;
  }
}
