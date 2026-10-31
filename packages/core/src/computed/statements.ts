// How lookups and rollups are worked out (spec 0015, the lookup and rollup
// statements): one statement for a batch of records, over the current links
// of the side followed to live related records, in the side's order. A lookup
// takes the related values (through a side that holds many, the distinct
// items, first 100); a rollup counts, sums, averages or takes the least or the
// greatest. Rollups count every linked record, including ones a reader can't
// open (AC-329): the value is an aggregate and names none of them.
import { sql, type SQL } from 'drizzle-orm';
import { LOOKUP_ITEMS } from '@crm/contracts/computed';
import type { LookupDefinition, RollupDefinition } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import type { ItemColumns } from '../engine/columns.ts';
import { uuidArray } from '../engine/ids.ts';
import { baseLevel, compileFilter, type CompileContext } from '../engine/query/compile.ts';
import { loadRelationships } from '../engine/relationships.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import { SYSTEM_ACCESS } from '../access/policy.ts';
import type { NextItems } from './write.ts';

/** A relationship side a lookup or a rollup follows, as the statements need it. */
export interface ViaSide {
  readonly attributeId: string;
  readonly relationshipId: string;
  /** This side is the relationship's defining end: its records are `from_record_id`. */
  readonly isFrom: boolean;
  /** This side holds many links. */
  readonly holdsMany: boolean;
  /** The other side's attribute and object. */
  readonly farAttributeId: string;
  readonly farObjectId: string;
}

/**
 * The side `via` names, when it is a two way relationship's side on `objectId`:
 * a one way reference has no side on the far object, so it is never one (AC-336).
 */
export async function loadVia(tx: WorkspaceTx, via: AttributeDef, objectId: string): Promise<ViaSide | undefined> {
  if (via.type !== 'record_reference' || via.relationshipId === null || via.objectId !== objectId) return undefined;
  const relationship = (await loadRelationships(tx, [via.relationshipId])).get(via.relationshipId);
  if (relationship === undefined || relationship.toAttributeId === null) return undefined;
  const isFrom = relationship.fromAttributeId === via.id;
  const farAttributeId = isFrom ? relationship.toAttributeId : relationship.fromAttributeId;
  const farObjectId = isFrom ? relationship.toObjectIds[0] : relationship.fromObjectId;
  if (farObjectId === undefined) return undefined;
  return {
    attributeId: via.id,
    relationshipId: relationship.id,
    isFrom,
    holdsMany: isFrom ? !relationship.fromSingle : !relationship.toSingle,
    farAttributeId,
    farObjectId,
  };
}

/** The link columns of a side: the near record, the far record and the near side's order. */
function sideColumns(via: ViaSide) {
  return via.isFrom
    ? { near: sql.raw('rl.from_record_id'), far: sql.raw('rl.to_record_id'), position: sql.raw('rl.position') }
    : { near: sql.raw('rl.to_record_id'), far: sql.raw('rl.from_record_id'), position: sql.raw('rl.to_position') };
}

/** The columns a statement reads back for an item row, in the diff's spelling. */
const ITEM_SELECT = sql.raw(`owner_id::text as owner_id, position::int as position, text_value,
  number_value::text as number_value, date_value::text as date_value,
  to_char(timestamp_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as timestamp_value,
  bool_value, option_id::text as option_id, actor_type::text as actor_type, actor_id::text as actor_id, json_value`);

type ItemRow = {
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

/** Rows into each owner's items, in position order. */
function byOwner(rows: readonly ItemRow[]): NextItems {
  const next = new Map<string, ItemColumns[]>();
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const list = next.get(row.owner_id) ?? [];
    list.push({
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
    next.set(row.owner_id, list);
  }
  return next;
}

/**
 * A lookup's values for some records (AC-313, AC-314): through a side that
 * holds one, the first link's value as it is; through many, the distinct items
 * of the linked records, in the side's order then each value's own order, at
 * most 100. A select's or status's options map to the lookup's mirrors; Created
 * at and Created by read the related record's row.
 */
export async function lookupValues(
  tx: WorkspaceTx,
  computed: AttributeDef,
  definition: LookupDefinition,
  via: ViaSide,
  target: AttributeDef,
  ownerIds: readonly string[],
  /** The preview: no mirrors exist yet, so options stay the related attribute's own. */
  ownOptions = false,
): Promise<NextItems> {
  if (ownerIds.length === 0) return new Map();
  const side = sideColumns(via);
  const optionColumn = ownOptions ? sql`v.option_id` : sql`m.id`;
  const optionFilter = ownOptions ? sql`true` : sql`v.option_id is null or m.id is not null`;
  const items: SQL =
    target.systemColumn === 'created_at'
      ? sql`select l.owner_id, l.pos, 0 as vpos, null::text as text_value, null::numeric as number_value,
          null::date as date_value, fr.created_at as timestamp_value, null::boolean as bool_value,
          null::uuid as option_id, null::actor_type as actor_type, null::uuid as actor_id, null::jsonb as json_value
          from links l join records fr on fr.id = l.far_id`
      : target.systemColumn === 'created_by'
        ? sql`select l.owner_id, l.pos, 0 as vpos, null::text as text_value, null::numeric as number_value,
            null::date as date_value, null::timestamptz as timestamp_value, null::boolean as bool_value,
            null::uuid as option_id, fr.created_by_type as actor_type, fr.created_by_id as actor_id,
            null::jsonb as json_value
            from links l join records fr on fr.id = l.far_id where fr.created_by_id is not null`
        : sql`select l.owner_id, l.pos, v.position as vpos, v.text_value, v.number_value, v.date_value,
            v.timestamp_value, v.bool_value, ${optionColumn} as option_id, v.actor_type, v.actor_id, v.json_value
            from links l
            join "values" v on v.owner_id = l.far_id and v.attribute_id = ${definition.target}
              and v.active_until is null and not v.is_cleared
            left join attribute_options m on m.attribute_id = ${computed.id} and m.mirror_of = v.option_id
            where ${optionFilter}`;
  // Through one, the one link's items as they are; through many, each distinct item once, by first appearance.
  const kept = via.holdsMany
    ? sql`select *, (row_number() over (partition by owner_id order by pos, vpos) - 1) as position from (
          select *, row_number() over (
            partition by owner_id, text_value, number_value, date_value, timestamp_value, bool_value, option_id,
              actor_type, actor_id, json_value
            order by pos, vpos) as dup
          from items) d where dup = 1`
    : sql`select *, (row_number() over (partition by owner_id order by pos, vpos) - 1) as position from items`;
  const result = await tx.execute<ItemRow>(sql`
    with owners as (select unnest(${uuidArray(ownerIds)}) as owner_id),
    links as (
      select o.owner_id, ${side.far} as far_id, ${side.position} as pos
      from owners o
      join record_links rl on rl.relationship_id = ${via.relationshipId} and ${side.near} = o.owner_id
        and rl.active_until is null
      join records far on far.id = ${side.far} and far.deleted_at is null
    ),
    items as (${items}),
    kept as (${kept})
    select ${ITEM_SELECT} from kept where position < ${via.holdsMany ? LOOKUP_ITEMS : 1_000}
  `);
  return byOwner(result.rows);
}

/** The engine's own filter compiler on the far object, as the system (every linked record counts, AC-329). */
export async function whereSql(tx: WorkspaceTx, definition: RollupDefinition, farObjectId: string): Promise<SQL> {
  if (definition.where === undefined) return sql`true`;
  const context: CompileContext = {
    attributes: await loadAttributes(tx, farObjectId),
    relationships: new Map(),
    clock: { timeZone: 'UTC' },
    actor: SYSTEM_ACTOR,
    access: SYSTEM_ACCESS,
  };
  const level = { ...baseLevel({ objectId: farObjectId }), row: 'fr', record: 'fr' };
  return compileFilter(context, level, definition.where);
}

/**
 * A rollup's values for some records (AC-316): Count and Count where give the
 * number of live linked records (0 when none), Sum the total of the values
 * present (0 when none, empty past 14 digits), Average their mean rounded to 4
 * decimals, Min, Max, Earliest and Latest the least or greatest (empty when
 * none). A Currency rollup reads only values in its code.
 */
export async function rollupValues(
  tx: WorkspaceTx,
  definition: RollupDefinition,
  via: ViaSide,
  target: AttributeDef | undefined,
  ownerIds: readonly string[],
): Promise<NextItems> {
  if (ownerIds.length === 0) return new Map();
  const side = sideColumns(via);
  const { calc } = definition;
  const createdAt = target?.systemColumn === 'created_at';
  const where = calc === 'count_where' ? await whereSql(tx, definition, via.farObjectId) : sql`true`;
  const value =
    calc === 'count' || calc === 'count_where'
      ? sql`count(fr.id) filter (where ${where})::numeric`
      : calc === 'sum'
        ? sql`coalesce(sum(v.number_value), 0)`
        : calc === 'average'
          ? sql`round(avg(v.number_value), 4)`
          : calc === 'min'
            ? sql`min(v.number_value)`
            : calc === 'max'
              ? sql`max(v.number_value)`
              : createdAt
                ? calc === 'earliest'
                  ? sql`min(fr.created_at)`
                  : sql`max(fr.created_at)`
                : calc === 'earliest'
                  ? sql`min(v.date_value)`
                  : sql`max(v.date_value)`;
  const readsValues = target !== undefined && !createdAt && calc !== 'count' && calc !== 'count_where';
  const currency = target?.type === 'currency' ? (definition.currency ?? null) : null;
  const valueJoin = readsValues
    ? sql`left join "values" v on v.owner_id = fr.id and v.attribute_id = ${target.id} and v.position = 0
        and v.active_until is null and not v.is_cleared
        ${currency === null ? sql`` : sql`and v.text_value = ${currency}`}`
    : sql``;
  const isDate = calc === 'earliest' || calc === 'latest';
  const columns = isDate
    ? createdAt
      ? sql`null::numeric as number_value, null::text as text_value, null::date as date_value, n as timestamp_value`
      : sql`null::numeric as number_value, null::text as text_value, n as date_value, null::timestamptz as timestamp_value`
    : sql`n as number_value, ${currency}::text as text_value, null::date as date_value,
        null::timestamptz as timestamp_value`;
  const result = await tx.execute<ItemRow>(sql`
    with owners as (select unnest(${uuidArray(ownerIds)}) as owner_id),
    totals as (
      select o.owner_id, ${value} as n
      from owners o
      left join (record_links rl join records fr on fr.id = ${side.far} and fr.deleted_at is null)
        on rl.relationship_id = ${via.relationshipId} and ${side.near} = o.owner_id and rl.active_until is null
      ${valueJoin}
      group by o.owner_id
    ),
    kept as (
      select owner_id, 0 as position, ${columns}, null::boolean as bool_value, null::uuid as option_id,
        null::actor_type as actor_type, null::uuid as actor_id, null::jsonb as json_value
      from totals
      where n is not null ${isDate ? sql`` : sql`and abs(n) < 100000000000000`}
    )
    select ${ITEM_SELECT} from kept
  `);
  return byOwner(result.rows);
}
