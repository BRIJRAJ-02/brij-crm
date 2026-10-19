// Link deltas (spec 0014, milestone 2): add or remove the named far records
// on one side of one record, never rewriting the rest of the side. A side that
// holds one replaces its link; a far side that holds one refuses a record
// already linked elsewhere unless the caller asks to move it. Both sides
// change under one version id, by spec 0004's write protocol, and the write
// reads and writes only the named records, the near record's lock and, on a
// move, each old holder's one link, so its cost never grows with the side.
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { RecordReferenceValue } from '@crm/contracts/values';
import { canonicalId, checkId, isUuid, uuidList } from './ids.ts';
import { postgresError, refuse, writeConflict } from './refusals.ts';
import { endOf, micro, recordName, relationshipOf } from './relationships.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import { holdDefinitions, isArchivedNow, loadAttributes, lockRecord, touchOwner, type AttributeDef } from './values.ts';
import { runWrite, type AfterWrite, type ValueChange, type WriteContext } from './write.ts';
import { fieldReadOnlyReason, isOpen, type Access } from '../access/policy.ts';
import {
  attributeLevel,
  checkObject,
  farVisibleSql,
  UNKNOWN_ATTRIBUTE,
  UNKNOWN_RECORD,
  visibleRecords,
} from '../access/visibility.ts';

const { objects, recordLinks, records } = schema;

/** The most far records one delta names (`links.add`, `links.remove`). */
export const LINKS_PER_DELTA = 100;

/** What one delta asks: add these far records, or remove these, on one side of one record. */
export type LinksDelta =
  | {
      readonly kind: 'add';
      readonly recordId: string;
      readonly attributeId: string;
      readonly targets: readonly RecordReferenceValue[];
      /** A far side that holds one: take a picked record from the record holding it (AC-292). */
      readonly move?: boolean;
      /**
       * A side that holds one: the link version the caller's copy held, to
       * report the save this one replaced (AC-295); `null` when it held none.
       */
      readonly baseVersionId?: string | null;
    }
  | {
      readonly kind: 'remove';
      readonly recordId: string;
      readonly attributeId: string;
      readonly targetRecordIds: readonly string[];
    };

/** What a delta did: the near record's object and attributes, and every value it changed (none when nothing did). */
export interface DeltaOutcome {
  readonly objectId: string;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  /** The near record's change first, then each far record's and each moved link's old holder's. */
  readonly changes: readonly ValueChange[];
}

/** The side a delta writes, refused unless the writer may change it (spec 0009, spec 0012's archived rule). */
async function nearSide(context: WriteContext, recordIdAsGiven: string, attributeIdAsGiven: string) {
  const { tx, scope } = context;
  const recordId = checkId(recordIdAsGiven, UNKNOWN_RECORD);
  const { objectId } = await lockRecord(tx, recordId, scope.access);
  await checkObject(tx, scope.access, objectId, 'write');
  const attributes = await loadAttributes(tx, objectId);
  const attribute = isUuid(attributeIdAsGiven) ? attributes.get(canonicalId(attributeIdAsGiven)) : undefined;
  const level =
    attribute === undefined ? 'hidden' : isOpen(scope.access) ? 'write' : attributeLevel(scope.access, attribute);
  if (attribute === undefined || level === 'hidden' || attribute.type !== 'record_reference') {
    throw refuse('NOT_FOUND', UNKNOWN_ATTRIBUTE, canonicalId(attributeIdAsGiven));
  }
  // An archived side, or one whose far object is archived (spec 0012's rule), answers as absent (AC-308).
  if (isArchivedNow(attribute)) {
    throw refuse(
      'NOT_FOUND',
      attribute.archivedAt === null
        ? `${attribute.title} links to an archived object. Restore that object first.`
        : `${attribute.title} is archived. Restore it first.`,
      attribute.id,
    );
  }
  if (attribute.isSystem) {
    throw refuse('ATTRIBUTE_READ_ONLY', `${attribute.title} is set by the system.`, attribute.id);
  }
  if (level === 'read') throw refuse('ATTRIBUTE_READ_ONLY', fieldReadOnlyReason(attribute.title), attribute.id);
  // Held still for the write: an archive or a type change of this side waits until it commits (spec 0013's hold).
  await holdDefinitions(tx, [attribute])();
  const relationship = await relationshipOf(tx, attribute);
  return { recordId, objectId, attributes, attribute, relationship, end: endOf(relationship, attribute.id) };
}

type Side = Awaited<ReturnType<typeof nearSide>>;

/** Ids once each, canonical, in the order given; 1 to 100 of them, else `ATTRIBUTE_VALUE_INVALID`. */
function boundedIds(attribute: AttributeDef, ids: readonly string[]): readonly string[] {
  const unique = [...new Set(ids.map(canonicalId))];
  if (unique.length === 0 || unique.length > LINKS_PER_DELTA) {
    throw refuse(
      'ATTRIBUTE_VALUE_INVALID',
      `Link or unlink 1 to ${String(LINKS_PER_DELTA)} records at a time in ${attribute.title}.`,
      attribute.id,
    );
  }
  return unique;
}

/**
 * Refuses far records a delta may not link (AC-293, AC-304, AC-308): a
 * record that doesn't exist, isn't of the object named, or that the writer
 * can't see answers `NOT_FOUND` as one; a record of an archived object too;
 * one in the trash `RECORD_DELETED`; the record itself, or an object this
 * side doesn't link to, `ATTRIBUTE_VALUE_INVALID`. Answers each far record's
 * object.
 */
async function checkFarRecords(
  tx: WorkspaceTx,
  access: Access,
  side: Side,
  wanted: readonly RecordReferenceValue[],
): Promise<void> {
  const { attribute, recordId, end } = side;
  const missing = `That ${attribute.title} record does not exist.`;
  if (!wanted.every((item) => isUuid(item.recordId) && isUuid(item.objectId))) {
    throw refuse('NOT_FOUND', missing, attribute.id);
  }
  const rows = await tx
    .select({
      id: records.id,
      objectId: records.objectId,
      deletedAt: records.deletedAt,
      objectArchivedAt: objects.archivedAt,
    })
    .from(records)
    .innerJoin(objects, and(eq(objects.workspaceId, records.workspaceId), eq(objects.id, records.objectId)))
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
    if (item.recordId === recordId) {
      throw refuse('ATTRIBUTE_VALUE_INVALID', `A record can't link to itself in ${attribute.title}.`, attribute.id);
    }
    const found = rows.find((row) => row.id === item.recordId);
    const row = found !== undefined && seen.has(found.id) ? found : undefined;
    if (row === undefined || row.objectId !== item.objectId) throw refuse('NOT_FOUND', missing, attribute.id);
    if (!end.allowed.includes(row.objectId)) {
      throw refuse('ATTRIBUTE_VALUE_INVALID', `${attribute.title} can't link to that kind of record.`, attribute.id);
    }
    if (row.objectArchivedAt !== null) throw refuse('NOT_FOUND', missing, attribute.id);
    if (row.deletedAt !== null) {
      throw refuse('RECORD_DELETED', `That ${attribute.title} record is in the trash. Restore it first.`, attribute.id);
    }
  }
}

/** A version id and a start time after every link the write ends (spec 0004's protocol: time never runs back). */
async function stamp(tx: WorkspaceTx, ending: readonly { readonly activeFrom: string }[]) {
  const latest = ending.reduce<string | undefined>(
    (best, link) => (best === undefined || link.activeFrom > best ? link.activeFrom : best),
    undefined,
  );
  const result = await tx.execute<{ t: string; version: string }>(sql`
    select greatest(clock_timestamp(), coalesce(${latest ?? null}::timestamptz + interval '1 microsecond', clock_timestamp()))::text as t,
      uuidv7()::text as version
  `);
  const [first] = result.rows;
  if (first === undefined) throw new Error('Could not stamp the new version.');
  return { at: sql`${first.t}::timestamptz`, version: first.version };
}

/** Ends exactly these current links, or starts the write again when another write ended one meanwhile. */
async function endLinks(context: WriteContext, ids: readonly string[], at: ReturnType<typeof sql>): Promise<void> {
  if (ids.length === 0) return;
  const by = actorRow(context.scope.actor);
  const result = await context.tx
    .update(recordLinks)
    .set({ activeUntil: at, endedByType: by.type, endedById: by.id, endedByMemberId: by.memberId })
    .where(and(sql`${recordLinks.id} = any(${uuidList(ids)})`, isNull(recordLinks.activeUntil)));
  if (result.rowCount !== ids.length) throw writeConflict('A link changed under this write.');
}

/** A far change for each far record, on the side paired with this one (none for a one way reference). */
function farChanges(
  side: Side,
  far: readonly { readonly recordId: string; readonly objectId: string }[],
  versionId: string,
): ValueChange[] {
  const farAttributeId = side.end.farAttributeId;
  if (farAttributeId === null) return [];
  return far.map((item) => ({
    ownerId: item.recordId,
    ownerKind: 'record',
    objectId: item.objectId,
    attributeId: farAttributeId,
    versionId,
  }));
}

/** Adds links (AC-290 to AC-293, AC-295): the named far records, each once; one already linked changes nothing. */
async function addLinks(
  context: WriteContext,
  side: Side,
  input: Extract<LinksDelta, { kind: 'add' }>,
): Promise<readonly ValueChange[]> {
  const { tx, scope } = context;
  const { attribute, relationship, end, recordId, objectId } = side;
  const ids = boundedIds(
    attribute,
    input.targets.map((item) => item.recordId),
  );
  const wanted = ids.map((id): RecordReferenceValue => {
    const given = input.targets.find((item) => canonicalId(item.recordId) === id);
    return { recordId: id, objectId: canonicalId(given?.objectId ?? '') };
  });
  if (end.mySingle && wanted.length > 1) {
    throw refuse('ATTRIBUTE_VALUE_INVALID', `${attribute.title} holds one record. Pick one.`, attribute.id);
  }
  await checkFarRecords(tx, scope.access, side, wanted);

  // A side that holds one: its one current link, whatever the far record's state, which a new pick replaces.
  const visible = farVisibleSql(scope.access, end.allowed, 'records');
  const current = end.mySingle
    ? await tx
        .select({
          id: recordLinks.id,
          versionId: recordLinks.versionId,
          far: end.far,
          farObjectId: records.objectId,
          setByType: recordLinks.setByType,
          setById: recordLinks.setById,
          activeFrom: micro(recordLinks.activeFrom),
          farDeleted: sql<boolean>`${records.deletedAt} is not null`,
          farHidden: visible === undefined ? sql<boolean>`false` : sql<boolean>`not (${visible})`,
        })
        .from(recordLinks)
        .innerJoin(records, and(eq(records.workspaceId, recordLinks.workspaceId), eq(records.id, end.far)))
        .where(
          and(eq(recordLinks.relationshipId, relationship.id), eq(end.mine, recordId), isNull(recordLinks.activeUntil)),
        )
    : [];
  // A side that holds many: only the named far records' links are read, never the rest of the side.
  const linked = end.mySingle
    ? new Set(current.map((link) => link.far))
    : new Set(
        (
          await tx
            .select({ far: end.far })
            .from(recordLinks)
            .where(
              and(
                eq(recordLinks.relationshipId, relationship.id),
                eq(end.mine, recordId),
                isNull(recordLinks.activeUntil),
                inArray(end.far, ids),
              ),
            )
        ).map((row) => row.far),
      );
  const added = wanted.filter((item) => !linked.has(item.recordId));
  // Already as asked: nothing is written, and the call still succeeds (AC-290).
  if (added.length === 0) return [];
  // A side that holds one link to a record the writer can't see: a write never removes what they can't see.
  if (end.mySingle && current.some((link) => link.farHidden && !link.farDeleted)) {
    throw refuse(
      'ATTRIBUTE_READ_ONLY',
      `${attribute.title} holds a record you can't see, so you can't change it.`,
      attribute.id,
    );
  }

  // A far side that holds one: a live holder refuses unless the caller moves it; one in the trash gives way.
  const freed: { id: string; activeFrom: string }[] = [];
  const moved: { id: string; activeFrom: string; holder: string; holderObjectId: string }[] = [];
  if (end.farSingle) {
    const held = await tx
      .select({
        id: recordLinks.id,
        target: end.far,
        holder: end.mine,
        holderObjectId: records.objectId,
        activeFrom: micro(recordLinks.activeFrom),
        holderDeleted: sql<boolean>`${records.deletedAt} is not null`,
      })
      .from(recordLinks)
      .innerJoin(records, and(eq(records.workspaceId, recordLinks.workspaceId), eq(records.id, end.mine)))
      .where(
        and(
          eq(recordLinks.relationshipId, relationship.id),
          inArray(
            end.far,
            added.map((item) => item.recordId),
          ),
          ne(end.mine, recordId),
          isNull(recordLinks.activeUntil),
        ),
      )
      // Each holder held against a restore until this write commits, so a link given away stays given away.
      .for('share', { of: records });
    const live = held.filter((link) => !link.holderDeleted);
    for (const link of held) if (link.holderDeleted) freed.push({ id: link.id, activeFrom: link.activeFrom });
    const [taken] = live;
    if (taken !== undefined && input.move !== true) {
      // Names the record the writer picked, never the one holding it (spec 0014, security model).
      const name = await recordName(tx, scope.access, taken.target);
      throw refuse(
        'RELATIONSHIP_TAKEN',
        `${name} is already linked to another record through ${attribute.title}.`,
        attribute.id,
      );
    }
    if (live.length > 0) {
      // A move ends a link on a record the writer must be able to see (spec 0009, AC-143).
      const seen = await visibleRecords(
        tx,
        scope.access,
        live.map((link) => ({ objectId: link.holderObjectId, recordId: link.holder })),
      );
      if (live.some((link) => !seen.has(link.holder))) {
        throw refuse('NOT_FOUND', `That ${attribute.title} record does not exist.`, attribute.id);
      }
      for (const link of live) moved.push(link);
    }
  }

  const ending = end.mySingle ? current : [];
  const { at, version } = await stamp(tx, [...ending, ...freed, ...moved]);
  await endLinks(
    context,
    [...ending, ...freed, ...moved].map((link) => link.id),
    at,
  );
  const by = actorRow(scope.actor);
  // A side that holds many numbers new links after its last (read through the side's position index).
  const [last] = end.mySingle
    ? []
    : (
        await tx.execute<{ next: number }>(sql`
          select coalesce(max(${end.myPosition}) + 1, 0)::int as next from ${recordLinks}
          where ${recordLinks.relationshipId} = ${relationship.id} and ${end.mine} = ${recordId}
            and ${recordLinks.activeUntil} is null
        `)
      ).rows;
  const first = last?.next ?? 0;
  const rows = added.map((item, index) => {
    const position = end.mySingle ? 0 : first + index;
    const farPosition = sql`(select coalesce(max(${end.farPosition}) + 1, 0) from ${recordLinks} where ${recordLinks.relationshipId} = ${relationship.id} and ${end.far} = ${item.recordId} and ${recordLinks.activeUntil} is null)`;
    return {
      workspaceId: scope.workspaceId,
      versionId: version,
      relationshipId: relationship.id,
      fromRecordId: end.isFrom ? recordId : item.recordId,
      toRecordId: end.isFrom ? item.recordId : recordId,
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
    if (pg?.code === '22003') {
      throw refuse(
        'LIMIT_REACHED',
        `A record picked for ${attribute.title} holds as many links as it can. Unlink some of its links first.`,
        attribute.id,
      );
    }
    // The far side linked this pair meanwhile: start again, and the write finds it already there.
    if (pg?.code === '23505' && pg.constraint === 'record_links_current') {
      throw writeConflict('The far side linked these records meanwhile.');
    }
    // Another write took the record (or this side) at the same moment: exactly one wins (AC-293).
    if (
      pg?.code === '23505' &&
      (pg.constraint === 'record_links_to_single' || pg.constraint === 'record_links_from_single')
    ) {
      throw refuse(
        'RELATIONSHIP_TAKEN',
        `That record was just linked to another record through ${attribute.title}. Try again to move it here.`,
        attribute.id,
      );
    }
    throw error;
  }

  // The save this one replaced, when the caller's copy held an older one (AC-295): reported, never refused.
  const before = current.find((link) => !link.farDeleted && !link.farHidden);
  const replaced =
    input.baseVersionId !== undefined && before !== undefined && before.versionId !== input.baseVersionId
      ? { versionId: before.versionId, setBy: { type: before.setByType, id: before.setById } satisfies Actor }
      : undefined;
  const near: ValueChange = {
    ownerId: recordId,
    ownerKind: 'record',
    objectId,
    attributeId: attribute.id,
    versionId: version,
    ...(replaced === undefined ? {} : { replaced }),
  };
  const lost = ending
    .filter((link) => !link.farDeleted && !link.farHidden)
    .map((link) => ({ recordId: link.far, objectId: link.farObjectId }));
  return [
    near,
    ...farChanges(side, [...added, ...lost], version),
    // Each moved link's old holder lost the record from this same side (AC-292).
    ...moved.map((link): ValueChange => ({
      ownerId: link.holder,
      ownerKind: 'record',
      objectId: link.holderObjectId,
      attributeId: attribute.id,
      versionId: version,
    })),
  ];
}

/**
 * Removes links (AC-290, AC-291): only the named far records' links end. A
 * record not linked, or one the writer can't see (whose link a write never
 * ends), changes nothing; one in the trash refuses `RECORD_DELETED`.
 * Emptying a required side refuses `VALUE_REQUIRED`.
 */
async function removeLinks(
  context: WriteContext,
  side: Side,
  input: Extract<LinksDelta, { kind: 'remove' }>,
): Promise<readonly ValueChange[]> {
  const { tx, scope } = context;
  const { attribute, relationship, end, recordId, objectId } = side;
  const ids = boundedIds(attribute, input.targetRecordIds.filter(isUuid));
  const visible = farVisibleSql(scope.access, end.allowed, 'records');
  const links = await tx
    .select({
      id: recordLinks.id,
      far: end.far,
      farObjectId: records.objectId,
      activeFrom: micro(recordLinks.activeFrom),
      farDeleted: sql<boolean>`${records.deletedAt} is not null`,
      farHidden: visible === undefined ? sql<boolean>`false` : sql<boolean>`not (${visible})`,
    })
    .from(recordLinks)
    .innerJoin(records, and(eq(records.workspaceId, recordLinks.workspaceId), eq(records.id, end.far)))
    .where(
      and(
        eq(recordLinks.relationshipId, relationship.id),
        eq(end.mine, recordId),
        isNull(recordLinks.activeUntil),
        inArray(end.far, [...ids]),
      ),
    );
  const ending = links.filter((link) => !link.farHidden);
  if (ending.some((link) => link.farDeleted)) {
    throw refuse('RECORD_DELETED', `That ${attribute.title} record is in the trash. Restore it first.`, attribute.id);
  }
  if (ending.length === 0) return [];
  if (attribute.isRequired) {
    // Another live link the reader may see must stay (one row through the side's index, never the whole side).
    const others = await tx.execute<{ one: number }>(sql`
      select 1 as one from ${recordLinks}
      join ${records} on ${records.workspaceId} = ${recordLinks.workspaceId} and ${records.id} = ${end.far}
        and ${records.deletedAt} is null${visible === undefined ? sql`` : sql` and ${visible}`}
      where ${recordLinks.relationshipId} = ${relationship.id} and ${end.mine} = ${recordId}
        and ${recordLinks.activeUntil} is null and not (${end.far} = any(${uuidList(ending.map((link) => link.far))}))
      limit 1
    `);
    if (others.rows.length === 0) {
      throw refuse('VALUE_REQUIRED', `${attribute.title} is required. Keep at least one record.`, attribute.id);
    }
  }
  const { at, version } = await stamp(tx, ending);
  await endLinks(
    context,
    ending.map((link) => link.id),
    at,
  );
  return [
    { ownerId: recordId, ownerKind: 'record', objectId, attributeId: attribute.id, versionId: version },
    ...farChanges(
      side,
      ending.map((link) => ({ recordId: link.far, objectId: link.farObjectId })),
      version,
    ),
  ];
}

/**
 * One link delta inside a write (spec 0014, `writeLinksDelta`): the near
 * record locked under the writer's record rule, `write` on the near side,
 * every named far record (and each moved link's old holder) visible to the
 * writer, then the delta by the write protocol. Records what changed for the
 * hooks (one outbox row per object, naming the near record, every far record
 * and each old holder) and moves the near record's revision; a delta that
 * changes nothing writes and records nothing.
 */
export async function writeLinksDelta(context: WriteContext, delta: LinksDelta): Promise<DeltaOutcome> {
  const side = await nearSide(context, delta.recordId, delta.attributeId);
  const changes = delta.kind === 'add' ? await addLinks(context, side, delta) : await removeLinks(context, side, delta);
  if (changes.length > 0) {
    await touchOwner(context, 'record', side.recordId);
    context.record({ values: changes });
  }
  return { objectId: side.objectId, attributes: side.attributes, changes };
}

/**
 * A link delta as its own write (spec 0014, AC-290 to AC-296): one
 * transaction, the hooks in it (one outbox row per object touched), tried
 * again on a deadlock. Answers what changed and the near record's attributes
 * as the write loaded them.
 */
export async function changeLinks(
  scope: EngineScope,
  delta: LinksDelta,
  hooks: readonly AfterWrite[] = [],
): Promise<DeltaOutcome> {
  const { result } = await runWrite(scope, (context) => writeLinksDelta(context, delta), hooks);
  return result;
}
