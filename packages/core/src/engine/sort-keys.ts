// Stored sort keys (spec 0004, stored sort keys, AC-20): one `sort_keys` row
// per current, set, position 0 value of a sortable attribute, kept in step
// with `values` inside the same transaction. The keys themselves are computed
// only in SQL, by the `sort_key_sources` view, so the save, the backfill and
// the tests can never disagree on an expression.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { uuidArray } from './ids.ts';
import type { AttributeDef } from './values.ts';

/** The attribute types that have a stored key today. */
const KEYED_TYPES: ReadonlySet<AttributeDef['type']> = new Set([
  'text',
  'email',
  'domain',
  'url',
  'phone',
  'personal_name',
  'file',
]);

/** True when an attribute's values have a stored sort key. */
export function hasSortKey(attribute: AttributeDef): boolean {
  return attribute.systemColumn === null && KEYED_TYPES.has(attribute.type);
}

const KEY_COLUMNS = sql.raw(
  'workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key, time_key, option_id, bool_key',
);
const CHANGED = sql.raw(
  '(sort_keys.live, sort_keys.text_key, sort_keys.number_key, sort_keys.code_key, sort_keys.date_key, sort_keys.time_key, sort_keys.option_id, sort_keys.bool_key) is distinct from (excluded.live, excluded.text_key, excluded.number_key, excluded.code_key, excluded.date_key, excluded.time_key, excluded.option_id, excluded.bool_key)',
);

/**
 * Brings one owner's key for one attribute in line with its current values:
 * upserts it from item 0, or deletes it when the value is cleared or gone. An
 * unchanged key writes nothing. The caller holds the owner's row lock.
 */
export async function syncSortKey(tx: WorkspaceTx, ownerId: string, attribute: AttributeDef): Promise<void> {
  if (!hasSortKey(attribute)) return;
  await tx.execute(sql`
    with source as (
      select ${KEY_COLUMNS} from sort_key_sources where owner_id = ${ownerId} and attribute_id = ${attribute.id}
    ), gone as (
      delete from sort_keys where owner_id = ${ownerId} and attribute_id = ${attribute.id}
        and not exists (select 1 from source)
    )
    insert into sort_keys (${KEY_COLUMNS}) select ${KEY_COLUMNS} from source
    on conflict (workspace_id, owner_id, attribute_id) do update set
      live = excluded.live, text_key = excluded.text_key, number_key = excluded.number_key,
      code_key = excluded.code_key, date_key = excluded.date_key, time_key = excluded.time_key,
      option_id = excluded.option_id, bool_key = excluded.bool_key
    where ${CHANGED}
  `);
}

/**
 * Marks a record's keys, and its entries' keys, as hidden (delete) or shown
 * again (restore). On restore, an entry's keys come back only if the entry
 * is still in its list.
 */
export async function setRecordKeysLive(tx: WorkspaceTx, recordId: string, live: boolean): Promise<void> {
  await tx.execute(
    live
      ? sql`
        update sort_keys s set live = true
        where s.record_id = ${recordId} and not s.live
          and (s.entry_id is null or exists (
            select 1 from list_entries e where e.workspace_id = s.workspace_id and e.id = s.entry_id and e.deleted_at is null
          ))
      `
      : sql`update sort_keys set live = false where record_id = ${recordId} and live`,
  );
}

/** Marks an entry's keys as hidden (removed) or shown again (restored; its record is live, the caller checked). */
export async function setEntryKeysLive(tx: WorkspaceTx, entryId: string, live: boolean): Promise<void> {
  await tx.execute(sql`update sort_keys set live = ${live} where entry_id = ${entryId} and live <> ${live}`);
}

/** Deletes the keys of records (with their entries') or of entries, before a purge or erasure deletes their values. */
export async function deleteSortKeys(
  tx: WorkspaceTx,
  owners: { readonly recordIds: readonly string[] } | { readonly entryIds: readonly string[] },
): Promise<void> {
  if ('recordIds' in owners) {
    if (owners.recordIds.length === 0) return;
    await tx.execute(sql`delete from sort_keys where record_id = any(${uuidArray(owners.recordIds)})`);
  } else {
    if (owners.entryIds.length === 0) return;
    await tx.execute(sql`delete from sort_keys where entry_id = any(${uuidArray(owners.entryIds)})`);
  }
}
