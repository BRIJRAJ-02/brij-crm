// The timeline's history sources (spec 0017, 0017-activity.md, milestone 2):
// every version of a visible attribute, and every moment a relationship side
// gained or lost links, read from the history the engine already keeps. Each
// answers its newest entries past the bound, at most `limit + 1`, in key
// order, so the service can merge them with the creation and (later) notes,
// tasks and comments. The creation's own versions (stamped with the record's
// id) fold into the creation entry and never show here.
import { sql, type SQL } from 'drizzle-orm';
import { ACTIVITY_RANKS, activityKey, LINKS_SHOWN_PER_ENTRY, type ActivityItem } from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { decodeValue, type StoredItem } from './columns.ts';
import { isUuid, uuidList } from './ids.ts';
import { readRecords } from './records.ts';
import { loadRelationships, type RelationshipDef } from './relationships.ts';
import type { Actor } from './scope.ts';
import type { AttributeDef } from './values.ts';
import type { Access } from '../access/policy.ts';
import { farVisibleSql } from '../access/visibility.ts';
import type { ActivityBound, ActivitySource, ActivitySourceInput } from './activity.ts';

/** Moments as fixed width UTC text with microseconds, so they compare as text and key the timeline. */
const MICRO = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
const micro = (column: SQL) => sql`to_char(${column} at time zone 'UTC', ${MICRO})`;

/** An instant with microseconds cut to the milliseconds `ActivityItem.at` carries. */
export const toMillis = (micros: string): string => `${micros.slice(0, 23)}Z`;

/**
 * The cursor bound on a source of rank `rank` (0017-activity.md): `at` up to
 * the bound's moment when this rank sorts after the bound's, before it when
 * it sorts first, and at the same rank, before it or at it with a larger id.
 * Ids compare in plain code unit order (`collate "C"`), as the browser does.
 */
export function boundSql(at: SQL, id: SQL, rank: number, after?: ActivityBound): SQL {
  if (after === undefined) return sql`true`;
  const moment = sql`${after.at}::timestamptz`;
  if (rank > after.rank) return sql`${at} <= ${moment}`;
  if (rank < after.rank) return sql`${at} < ${moment}`;
  return sql`(${at} < ${moment} or (${at} = ${moment} and (${id}) collate "C" > ${after.id}))`;
}

/** The loose half of the bound, which an index on the moment can use: never past the bound's moment. */
function nearBound(at: SQL, after?: ActivityBound): SQL {
  return after === undefined ? sql`true` : sql`${at} <= ${after.at}::timestamptz`;
}

/**
 * Values the database itself answered (moments, actor types, uuids) as one
 * array literal parameter, each element quoted. Never caller input.
 */
const arrayText = (items: readonly string[]): string => `{${items.map((item) => `"${item}"`).join(',')}}`;

/** An actor as its stored columns hand it back. */
const actorOf = (type: Actor['type'], id: string | null): Actor => ({ type, id });

/** A version the value source keeps: its attribute, its id, when and who. */
interface VersionRow extends Record<string, unknown> {
  readonly attribute_id: string;
  readonly version_id: string;
  readonly at: string;
  readonly actor_type: Actor['type'];
  readonly actor_id: string | null;
}

/** One stored item of a kept version, or of the version it replaced. */
interface ItemRow extends Record<string, unknown> {
  readonly ord: number;
  readonly part: 'to' | 'from';
  readonly position: number;
  readonly is_cleared: boolean;
  readonly text_value: string | null;
  readonly number_value: string | null;
  readonly date_value: string | null;
  readonly timestamp_value: string | null;
  readonly bool_value: boolean | null;
  readonly option_id: string | null;
  readonly actor_type: Actor['type'] | null;
  readonly actor_id: string | null;
  readonly json_value: unknown;
}

const ITEM_SELECT = sql`x.position, x.is_cleared, x.text_value, x.number_value::text as number_value,
  x.date_value::text as date_value,
  to_char(x.timestamp_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as timestamp_value,
  x.bool_value, x.option_id::text as option_id, x.actor_type, x.actor_id::text as actor_id, x.json_value`;

const storedItem = (row: ItemRow): StoredItem => ({
  position: row.position,
  textValue: row.text_value,
  numberValue: row.number_value,
  dateValue: row.date_value,
  timestampValue: row.timestamp_value,
  boolValue: row.bool_value,
  optionId: row.option_id,
  actorType: row.actor_type,
  actorId: row.actor_id,
  jsonValue: row.json_value,
});

/**
 * Value versions (`change`, rank 2): for each visible, live, non system
 * attribute stored as values, its newest versions past the bound (one
 * lateral read per attribute on `values_history`), the creation's left out.
 * For the `limit + 1` kept, a second read loads each version's items and
 * those of the version it replaced, decoded as every read decodes them.
 */
export const valueSource: ActivitySource = async ({ tx, record, attributes, after, limit }) => {
  const stored = attributes.filter((attribute) => attribute.type !== 'record_reference');
  if (stored.length === 0) return [];
  const rank = ACTIVITY_RANKS.change;
  const id = sql`'value:' || x.attribute_id::text || ':' || x.version_id::text`;
  const outerId = sql`'value:' || v.attribute_id || ':' || v.version_id`;
  const found = await tx.execute<VersionRow>(sql`
    select v.attribute_id, v.version_id, ${micro(sql`v.active_from`)} as at, v.actor_type, v.actor_id
    from unnest(${uuidList(stored.map((attribute) => attribute.id))}) as a(id)
    cross join lateral (
      select x.attribute_id::text as attribute_id, x.version_id::text as version_id, x.active_from,
        x.set_by_type as actor_type, x.set_by_id::text as actor_id
      from "values" x
      where x.owner_id = ${record.id}::uuid and x.attribute_id = a.id and x.record_id is not null
        and x.version_id <> ${record.id}::uuid
        and ${nearBound(sql`x.active_from`, after)}
        and ${boundSql(sql`x.active_from`, id, rank, after)}
      group by x.attribute_id, x.version_id, x.active_from, x.set_by_type, x.set_by_id
      order by x.active_from desc, (${id}) collate "C"
      limit ${limit + 1}
    ) v
    order by v.active_from desc, (${outerId}) collate "C"
    limit ${limit + 1}
  `);
  const versions = found.rows;
  if (versions.length === 0) return [];
  // The kept versions' items, and the items of the version each replaced: the one before it, which the write
  // protocol ended at the kept version's moment.
  const items = await tx.execute<ItemRow>(sql`
    select k.ord::int as ord, i.*
    from unnest(
      ${uuidList(versions.map((row) => row.attribute_id))},
      ${uuidList(versions.map((row) => row.version_id))},
      ${arrayText(versions.map((row) => row.at))}::timestamptz[]
    ) with ordinality as k(attribute_id, version_id, at, ord)
    cross join lateral (
      select 'to' as part, ${ITEM_SELECT}
      from "values" x
      where x.owner_id = ${record.id}::uuid and x.attribute_id = k.attribute_id and x.active_from = k.at
        and x.version_id = k.version_id
      union all
      select 'from' as part, ${ITEM_SELECT}
      from "values" x
      where x.owner_id = ${record.id}::uuid and x.attribute_id = k.attribute_id and x.active_until = k.at
        and x.active_from = (
          select max(y.active_from) from "values" y
          where y.owner_id = ${record.id}::uuid and y.attribute_id = k.attribute_id and y.active_from < k.at
        )
    ) i
  `);
  const byVersion = new Map<number, { to: StoredItem[]; from: StoredItem[]; hadFrom: boolean }>();
  for (const row of items.rows) {
    const bucket = byVersion.get(row.ord) ?? { to: [], from: [], hadFrom: false };
    byVersion.set(row.ord, bucket);
    if (row.part === 'from') bucket.hadFrom = true;
    if (!row.is_cleared) bucket[row.part].push(storedItem(row));
  }
  const byId = new Map(stored.map((attribute) => [attribute.id, attribute]));
  return versions.flatMap((row, index): ActivityItem[] => {
    const attribute = byId.get(row.attribute_id);
    if (attribute === undefined) return [];
    const bucket = byVersion.get(index + 1) ?? { to: [], from: [], hadFrom: false };
    const entryId = `value:${row.attribute_id}:${row.version_id}`;
    return [
      {
        id: entryId,
        key: activityKey({ at: row.at, rank, id: entryId }),
        at: toMillis(row.at),
        actor: actorOf(row.actor_type, row.actor_id),
        kind: 'change',
        attributeId: attribute.id,
        // A first set has no version before it: null, whatever the type.
        from: bucket.hadFrom ? decodeValue(attribute.type, attribute.isMulti, bucket.from) : null,
        to: decodeValue(attribute.type, attribute.isMulti, bucket.to),
      },
    ];
  });
};

/** One relationship side of the record, as the link source reads it. */
interface Side {
  readonly attribute: AttributeDef;
  readonly relationship: RelationshipDef;
  readonly isFrom: boolean;
  /** The objects a far record may sit on. */
  readonly allowed: readonly string[];
  /** The side holds one record: its moments read as changes, not link entries. */
  readonly single: boolean;
}

/** A moment on a side: when, and who. */
interface Moment {
  readonly at: string;
  readonly actorType: Actor['type'];
  readonly actorId: string | null;
}

/** A moment's entry id, which keys and pages it (0017-activity.md). */
const momentId = (side: Side, moment: Moment): string =>
  `links:${side.attribute.id}:${moment.at}:${moment.actorType}:${moment.actorId ?? 'none'}`;

/** One end's columns of `record_links` under the alias `k` (fixed names, never input). */
function columnsOf(side: Side): { mine: SQL; far: SQL; position: SQL } {
  return side.isFrom
    ? { mine: sql.raw('k.from_record_id'), far: sql.raw('k.to_record_id'), position: sql.raw('k.position') }
    : { mine: sql.raw('k.to_record_id'), far: sql.raw('k.from_record_id'), position: sql.raw('k.to_position') };
}

/** The far record join: live, on a visible object, inside the viewer's record rule. */
function farJoin(access: Access, side: Side): SQL {
  const { far } = columnsOf(side);
  const visible = farVisibleSql(access, side.allowed, 'r');
  return sql`join records r on r.workspace_id = k.workspace_id and r.id = ${far} and r.deleted_at is null${
    visible === undefined ? sql`` : sql` and ${visible}`
  }`;
}

interface MomentRow extends Record<string, unknown> {
  readonly part: 'start' | 'end';
  readonly at: string;
  readonly actor_type: Actor['type'];
  readonly actor_id: string | null;
}

/**
 * The side's newest moments past the bound: starts grouped by (`active_from`,
 * `set_by`), the creation's own links left out, and ends grouped by
 * (`active_until`, `ended_by`), each at most `limit + 1`, at moments with a
 * far record the viewer may see (`netOf` drops one whose actor touched only
 * others). Merged, the first `limit + 1` moments are whole (any moment newer
 * than one of them is among them), and `more` says whether either read was cut.
 */
async function readMoments(
  tx: WorkspaceTx,
  access: Access,
  recordId: string,
  side: Side,
  rank: number,
  after: ActivityBound | undefined,
  limit: number,
): Promise<{ readonly moments: readonly Moment[]; readonly more: boolean }> {
  const { mine } = columnsOf(side);
  const join = farJoin(access, side);
  const idOf = (at: SQL, type: SQL, actor: SQL) =>
    sql`'links:' || ${side.attribute.id} || ':' || ${micro(at)} || ':' || ${type}::text || ':' || coalesce(${actor}::text, 'none')`;
  const grouped = (part: 'start' | 'end') => {
    const at = part === 'start' ? sql.raw('k.active_from') : sql.raw('k.active_until');
    const type = part === 'start' ? sql.raw('k.set_by_type') : sql.raw('k.ended_by_type');
    const actor = part === 'start' ? sql.raw('k.set_by_id') : sql.raw('k.ended_by_id');
    const only = part === 'start' ? sql`k.version_id <> ${recordId}::uuid` : sql.raw('k.active_until is not null');
    const on = sql`${mine} = ${recordId}::uuid and k.relationship_id = ${side.relationship.id}::uuid and ${only}`;
    const steps = sql.raw(part === 'start' ? 'starts' : 'ends');
    const id = idOf(sql.raw('g.at'), sql.raw('g.actor_type'), sql.raw('g.actor_id'));
    // The newest moments one index step each (a loose index scan): each step finds the next older moment with a
    // far record the viewer may see, so a side of 150,000 links reads about `limit` index entries, not all of them.
    // One more than the page, and one more again, so a moment the exact bound drops at the cursor's own moment
    // still leaves `limit + 1` when there are more.
    return sql`
      with recursive ${steps}(at, n) as (
        select (select ${at} from record_links k ${join} where ${on} and ${nearBound(at, after)} order by ${at} desc limit 1), 1
        union all
        select (select ${at} from record_links k ${join} where ${on} and ${at} < ${steps}.at order by ${at} desc limit 1), ${steps}.n + 1
        from ${steps} where ${steps}.at is not null and ${steps}.n < ${limit + 2}
      )
      select ${part} as part, ${micro(sql.raw('g.at'))} as at, g.actor_type, g.actor_id::text as actor_id
      from (
        select ${at} as at, ${type} as actor_type, ${actor} as actor_id
        from record_links k
        where ${on} and ${at} = any(array(select ${steps}.at from ${steps} where ${steps}.at is not null))
        group by 1, 2, 3
      ) g
      where ${boundSql(sql.raw('g.at'), id, rank, after)}
      order by g.at desc, (${id}) collate "C"
      limit ${limit + 1}
    `;
  };
  const rows = await tx.execute<MomentRow>(sql`(${grouped('start')}) union all (${grouped('end')})`);
  const starts = rows.rows.filter((row) => row.part === 'start').length;
  const ends = rows.rows.length - starts;
  const seen = new Map<string, Moment>();
  for (const row of rows.rows) {
    const moment = { at: row.at, actorType: row.actor_type, actorId: row.actor_id };
    seen.set(momentId(side, moment), moment);
  }
  const sorted = [...seen.entries()]
    .sort(([a, first], [b, second]) =>
      first.at === second.at ? (a < b ? -1 : a > b ? 1 : 0) : first.at > second.at ? -1 : 1,
    )
    .map(([, moment]) => moment);
  return { moments: sorted.slice(0, limit + 1), more: starts > limit || ends > limit };
}

interface NetRow extends Record<string, unknown> {
  readonly ord: number;
  readonly dir: 'added' | 'removed';
  readonly n: number;
  readonly ids: string[] | null;
}

/** What a moment did on the side, net: the far records it added and removed, counted, the first 3 by position. */
interface Net {
  readonly added: readonly string[];
  readonly addedCount: number;
  readonly removed: readonly string[];
  readonly removedCount: number;
}

/**
 * Each moment's net change (0017-activity.md): the far records started at it
 * and not ended at it, and the reverse, so a whole value write that keeps a
 * record, a reorder, and a move read only what changed. The first 3 of each by
 * the near side's position (the ended rows' own position for removals).
 */
async function netOf(
  tx: WorkspaceTx,
  access: Access,
  recordId: string,
  side: Side,
  moments: readonly Moment[],
): Promise<readonly Net[]> {
  if (moments.length === 0) return [];
  const { mine, far, position } = columnsOf(side);
  const join = farJoin(access, side);
  const ats = arrayText(moments.map((moment) => moment.at));
  const types = arrayText(moments.map((moment) => moment.actorType));
  // The system acts with no id: '' stands for none (ids are uuids, so it names no actor).
  const actors = arrayText(
    moments.map((moment) => (moment.actorId !== null && isUuid(moment.actorId) ? moment.actorId : '')),
  );
  const shown = LINKS_SHOWN_PER_ENTRY;
  const rows = await tx.execute<NetRow>(sql`
    select m.ord::int as ord, d.dir, d.n, d.ids
    from unnest(${ats}::timestamptz[], ${types}::text[], ${actors}::text[]) with ordinality as m(at, actor_type, actor_id, ord)
    cross join lateral (
      with s as (
        select ${far} as far, ${position} as p, k.id as kid
        from record_links k ${join}
        where ${mine} = ${recordId}::uuid and k.relationship_id = ${side.relationship.id}::uuid
          and k.version_id <> ${recordId}::uuid and k.active_from = m.at
          and k.set_by_type::text = m.actor_type and k.set_by_id is not distinct from nullif(m.actor_id, '')::uuid
      ), e as (
        select ${far} as far, ${position} as p, k.id as kid
        from record_links k ${join}
        where ${mine} = ${recordId}::uuid and k.relationship_id = ${side.relationship.id}::uuid
          and k.active_until is not null and k.active_until = m.at
          and k.ended_by_type::text = m.actor_type and k.ended_by_id is not distinct from nullif(m.actor_id, '')::uuid
      ), added as (
        select far, p, kid from s where not exists (select 1 from e where e.far = s.far)
      ), removed as (
        select far, p, kid from e where not exists (select 1 from s where s.far = e.far)
      )
      select 'added' as dir, (select count(*)::int from added) as n,
        (select array_agg(t.far::text order by t.p, t.kid) from (select far, p, kid from added order by p, kid limit ${shown}) t) as ids
      union all
      select 'removed' as dir, (select count(*)::int from removed) as n,
        (select array_agg(t.far::text order by t.p, t.kid) from (select far, p, kid from removed order by p, kid limit ${shown}) t) as ids
    ) d
  `);
  const nets = moments.map(() => ({ added: [] as string[], addedCount: 0, removed: [] as string[], removedCount: 0 }));
  for (const row of rows.rows) {
    const net = nets[row.ord - 1];
    if (net === undefined) continue;
    if (row.dir === 'added') {
      net.added = row.ids ?? [];
      net.addedCount = row.n;
    } else {
      net.removed = row.ids ?? [];
      net.removedCount = row.n;
    }
  }
  return nets;
}

/** A side's entries before displays: the moment, its net, and the ids to name. */
interface Pending {
  readonly side: Side;
  readonly moment: Moment;
  readonly net: Net;
}

/**
 * A side's newest non empty moments past the bound, at most `limit + 1`. A
 * moment whose net is empty (a reorder only) makes no entry, so when a read
 * was cut and empties leave the page short, it reads on past the last moment.
 */
async function sideMoments(input: ActivitySourceInput, side: Side): Promise<readonly Pending[]> {
  const { tx, scope, record, limit } = input;
  const rank = side.single ? ACTIVITY_RANKS.change : ACTIVITY_RANKS.links;
  const kept: Pending[] = [];
  let after = input.after;
  for (;;) {
    const { moments, more } = await readMoments(tx, scope.access, record.id, side, rank, after, limit);
    const nets = await netOf(tx, scope.access, record.id, side, moments);
    moments.forEach((moment, index) => {
      const net = nets[index];
      if (net !== undefined && net.addedCount + net.removedCount > 0) kept.push({ side, moment, net });
    });
    const last = moments.at(-1);
    if (kept.length > limit || !more || last === undefined) break;
    after = { at: last.at, rank, id: momentId(side, last) };
  }
  return kept.slice(0, limit + 1);
}

/** The record reference sides of the record's object the viewer may see, with their relationships. */
async function sidesOf(tx: WorkspaceTx, attributes: readonly AttributeDef[]): Promise<readonly Side[]> {
  const references = attributes.filter(
    (attribute) => attribute.type === 'record_reference' && attribute.relationshipId !== null,
  );
  const relationships = await loadRelationships(
    tx,
    references.flatMap((attribute) => (attribute.relationshipId === null ? [] : [attribute.relationshipId])),
  );
  return references.flatMap((attribute): Side[] => {
    const relationship = attribute.relationshipId === null ? undefined : relationships.get(attribute.relationshipId);
    if (relationship === undefined) return [];
    const isFrom = relationship.fromAttributeId === attribute.id;
    return [
      {
        attribute,
        relationship,
        isFrom,
        allowed: isFrom ? relationship.toObjectIds : [relationship.fromObjectId],
        single: isFrom ? relationship.fromSingle : relationship.toSingle,
      },
    ];
  });
}

/** The far records' displays (name, kind, hue), read as every record read names them. */
async function displaysOf(
  tx: WorkspaceTx,
  access: Access,
  ids: readonly string[],
): Promise<ReadonlyMap<string, RecordRefDisplay>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  // The ids came from reads that kept only live far records the viewer may see.
  const views = await readRecords(tx, access, unique, { attributeIds: [], visibleAlready: true });
  return new Map(views.map((view) => [view.id, view.display]));
}

/**
 * Relationship sides (`links`, rank 1, or `change` for a side that holds one):
 * every moment a side of the record gained or lost far records, from either
 * end of the relationship, grouped per moment and actor, net of what the
 * moment both ended and started, with only live far records the viewer may
 * see. One write that links 100 people is one entry naming 3 and counting 100.
 */
export const linkSource: ActivitySource = async (input) => {
  const sides = await sidesOf(input.tx, input.attributes);
  const pending: Pending[] = [];
  // One side after another: they share the read's one transaction.
  for (const side of sides) pending.push(...(await sideMoments(input, side)));
  const parts = pending.map((each) => {
    const rank = each.side.single ? ACTIVITY_RANKS.change : ACTIVITY_RANKS.links;
    const id = momentId(each.side, each.moment);
    return { each, rank, id, key: activityKey({ at: each.moment.at, rank, id }) };
  });
  // Only the first `limit + 1` across sides are kept, so only their records are named.
  parts.sort((a, b) =>
    a.each.moment.at !== b.each.moment.at
      ? a.each.moment.at > b.each.moment.at
        ? -1
        : 1
      : a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const kept = parts.slice(0, input.limit + 1);
  const displays = await displaysOf(
    input.tx,
    input.scope.access,
    kept.flatMap(({ each }) => [...each.net.added, ...each.net.removed]),
  );
  const named = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const display = displays.get(id);
      return display === undefined ? [] : [display];
    });
  return kept.map(({ each, id, key }): ActivityItem => {
    const { side, moment, net } = each;
    const base = {
      id,
      key,
      at: toMillis(moment.at),
      actor: actorOf(moment.actorType, moment.actorId),
      attributeId: side.attribute.id,
    };
    if (side.single) {
      const fromRefs = named(net.removed);
      const toRefs = named(net.added);
      const reference = (refs: readonly RecordRefDisplay[]) => {
        const [first] = refs;
        return first === undefined ? null : { objectId: first.objectId, recordId: first.recordId };
      };
      return { ...base, kind: 'change', from: reference(fromRefs), to: reference(toRefs), fromRefs, toRefs };
    }
    return {
      ...base,
      kind: 'links',
      added: named(net.added),
      addedCount: net.addedCount,
      removed: named(net.removed),
      removedCount: net.removedCount,
    };
  });
};
