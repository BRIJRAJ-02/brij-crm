// The command menu's search (spec 0039): every readable object's live
// records by name, email and domain, and the views the caller sees, in one
// read. The number of statements never grows with the number of objects, and
// it is the same whatever the reader may not see, so neither the answer nor
// its timing hints at a hidden record (AC-1089):
// - one or two characters: one statement seeks a bounded range of each
//   readable object's stored name keys, inside its record rule;
// - three or more: one statement gathers candidates (every searched attribute
//   through `crm_search_text`, plus the names starting with the text) and ranks
//   them, keeping only live records of readable objects inside their rules;
// - four or more, when fewer than the limit matched: close names (a typo)
//   through `crm_search_similar`, gathered and ranked the same way in one
//   statement, inside a savepoint with its own short timeout, so a slow typo
//   step answers the exact matches instead of an error (AC-1094).
// Hidden attributes are never searched (AC-1090). Text never reaches SQL as
// text: it goes in as parameters, and contains and similarity go through the
// search functions, which treat it as data.
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import type { GlobalSearchResults, RecordHit, SearchMatch, ViewHit } from '@crm/contracts';
import { MAX_GLOBAL_QUERY, MAX_GLOBAL_RECORDS } from '@crm/contracts';
import { isUuid, uuidArray, uuidList } from '../engine/ids.ts';
import { searchedAttributes } from '../engine/record-search.ts';
import { readRecords } from '../engine/records.ts';
import { postgresError, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isArchivedNow, loadSearchAttributes, type AttributeDef } from '../engine/values.ts';
import { isAborted, withCancel } from '../engine/query/cancel.ts';
import { objectLevel, recordRule } from '../access/policy.ts';
import { attributeVisible, farVisibleSql } from '../access/visibility.ts';
import { memberOf } from '../views/views.ts';

/** The most views one search answers (AC-1081). */
export const MAX_GLOBAL_VIEWS = 8;
/**
 * How many contains candidates one search gathers across every searched
 * attribute (shared out, 20 to 200 each), so the ranking's work has a ceiling
 * however many objects the workspace has.
 */
const CONTAINS_BUDGET = 1000;
/** An attribute of an object with a record rule asks for this many times its share: most of its matches are cut. */
const RULED_FACTOR = 4;
/** The most stored name keys each object's prefix range walks before the rule and liveness checks. */
const PREFIX_BUDGET = 500;
/** The most ids the typo step asks `crm_search_similar` for. */
const SIMILAR_CANDIDATES = 100;
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
  /** The attributes loaded for it (its name, emails and domains), so reading the hits' names loads nothing again. */
  readonly attributes: ReadonlyMap<string, AttributeDef>;
}

/**
 * The live objects the reader may read, in sidebar order, each with the
 * attributes a search may look at (spec 0014's `searchedAttributes`): two
 * statements, whatever the number of objects. The first also sets the
 * transaction's statement timeout, when one is given.
 */
export async function searchedObjects(
  tx: WorkspaceTx,
  scope: EngineScope,
  timeout?: string,
): Promise<readonly SearchedObject[]> {
  const set = timeout === undefined ? sql`` : sql`, set_config('statement_timeout', ${timeout}, true) as timeout`;
  const found = await tx.execute<{ id: string; primary_attribute_id: string | null }>(sql`
    select o.id::text as id, o.primary_attribute_id::text as primary_attribute_id${set}
    from objects o where o.archived_at is null
    order by o.position, o.id
  `);
  const readable = found.rows.filter((row) => objectLevel(scope.access, row.id) !== 'none');
  const attributes = await loadSearchAttributes(
    tx,
    readable.map((row) => row.id),
    readable.flatMap((row) => (row.primary_attribute_id === null ? [] : [row.primary_attribute_id])),
  );
  return readable.map((row) => {
    const own = attributes.get(row.id) ?? new Map<string, AttributeDef>();
    const named = row.primary_attribute_id === null ? undefined : own.get(row.primary_attribute_id);
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

/** The readable objects whose name the reader may see, with that name attribute. */
function named(searched: readonly SearchedObject[]): readonly { id: string; primary: AttributeDef }[] {
  return searched.flatMap((object) =>
    object.primary === undefined ? [] : [{ id: object.id, primary: object.primary }],
  );
}

/**
 * One subselect per named object: its live records inside its rule whose
 * stored name key starts with the text (a bounded range of `sort_keys_text`,
 * walking at most `PREFIX_BUDGET` keys), at most `limit` of them, as `(id, key)`.
 */
function prefixArms(scope: EngineScope, searched: readonly SearchedObject[], text: string, limit: number): SQL[] {
  return named(searched).map((object) => {
    const rule = farVisibleSql(scope.access, [object.id], 'r');
    return sql`(select k.record_id as id, k.text_key as key
      from (select s.record_id, s.text_key, s.workspace_id from sort_keys s
        where s.attribute_id = ${object.primary.id}::uuid and s.live and s.text_key is not null
          and s.text_key >= (lower(${text}) collate "und-x-icu")
          and s.text_key < ((lower(${text}) || U&'\\FFFF') collate "und-x-icu")
        order by s.text_key, s.owner_id
        limit ${PREFIX_BUDGET}) k
      join records r on r.workspace_id = k.workspace_id and r.id = k.record_id
        and r.object_id = ${object.id}::uuid and r.deleted_at is null${rule === undefined ? sql`` : sql` and ${rule}`}
      order by k.text_key, k.record_id
      limit ${limit})`;
  });
}

/** The 1 or 2 character path: each object's names starting with the text, in one statement. */
async function prefixIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  searched: readonly SearchedObject[],
  text: string,
  limit: number,
): Promise<readonly Ranked[]> {
  const parts = prefixArms(scope, searched, text, limit);
  if (parts.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`
    select x.id::text as id from (${sql.join(parts, sql` union all `)}) x
    order by x.key, x.id
    limit ${limit}
  `);
  return rows.rows.map((row) => ({ id: row.id, match: 'prefix' }));
}

/** The match a ranked row's rank number stands for (AC-1079). */
const MATCHES: readonly SearchMatch[] = ['prefix', 'word', 'contains'];

/**
 * Ranks the candidates a CTE named `c` (one column, `id`) gathers (AC-1079):
 * live records of readable objects inside their rules, names starting with
 * the text first, then a word starting with it, then the rest, each by name.
 * `similar` ranks by closeness instead, after leaving out `skip`.
 */
function rankSql(
  scope: EngineScope,
  searched: readonly SearchedObject[],
  candidates: SQL,
  text: string,
  limit: number,
  similar?: { readonly skip: readonly string[] },
): SQL {
  const objectIds = searched.map((object) => object.id);
  const primaryIds = named(searched).map((object) => object.primary.id);
  const lowered = sql`lower(${text})`;
  const rank = sql`case when starts_with(k.text_key, ${lowered}) then 0
    when strpos(k.text_key, ' ' || ${lowered}) > 0 then 1 else 2 end`;
  const order =
    similar === undefined
      ? sql`${rank}, k.text_key nulls last, r.id`
      : sql`public.word_similarity(${lowered}, coalesce(k.text_key, '')) desc, k.text_key nulls last, r.id`;
  const skip =
    similar === undefined || similar.skip.length === 0 ? sql`` : sql` and r.id <> all(${uuidList([...similar.skip])})`;
  // The name key: at most one per record, since each name attribute belongs to one object.
  return sql`
    with c as (${candidates})
    select r.id::text as id, ${rank} as rank
    from records r
    left join sort_keys k on k.workspace_id = r.workspace_id and k.owner_id = r.id
      and k.attribute_id = any(${uuidArray(primaryIds)})
    where r.id in (select c.id from c) and r.deleted_at is null and ${readableSql(scope, objectIds)}${skip}
    order by ${order}
    limit ${limit}
  `;
}

/**
 * The 3+ character path, in one statement: every searched attribute through
 * `crm_search_text` (its share of `CONTAINS_BUDGET`; more for an object with
 * a record rule, which cuts most of them) and the names starting with the
 * text, ranked.
 */
async function containsIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  searched: readonly SearchedObject[],
  text: string,
  limit: number,
): Promise<readonly Ranked[]> {
  const attributes = searched.flatMap((object) =>
    object.searched.map((attribute) => ({
      id: attribute.id,
      ruled: recordRule(scope.access, object.id) !== undefined,
    })),
  );
  if (attributes.length === 0) return [];
  const share = Math.min(Math.max(Math.ceil(CONTAINS_BUDGET / attributes.length), 20), 200);
  // Whole numbers made here, never input.
  const shares = attributes.map((attribute) => (attribute.ruled ? share * RULED_FACTOR : share));
  const arms = prefixArms(scope, searched, text, limit);
  const candidates = sql`select s.id from unnest(${uuidArray(attributes.map((attribute) => attribute.id))}, ${sql.raw(
    `array[${shares.map((n) => String(Math.trunc(n))).join(',')}]::int[]`,
  )}) a(id, n), lateral crm_search_text(a.id, ${text}, a.n) s(id)${
    arms.length === 0 ? sql`` : sql` union select x.id from (${sql.join(arms, sql` union all `)}) x`
  }`;
  const rows = await tx.execute<{ id: string; rank: number }>(rankSql(scope, searched, candidates, text, limit));
  return rows.rows.map((row) => ({ id: row.id, match: MATCHES[row.rank] ?? 'contains' }));
}

/**
 * The typo step (AC-1078, AC-1094): close names through `crm_search_similar`,
 * ranked by closeness in the same statement, inside a savepoint with its own
 * timeout. The step only reads, so the savepoint always rolls back, which
 * also puts the search's own timeout back; past its time the step answers
 * nothing, and the search still answers its exact matches.
 */
async function similarIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  searched: readonly SearchedObject[],
  text: string,
  limit: number,
  skip: readonly string[],
): Promise<readonly Ranked[]> {
  const primaryIds = named(searched).map((object) => object.primary.id);
  if (primaryIds.length === 0 || limit <= 0) return [];
  await tx.execute(sql`savepoint crm_search_similar`);
  try {
    await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${SIMILAR_TIMEOUT}'`)}`);
    const candidates = sql`select s.id from crm_search_similar(${uuidArray(primaryIds)}, ${text}, ${SIMILAR_CANDIDATES}::int) s(id)`;
    const rows = await tx.execute<{ id: string }>(rankSql(scope, searched, candidates, text, limit, { skip }));
    return rows.rows.map((row) => ({ id: row.id, match: 'similar' }));
  } catch (error) {
    if (postgresError(error)?.code !== '57014') throw error;
    return [];
  } finally {
    await tx.execute(sql`rollback to savepoint crm_search_similar`);
  }
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
      const searched = await searchedObjects(tx, scope, SEARCH_TIMEOUT);
      if (searched.length === 0) return { records: [], views: [] };
      const exact =
        mode === 'prefix'
          ? await prefixIds(tx, scope, searched, text, limit)
          : await containsIds(tx, scope, searched, text, limit);
      checkpoint();
      const close =
        mode === 'contains' && wantsSimilar(text, exact.length, limit)
          ? await similarIds(
              tx,
              scope,
              searched,
              text,
              limit - exact.length,
              exact.map((hit) => hit.id),
            )
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
