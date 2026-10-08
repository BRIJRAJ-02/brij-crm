// Relationships and record references (spec 0004, AC-5). One definition gives
// each end its own record reference attribute; each link is one record_links
// row, read from both ends. Links keep history in place like values: a change
// ends the current links of that end and starts new ones under one version.
// Links to a record in the trash stay current but hidden, so a restore brings
// them back.
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { MAX_CELL_LINKS } from '@crm/contracts';
import type { RecordReferenceValue, ValueVersion } from '@crm/contracts/values';
import { insertAttribute } from './definitions.ts';
import { canonicalId, checkId, isUuid, uuidList } from './ids.ts';
import { postgresError, refuse, versionChangedMessage, writeConflict } from './refusals.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import { parseFor, type AttributeDef, type AttributeWrite } from './values.ts';
import { runWrite, type AfterWrite, type ValueChange, type WriteContext } from './write.ts';
import { requirePermission } from '../access/check.ts';
import type { Access } from '../access/policy.ts';
import { attributeVisible, farVisibleSql, visibleRecords } from '../access/visibility.ts';

const { attributes, objects, recordLinks, records, relationships } = schema;

/** How many records each end may link to, read from the defining end: `one_to_many` is one of its records to many. */
export type Cardinality = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';

/** One end of a relationship: the object it sits on and the attribute it gets there. */
export interface RelationshipEnd {
  readonly objectId: string;
  readonly apiSlug: string;
  readonly title: string;
  readonly description?: string;
}

/**
 * What a relationship needs: the defining end, and either the other end (two
 * way, each end gets an attribute) or the objects a one way reference may
 * point to (no attribute on the other side).
 */
export interface RelationshipInput {
  readonly cardinality: Cardinality;
  readonly from: RelationshipEnd;
  readonly to?: RelationshipEnd;
  readonly targetObjectIds?: readonly string[];
}

/** A relationship as the write and read paths use it. */
export interface RelationshipDef {
  readonly id: string;
  readonly fromAttributeId: string;
  readonly toAttributeId: string | null;
  readonly fromObjectId: string;
  /** The objects the defining end may link to: the other end's object, or a one way reference's targets. */
  readonly toObjectIds: readonly string[];
  readonly fromSingle: boolean;
  readonly toSingle: boolean;
}

/** Which ends of a cardinality hold one link at most. */
export function singleEnds(cardinality: Cardinality): { fromSingle: boolean; toSingle: boolean } {
  return {
    fromSingle: cardinality === 'one_to_one' || cardinality === 'many_to_one',
    toSingle: cardinality === 'one_to_one' || cardinality === 'one_to_many',
  };
}

/** A link time as fixed width UTC text with microseconds, so times compare as strings. */
const MICRO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const micro = (column: unknown) => sql<string>`to_char(${column} at time zone 'UTC', ${sql.raw(MICRO)})`;

/** The most objects a one way reference may point to. */
const MAX_TARGETS = 20;

/** Refuses objects that are missing or archived; returns their canonical ids, in order. */
async function liveObjects(tx: WorkspaceTx, given: readonly string[]): Promise<readonly string[]> {
  const ids = given.map((id) => checkId(id, 'That object does not exist.'));
  const rows = await tx
    .select({ id: objects.id, archivedAt: objects.archivedAt })
    .from(objects)
    .where(inArray(objects.id, [...ids]));
  for (const id of ids) {
    const row = rows.find((each) => each.id === id);
    if (row === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
    if (row.archivedAt !== null) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
  }
  return ids;
}

/** Inserts a relationship and its end attributes, inside a write. */
export async function insertRelationship(
  context: WriteContext,
  input: RelationshipInput,
): Promise<{ relationshipId: string; fromAttributeId: string; toAttributeId?: string }> {
  const { tx, scope } = context;
  // Canonical first, so two spellings of one object are one target.
  const targets = [...new Set((input.targetObjectIds ?? []).map(canonicalId))];
  if ((input.to === undefined) === (targets.length === 0)) {
    throw refuse(
      'CONFIG_INVALID',
      'Give the other end of the relationship, or the objects a one way reference may point to.',
    );
  }
  if (targets.length > MAX_TARGETS) {
    throw refuse('CONFIG_INVALID', `A one way reference may point to at most ${String(MAX_TARGETS)} objects.`);
  }
  await liveObjects(tx, [input.from.objectId, ...(input.to === undefined ? targets : [input.to.objectId])]);
  const { fromSingle, toSingle } = singleEnds(input.cardinality);
  const end = (side: RelationshipEnd, single: boolean) =>
    insertAttribute(
      context,
      {
        objectId: side.objectId,
        apiSlug: side.apiSlug,
        title: side.title,
        type: 'record_reference',
        isMulti: !single,
        ...(side.description === undefined ? {} : { description: side.description }),
      },
      { reference: true },
    );
  const from = await end(input.from, fromSingle);
  const to = input.to === undefined ? undefined : await end(input.to, toSingle);
  const by = actorRow(scope.actor);
  const [row] = await tx
    .insert(relationships)
    .values({
      workspaceId: scope.workspaceId,
      cardinality: input.cardinality,
      fromAttributeId: from.attributeId,
      toAttributeId: to?.attributeId ?? null,
      targetObjectIds: to === undefined ? targets : null,
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .returning({ id: relationships.id });
  if (row === undefined) throw new Error('The relationship was not created.');
  await tx
    .update(attributes)
    .set({ relationshipId: row.id })
    .where(inArray(attributes.id, to === undefined ? [from.attributeId] : [from.attributeId, to.attributeId]));
  return {
    relationshipId: row.id,
    fromAttributeId: from.attributeId,
    ...(to === undefined ? {} : { toAttributeId: to.attributeId }),
  };
}

/** Defines a relationship between two objects (or one object and itself), or a one way reference (AC-5). */
export async function defineRelationship(
  scope: EngineScope,
  input: RelationshipInput,
  hooks: readonly AfterWrite[] = [],
) {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(scope, (context) => insertRelationship(context, input), hooks);
  return result;
}

/** The relationships behind some reference attributes, by relationship id. */
export async function loadRelationships(
  tx: WorkspaceTx,
  relationshipIds: readonly string[],
): Promise<ReadonlyMap<string, RelationshipDef>> {
  if (relationshipIds.length === 0) return new Map();
  const result = await tx.execute<{
    id: string;
    cardinality: Cardinality;
    from_attribute_id: string;
    to_attribute_id: string | null;
    from_object_id: string;
    to_object_ids: string[];
  }>(sql`
    select rel.id::text, rel.cardinality, rel.from_attribute_id::text, rel.to_attribute_id::text,
      f.object_id::text as from_object_id,
      (case when t.object_id is null then rel.target_object_ids else array[t.object_id] end)::text[] as to_object_ids
    from relationships rel
    join attributes f on f.workspace_id = rel.workspace_id and f.id = rel.from_attribute_id
    left join attributes t on t.workspace_id = rel.workspace_id and t.id = rel.to_attribute_id
    where rel.id in (${sql.join(
      relationshipIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        fromAttributeId: row.from_attribute_id,
        toAttributeId: row.to_attribute_id,
        fromObjectId: row.from_object_id,
        toObjectIds: row.to_object_ids,
        ...singleEnds(row.cardinality),
      },
    ]),
  );
}

async function relationshipOf(tx: WorkspaceTx, attribute: AttributeDef): Promise<RelationshipDef> {
  const relationship =
    attribute.relationshipId === null
      ? undefined
      : (await loadRelationships(tx, [attribute.relationshipId])).get(attribute.relationshipId);
  if (relationship === undefined) throw new Error(`${attribute.title} has no relationship.`);
  return relationship;
}

/** Which end of its relationship an attribute is, and that end's columns. */
function endOf(relationship: RelationshipDef, attributeId: string) {
  const isFrom = relationship.fromAttributeId === attributeId;
  return {
    isFrom,
    mine: isFrom ? recordLinks.fromRecordId : recordLinks.toRecordId,
    far: isFrom ? recordLinks.toRecordId : recordLinks.fromRecordId,
    myPosition: isFrom ? recordLinks.position : recordLinks.toPosition,
    farPosition: isFrom ? recordLinks.toPosition : recordLinks.position,
    mySingle: isFrom ? relationship.fromSingle : relationship.toSingle,
    farSingle: isFrom ? relationship.toSingle : relationship.fromSingle,
    farAttributeId: isFrom ? relationship.toAttributeId : relationship.fromAttributeId,
    allowed: isFrom ? relationship.toObjectIds : [relationship.fromObjectId],
  };
}

/**
 * A parsed record reference value as its list of references, in order, each
 * record once, with canonical ids: an upper case id is the same record, so it
 * must compare equal to the owner (no link to itself) and to the stored links.
 */
function referencesOf(value: unknown): readonly RecordReferenceValue[] {
  const given =
    value === null ? [] : Array.isArray(value) ? (value as RecordReferenceValue[]) : [value as RecordReferenceValue];
  const items = given.map((item) => ({ objectId: canonicalId(item.objectId), recordId: canonicalId(item.recordId) }));
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.recordId)) return false;
    seen.add(item.recordId);
    return true;
  });
}

/** A record's name for a message: its primary attribute's text, or "an unnamed <object>". */
async function recordName(tx: WorkspaceTx, access: Access, recordId: string): Promise<string> {
  const result = await tx.execute<{
    name: string | null;
    singular: string;
    object_id: string;
    primary_id: string | null;
  }>(sql`
    select v.text_value as name, o.singular_name as singular, o.id::text as object_id,
      o.primary_attribute_id::text as primary_id
    from records r
    join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    left join "values" v on v.workspace_id = r.workspace_id and v.owner_id = r.id
      and v.attribute_id = o.primary_attribute_id and v.position = 0 and v.active_until is null and not v.is_cleared
    where r.id = ${recordId}
  `);
  const [row] = result.rows;
  if (row === undefined) return 'that record';
  const unnamed = `an unnamed ${row.singular.toLowerCase()}`;
  // A name attribute the principal can't see is never quoted (spec 0009, AC-144): the record reads as unnamed.
  const named =
    row.primary_id !== null && attributeVisible(access, { id: row.primary_id, objectId: row.object_id, listId: null });
  return !named || row.name === null || row.name === '' ? unnamed : row.name;
}

/**
 * Refuses references to records that don't exist, are in the trash, or sit on
 * an object this end can't link to. A record the principal can't see (a
 * hidden object, or outside its record rule) is refused exactly as one that
 * doesn't exist (spec 0009, AC-143).
 */
async function checkTargets(
  tx: WorkspaceTx,
  access: Access,
  attribute: AttributeDef,
  ownerId: string,
  allowed: readonly string[],
  wanted: readonly RecordReferenceValue[],
): Promise<void> {
  if (wanted.length === 0) return;
  // A malformed id names no record: refused here, so a batch refuses this record alone instead of failing the cast.
  if (!wanted.every((item) => isUuid(item.recordId) && isUuid(item.objectId))) {
    throw refuse('ATTRIBUTE_VALUE_INVALID', `That ${attribute.title} record does not exist.`, attribute.id);
  }
  const rows = await tx
    .select({ id: records.id, objectId: records.objectId, deletedAt: records.deletedAt })
    .from(records)
    .where(
      inArray(
        records.id,
        wanted.map((item) => item.recordId),
      ),
    );
  const seen = await visibleRecords(
    tx,
    access,
    rows.map((row) => ({ objectId: row.objectId, recordId: row.id })),
  );
  for (const item of wanted) {
    const found = rows.find((each) => each.id === item.recordId);
    const row = found !== undefined && seen.has(found.id) ? found : undefined;
    if (item.recordId === ownerId) {
      throw refuse('ATTRIBUTE_VALUE_INVALID', `A record can't link to itself in ${attribute.title}.`, attribute.id);
    }
    if (row === undefined || row.objectId !== item.objectId) {
      throw refuse('ATTRIBUTE_VALUE_INVALID', `That ${attribute.title} record does not exist.`, attribute.id);
    }
    if (!allowed.includes(row.objectId)) {
      throw refuse('ATTRIBUTE_VALUE_INVALID', `${attribute.title} can't link to that kind of record.`, attribute.id);
    }
    if (row.deletedAt !== null) {
      throw refuse('RECORD_DELETED', `That ${attribute.title} record is in the trash. Restore it first.`, attribute.id);
    }
  }
}

/** The current links on one end of one record, in order, with whether the far record is in the trash. */
async function endLinks(
  tx: WorkspaceTx,
  relationship: RelationshipDef,
  end: ReturnType<typeof endOf>,
  ownerId: string,
  access: Access,
) {
  // Whether the writer may see each far record (spec 0009), read with the links: no list of ids goes back to
  // the database however many links the end holds. Nothing is added under the open policy.
  const visible = farVisibleSql(access, end.allowed, 'records');
  return tx
    .select({
      id: recordLinks.id,
      versionId: recordLinks.versionId,
      far: end.far,
      farObjectId: records.objectId,
      farPosition: end.farPosition,
      setByType: recordLinks.setByType,
      setById: recordLinks.setById,
      activeFrom: micro(recordLinks.activeFrom),
      farDeleted: sql<boolean>`${records.deletedAt} is not null`,
      ...(visible === undefined ? {} : { farHidden: sql<boolean>`not (${visible})` }),
    })
    .from(recordLinks)
    .innerJoin(records, and(eq(records.workspaceId, recordLinks.workspaceId), eq(records.id, end.far)))
    .where(and(eq(recordLinks.relationshipId, relationship.id), eq(end.mine, ownerId), isNull(recordLinks.activeUntil)))
    .orderBy(asc(end.myPosition), asc(recordLinks.activeFrom), asc(recordLinks.id));
}

/**
 * Refuses `VERSION_CHANGED` (spec 0006, AC-49, undo) unless the cell is at
 * exactly `wanted`: its latest current link's version among the links the
 * writer may see, records in the trash included, the rule reads give
 * (`linkValues`). Checked against the links this write is about to end, so
 * a link another write adds after them is never ended by it. A cell with no
 * current link has no version, so it never matches.
 */
function checkLinkVersion(
  attribute: AttributeDef,
  current: readonly {
    readonly id: string;
    readonly versionId: string;
    readonly activeFrom: string;
    readonly farHidden?: boolean;
  }[],
  wanted: string,
): void {
  const seen = current.filter((link) => link.farHidden !== true);
  const latest = seen.reduce<(typeof seen)[number] | undefined>(
    (best, link) =>
      best === undefined ||
      link.activeFrom > best.activeFrom ||
      (link.activeFrom === best.activeFrom && link.id > best.id)
        ? link
        : best,
    undefined,
  );
  if (latest === undefined || !isUuid(wanted) || latest.versionId !== canonicalId(wanted)) {
    throw refuse('VERSION_CHANGED', versionChangedMessage(attribute.title), attribute.id);
  }
}

/**
 * Writes a record reference by the protocol, on a record the caller already
 * locked. An unchanged list writes nothing. Otherwise the end's current links
 * end and the new ones start under one version id. A single end replaces its
 * link; a single far end that already holds a live record's link refuses with
 * `RELATIONSHIP_TAKEN`, naming that record. Returns the changes for this record
 * and for every far record whose reference changed.
 */
export async function writeLinks(context: WriteContext, write: AttributeWrite): Promise<readonly ValueChange[]> {
  const { tx, scope } = context;
  const { attribute, ownerId } = write;
  if (write.ownerKind !== 'record') throw new Error('Only records hold record references.');
  const wanted = referencesOf(parseFor(attribute, write.value));
  const relationship = await relationshipOf(tx, attribute);
  const end = endOf(relationship, attribute.id);
  const current = await endLinks(tx, relationship, end, ownerId, scope.access);
  // Links to far records the writer can't see (spec 0009): they read as absent, and a multi end keeps them.
  const unseen = new Set(current.flatMap((link) => (link.farHidden === true ? [link.far] : [])));
  if (write.ifVersionId !== undefined) checkLinkVersion(attribute, current, write.ifVersionId);
  await checkTargets(tx, scope.access, attribute, ownerId, end.allowed, wanted);

  const visible = current.filter((link) => !link.farDeleted && !unseen.has(link.far));
  const wantedIds = wanted.map((item) => item.recordId);
  if (visible.length === wantedIds.length && visible.every((link, index) => link.far === wantedIds[index])) return [];
  // A single end holding a live link the writer can't see: replacing it would end that link, and a write never
  // removes what the writer can't see (spec 0009), so the change is refused without naming the record.
  if (end.mySingle && current.some((link) => !link.farDeleted && unseen.has(link.far))) {
    throw refuse(
      'ATTRIBUTE_READ_ONLY',
      `${attribute.title} holds a record you can't see, so you can't change it.`,
      attribute.id,
    );
  }

  // A far end that holds one link: a live record's link refuses, one in the trash gives way.
  const freed: { id: string; activeFrom: string }[] = [];
  const shown = new Set(visible.map((link) => link.far));
  const added = wantedIds.filter((id) => !shown.has(id));
  if (end.farSingle && added.length > 0) {
    const held = await tx
      .select({
        id: recordLinks.id,
        target: end.far,
        activeFrom: micro(recordLinks.activeFrom),
        holderDeleted: sql<boolean>`${records.deletedAt} is not null`,
      })
      .from(recordLinks)
      .innerJoin(records, and(eq(records.workspaceId, recordLinks.workspaceId), eq(records.id, end.mine)))
      .where(
        and(
          eq(recordLinks.relationshipId, relationship.id),
          inArray(end.far, added),
          ne(end.mine, ownerId),
          isNull(recordLinks.activeUntil),
        ),
      )
      // Holds each holder against a restore until this write commits, so a link it gives away stays given away.
      .for('share', { of: records });
    for (const link of held) {
      if (!link.holderDeleted) {
        const name = await recordName(tx, scope.access, link.target);
        throw refuse(
          'RELATIONSHIP_TAKEN',
          `${name} is already linked to another record through ${attribute.title}. Unlink it there first.`,
          attribute.id,
        );
      }
      freed.push({ id: link.id, activeFrom: link.activeFrom });
    }
  }

  // What this write ends on its own end: a single end's one link whatever the far record's state, and on a
  // multi end every link it shows. A multi end's links to records in the trash stay, so a restore brings
  // them back, and so do its links to records the writer can't see (spec 0009, AC-143).
  const ending = end.mySingle ? current : visible;
  let latest: string | undefined;
  for (const link of [ending, freed].flat()) {
    if (latest === undefined || link.activeFrom > latest) latest = link.activeFrom;
  }
  const stamp = await tx.execute<{ t: string; version: string }>(sql`
    select greatest(clock_timestamp(), coalesce(${latest ?? null}::timestamptz + interval '1 microsecond', clock_timestamp()))::text as t,
      uuidv7()::text as version
  `);
  const [first] = stamp.rows;
  if (first === undefined) throw new Error('Could not stamp the new version.');
  const at = sql`${first.t}::timestamptz`;
  const by = actorRow(scope.actor);

  const ended = { activeUntil: at, endedByType: by.type, endedById: by.id, endedByMemberId: by.memberId };
  if (ending.length > 0) {
    // One set based statement however many links the end holds (a company with 70,000 people), naming the
    // links this write read: their ids go as one array parameter, never one parameter per link, so neither
    // drizzle's stack nor Postgres's 65,535 parameters bound it. Only those links, and only while current (a
    // past version never changes): a link the far end added meanwhile was never read, so this write neither
    // ends it nor reports its far record, and it stays. When the far end ended one of them meanwhile, the
    // count falls short: start again, so this write sees it.
    const result = await tx
      .update(recordLinks)
      .set(ended)
      .where(
        and(
          eq(recordLinks.relationshipId, relationship.id),
          eq(end.mine, ownerId),
          isNull(recordLinks.activeUntil),
          sql`${recordLinks.id} = any(${uuidList(ending.map((link) => link.id))})`,
        ),
      );
    if (result.rowCount !== ending.length) throw writeConflict('A link changed under this write.');
  }
  if (freed.length > 0) {
    // The trashed holders' links on a single far end (at most one per added record).
    const result = await tx
      .update(recordLinks)
      .set(ended)
      .where(
        and(
          inArray(
            recordLinks.id,
            freed.map((link) => link.id),
          ),
          isNull(recordLinks.activeUntil),
        ),
      );
    if (result.rowCount !== freed.length) throw writeConflict('A link changed under this write.');
  }
  if (wanted.length > 0) {
    const carried = new Map(current.map((link) => [link.far, link.farPosition]));
    const rows = wantedIds.map((farId, position) => {
      const farPosition =
        carried.get(farId) ??
        sql`(select coalesce(max(${end.farPosition}) + 1, 0) from ${recordLinks} where ${recordLinks.relationshipId} = ${relationship.id} and ${end.far} = ${farId} and ${recordLinks.activeUntil} is null)`;
      return {
        workspaceId: scope.workspaceId,
        versionId: first.version,
        relationshipId: relationship.id,
        fromRecordId: end.isFrom ? ownerId : farId,
        toRecordId: end.isFrom ? farId : ownerId,
        position: end.isFrom ? position : farPosition,
        toPosition: end.isFrom ? farPosition : position,
        fromSingle: relationship.fromSingle,
        toSingle: relationship.toSingle,
        activeFrom: at,
        setByType: by.type,
        setById: by.id,
        setByMemberId: by.memberId,
      };
    });
    try {
      await tx.insert(recordLinks).values(rows);
    } catch (error) {
      const pg = postgresError(error);
      // A far end numbers each new link after its last: one whose last position is the largest an integer
      // holds has no next one. A clean refusal, never a raw out of range error.
      if (pg?.code === '22003') {
        throw refuse(
          'LIMIT_REACHED',
          `A record picked for ${attribute.title} holds as many links as it can. Unlink some of its links first.`,
          attribute.id,
        );
      }
      // The far end linked this same pair meanwhile: start again, and the write will find it already there.
      if (pg?.code === '23505' && pg.constraint === 'record_links_current') {
        throw writeConflict('The far end linked these records meanwhile.');
      }
      if (
        pg?.code === '23505' &&
        (pg.constraint === 'record_links_to_single' || pg.constraint === 'record_links_from_single')
      ) {
        throw refuse(
          'RELATIONSHIP_TAKEN',
          `That record was just linked to another record through ${attribute.title}. Unlink it there first.`,
          attribute.id,
        );
      }
      throw error;
    }
  }

  const before = visible.reduce<(typeof visible)[number] | undefined>(
    (latestLink, link) => (latestLink === undefined || link.activeFrom > latestLink.activeFrom ? link : latestLink),
    undefined,
  );
  const replaced =
    write.baseVersionId !== undefined && before !== undefined && before.versionId !== write.baseVersionId
      ? { versionId: before.versionId, setBy: { type: before.setByType, id: before.setById } satisfies Actor }
      : undefined;
  if (attribute.objectId === null) throw new Error(`${attribute.title} is not on an object.`);
  const changes: ValueChange[] = [
    {
      ownerId,
      ownerKind: 'record',
      objectId: attribute.objectId,
      attributeId: attribute.id,
      versionId: first.version,
      ...(replaced === undefined ? {} : { replaced }),
    },
  ];
  const farAttributeId = end.farAttributeId;
  if (farAttributeId !== null) {
    const shown = visible;
    const before = new Set(shown.map((link) => link.far));
    const after = new Set(wantedIds);
    const objectOf = new Map([
      ...shown.map((link) => [link.far, link.farObjectId] as const),
      ...wanted.map((item) => [item.recordId, item.objectId] as const),
    ]);
    const touched = [...before, ...after].filter((id) => before.has(id) !== after.has(id));
    for (const farId of touched) {
      const objectId = objectOf.get(farId);
      if (objectId === undefined) throw new Error('A far record has no object.');
      changes.push({
        ownerId: farId,
        ownerKind: 'record',
        objectId,
        attributeId: farAttributeId,
        versionId: first.version,
      });
    }
  }
  return changes;
}

/** A reference attribute's value from its links: a list for a multi end, else one reference or null. */
function asValue(attribute: AttributeDef, items: readonly RecordReferenceValue[]): unknown {
  if (attribute.isMulti) return items;
  return items[0] ?? null;
}

/** The most links one multi reference cell reads per record (the contract's cap); `LinkCells.totals` counts the rest. */
export const LINK_CELL_CAP = MAX_CELL_LINKS;

/** Reference cells read from links, each map by record id then attribute id. */
export interface LinkCells {
  /** Each cell's value: a list for a multi end (at most the cap, when one is given), else one reference or null. */
  readonly values: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  /** Only for a multi cell cut at the cap: how many live links it holds in all. */
  readonly totals: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /**
   * Each cell's version: that of its latest link in the period (the write
   * that made it; one write's links share its version), whether or not the far
   * record is in the trash. A cell with no link has none.
   */
  readonly versions: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** Sets `value` at `ownerId` then `attributeId` in a two level map. */
function setCell<T>(map: Map<string, Map<string, T>>, ownerId: string, attributeId: string, value: T): void {
  const byAttribute = map.get(ownerId) ?? new Map<string, T>();
  byAttribute.set(attributeId, value);
  map.set(ownerId, byAttribute);
}

/** One end's columns of `record_links` under the alias `k`, for raw statements (fixed names, never input). */
function endColumns(isFrom: boolean): { mine: SQL; far: SQL; position: SQL } {
  return isFrom
    ? { mine: sql.raw('k.from_record_id'), far: sql.raw('k.to_record_id'), position: sql.raw('k.position') }
    : { mine: sql.raw('k.to_record_id'), far: sql.raw('k.from_record_id'), position: sql.raw('k.to_position') };
}

/**
 * The values of reference attributes on some records, from their links to
 * live records: current ones, or those at the moment `at`. Each end reads in
 * its own order. With `cap`, a multi cell reads at most `cap` links per
 * record (a lateral limit per record, so a company with 70,000 people reads
 * 20 of them, not 70,000), and a cell cut short gets its total in `totals`.
 * Only far records `access` may see are read (spec 0009, AC-143): the cap,
 * the total and the cell's version all count visible links alone, and the
 * open policy adds nothing to the statement.
 */
export async function linkValues(
  tx: WorkspaceTx,
  access: Access,
  ownerIds: readonly string[],
  references: readonly AttributeDef[],
  options: { readonly at?: string; readonly cap?: number } = {},
): Promise<LinkCells> {
  const values = new Map<string, Map<string, unknown>>();
  const totals = new Map<string, Map<string, number>>();
  const versions = new Map<string, Map<string, string>>();
  if (ownerIds.length === 0 || references.length === 0) return { values, totals, versions };
  const relationshipsById = await loadRelationships(
    tx,
    references.flatMap((attribute) => (attribute.relationshipId === null ? [] : [attribute.relationshipId])),
  );
  const owners = uuidList([...new Set(ownerIds)]);
  const period =
    options.at === undefined
      ? sql`k.active_until is null`
      : sql`k.active_from <= ${options.at}::timestamptz and (k.active_until is null or k.active_until > ${options.at}::timestamptz)`;
  for (const attribute of references) {
    const relationship =
      attribute.relationshipId === null ? undefined : relationshipsById.get(attribute.relationshipId);
    if (relationship === undefined) continue;
    const ends = endOf(relationship, attribute.id);
    const { mine, far, position } = endColumns(ends.isFrom);
    // A single cell holds one link; reading a second would only be a broken invariant, so it reads one.
    const cap = options.cap === undefined ? undefined : attribute.isMulti ? options.cap : 1;
    const farVisible = farVisibleSql(access, ends.allowed, 'r');
    const seen = farVisible === undefined ? sql`` : sql` and ${farVisible}`;
    const links = sql`
      from record_links k
      join records r on r.workspace_id = k.workspace_id and r.id = ${far} and r.deleted_at is null${seen}
      where k.relationship_id = ${relationship.id} and ${mine} = o.owner and ${period}
    `;
    // The cell's version: its latest link's, among the links to far records the principal may see.
    const versionFrom =
      farVisible === undefined
        ? sql`from record_links k`
        : sql`from record_links k join records r on r.workspace_id = k.workspace_id and r.id = ${far} and ${farVisible}`;
    // One more than the cap, so a cell that holds more is known to be cut; and each cell's latest link's version.
    const rows = await tx.execute<{
      owner: string;
      record_id: string | null;
      object_id: string | null;
      latest: string | null;
    }>(sql`
      select o.owner::text as owner, l.record_id::text as record_id, l.object_id::text as object_id,
        v.version_id::text as latest
      from unnest(${owners}) as o(owner)
      left join lateral (
        select r.id as record_id, r.object_id, ${position} as p, k.active_from as f, k.id as kid
        ${links}
        order by ${position}, k.active_from, k.id
        ${cap === undefined ? sql`` : sql`limit ${cap + 1}`}
      ) l on true
      left join lateral (
        select k.version_id ${versionFrom}
        where k.relationship_id = ${relationship.id} and ${mine} = o.owner and ${period}
        order by k.active_from desc, k.id desc
        limit 1
      ) v on true
      order by o.owner, l.p, l.f, l.kid
    `);
    // Grouped by owner in one pass, so a page of 200 records is never 200 scans of every row.
    const byOwner = new Map<string, RecordReferenceValue[]>();
    for (const row of rows.rows) {
      const items = byOwner.get(row.owner) ?? [];
      byOwner.set(row.owner, items);
      if (row.record_id !== null && row.object_id !== null) {
        items.push({ objectId: row.object_id, recordId: row.record_id });
      }
      if (row.latest !== null) setCell(versions, row.owner, attribute.id, row.latest);
    }
    const cut: string[] = [];
    for (const [ownerId, items] of byOwner) {
      const shown = cap !== undefined && items.length > cap ? items.slice(0, cap) : items;
      if (attribute.isMulti && shown.length < items.length) cut.push(ownerId);
      setCell(values, ownerId, attribute.id, asValue(attribute, shown));
    }
    if (cut.length === 0) continue;
    const counted = await tx.execute<{ owner: string; n: number }>(sql`
      select o.owner::text as owner, (select count(*)::int ${links}) as n
      from unnest(${uuidList(cut)}) as o(owner)
    `);
    for (const row of counted.rows) setCell(totals, row.owner, attribute.id, row.n);
  }
  return { values, totals, versions };
}

/**
 * Every version of a reference attribute on one record, oldest first, built
 * from its links' periods: a new version starts wherever the set of links
 * changes. Links to records in the trash are hidden here too. Who set it is whoever started a link then, or ended one.
 */
export async function linkHistory(
  tx: WorkspaceTx,
  access: Access,
  attribute: AttributeDef,
  ownerId: string,
): Promise<readonly ValueVersion[]> {
  const relationship = await relationshipOf(tx, attribute);
  const end = endOf(relationship, attribute.id);
  // Links to far records the principal can't see leave the history whole (spec 0009): no version marks them.
  const farVisible = farVisibleSql(access, end.allowed, 'records');
  const links = await tx
    .select({
      recordId: records.id,
      objectId: records.objectId,
      position: end.myPosition,
      from: micro(recordLinks.activeFrom),
      until: sql<string | null>`to_char(${recordLinks.activeUntil} at time zone 'UTC', ${sql.raw(MICRO)})`,
      setByType: recordLinks.setByType,
      setById: recordLinks.setById,
      endedByType: recordLinks.endedByType,
      endedById: recordLinks.endedById,
    })
    .from(recordLinks)
    .innerJoin(
      records,
      and(eq(records.workspaceId, recordLinks.workspaceId), eq(records.id, end.far), isNull(records.deletedAt)),
    )
    .where(and(eq(recordLinks.relationshipId, relationship.id), eq(end.mine, ownerId), farVisible))
    .orderBy(asc(recordLinks.activeFrom), asc(end.myPosition), asc(recordLinks.id));
  const moments = [
    ...new Set(links.flatMap((link) => (link.until === null ? [link.from] : [link.from, link.until]))),
  ].sort();
  const versions: { value: unknown; key: string; activeFrom: string; setBy: Actor }[] = [];
  for (const moment of moments) {
    const live = links
      .filter((link) => link.from <= moment && (link.until === null || link.until > moment))
      .sort((a, b) => a.position - b.position);
    const key = live.map((link) => link.recordId).join(',');
    if (versions.at(-1)?.key === key) continue;
    const starter = links.find((link) => link.from === moment);
    const ender = links.find((link) => link.until === moment);
    const setBy: Actor =
      starter !== undefined
        ? { type: starter.setByType, id: starter.setById }
        : { type: ender?.endedByType ?? 'system', id: ender?.endedById ?? null };
    versions.push({
      key,
      activeFrom: moment,
      setBy,
      value: asValue(
        attribute,
        live.map((link) => ({ objectId: link.objectId, recordId: link.recordId })),
      ),
    });
  }
  const millis = (text: string) => `${text.slice(0, 23)}Z`;
  return versions.map((version, index) => {
    const next = versions[index + 1];
    return {
      value: version.value,
      activeFrom: millis(version.activeFrom),
      activeUntil: next === undefined ? null : millis(next.activeFrom),
      setBy: version.setBy,
    };
  });
}
