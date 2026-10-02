// Unique attributes (spec 0004, AC-10): each item's normalised key, which a
// partial unique index on current values refuses twice. Only the types listed
// can be unique.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { toCanonicalDecimal, type AttributeType } from '@crm/contracts/values';
import type { ItemColumns } from './columns.ts';
import { refuse } from './refusals.ts';
import type { AttributeDef } from './values.ts';

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
 * restore takes them back.
 */
export async function fillUniqueKeys(tx: WorkspaceTx, attribute: AttributeDef): Promise<void> {
  const rows = await tx.execute<{ id: string; text: string | null; number: string | null; deleted: boolean }>(sql`
    select v.id::text as id, v.text_value as text, v.number_value::text as number, r.deleted_at is not null as deleted
    from "values" v join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
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
