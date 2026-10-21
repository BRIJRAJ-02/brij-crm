// The command menu's search (spec 0039): every readable object's live
// records by name, email and domain, and the views the caller sees, in one
// read. Each step is one statement however many objects the workspace has:
// one or two characters seek a bounded range of the stored name keys; three
// or more ask `crm_search_text` about every searched attribute at once; four
// or more, when few matched, ask `crm_search_similar` for close names (a
// typo), inside a savepoint with its own short timeout, so a slow typo step
// answers the exact matches instead of an error. The ids each step returns
// are ranked in a statement that keeps only live records of readable objects
// inside their record rules, so nothing hidden is ever ranked or shown.
// Hidden attributes are never searched (AC-1090). Text never reaches SQL as
// text: it goes in as parameters, and contains and similarity go through the
// search functions, which treat it as data.
import { isNull, sql, type SQL } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { GlobalSearchResults, RecordHit, SearchMatch, ViewHit } from '@crm/contracts';
import { MAX_GLOBAL_QUERY, MAX_GLOBAL_RECORDS } from '@crm/contracts';
import { isUuid, uuidArray, uuidList } from '../engine/ids.ts';
import { searchedAttributes } from '../engine/record-search.ts';
import { readRecords } from '../engine/records.ts';
import { postgresError, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isArchivedNow, loadAttributesOfObjects, type AttributeDef } from '../engine/values.ts';
import { isAborted, withCancel } from '../engine/query/cancel.ts';
import { objectLevel } from '../access/policy.ts';
import { attributeVisible, farVisibleSql } from '../access/visibility.ts';
import { memberOf } from '../views/views.ts';

const { objects } = schema;

/** The most views one search answers (AC-1081). */
export const MAX_GLOBAL_VIEWS = 8;
/** The most ids each searched attribute asks `crm_search_text` for. */
const CONTAINS_CANDIDATES = 200;
/** The most ids the typo step asks `crm_search_similar` for. */
const SIMILAR_CANDIDATES = 50;
/** How long a search's statements may run, and the typo step's own budget (AC-1094). */
const SEARCH_TIMEOUT = '3s';
const SIMILAR_TIMEOUT = '300ms';

/** What the command menu asks: what is typed, and how many records at most. */
export interface GlobalSearchInput {
  readonly query: string;
  readonly limit?: number;
}

/** A readable live object and what a search reads of it: its name attribute and the attributes it searches. */
export interface SearchedObject {
  readonly id: string;
  /** Its name attribute, when the reader may see it. */
  readonly primary: AttributeDef | undefined;
  /** The name, then up to two email or domain attributes, all visible to the reader. */
  readonly searched: readonly AttributeDef[];
  /** Every attribute of the object, so reading the hits' names loads nothing again. */
  readonly attributes: ReadonlyMap<string, AttributeDef>;
}

/**
 * The live objects the reader may read, each with the attributes a search
 * may look at (spec 0014's `searchedAttributes`): two statements, whatever
 * the number of objects.
 */
export async function searchedObjects(tx: WorkspaceTx, scope: EngineScope): Promise<readonly SearchedObject[]> {
  const rows = await tx
    .select({ id: objects.id, primaryAttributeId: objects.primaryAttributeId, position: objects.position })
    .from(objects)
    .where(isNull(objects.archivedAt));
  const readable = rows
    .filter((row) => objectLevel(scope.access, row.id) !== 'none')
    .sort((a, b) => a.position - b.position);
  const attributes = await loadAttributesOfObjects(
    tx,
    readable.map((row) => row.id),
  );
  return readable.map((row) => {
    const own = attributes.get(row.id) ?? new Map<string, AttributeDef>();
    const named = row.primaryAttributeId === null ? undefined : own.get(row.primaryAttributeId);
    const primary =
      named !== undefined && !isArchivedNow(named) && attributeVisible(scope.access, named) ? named : undefined;
    return { id: row.id, primary, searched: searchedAttributes(scope, primary, own), attributes: own };
  });
}

/** Which search runs for a query (AC-1078): none when blank, a name prefix for 1 or 2 characters, else contains. */
export function globalSearchMode(query: string): 'none' | 'prefix' | 'contains' {
  const length = query.trim().length;
  if (length === 0) return 'none';
  return length < 3 ? 'prefix' : 'contains';
}

/**
 * Whether the typo step runs (AC-1078): 4 or more characters, a run of 3
 * letters or digits (a trigram to look up), and fewer exact matches than
 * the search answers (`limit`, 20 by default).
 */
export function wantsSimilar(query: string, exact: number, limit: number = MAX_GLOBAL_RECORDS): boolean {
  const text = query.trim();
  return text.length >= 4 && /[\p{L}\p{N}]{3}/u.test(text) && exact < limit;
}

/** One ranked record id and how it matched. */
interface Ranked {
  readonly id: string;
  readonly match: SearchMatch;
}

/** The condition that keeps a record (aliased `r`) only on a readable object and inside its record rule. */
function readableSql(scope: EngineScope, objectIds: readonly string[]): SQL {
  const rule = farVisibleSql(scope.access, objectIds, 'r');
  return rule === undefined
    ? sql`r.object_id = any(${uuidArray(objectIds)})`
    : sql`r.object_id = any(${uuidArray(objectIds)}) and ${rule}`;
}

/** The 1 or 2 character path: each object's names starting with the text, from the stored keys, in one statement. */
async function prefixIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  searched: readonly SearchedObject[],
  text: string,
  limit: number,
): Promise<readonly Ranked[]> {
  const named = searched.flatMap((object) =>
    object.primary === undefined ? [] : [{ id: object.id, primary: object.primary }],
  );
  if (named.length === 0) return [];
  // One bounded range per object's name key (spec 0014's), each joined to its live records inside its rule.
  const parts = named.map((object) => {
    const rule = farVisibleSql(scope.access, [object.id], 'r');
    return sql`(select k.record_id as id, k.text_key as key from sort_keys k
      join records r on r.workspace_id = k.workspace_id and r.id = k.record_id
        and r.object_id = ${object.id}::uuid and r.deleted_at is null${rule === undefined ? sql`` : sql` and ${rule}`}
      where k.attribute_id = ${object.primary.id}::uuid and k.live and k.text_key is not null
        and k.text_key >= (lower(${text}) collate "und-x-icu")
        and k.text_key < ((lower(${text}) || U&'\\FFFF') collate "und-x-icu")
      order by k.text_key, k.owner_id
      limit ${limit})`;
  });
  const rows = await tx.execute<{ id: string }>(sql`
    select x.id::text as id from (${sql.join(parts, sql` union all `)}) x
    order by x.key, x.id
    limit ${limit}
  `);
  return rows.rows.map((row) => ({ id: row.id, match: 'prefix' }));
}

/**
 * Ranks candidate ids (AC-1079): live records of readable objects inside
 * their rules, names starting with the text first, then a word starting with
 * it, then the rest, each by name. `similar` ranks by closeness instead.
 */
async function rankIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  searched: readonly SearchedObject[],
  candidates: readonly string[],
  text: string,
  limit: number,
  similar: boolean,
): Promise<readonly Ranked[]> {
  if (candidates.length === 0 || limit <= 0) return [];
  const objectIds = searched.map((object) => object.id);
  const primaryIds = searched.flatMap((object) => (object.primary === undefined ? [] : [object.primary.id]));
  const lowered = sql`lower(${text})`;
  // The name key: at most one per record, since each name attribute belongs to one object.
  const order = similar
    ? sql`public.word_similarity(${lowered}, coalesce(k.text_key, '')) desc, k.text_key nulls last, r.id`
    : sql`case when starts_with(k.text_key, ${lowered}) then 0
        when strpos(k.text_key, ' ' || ${lowered}) > 0 then 1 else 2 end, k.text_key nulls last, r.id`;
  const rows = await tx.execute<{ id: string; rank: number }>(sql`
    select r.id::text as id,
      case when starts_with(k.text_key, ${lowered}) then 0
        when strpos(k.text_key, ' ' || ${lowered}) > 0 then 1 else 2 end as rank
    from records r
    left join sort_keys k on k.workspace_id = r.workspace_id and k.owner_id = r.id
      and k.attribute_id = any(${uuidArray(primaryIds)})
    where r.id = any(${uuidList([...candidates])}) and r.deleted_at is null and ${readableSql(scope, objectIds)}
    order by ${order}
    limit ${limit}
  `);
  return rows.rows.map((row) => ({
    id: row.id,
    match: similar ? 'similar' : row.rank === 0 ? 'prefix' : row.rank === 1 ? 'word' : 'contains',
  }));
}

/** The 3+ character path: every searched attribute through `crm_search_text` in one statement, then ranked. */
async function containsIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  searched: readonly SearchedObject[],
  text: string,
  limit: number,
): Promise<readonly Ranked[]> {
  const attributeIds = searched.flatMap((object) => object.searched.map((attribute) => attribute.id));
  if (attributeIds.length === 0) return [];
  const found = await tx.execute<{ id: string }>(sql`
    select distinct s.id::text as id
    from unnest(${uuidArray(attributeIds)}) a(id), lateral crm_search_text(a.id, ${text}, ${CONTAINS_CANDIDATES}::int) s(id)
  `);
  return rankIds(
    tx,
    scope,
    searched,
    found.rows.map((row) => row.id),
    text,
    limit,
    false,
  );
}

/**
 * The typo step (AC-1078, AC-1094): close names through `crm_search_similar`,
 * inside a savepoint with its own timeout. Past it, the savepoint rolls back
 * and the step answers nothing, so the search still answers its exact matches.
 */
async function similarIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  searched: readonly SearchedObject[],
  text: string,
  limit: number,
  skip: ReadonlySet<string>,
): Promise<readonly Ranked[]> {
  const primaryIds = searched.flatMap((object) => (object.primary === undefined ? [] : [object.primary.id]));
  if (primaryIds.length === 0 || limit <= 0) return [];
  await tx.execute(sql`savepoint crm_search_similar`);
  let ids: readonly string[];
  try {
    await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${SIMILAR_TIMEOUT}'`)}`);
    const found = await tx.execute<{ id: string }>(sql`
      select distinct s.id::text as id
      from crm_search_similar(${uuidArray(primaryIds)}, ${text}, ${SIMILAR_CANDIDATES}::int) s(id)
    `);
    ids = found.rows.map((row) => row.id).filter((id) => !skip.has(id));
    await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${SEARCH_TIMEOUT}'`)}`);
    await tx.execute(sql`release savepoint crm_search_similar`);
  } catch (error) {
    if (postgresError(error)?.code !== '57014') throw error;
    // Rolling back to the savepoint also restores the search's own timeout, which `set local` changed after it.
    await tx.execute(sql`rollback to savepoint crm_search_similar`);
    return [];
  }
  return rankIds(tx, scope, searched, ids, text, limit, true);
}

/**
 * Each record's first email or domain the reader may see (the row's second
 * line, AC-1080), in one statement over the current values at position 0.
 */
async function detailsOf(
  tx: WorkspaceTx,
  searched: readonly SearchedObject[],
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const detailIds = searched.flatMap((object) =>
    object.searched.filter((attribute) => attribute.id !== object.primary?.id).map((attribute) => attribute.id),
  );
  if (ids.length === 0 || detailIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; text: string }>(sql`
    select distinct on (v.owner_id) v.owner_id::text as id, v.text_value as text
    from "values" v
    where v.owner_id = any(${uuidList([...ids])}) and v.attribute_id = any(${uuidArray(detailIds)})
      and v.active_until is null and not v.is_cleared and v.position = 0 and v.text_value is not null
    order by v.owner_id, array_position(${uuidArray(detailIds)}, v.attribute_id)
  `);
  return new Map(rows.rows.map((row) => [row.id, row.text]));
}

/**
 * The views the caller sees whose name contains the text (AC-1081): on
 * readable live objects, shared or their own private ones, default views
 * first, then by name.
 */
export async function findViews(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectIds: readonly string[],
  where: { readonly text: string } | { readonly ids: readonly string[] },
  limit: number,
): Promise<readonly ViewHit[]> {
  if (objectIds.length === 0) return [];
  const caller = memberOf(scope);
  const sees =
    caller === undefined
      ? sql`v.visibility = 'workspace'`
      : sql`(v.visibility = 'workspace' or v.creator_member_id = ${caller}::uuid)`;
  const matches =
    'text' in where
      ? sql`strpos(lower(v.name), lower(${where.text})) > 0`
      : where.ids.length === 0
        ? sql`false`
        : sql`v.id = any(${uuidList([...where.ids])})`;
  const rows = await tx.execute<{
    id: string;
    object_id: string;
    name: string;
    kind: 'table' | 'board';
    is_default: boolean;
  }>(sql`
    select v.id::text as id, v.object_id::text as object_id, v.name, v.kind::text as kind,
      coalesce(o.default_view_id = v.id, false) as is_default
    from views v
    join objects o on o.workspace_id = v.workspace_id and o.id = v.object_id and o.archived_at is null
    where v.object_id = any(${uuidArray(objectIds)}) and ${sees} and ${matches}
    order by is_default desc, lower(v.name), v.id
    limit ${limit}
  `);
  return rows.rows.map((row) => ({
    id: row.id,
    objectId: row.object_id,
    name: row.name,
    kind: row.kind,
    isDefault: row.is_default,
  }));
}

/**
 * Searches the workspace for the command menu (spec 0039, AC-1077 to
 * AC-1084, AC-1089, AC-1090, AC-1094): see the file's opening. Aborting
 * `signal` (the request's) cancels it; a statement past its time answers
 * `QUERY_CANCELLED`. Results are displays, never record bodies.
 */
export async function searchWorkspace(
  scope: EngineScope,
  input: GlobalSearchInput,
  signal?: AbortSignal,
): Promise<GlobalSearchResults> {
  const text = input.query.slice(0, MAX_GLOBAL_QUERY).trim();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? MAX_GLOBAL_RECORDS), 1), MAX_GLOBAL_RECORDS);
  const mode = globalSearchMode(text);
  if (mode === 'none') return { records: [], views: [] };
  const cancelled = () => refuse('QUERY_CANCELLED', 'That search took too long or was cancelled. Try again.');
  try {
    return await withCancel(scope, 'query', signal, cancelled, async (tx, checkpoint) => {
      await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${SEARCH_TIMEOUT}'`)}`);
      const searched = await searchedObjects(tx, scope);
      if (searched.length === 0) return { records: [], views: [] };
      const exact =
        mode === 'prefix'
          ? await prefixIds(tx, scope, searched, text, limit)
          : await containsIds(tx, scope, searched, text, limit);
      checkpoint();
      const close =
        mode === 'contains' && wantsSimilar(text, exact.length, limit)
          ? await similarIds(tx, scope, searched, text, limit - exact.length, new Set(exact.map((hit) => hit.id)))
          : [];
      checkpoint();
      const ranked = [...exact, ...close];
      const ids = ranked.map((hit) => hit.id).filter(isUuid);
      // Every id came from a statement that kept only live records the reader may see.
      const views = await readRecords(tx, scope.access, ids, {
        attributeIds: [],
        visibleAlready: true,
        attributes: new Map(searched.map((object) => [object.id, object.attributes])),
      });
      const display = new Map(views.map((view) => [view.id, view.display]));
      const details = await detailsOf(tx, searched, ids);
      const records = ranked.flatMap((hit): RecordHit[] => {
        const ref = display.get(hit.id);
        if (ref === undefined) return [];
        const detail = details.get(hit.id);
        return [{ ref, match: hit.match, ...(detail === undefined ? {} : { detail }) }];
      });
      const foundViews = await findViews(
        tx,
        scope,
        searched.map((object) => object.id),
        { text },
        MAX_GLOBAL_VIEWS,
      );
      return { records, views: [...foundViews] };
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
