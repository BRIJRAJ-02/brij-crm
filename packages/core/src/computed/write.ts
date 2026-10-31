// Writing computed values (spec 0015, `writeComputedBatch`): spec 0004's write
// protocol, set based, with the system as `set_by`. Owners are locked first, in
// id order, and the values worked out only then, so any change after that read
// queues them again and values converge. Records in the trash are left out, an
// unchanged value writes nothing, `updated_at` never moves, no validation rule
// runs (these are the system's own writes), and sort keys follow in one statement.
import { sql } from 'drizzle-orm';
import { toCanonicalDecimal } from '@crm/contracts/values';
import type { ItemColumns } from '../engine/columns.ts';
import { uuidArray } from '../engine/ids.ts';
import { syncSortKeys } from '../engine/sort-keys.ts';
import type { AttributeDef } from '../engine/values.ts';
import type { ValueChange, WriteContext } from '../engine/write.ts';

/** A computed attribute on an object: what the writes need of it. */
export type ComputedTarget = AttributeDef & { readonly objectId: string };

/** The item rows each owner's value should become, in order; an owner missing from the map becomes empty. */
export type NextItems = ReadonlyMap<string, readonly ItemColumns[]>;

/** One stored row as the diff reads it. */
type Row = {
  readonly owner_id: string;
  readonly position: number;
  readonly text_value: string | null;
  readonly number_value: string | null;
  readonly date_value: string | null;
  readonly timestamp_value: string | null;
  readonly bool_value: boolean | null;
  readonly option_id: string | null;
  readonly actor_type: string | null;
  readonly actor_id: string | null;
  readonly json_value: unknown;
};

/** An item's columns in one spelling, so a stored `12.5000` and a worked out `12.5` compare equal. */
function keyOf(item: ItemColumns): string {
  const number = item.numberValue === null ? null : (toCanonicalDecimal(item.numberValue) ?? item.numberValue);
  const time = item.timestampValue === null ? null : new Date(item.timestampValue).toISOString();
  return JSON.stringify([
    item.textValue,
    number,
    item.dateValue,
    time,
    item.boolValue,
    item.optionId?.toLowerCase() ?? null,
    item.actorType,
    item.actorId?.toLowerCase() ?? null,
    item.jsonValue ?? null,
  ]);
}

const columnsOf = (row: Row): ItemColumns => ({
  textValue: row.text_value,
  numberValue: row.number_value,
  dateValue: row.date_value,
  timestampValue: row.timestamp_value,
  boolValue: row.bool_value,
  optionId: row.option_id,
  actorType: row.actor_type as ItemColumns['actorType'],
  actorId: row.actor_id,
  jsonValue: row.json_value,
});

/**
 * Locks the live records of `ownerIds` on the attribute's object (`for no key
 * update`, in id order) and answers them; records in the trash or of another
 * object are left out.
 */
export async function lockLiveOwners(
  context: WriteContext,
  attribute: ComputedTarget,
  ownerIds: readonly string[],
): Promise<readonly string[]> {
  if (ownerIds.length === 0) return [];
  const locked = await context.tx.execute<{ id: string }>(sql`
    select id::text as id from records
    where id = any(${uuidArray(ownerIds)}) and object_id = ${attribute.objectId} and deleted_at is null
    order by id
    for no key update
  `);
  return locked.rows.map((row) => row.id);
}

/**
 * Writes one computed attribute's values for some records: locks them, asks
 * `compute` for their values (read after the lock), and writes the changed
 * ones as one new system version per record. Answers the records whose value
 * changed; each is recorded as a value change, so the planner carries a chain
 * further and the outbox names them.
 */
export async function writeComputedBatch(
  context: WriteContext,
  attribute: ComputedTarget,
  ownerIds: readonly string[],
  compute: (liveOwnerIds: readonly string[]) => Promise<NextItems>,
): Promise<readonly string[]> {
  const { tx, scope } = context;
  const live = await lockLiveOwners(context, attribute, ownerIds);
  if (live.length === 0) return [];
  const next = await compute(live);
  const current = await tx.execute<Row>(sql`
    select owner_id::text as owner_id, position, text_value, number_value::text as number_value,
      date_value::text as date_value,
      to_char(timestamp_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as timestamp_value,
      bool_value, option_id::text as option_id, actor_type::text as actor_type, actor_id::text as actor_id, json_value
    from "values"
    where attribute_id = ${attribute.id} and owner_id = any(${uuidArray(live)})
      and active_until is null and not is_cleared
    order by owner_id, position
  `);
  const held = new Map<string, ItemColumns[]>();
  for (const row of current.rows) {
    const list = held.get(row.owner_id) ?? [];
    list.push(columnsOf(row));
    held.set(row.owner_id, list);
  }
  const changed = live.filter((ownerId) => {
    const before = (held.get(ownerId) ?? []).map(keyOf);
    const after = (next.get(ownerId) ?? []).map(keyOf);
    return before.length !== after.length || before.some((key, index) => key !== after[index]);
  });
  if (changed.length === 0) return [];

  // One time for the batch, after every current row's start, so no version runs before the one it replaces.
  const stamp = await tx.execute<{ t: string }>(sql`
    select greatest(clock_timestamp(), coalesce(max(active_from) + interval '1 microsecond', clock_timestamp()))::text as t
    from "values" where attribute_id = ${attribute.id} and owner_id = any(${uuidArray(changed)}) and active_until is null
  `);
  const at = stamp.rows[0]?.t;
  if (at === undefined) throw new Error('Could not stamp the computed versions.');
  await tx.execute(sql`
    update "values" set active_until = ${at}::timestamptz
    where attribute_id = ${attribute.id} and owner_id = any(${uuidArray(changed)}) and active_until is null
  `);
  const rows = changed.flatMap((ownerId) => {
    const items = next.get(ownerId) ?? [];
    if (items.length === 0) return [{ owner_id: ownerId, position: 0, is_cleared: true }];
    return items.map((item, position) => ({
      owner_id: ownerId,
      position,
      is_cleared: false,
      text_value: item.textValue,
      number_value: item.numberValue,
      date_value: item.dateValue,
      timestamp_value: item.timestampValue,
      bool_value: item.boolValue,
      option_id: item.optionId,
      actor_type: item.actorType,
      actor_id: item.actorId,
      json_value: item.jsonValue ?? null,
    }));
  });
  // The rows go as one JSON parameter, never spliced into the statement.
  const inserted = await tx.execute<{ owner_id: string; version_id: string }>(sql`
    with given as (
      select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(
        owner_id uuid, position smallint, is_cleared boolean, text_value text, number_value numeric,
        date_value date, timestamp_value timestamptz, bool_value boolean, option_id uuid, actor_type actor_type,
        actor_id uuid, json_value jsonb
      )
    ), versions as (
      select owner_id, uuidv7() as version_id from (select distinct owner_id from given) owners
    ), made as (
      insert into "values" (
        workspace_id, version_id, attribute_id, record_id, owner_id, position, is_cleared, text_value, number_value,
        date_value, timestamp_value, bool_value, option_id, actor_type, actor_id, actor_member_id, json_value,
        active_from, set_by_type
      )
      select ${scope.workspaceId}::uuid, versions.version_id, ${attribute.id}::uuid, given.owner_id, given.owner_id,
        given.position, given.is_cleared, given.text_value, given.number_value, given.date_value,
        given.timestamp_value, given.bool_value, given.option_id, given.actor_type, given.actor_id,
        case when given.actor_type = 'member' then given.actor_id end, given.json_value, ${at}::timestamptz, 'system'
      from given join versions using (owner_id)
      returning owner_id
    )
    select distinct versions.owner_id::text as owner_id, versions.version_id::text as version_id
    from versions where versions.owner_id in (select owner_id from made)
  `);
  await syncSortKeys(tx, attribute, changed);
  const values: ValueChange[] = inserted.rows.map((row) => ({
    ownerId: row.owner_id,
    ownerKind: 'record',
    objectId: attribute.objectId,
    attributeId: attribute.id,
    versionId: row.version_id,
  }));
  context.record({ values });
  return changed;
}
