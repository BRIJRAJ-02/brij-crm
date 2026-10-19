// The record picker's search (spec 0014, `searchRecords`): one object's live
// records the reader may see, by what is typed. Nothing typed lists the 20
// most recently updated; one or two characters seek a bounded range of the
// stored name key; three or more ask the search function about the name and
// the object's email and domain attributes. Each result says whether it is
// already linked from the record being edited and, when the far side holds
// one, which record holds it now. Text never reaches SQL as text: prefix keys
// are parameters, and contains goes through `crm_search_text`.
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { RecordRefDisplay } from '@crm/contracts/values';
import { canonicalId, isUuid, uuidList } from './ids.ts';
import { postgresError, refuse } from './refusals.ts';
import { endOf, relationshipOf } from './relationships.ts';
import { readRecords } from './records.ts';
import type { EngineScope } from './scope.ts';
import { isArchivedNow, loadAttributes, type AttributeDef } from './values.ts';
import { isAborted, withCancel } from './query/cancel.ts';
import { isOpen } from '../access/policy.ts';
import { attributeVisible, checkObject, recordRuleSql, UNKNOWN_OBJECT, visibleRecords } from '../access/visibility.ts';

const { objects } = schema;

/** The most results one search answers, and how many it answers when not told. */
export const SEARCH_LIMIT_MAX = 50;
export const SEARCH_LIMIT_DEFAULT = 20;
/** The longest query a search takes, in characters. */
export const SEARCH_QUERY_MAX = 200;
/** The most ids each contains term asks the search function for (spec 0014, `SEARCH_CANDIDATES`). */
export const SEARCH_CANDIDATES = 200;
/** How long a search's statements may run before it answers `QUERY_CANCELLED`. */
const SEARCH_TIMEOUT = '3s';

/** What the picker asks: an object, what is typed, and the side being edited (for `linked` and `takenBy`). */
export interface SearchInput {
  readonly objectId: string;
  readonly query: string;
  readonly limit?: number;
  /** The record reference attribute being edited, on `forRecordId`'s object. */
  readonly forAttributeId?: string;
  /** The record being edited. */
  readonly forRecordId?: string;
}

/** One result: the record as a chip shows it, whether it is linked already, and who holds it on a far side of one. */
export interface SearchResult {
  readonly ref: RecordRefDisplay;
  readonly linked: boolean;
  /** The record holding it now on the paired side ("At Acme"), or `{ hidden: true }` when the reader can't see it. */
  readonly takenBy?: RecordRefDisplay | { readonly hidden: true };
}

/** Which search runs for a query: recent with nothing typed, a prefix range for one or two characters, else contains. */
export function searchMode(query: string): 'recent' | 'prefix' | 'contains' {
  const length = query.trim().length;
  if (length === 0) return 'recent';
  return length < 3 ? 'prefix' : 'contains';
}

/** The object's live attributes a contains term may search: its name, and its email and domain attributes (3 at most). */
function searchedAttributes(
  scope: EngineScope,
  primary: AttributeDef | undefined,
  attributes: ReadonlyMap<string, AttributeDef>,
): readonly AttributeDef[] {
  const others = [...attributes.values()]
    .filter(
      (attribute) =>
        (attribute.type === 'email' || attribute.type === 'domain') &&
        !attribute.isSystem &&
        !isArchivedNow(attribute) &&
        attribute.id !== primary?.id,
    )
    .sort((a, b) => a.position - b.position);
  return [...(primary === undefined ? [] : [primary]), ...others]
    .filter((attribute) => attributeVisible(scope.access, attribute))
    .slice(0, 3);
}

/** Ids in order: the 20 (or `limit`) the mode finds among the object's live records the reader may see. */
async function findIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  query: string,
  limit: number,
  primary: AttributeDef | undefined,
  attributes: ReadonlyMap<string, AttributeDef>,
): Promise<readonly string[]> {
  const rule = recordRuleSql(scope.access, objectId, 'r');
  const ruled = rule === undefined ? sql`` : sql` and ${rule}`;
  const mode = searchMode(query);
  const text = query.trim();
  if (mode === 'recent') {
    // The `records_updated` index, read backwards.
    const rows = await tx.execute<{ id: string }>(sql`
      select r.id::text as id from records r
      where r.object_id = ${objectId}::uuid and r.deleted_at is null${ruled}
      order by r.updated_at desc, r.id desc
      limit ${limit}
    `);
    return rows.rows.map((row) => row.id);
  }
  // A name the reader can't see is never searched: that would say what it holds (spec 0009, AC-144).
  const named = primary !== undefined && attributeVisible(scope.access, primary) ? primary : undefined;
  if (mode === 'prefix') {
    if (named === undefined) return [];
    // A bounded range on `sort_keys_text`: from the lowercased text to the text followed by the collation's last
    // character, so the scan starts and stops inside the range (verified with explain, spec 0014 verify.md).
    const rows = await tx.execute<{ id: string }>(sql`
      select k.record_id::text as id from sort_keys k
      join records r on r.workspace_id = k.workspace_id and r.id = k.record_id
        and r.object_id = ${objectId}::uuid and r.deleted_at is null${ruled}
      where k.attribute_id = ${named.id}::uuid and k.live and k.text_key is not null
        and k.text_key >= (lower(${text}) collate "und-x-icu")
        and k.text_key < ((lower(${text}) || U&'\\FFFF') collate "und-x-icu")
      order by k.text_key, k.owner_id
      limit ${limit}
    `);
    return rows.rows.map((row) => row.id);
  }
  const searched = searchedAttributes(scope, named, attributes);
  if (searched.length === 0) return [];
  const candidates = new Set<string>();
  for (const attribute of searched) {
    const found = await tx.execute<{ id: string }>(sql`
      select id::text as id from crm_search_text(${attribute.id}::uuid, ${text}, ${SEARCH_CANDIDATES}::int) as id
    `);
    for (const row of found.rows) candidates.add(row.id);
  }
  if (candidates.size === 0) return [];
  // Live records of this object the reader may see; names that start with the text first, then by name.
  const nameKey: SQL =
    named === undefined
      ? sql`null::text`
      : sql`(select k.text_key from sort_keys k where k.owner_id = r.id and k.attribute_id = ${named.id}::uuid)`;
  const rows = await tx.execute<{ id: string }>(sql`
    select r.id::text as id from records r
    where r.id = any(${uuidList([...candidates])}) and r.object_id = ${objectId}::uuid and r.deleted_at is null${ruled}
    order by coalesce(starts_with(${nameKey}, lower(${text})), false) desc, ${nameKey} nulls last, r.id
    limit ${limit}
  `);
  return rows.rows.map((row) => row.id);
}

/**
 * Each result's state against the side being edited: `linked` from
 * `forRecordId` through `forAttributeId`, and for a side whose far records
 * hold one, the record holding each result now (live, other than
 * `forRecordId`). Nothing when the side isn't given, isn't a record
 * reference to this object, is hidden from the reader or is effectively
 * archived (AC-308), or the record isn't one the reader may see.
 */
async function sideStates(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  ids: readonly string[],
  input: SearchInput,
): Promise<{
  readonly linked: ReadonlySet<string>;
  readonly holders: ReadonlyMap<string, { readonly holderId: string; readonly holderObjectId: string }>;
}> {
  const none = { linked: new Set<string>(), holders: new Map() };
  if (ids.length === 0 || input.forAttributeId === undefined || !isUuid(input.forAttributeId)) return none;
  const attributeId = canonicalId(input.forAttributeId);
  const [owner] = await tx
    .execute<{ object_id: string }>(
      sql`select object_id::text as object_id from attributes where id = ${attributeId}::uuid and object_id is not null`,
    )
    .then((result) => result.rows);
  if (owner === undefined) return none;
  const attribute = (await loadAttributes(tx, owner.object_id)).get(attributeId);
  if (
    attribute === undefined ||
    attribute.type !== 'record_reference' ||
    isArchivedNow(attribute) ||
    !attributeVisible(scope.access, attribute)
  ) {
    return none;
  }
  const relationship = await relationshipOf(tx, attribute);
  const end = endOf(relationship, attribute.id);
  if (!end.allowed.includes(objectId)) return none;
  const forRecordId =
    input.forRecordId !== undefined && isUuid(input.forRecordId) ? canonicalId(input.forRecordId) : undefined;
  // The record being edited counts only when the reader may see it.
  const seen =
    forRecordId === undefined
      ? new Set<string>()
      : await visibleRecords(tx, scope.access, [{ objectId: owner.object_id, recordId: forRecordId }]);
  const mine = forRecordId !== undefined && seen.has(forRecordId) ? forRecordId : undefined;
  const { mine: mineColumn, far: farColumn } = end.isFrom
    ? { mine: sql.raw('k.from_record_id'), far: sql.raw('k.to_record_id') }
    : { mine: sql.raw('k.to_record_id'), far: sql.raw('k.from_record_id') };
  const linked =
    mine === undefined
      ? new Set<string>()
      : new Set(
          (
            await tx.execute<{ far: string }>(sql`
              select ${farColumn}::text as far from record_links k
              where k.relationship_id = ${relationship.id}::uuid and ${mineColumn} = ${mine}::uuid
                and k.active_until is null and ${farColumn} = any(${uuidList(ids)})
            `)
          ).rows.map((row) => row.far),
        );
  if (!end.farSingle) return { linked, holders: new Map() };
  // Who holds each result on this side now: a live record other than the one being edited (a trashed one gives way).
  const held = await tx.execute<{ far: string; holder: string; holder_object: string }>(sql`
    select ${farColumn}::text as far, h.id::text as holder, h.object_id::text as holder_object
    from record_links k
    join records h on h.workspace_id = k.workspace_id and h.id = ${mineColumn} and h.deleted_at is null
    where k.relationship_id = ${relationship.id}::uuid and k.active_until is null
      and ${farColumn} = any(${uuidList(ids)})${mine === undefined ? sql`` : sql` and ${mineColumn} <> ${mine}::uuid`}
  `);
  return {
    linked,
    holders: new Map(
      held.rows.map((row) => [row.far, { holderId: row.holder, holderObjectId: row.holder_object }] as const),
    ),
  };
}

/**
 * Searches one object's live records the reader may see (spec 0014,
 * AC-289, AC-292, AC-304, AC-308): see the file's opening. An object that is
 * unknown, hidden from the reader or archived answers `NOT_FOUND`. Aborting
 * `signal` (the request's) cancels it; a statement past its time answers
 * `QUERY_CANCELLED`. Results are displays, never record bodies.
 */
export async function searchRecords(
  scope: EngineScope,
  input: SearchInput,
  signal?: AbortSignal,
): Promise<readonly SearchResult[]> {
  if (!isUuid(input.objectId)) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
  const objectId = canonicalId(input.objectId);
  const query = input.query.slice(0, SEARCH_QUERY_MAX);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? SEARCH_LIMIT_DEFAULT), 1), SEARCH_LIMIT_MAX);
  const cancelled = () => refuse('QUERY_CANCELLED', 'That search took too long or was cancelled. Try again.');
  try {
    return await withCancel(scope, 'query', signal, cancelled, async (tx, checkpoint) => {
      await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${SEARCH_TIMEOUT}'`)}`);
      await checkObject(tx, scope.access, objectId, 'read');
      const [object] = await tx
        .select({ archivedAt: objects.archivedAt, primaryAttributeId: objects.primaryAttributeId })
        .from(objects)
        .where(and(eq(objects.id, objectId)));
      if (object === undefined) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
      if (object.archivedAt !== null) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
      const attributes = await loadAttributes(tx, objectId);
      const primary = object.primaryAttributeId === null ? undefined : attributes.get(object.primaryAttributeId);
      const ids = await findIds(tx, scope, objectId, query, limit, primary, attributes);
      checkpoint();
      if (ids.length === 0) return [];
      const { linked, holders } = await sideStates(tx, scope, objectId, ids, input);
      // Every id came from a statement that kept only records the reader may see; holders are checked here.
      const holderRefs = [...holders.values()].map((holder) => ({
        objectId: holder.holderObjectId,
        recordId: holder.holderId,
      }));
      const visibleHolders = isOpen(scope.access)
        ? new Set(holderRefs.map((ref) => ref.recordId))
        : await visibleRecords(tx, scope.access, holderRefs);
      const shownHolders = [...visibleHolders];
      const views = await readRecords(tx, scope.access, [...new Set([...ids, ...shownHolders])], {
        attributeIds: [],
        visibleAlready: true,
      });
      const display = new Map(views.map((view) => [view.id, view.display]));
      return ids.flatMap((id): SearchResult[] => {
        const ref = display.get(id);
        if (ref === undefined) return [];
        const holder = holders.get(id);
        const holderDisplay = holder === undefined ? undefined : display.get(holder.holderId);
        const takenBy =
          holder === undefined
            ? undefined
            : visibleHolders.has(holder.holderId) && holderDisplay !== undefined
              ? holderDisplay
              : ({ hidden: true } as const);
        return [{ ref, linked: linked.has(id), ...(takenBy === undefined ? {} : { takenBy }) }];
      });
    });
  } catch (error) {
    if (postgresError(error)?.code === '57014') {
      throw isAborted(signal)
        ? cancelled()
        : refuse('QUERY_CANCELLED', 'That search took too long. Type a little more and try again.');
    }
    throw error;
  }
}
