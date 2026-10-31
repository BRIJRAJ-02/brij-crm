// Merging two records of one object (spec 0049, AC-4910 to AC-4917, AC-4919):
// everything that points at the merged record moves onto the kept one, in one
// transaction, then the merged record goes to the trash with
// `merged_into_record_id` set, where no list, search or restore finds it and
// the normal purge removes it. A read only `previewMerge` answers the
// dialog's rows and counts with the same plan.
//
// Locks, in the order every other write takes them: the lists either record
// has live entries in (id order, as erasure and the purge take them), then
// both records (id order), then the workspace counter row last (the merged
// record's slot, through `deferSlots`).
//
// What moves, and how:
// - values: a single value by pick (only where the reader may see and change
//   the attribute; else the kept record's, or the merged one's when the kept
//   is empty), a multi value united without repeats; written as new versions
//   on the kept record by the merging member (`putItems`, the value protocol
//   without parsing: a merge only moves values that are already stored, so an
//   archived option or a former member's name never refuses it), after the
//   merged record's unique keys are held by its trash;
// - the merged record's past value rows, re-owned (both `owner_id` and
//   `record_id`, as `values_owner` holds them equal), so the kept record's
//   history shows both;
// - links, re-pointed in place (the far record's version moves): a link the
//   kept record already has, the link between the two, and the merged side of
//   a single end the kept record already fills (unless picked) are ended
//   instead; its past links move too;
// - list entries, moved, except in a list that holds a record once where both
//   are: the kept entry stays, takes the other's values where its own are
//   empty, and the other is removed;
// - notes, comments, files, task links, meetings and attendees, form
//   submissions, bookings, notifications, live routing assignments and recent
//   visits, each through its record index; a row the kept record already has
//   (a task linked to both) is dropped instead of doubled.
// Validation rules (spec 0013) are not run: a merge writes only values that
// were valid where they stood, as a restore does (`bypass.test.ts` places it).
import { sql, type SQL } from 'drizzle-orm';
import { MERGE_MAX_ITEMS, type MergeMoved, type MergeSide } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { sameItems, type ItemColumns, type StoredItem } from './columns.ts';
import { checkId, newId, uuidList } from './ids.ts';
import { readRecords, type RecordView } from './records.ts';
import { loadRelationships } from './relationships.ts';
import { refuse } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { setEntryKeysLive, setRecordKeysLive, syncSortKey } from './sort-keys.ts';
import { holdUniqueKeys, uniqueKeyOf } from './unique.ts';
import {
  currentItems,
  holdDefinitions,
  isArchivedNow,
  itemInsert,
  loadAttributes,
  loadListAttributes,
  touchOwner,
  type AttributeDef,
} from './values.ts';
import {
  runWrite,
  type AfterWrite,
  type CommentChange,
  type EntryRef,
  type MeetingChange,
  type NoteChange,
  type ReferenceChange,
  type TaskChange,
  type ValueChange,
  type WriteContext,
} from './write.ts';
import { inWorkspace } from '../access/run.ts';
import { isOpen, type Access } from '../access/policy.ts';
import { attributeLevel, checkObject, UNKNOWN_OBJECT, UNKNOWN_RECORD, visibleRecords } from '../access/visibility.ts';
import { writeAudit } from '../members/audit.ts';

/** Two records of one object: the one kept, and the one merged into it. */
export interface MergePair {
  readonly objectId: string;
  readonly keepId: string;
  readonly mergeId: string;
}

/** A merge: the pair, the side picked per attribute, and the revisions the dialog read. */
export interface MergeInput extends MergePair {
  readonly picks?: Readonly<Record<string, MergeSide>>;
  readonly revisions?: { readonly keep: number; readonly merge: number };
}

/** What a merge did: the kept record, its revision after, the merged record and what moved. */
export interface MergeResult {
  readonly recordId: string;
  readonly mergedId: string;
  readonly revision: number;
  readonly moved: MergeMoved;
  /** A retry of a merge that already landed (the same pair, by the same member): nothing changed this time. */
  readonly replayed: boolean;
}

/** One row of the merge dialog: an attribute both hold differently, which the reader may see and change. */
export interface MergeRow {
  readonly attributeId: string;
  readonly preselected: MergeSide;
}

/** What the dialog shows before a merge: both records as read, the rows, the counts, and whether it is too large. */
export interface MergePreviewResult {
  readonly keep: RecordView;
  readonly merge: RecordView;
  readonly rows: readonly MergeRow[];
  readonly moved: MergeMoved;
  readonly tooLarge: boolean;
}

/** "Too much is attached to merge in one go" (AC-4917). */
export const MERGE_TOO_LARGE_MESSAGE = 'Too much is attached to merge in one go.';

const SAME_RECORD = 'Pick two different records to merge.';
const OTHER_OBJECT = 'Only records of the same object can be merged.';

/** A locked record of the pair, as the merge reads it. */
interface PairRow {
  readonly id: string;
  readonly objectId: string;
  readonly deleted: boolean;
  readonly mergedInto: string | null;
  readonly deletedById: string | null;
  readonly revision: number;
}

/** The pair's ids checked, canonical, and different. */
function checkPair(input: MergePair): MergePair {
  const objectId = checkId(input.objectId, UNKNOWN_OBJECT);
  const keepId = checkId(input.keepId, UNKNOWN_RECORD);
  const mergeId = checkId(input.mergeId, UNKNOWN_RECORD);
  if (keepId === mergeId) throw refuse('INVALID', SAME_RECORD);
  return { objectId, keepId, mergeId };
}

/**
 * The object first (AC-4919): hidden is `NOT_FOUND`, read only `FORBIDDEN`,
 * both before any record is looked up, so the refusal never says whether a
 * record exists. Then both records, which must be visible (else `NOT_FOUND`,
 * as a missing one), of the object (`INVALID`), and the merged one deletable,
 * which is the object's write and its record rule, as `deleteMany` checks.
 */
async function readPair(
  tx: WorkspaceTx,
  access: Access,
  pair: MergePair,
  lock: boolean,
): Promise<{ readonly keep: PairRow; readonly merge: PairRow }> {
  await checkObject(tx, access, pair.objectId, 'read');
  await checkObject(tx, access, pair.objectId, 'write');
  const rows = await tx.execute<{
    id: string;
    object_id: string;
    deleted: boolean;
    merged_into: string | null;
    deleted_by_id: string | null;
    revision: string;
  }>(sql`
    select id::text, object_id::text, deleted_at is not null as deleted,
      merged_into_record_id::text as merged_into, deleted_by_id::text, revision::text
    from records where id = any(${uuidList([pair.keepId, pair.mergeId])})
    order by id ${lock ? sql`for no key update` : sql``}
  `);
  const seen = await visibleRecords(
    tx,
    access,
    rows.rows.map((row) => ({ objectId: row.object_id, recordId: row.id })),
  );
  const found = new Map(
    rows.rows
      .filter((row) => seen.has(row.id))
      .map((row): [string, PairRow] => [
        row.id,
        {
          id: row.id,
          objectId: row.object_id,
          deleted: row.deleted,
          mergedInto: row.merged_into,
          deletedById: row.deleted_by_id,
          revision: Number(row.revision),
        },
      ]),
  );
  const keep = found.get(pair.keepId);
  const merge = found.get(pair.mergeId);
  if (keep === undefined || merge === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  if (keep.objectId !== pair.objectId || merge.objectId !== pair.objectId) throw refuse('INVALID', OTHER_OBJECT);
  return { keep, merge };
}

/**
 * How much hangs off the merged record (AC-4916, AC-4917), each part counted
 * through its record index and stopped one past the cap, so a record with a
 * million links costs a bounded read before anything is written.
 */
async function countAttached(tx: WorkspaceTx, recordId: string): Promise<MergeMoved & { readonly total: number }> {
  const cap = MERGE_MAX_ITEMS + 1;
  const bounded = (from: SQL) => sql`(select count(*)::int from (select 1 ${from} limit ${cap}) t)`;
  const id = sql`${recordId}::uuid`;
  const result = await tx.execute<{ links: number; entries: number; notes: number; others: number }>(sql`
    select
      ${bounded(sql`from record_links where from_record_id = ${id} and active_until is null`)}
        + ${bounded(sql`from record_links where to_record_id = ${id} and active_until is null`)} as links,
      ${bounded(sql`from list_entries where record_id = ${id} and deleted_at is null`)} as entries,
      ${bounded(sql`from notes where record_id = ${id}`)} as notes,
      ${bounded(sql`from comments where record_id = ${id}`)}
        + ${bounded(sql`from task_records where record_id = ${id}`)}
        + ${bounded(sql`from meeting_records where record_id = ${id}`)}
        + ${bounded(sql`from meeting_attendees where person_record_id = ${id}`)}
        + ${bounded(sql`from form_submission_records where record_id = ${id}`)}
        + ${bounded(sql`from form_submissions where main_record_id = ${id}`)}
        + ${bounded(sql`from bookings where person_record_id = ${id}`)}
        + ${bounded(sql`from bookings where company_record_id = ${id}`)}
        + ${bounded(sql`from bookings where deal_record_id = ${id}`)}
        + ${bounded(sql`from notifications where record_id = ${id}`)}
        + ${bounded(sql`from rotation_assignments where record_id = ${id} and voided_at is null`)}
        + ${bounded(sql`from record_files where record_id = ${id}`)} as others
  `);
  const row = result.rows[0] ?? { links: 0, entries: 0, notes: 0, others: 0 };
  const items = row.notes + row.others;
  return { links: row.links, entries: row.entries, items, notes: row.notes, total: row.links + row.entries + items };
}

/** The value rows of one attribute on one record, by position, as item columns. */
function itemsOf(rows: readonly StoredItem[]): readonly ItemColumns[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      textValue: row.textValue,
      numberValue: row.numberValue,
      dateValue: row.dateValue,
      timestampValue: row.timestampValue,
      boolValue: row.boolValue,
      optionId: row.optionId,
      actorType: row.actorType,
      actorId: row.actorId,
      jsonValue: row.jsonValue,
    }));
}

/**
 * Whether the reader may pick a side for an attribute in the dialog
 * (AC-4910, AC-4912): one they may see and change, live, not a system one
 * (created at and its kind) and not a type only the system writes.
 */
export function isPickable(access: Access, attribute: AttributeDef): boolean {
  if (attribute.isSystem || attribute.systemColumn !== null || isArchivedNow(attribute)) return false;
  if (attribute.type === 'timestamp' || attribute.type === 'interaction') return false;
  return isOpen(access) || attributeLevel(access, attribute) === 'write';
}

/** What a value plan writes on the kept record: the attribute, and its items after the merge. */
export interface ValueWrite {
  readonly attribute: AttributeDef;
  readonly items: readonly ItemColumns[];
}

/**
 * The value plan (pure; AC-4910 to AC-4912). For each attribute stored as
 * values (record references are links, planned apart) that the merged record
 * holds: a multi value is united, the kept items first and then each merged
 * item it lacks; a single value goes to the merged side when the kept is
 * empty, or when both hold different values and the reader picked `merge` on
 * a pickable attribute. Everything else keeps the kept record's value. A
 * system column is never planned (it is not stored as values).
 */
export function planValues(
  attributes: readonly AttributeDef[],
  keep: ReadonlyMap<string, readonly ItemColumns[]>,
  merge: ReadonlyMap<string, readonly ItemColumns[]>,
  pickable: (attribute: AttributeDef) => boolean,
  picks: Readonly<Record<string, MergeSide>>,
): { readonly writes: readonly ValueWrite[]; readonly rows: readonly MergeRow[] } {
  const writes: ValueWrite[] = [];
  const rows: MergeRow[] = [];
  for (const attribute of attributes) {
    if (attribute.type === 'record_reference' || attribute.systemColumn !== null || isArchivedNow(attribute)) continue;
    const kept = keep.get(attribute.id) ?? [];
    const merged = merge.get(attribute.id) ?? [];
    if (merged.length === 0) continue;
    if (attribute.isMulti) {
      const extra = merged.filter((item) => !kept.some((held) => sameItems([held], [item])));
      if (extra.length > 0) writes.push({ attribute, items: [...kept, ...extra] });
      continue;
    }
    if (kept.length === 0) {
      writes.push({ attribute, items: merged });
      continue;
    }
    if (sameItems(kept, merged)) continue;
    const shown = pickable(attribute);
    if (shown) rows.push({ attributeId: attribute.id, preselected: 'keep' });
    if (shown && picks[attribute.id] === 'merge') writes.push({ attribute, items: merged });
  }
  return { writes, rows };
}

/**
 * Writes `items` as one attribute's new version on a record or entry the
 * caller locked: the value protocol of `writeAttribute` (current rows end at
 * `t`, new rows start at `t` under one version, unique keys, the sort key)
 * without parsing, since a merge moves values already stored.
 */
async function putItems(
  context: WriteContext,
  owner: { readonly kind: 'record'; readonly objectId: string } | { readonly kind: 'entry'; readonly listId: string },
  ownerId: string,
  attribute: AttributeDef,
  items: readonly ItemColumns[],
): Promise<ValueChange> {
  const { tx, scope } = context;
  const stamp = await tx.execute<{ t: string; version: string }>(sql`
    select greatest(clock_timestamp(), coalesce(max(active_from) + interval '1 microsecond', clock_timestamp()))::text as t,
      uuidv7()::text as version
    from "values" where owner_id = ${ownerId}::uuid and attribute_id = ${attribute.id}::uuid and active_until is null
  `);
  const [first] = stamp.rows;
  if (first === undefined) throw new Error('Could not stamp the new version.');
  await tx.execute(sql`
    update "values" set active_until = ${first.t}::timestamptz
    where owner_id = ${ownerId}::uuid and attribute_id = ${attribute.id}::uuid and active_until is null
  `);
  const by = actorRow(scope.actor);
  const base = {
    workspaceId: scope.workspaceId,
    versionId: first.version,
    attributeId: attribute.id,
    ownerId,
    ...(owner.kind === 'record' ? { recordId: ownerId } : { entryId: ownerId }),
    activeFrom: sql`${first.t}::timestamptz`,
    setByType: by.type,
    setById: by.id,
    setByMemberId: by.memberId,
  };
  await tx.insert(schema.values).values(
    items.map((item, position) => ({
      ...base,
      ...itemInsert(item),
      position,
      uniqueKey: attribute.isUnique ? uniqueKeyOf(attribute.type, item) : null,
    })),
  );
  await syncSortKey(tx, ownerId, attribute);
  return owner.kind === 'record'
    ? { ownerId, ownerKind: 'record', objectId: owner.objectId, attributeId: attribute.id, versionId: first.version }
    : { ownerId, ownerKind: 'entry', listId: owner.listId, attributeId: attribute.id, versionId: first.version };
}

/** The current items of some owners, by owner and attribute. */
async function itemsByOwner(
  tx: WorkspaceTx,
  ownerIds: readonly string[],
): Promise<ReadonlyMap<string, ReadonlyMap<string, readonly ItemColumns[]>>> {
  const rows = await currentItems(tx, ownerIds);
  const grouped = new Map<string, Map<string, StoredItem[]>>();
  for (const row of rows) {
    const owner = grouped.get(row.ownerId) ?? new Map<string, StoredItem[]>();
    grouped.set(row.ownerId, owner);
    const list = owner.get(row.attributeId) ?? [];
    owner.set(row.attributeId, list);
    list.push(row);
  }
  return new Map(
    [...grouped].map(([ownerId, byAttribute]) => [
      ownerId,
      new Map([...byAttribute].map(([attributeId, items]) => [attributeId, itemsOf(items)])),
    ]),
  );
}

/** One current link of either record, with the far record's object. */
interface LinkRow {
  readonly id: string;
  readonly relationshipId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly fromSingle: boolean;
  readonly toSingle: boolean;
  readonly fromObjectId: string;
  readonly toObjectId: string;
}

/** Both records' current links, each once (the one between them shows from both). */
async function currentLinks(tx: WorkspaceTx, ids: readonly string[]): Promise<readonly LinkRow[]> {
  const result = await tx.execute<{
    id: string;
    relationship_id: string;
    from_id: string;
    to_id: string;
    from_single: boolean;
    to_single: boolean;
    from_object_id: string;
    to_object_id: string;
  }>(sql`
    select l.id::text, l.relationship_id::text, l.from_record_id::text as from_id, l.to_record_id::text as to_id,
      l.from_single, l.to_single, f.object_id::text as from_object_id, t.object_id::text as to_object_id
    from (
      select * from record_links where from_record_id = any(${uuidList(ids)}) and active_until is null
      union
      select * from record_links where to_record_id = any(${uuidList(ids)}) and active_until is null
    ) l
    join records f on f.workspace_id = l.workspace_id and f.id = l.from_record_id
    join records t on t.workspace_id = l.workspace_id and t.id = l.to_record_id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    relationshipId: row.relationship_id,
    fromId: row.from_id,
    toId: row.to_id,
    fromSingle: row.from_single,
    toSingle: row.to_single,
    fromObjectId: row.from_object_id,
    toObjectId: row.to_object_id,
  }));
}

/** A relationship's two attributes, as the link plan needs them. */
interface Ends {
  readonly fromAttributeId: string;
  readonly toAttributeId: string | null;
}

/** What the link plan does: links to end, links to re-point (by the side the merged record is on), and the rows. */
export interface LinkPlan {
  readonly end: readonly string[];
  readonly repointFrom: readonly string[];
  readonly repointTo: readonly string[];
  /** Single sides both records fill differently and the reader may pick: the dialog's rows. */
  readonly rows: readonly MergeRow[];
}

/**
 * The link plan (pure; AC-4911, AC-4913). Each current link of the merged
 * record: the one to the kept record is ended; one the kept record already has
 * on the same side to the same far record is ended (no doubles); on a side
 * that holds one record, the merged link moves only while the kept side is
 * empty, or when the reader picked `merge` on that attribute (the kept link
 * then ends); every other link moves. A side that holds many is united
 * whatever the field rules, as a multi value is, so nothing is lost.
 */
export function planLinks(
  links: readonly LinkRow[],
  pair: { readonly keepId: string; readonly mergeId: string },
  ends: ReadonlyMap<string, Ends>,
  pickable: (attributeId: string) => boolean,
  picks: Readonly<Record<string, MergeSide>>,
): LinkPlan {
  const { keepId, mergeId } = pair;
  const end = new Set<string>();
  const repointFrom: string[] = [];
  const repointTo: string[] = [];
  const rows = new Map<string, MergeRow>();
  const keptOn = (relationshipId: string, isFrom: boolean) =>
    links.filter(
      (link) =>
        link.relationshipId === relationshipId &&
        (isFrom ? link.fromId === keepId && link.toId !== mergeId : link.toId === keepId && link.fromId !== mergeId),
    );
  for (const link of links) {
    const isFrom = link.fromId === mergeId;
    if (!isFrom && link.toId !== mergeId) continue;
    const far = isFrom ? link.toId : link.fromId;
    if (far === keepId) {
      end.add(link.id);
      continue;
    }
    const kept = keptOn(link.relationshipId, isFrom);
    if (kept.some((held) => (isFrom ? held.toId : held.fromId) === far)) {
      end.add(link.id);
      continue;
    }
    const single = isFrom ? link.fromSingle : link.toSingle;
    if (single && kept.length > 0) {
      const relationship = ends.get(link.relationshipId);
      const attributeId =
        relationship === undefined ? null : isFrom ? relationship.fromAttributeId : relationship.toAttributeId;
      const shown = attributeId !== null && pickable(attributeId);
      if (shown) rows.set(attributeId, { attributeId, preselected: 'keep' });
      if (!shown || picks[attributeId] !== 'merge') {
        end.add(link.id);
        continue;
      }
      for (const held of kept) end.add(held.id);
    }
    (isFrom ? repointFrom : repointTo).push(link.id);
  }
  return { end: [...end], repointFrom, repointTo, rows: [...rows.values()] };
}

/** The attributes and links both records hold, read once for the plan. */
async function readPlanInputs(tx: WorkspaceTx, pair: MergePair) {
  const attributes = await loadAttributes(tx, pair.objectId);
  const items = await itemsByOwner(tx, [pair.keepId, pair.mergeId]);
  const links = await currentLinks(tx, [pair.keepId, pair.mergeId]);
  const relationships = await loadRelationships(tx, [...new Set(links.map((link) => link.relationshipId))]);
  const ends = new Map(
    [...relationships].map(([id, rel]): [string, Ends] => [
      id,
      { fromAttributeId: rel.fromAttributeId, toAttributeId: rel.toAttributeId },
    ]),
  );
  return { attributes, items, links, ends };
}

/** The dialog's rows in the object's attribute order. */
function orderedRows(attributes: ReadonlyMap<string, AttributeDef>, rows: readonly MergeRow[]): readonly MergeRow[] {
  const order = [...attributes.values()].sort((a, b) => a.position - b.position).map((attribute) => attribute.id);
  return [...rows].sort((a, b) => order.indexOf(a.attributeId) - order.indexOf(b.attributeId));
}

/**
 * What a merge would do, read only (spec 0049, `records.mergePreview`): the
 * same checks as the merge (AC-4919), then both records as a read gives them,
 * the dialog's rows and the counts. Refuses a trashed or merged record
 * `NOT_FOUND`.
 */
export async function previewMerge(scope: EngineScope, input: MergePair): Promise<MergePreviewResult> {
  const pair = checkPair(input);
  return inWorkspace(scope, async (tx) => {
    const { keep, merge } = await readPair(tx, scope.access, pair, false);
    if (keep.deleted || merge.deleted) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    const { attributes, items, links, ends } = await readPlanInputs(tx, pair);
    const byId = new Map([...attributes.values()].map((attribute) => [attribute.id, attribute]));
    const pickable = (attribute: AttributeDef) => isPickable(scope.access, attribute);
    const values = planValues(
      [...attributes.values()],
      items.get(pair.keepId) ?? new Map(),
      items.get(pair.mergeId) ?? new Map(),
      pickable,
      {},
    );
    const linkPlan = planLinks(
      links,
      pair,
      ends,
      (attributeId) => {
        const attribute = byId.get(attributeId);
        return attribute !== undefined && pickable(attribute);
      },
      {},
    );
    const counted = await countAttached(tx, pair.mergeId);
    const [keepView, mergeView] = await readRecords(tx, scope.access, [pair.keepId, pair.mergeId], {
      visibleAlready: true,
    });
    if (keepView === undefined || mergeView === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    const { total, ...moved } = counted;
    return {
      keep: keepView,
      merge: mergeView,
      rows: orderedRows(attributes, [...values.rows, ...linkPlan.rows]),
      moved,
      tooLarge: total > MERGE_MAX_ITEMS,
    };
  });
}

/**
 * Merges `mergeId` into `keepId` (spec 0049, AC-4910 to AC-4917), as one
 * write: refused with nothing changed when either record changed since the
 * dialog read it (`CONFLICT`), is trashed or already merged (`NOT_FOUND`),
 * when they are the same record or of different objects (`INVALID`), when the
 * merged record carries more than 10,000 links, entries and items
 * (`MERGE_TOO_LARGE`, counted before any write), and as AC-4919 says for
 * access. A retry of a merge that landed (the merged record already merged
 * into the kept one by the same member) answers it again, changing nothing.
 */
export async function mergeRecords(
  scope: EngineScope,
  input: MergeInput,
  hooks: readonly AfterWrite[] = [],
): Promise<MergeResult> {
  const pair = checkPair(input);
  const { result } = await runWrite(scope, (context) => mergeIn(context, { ...input, ...pair }), hooks);
  return result;
}

/** The lists either record has live entries in, locked in id order (the order erasure and the purge take). */
async function lockLists(tx: WorkspaceTx, ids: readonly string[]): Promise<void> {
  await tx.execute(sql`
    select 1 from lists
    where id in (select list_id from list_entries where record_id = any(${uuidList(ids)}) and deleted_at is null)
    order by id for update
  `);
}

/** A merge inside a write: locks, checks, counts, then moves everything and trashes the merged record. */
async function mergeIn(context: WriteContext, input: MergeInput & MergePair): Promise<MergeResult> {
  const { tx, scope } = context;
  const { objectId, keepId, mergeId } = input;
  await lockLists(tx, [keepId, mergeId]);
  const { keep, merge } = await readPair(tx, scope.access, input, true);
  const none: MergeMoved = { links: 0, entries: 0, items: 0, notes: 0 };
  if (keep.deleted) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  if (merge.deleted) {
    // A retry after a lost answer: the same member already merged this pair.
    const sameActor = scope.actor.id !== null && merge.deletedById === scope.actor.id;
    if (merge.mergedInto === keepId && sameActor) {
      return { recordId: keepId, mergedId: mergeId, revision: keep.revision, moved: none, replayed: true };
    }
    throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  }
  if (input.revisions !== undefined) {
    const moved = [
      keep.revision !== input.revisions.keep ? keep : undefined,
      merge.revision !== input.revisions.merge ? merge : undefined,
    ].find((row) => row !== undefined);
    if (moved !== undefined) {
      const [view] = await readRecords(tx, scope.access, [moved.id], { attributeIds: [], visibleAlready: true });
      const name = view?.display.name ?? 'A record';
      throw refuse('CONFLICT', `${name === '' ? 'A record' : name} changed while you were merging. Review it again.`);
    }
  }
  const counted = await countAttached(tx, mergeId);
  if (counted.total > MERGE_MAX_ITEMS) throw refuse('MERGE_TOO_LARGE', MERGE_TOO_LARGE_MESSAGE);
  const moved: MergeMoved = {
    links: counted.links,
    entries: counted.entries,
    items: counted.items,
    notes: counted.notes,
  };

  const picks = input.picks ?? {};
  const { attributes, items, links, ends } = await readPlanInputs(tx, input);
  const byId = new Map([...attributes.values()].map((attribute) => [attribute.id, attribute]));
  const pickable = (attribute: AttributeDef) => isPickable(scope.access, attribute);
  const valuePlan = planValues(
    [...attributes.values()],
    items.get(keepId) ?? new Map(),
    items.get(mergeId) ?? new Map(),
    pickable,
    picks,
  );
  const linkPlan = planLinks(
    links,
    { keepId, mergeId },
    ends,
    (attributeId) => {
      const attribute = byId.get(attributeId);
      return attribute !== undefined && pickable(attribute);
    },
    picks,
  );
  const by = actorRow(scope.actor);
  const mergedRef = { recordId: mergeId, objectId };

  // The merged record to the trash first, so its unique values stop blocking the kept record before it takes them.
  await tx.execute(sql`
    update records set deleted_at = clock_timestamp(), deleted_by_type = ${by.type}::actor_type,
      deleted_by_id = ${by.id}::uuid, deleted_by_member_id = ${by.memberId}::uuid,
      deleted_batch_id = ${newId()}::uuid, merged_into_record_id = ${keepId}::uuid, revision = revision + 1
    where id = ${mergeId}::uuid
  `);
  await holdUniqueKeys(tx, [mergeId]);

  // Values: the plan's new versions on the kept record, then the merged record's past rows (AC-4913).
  const hold = holdDefinitions(
    tx,
    valuePlan.writes.map((write) => write.attribute),
  );
  await hold();
  const valueChanges: ValueChange[] = [];
  for (const write of valuePlan.writes) {
    valueChanges.push(await putItems(context, { kind: 'record', objectId }, keepId, write.attribute, write.items));
  }
  await tx.execute(sql`
    update "values" set owner_id = ${keepId}::uuid, record_id = ${keepId}::uuid
    where owner_id = ${mergeId}::uuid and active_until is not null
  `);

  // Links (AC-4913): past links move first, then the ended ones end and the rest are re-pointed under a new version.
  const linkChanges = await moveLinks(context, { keepId, mergeId, objectId }, links, linkPlan, ends);

  // List entries, then everything else that hangs off the record.
  const entries = await moveEntries(context, { keepId, mergeId, objectId });
  const attached = await moveAttached(context, { keepId, mergeId, objectId });

  // The merged record leaves every read: its sort keys hidden, its slot given back with the counter row last.
  await setRecordKeysLive(tx, mergeId, false);
  context.deferSlots(-1);
  await touchOwner(context, 'record', keepId);
  const after = await tx.execute<{ revision: string }>(
    sql`select revision::text from records where id = ${keepId}::uuid`,
  );
  await writeAudit(tx, scope.workspaceId, scope.actor, {
    action: 'record.merged',
    targetType: 'record',
    targetId: keepId,
    before: { mergedRecordId: mergeId, objectId },
    // Others' notes and comments move too: accepted on purpose, and named here (spec 0049, security model).
    after: { keptRecordId: keepId, moved, movesOthersItems: moved.items > 0 },
  });
  context.record({
    deletedRecords: [mergedRef],
    values: [...valueChanges, ...linkChanges.values],
    references: linkChanges.references,
    ...entries,
    ...attached,
  });
  return {
    recordId: keepId,
    mergedId: mergeId,
    revision: Number(after.rows[0]?.revision ?? keep.revision + 1),
    moved,
    replayed: false,
  };
}

/**
 * Carries out the link plan: the merged record's past links move to the kept
 * record (never the one between them, which would point at itself), then the
 * plan's links end, then the rest move to the kept record in place under one
 * new version (so the far records' cells read newer), each after the kept
 * record's own links on its side. Answers the value changes on the kept and
 * far records, and the far records whose link to the merged record ended.
 */
async function moveLinks(
  context: WriteContext,
  ids: { readonly keepId: string; readonly mergeId: string; readonly objectId: string },
  links: readonly LinkRow[],
  plan: LinkPlan,
  ends: ReadonlyMap<string, Ends>,
): Promise<{ readonly values: readonly ValueChange[]; readonly references: readonly ReferenceChange[] }> {
  const { tx, scope } = context;
  const { keepId, mergeId, objectId } = ids;
  const keep = sql`${keepId}::uuid`;
  const merge = sql`${mergeId}::uuid`;
  await tx.execute(sql`
    update record_links set from_record_id = ${keep}
    where from_record_id = ${merge} and active_until is not null and to_record_id <> ${keep}
  `);
  await tx.execute(sql`
    update record_links set to_record_id = ${keep}
    where to_record_id = ${merge} and active_until is not null and from_record_id <> ${keep}
  `);
  const by = actorRow(scope.actor);
  if (plan.end.length > 0) {
    await tx.execute(sql`
      update record_links set active_until = greatest(clock_timestamp(), active_from + interval '1 microsecond'),
        ended_by_type = ${by.type}::actor_type, ended_by_id = ${by.id}::uuid, ended_by_member_id = ${by.memberId}::uuid
      where id = any(${uuidList(plan.end)})
    `);
  }
  const version = newId();
  if (plan.repointFrom.length > 0) {
    await tx.execute(sql`
      with top as (
        select relationship_id, max(position) as top from record_links
        where from_record_id = ${keep} and active_until is null group by relationship_id
      ), moving as (
        select id, relationship_id, row_number() over (partition by relationship_id order by position, id) as n
        from record_links where id = any(${uuidList(plan.repointFrom)})
      )
      update record_links l set from_record_id = ${keep}, version_id = ${version}::uuid,
        position = coalesce(top.top, -1) + moving.n
      from moving left join top on top.relationship_id = moving.relationship_id
      where l.id = moving.id
    `);
  }
  if (plan.repointTo.length > 0) {
    await tx.execute(sql`
      with top as (
        select relationship_id, max(to_position) as top from record_links
        where to_record_id = ${keep} and active_until is null group by relationship_id
      ), moving as (
        select id, relationship_id, row_number() over (partition by relationship_id order by to_position, id) as n
        from record_links where id = any(${uuidList(plan.repointTo)})
      )
      update record_links l set to_record_id = ${keep}, version_id = ${version}::uuid,
        to_position = coalesce(top.top, -1) + moving.n
      from moving left join top on top.relationship_id = moving.relationship_id
      where l.id = moving.id
    `);
  }
  // What screens read again: the kept record's sides that changed, and every far record's side.
  const byId = new Map(links.map((link) => [link.id, link]));
  const values = new Map<string, ValueChange>();
  const references = new Map<string, ReferenceChange>();
  const note = (ownerId: string, owner: string, attributeId: string | null) => {
    if (attributeId === null) return;
    values.set(`${ownerId}:${attributeId}`, {
      ownerId,
      ownerKind: 'record',
      objectId: owner,
      attributeId,
      versionId: version,
    });
  };
  for (const [ids_, isFrom] of [
    [plan.repointFrom, true],
    [plan.repointTo, false],
  ] as const) {
    for (const id of ids_) {
      const link = byId.get(id);
      const rel = link === undefined ? undefined : ends.get(link.relationshipId);
      if (link === undefined || rel === undefined) continue;
      note(keepId, objectId, isFrom ? rel.fromAttributeId : rel.toAttributeId);
      if (isFrom) note(link.toId, link.toObjectId, rel.toAttributeId);
      else note(link.fromId, link.fromObjectId, rel.fromAttributeId);
    }
  }
  for (const id of plan.end) {
    const link = byId.get(id);
    const rel = link === undefined ? undefined : ends.get(link.relationshipId);
    if (link === undefined || rel === undefined) continue;
    // A kept link a pick replaced: the kept side changed under the new version.
    if (link.fromId === keepId) note(keepId, objectId, rel.fromAttributeId);
    else if (link.toId === keepId && link.fromId !== mergeId) note(keepId, objectId, rel.toAttributeId);
    const far =
      link.fromId === mergeId
        ? { id: link.toId, objectId: link.toObjectId, attributeId: rel.toAttributeId }
        : { id: link.fromId, objectId: link.fromObjectId, attributeId: rel.fromAttributeId };
    if (far.attributeId !== null && far.id !== keepId && far.id !== mergeId) {
      references.set(`${far.id}:${far.attributeId}`, {
        recordId: far.id,
        objectId: far.objectId,
        attributeId: far.attributeId,
      });
    }
  }
  return { values: [...values.values()], references: [...references.values()] };
}

/**
 * Moves the merged record's live entries (AC-4913): to the kept record,
 * except in a list that holds a record once where the kept record is too:
 * there the kept entry takes each value it lacks, and the merged one is
 * removed (its unique values held, its keys hidden, its slot given back). A
 * moved entry's sort keys are rebuilt under its new record (`sort_keys_entry`
 * names the record with the entry).
 */
async function moveEntries(
  context: WriteContext,
  ids: { readonly keepId: string; readonly mergeId: string; readonly objectId: string },
): Promise<{ readonly changedEntries: readonly EntryRef[]; readonly removedEntries: readonly EntryRef[] }> {
  const { tx, scope } = context;
  const { keepId, mergeId, objectId } = ids;
  // Lists added since `lockLists` read them are locked here (rare: an entry made between the two reads).
  await lockLists(tx, [mergeId]);
  const found = await tx.execute<{ id: string; list_id: string; record_id: string; once: boolean }>(sql`
    select e.id::text, e.list_id::text, e.record_id::text, not l.allows_duplicates as once
    from list_entries e join lists l on l.workspace_id = e.workspace_id and l.id = e.list_id
    where e.record_id = any(${uuidList([keepId, mergeId])}) and e.deleted_at is null
    order by e.id
  `);
  const keptIn = new Map<string, string>();
  for (const row of found.rows)
    if (row.record_id === keepId && !keptIn.has(row.list_id)) keptIn.set(row.list_id, row.id);
  const moving: string[] = [];
  const changedEntries: EntryRef[] = [];
  const removedEntries: EntryRef[] = [];
  const by = actorRow(scope.actor);
  for (const row of found.rows) {
    if (row.record_id !== mergeId) continue;
    const kept = keptIn.get(row.list_id);
    if (!row.once || kept === undefined) {
      moving.push(row.id);
      changedEntries.push({ entryId: row.id, listId: row.list_id, recordId: keepId, objectId });
      continue;
    }
    // Once per list, and both are in it: the kept entry fills what it lacks from the merged one, which leaves.
    const attributes = [...(await loadListAttributes(tx, row.list_id)).values()].filter(
      (attribute) =>
        attribute.systemColumn === null && !isArchivedNow(attribute) && attribute.type !== 'record_reference',
    );
    const held = await itemsByOwner(tx, [kept, row.id]);
    const keptItems = held.get(kept) ?? new Map<string, readonly ItemColumns[]>();
    const mergedItems = held.get(row.id) ?? new Map<string, readonly ItemColumns[]>();
    const fills = attributes.filter(
      (attribute) =>
        (keptItems.get(attribute.id) ?? []).length === 0 && (mergedItems.get(attribute.id) ?? []).length > 0,
    );
    await tx.execute(sql`
      update list_entries set deleted_at = clock_timestamp(), deleted_by_type = ${by.type}::actor_type,
        deleted_by_id = ${by.id}::uuid, deleted_by_member_id = ${by.memberId}::uuid
      where id = ${row.id}::uuid
    `);
    await holdUniqueKeys(tx, [row.id]);
    await setEntryKeysLive(tx, row.id, false);
    await tx.execute(sql`update lists set entry_count = entry_count - 1 where id = ${row.list_id}::uuid`);
    removedEntries.push({ entryId: row.id, listId: row.list_id, recordId: mergeId, objectId });
    if (fills.length > 0) {
      await holdDefinitions(tx, fills)();
      const changes: ValueChange[] = [];
      for (const attribute of fills) {
        changes.push(
          await putItems(
            context,
            { kind: 'entry', listId: row.list_id },
            kept,
            attribute,
            mergedItems.get(attribute.id) ?? [],
          ),
        );
      }
      await touchOwner(context, 'entry', kept);
      context.record({ values: changes });
      changedEntries.push({ entryId: kept, listId: row.list_id, recordId: keepId, objectId });
    }
  }
  if (moving.length > 0) {
    const list = uuidList(moving);
    await tx.execute(sql`delete from sort_keys where entry_id = any(${list})`);
    await tx.execute(sql`update list_entries set record_id = ${keepId}::uuid where id = any(${list})`);
    await tx.execute(sql`
      insert into sort_keys (workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key,
        code_key, date_key, time_key, option_id, bool_key)
      select workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key,
        time_key, option_id, bool_key
      from sort_key_sources where owner_id = any(${list})
    `);
  }
  return { changedEntries, removedEntries };
}

/**
 * Moves everything else that names the merged record onto the kept one
 * (AC-4913), each through its record index. Where the kept record already
 * has the row a key allows once (a task, meeting or submission linked to
 * both, a live routing assignment in the same rotation, a recent visit), the
 * merged record's row is dropped instead. Answers the changes the hooks name.
 */
async function moveAttached(
  context: WriteContext,
  ids: { readonly keepId: string; readonly mergeId: string; readonly objectId: string },
): Promise<{
  readonly notes: readonly NoteChange[];
  readonly comments: readonly CommentChange[];
  readonly tasks: readonly TaskChange[];
  readonly meetings: readonly MeetingChange[];
  readonly notifications: readonly string[];
}> {
  const { tx } = context;
  const { keepId, mergeId, objectId } = ids;
  const keep = sql`${keepId}::uuid`;
  const merge = sql`${mergeId}::uuid`;
  const notes = await tx.execute<{ id: string }>(
    sql`update notes set record_id = ${keep} where record_id = ${merge} returning id::text`,
  );
  const comments = await tx.execute<{ thread_id: string }>(
    sql`update comments set record_id = ${keep} where record_id = ${merge} returning thread_id::text`,
  );
  const notified = await tx.execute<{ member_id: string }>(
    sql`update notifications set record_id = ${keep} where record_id = ${merge} returning member_id::text`,
  );
  // Rows keyed with their record: moved where the kept record lacks one, the rest dropped.
  const moveKeyed = async (table: string, key: string): Promise<readonly string[]> => {
    const name = sql.raw(table);
    const column = sql.raw(key);
    const movedRows = await tx.execute<{ key: string }>(sql`
      update ${name} m set record_id = ${keep}
      where m.record_id = ${merge}
        and not exists (select 1 from ${name} k where k.record_id = ${keep} and k.${column} = m.${column})
      returning m.${column}::text as key
    `);
    const dropped = await tx.execute<{ key: string }>(
      sql`delete from ${name} where record_id = ${merge} returning ${column}::text as key`,
    );
    return [...movedRows.rows, ...dropped.rows].map((row) => row.key);
  };
  const tasks = await moveKeyed('task_records', 'task_id');
  const meetings = await moveKeyed('meeting_records', 'meeting_id');
  await tx.execute(sql`
    update form_submission_records m set record_id = ${keep}
    where m.record_id = ${merge} and not exists (
      select 1 from form_submission_records k
      where k.record_id = ${keep} and k.submission_id = m.submission_id and k.role = m.role
    )
  `);
  await tx.execute(sql`delete from form_submission_records where record_id = ${merge}`);
  await tx.execute(sql`update meeting_attendees set person_record_id = ${keep} where person_record_id = ${merge}`);
  await tx.execute(sql`update form_submissions set main_record_id = ${keep} where main_record_id = ${merge}`);
  await tx.execute(sql`update bookings set person_record_id = ${keep} where person_record_id = ${merge}`);
  await tx.execute(sql`update bookings set company_record_id = ${keep} where company_record_id = ${merge}`);
  await tx.execute(sql`update bookings set deal_record_id = ${keep} where deal_record_id = ${merge}`);
  // A live assignment moves unless the kept record holds one in that rotation; voided ones stay as history.
  await tx.execute(sql`
    update rotation_assignments m set record_id = ${keep}
    where m.record_id = ${merge} and m.voided_at is null and not exists (
      select 1 from rotation_assignments k
      where k.record_id = ${keep} and k.rotation_id = m.rotation_id and k.voided_at is null
    )
  `);
  // The files its cells hold: the kept record's now, so a file a moved value names stays downloadable.
  await tx.execute(sql`update record_files set record_id = ${keep} where record_id = ${merge}`);
  // Recent visits: the merged record's become the kept record's, once per member.
  await tx.execute(sql`
    update member_recents m set target_id = ${keep}
    where m.kind = 'record' and m.target_id = ${merge} and not exists (
      select 1 from member_recents k where k.member_id = m.member_id and k.kind = 'record' and k.target_id = ${keep}
    )
  `);
  await tx.execute(sql`delete from member_recents where kind = 'record' and target_id = ${merge}`);
  return {
    notes: notes.rows.map((row) => ({ noteId: row.id, recordId: keepId, objectId })),
    comments: [...new Set(comments.rows.map((row) => row.thread_id))].map((threadId) => ({
      threadId,
      recordId: keepId,
      objectId,
    })),
    tasks: [...new Set(tasks)].map((taskId) => ({ taskId, recordIds: [mergeId, keepId] })),
    meetings: [...new Set(meetings)].map((meetingId) => ({ meetingId, recordIds: [mergeId, keepId] })),
    notifications: [...new Set(notified.rows.map((row) => row.member_id))],
  };
}
