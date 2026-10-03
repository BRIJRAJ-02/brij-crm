// One page of a view (spec 0004, AC-6, AC-14, AC-15): the compiled filter and
// sorts over an object's records or a list's entries, paged by keyset cursor
// (or a jump to a position on an unfiltered view), then read back whole. And
// the exact count, as its own cancellable statement.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { FilterGroup, SortRules } from '@crm/contracts/values';
import { LIMITS } from '../limits.ts';
import { readEntriesById, type EntryView } from '../lists.ts';
import { readRecords, type RecordView } from '../records.ts';
import { postgresError, refuse } from '../refusals.ts';
import { loadRelationships } from '../relationships.ts';
import type { EngineScope } from '../scope.ts';
import { loadAttributes, loadAttributesById, loadListAttributes, type AttributeDef } from '../values.ts';
import {
  afterCursor,
  attributeIdsOf,
  baseLevel,
  compileFilter,
  compileSorts,
  drivingSort,
  fromText,
  isUuid,
  keyText,
  narrowedBySearch,
  SEARCH_CAP,
  searchKey,
  searchTermsOf,
  orderBy,
  tieDirection,
  type CompileContext,
  type Cursor,
  type Level,
  type QueryClock,
  type SortKey,
} from './compile.ts';

const { attributeOptions, lists, objects } = schema;

/** The largest page a view may ask for. */
export const MAX_PAGE = 200;
/** The furthest a view may jump: the most rows an object or a list can hold. */
const MAX_POSITION = Math.max(LIMITS.liveRecords, LIMITS.entriesPerList);

/** How long one page or count statement may run before Postgres cancels it, so no request holds a connection for long. */
const STATEMENT_TIMEOUT = '10s';

/** How many options of a select or status sort a page walks one at a time before it filters first instead. */
const MAX_OPTION_WALK = 12;

/** How many cut groups one page reads on their own (each a few statements) before it filters first instead. */
const MAX_GROUPS = 8;
/** The most contains one query asks the search function about; the rest take the narrowed path. */
const MAX_SEARCHES = 3;
/** How long one search may run before its contains takes the narrowed path. */
const SEARCH_TIMEOUT = '2s';

/** A group of equal first keys this small is read whole from its key index and sorted, instead of driven. */
const GROUP_SORT = 20_000;

/** Which rows a view reads: one object's records, or one list's entries. */
export type ViewSource = { readonly objectId: string } | { readonly listId: string };

/** What a view asks for. Relative dates resolve against `now`, `timeZone` and `weekStart` (UTC and Monday by default). */
export type PageQuery = ViewSource &
  QueryClock & {
    readonly filter?: FilterGroup;
    readonly sorts?: SortRules;
    /** The `nextCursor` of the page before, to continue after it. */
    readonly cursor?: string;
    /** Start at this row instead, on a view with no filter and at most one sort (a scrollbar jump). */
    readonly position?: number;
    readonly limit?: number;
  };

/** One page: records in order (for a list, its entries in order and their records), and the cursor for the next. */
export interface Page {
  readonly records: readonly RecordView[];
  readonly entries?: readonly EntryView[];
  readonly nextCursor?: string;
}

/** A cursor as the opaque text a client holds. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** A client's cursor text back into a cursor, refusing anything malformed. */
export function decodeCursor(text: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      isUuid(parsed.id) &&
      'keys' in parsed &&
      Array.isArray(parsed.keys) &&
      parsed.keys.every((key: unknown) => key === null || typeof key === 'string')
    ) {
      const keys: (string | null)[] = parsed.keys.map((key: unknown) => (typeof key === 'string' ? key : null));
      return { id: parsed.id, keys };
    }
  } catch {
    // Falls through to the refusal below.
  }
  throw refuse('FILTER_INVALID', 'That page cursor is not valid. Start from the first page.');
}

/** The view's base level, its catalog of attributes and relationships, and the FROM clause. */
async function prepare(
  tx: WorkspaceTx,
  scope: EngineScope,
  query: ViewSource & QueryClock & { readonly filter?: FilterGroup; readonly sorts?: SortRules },
  search = true,
): Promise<{ context: CompileContext; level: Level }> {
  // Checked against the contract first, so its caps on size and depth hold before anything walks the filter.
  for (const [value, shape] of [
    [query.filter, FilterGroup],
    [query.sorts, SortRules],
  ] as const) {
    if (value === undefined) continue;
    const checked = shape.safeParse(value);
    if (!checked.success)
      throw refuse('FILTER_INVALID', checked.error.issues[0]?.message ?? 'That filter is not valid.');
  }
  let level: Level;
  let own: ReadonlyMap<string, AttributeDef>;
  if ('listId' in query) {
    if (!isUuid(query.listId)) throw refuse('FILTER_INVALID', 'That list does not exist.');
    const [list] = await tx.select({ objectId: lists.objectId }).from(lists).where(eq(lists.id, query.listId));
    if (list === undefined) throw refuse('NOT_FOUND', 'That list does not exist.');
    level = baseLevel({ objectId: list.objectId, listId: query.listId });
    own = new Map([...(await loadListAttributes(tx, query.listId)), ...(await loadAttributes(tx, list.objectId))]);
  } else {
    if (!isUuid(query.objectId)) throw refuse('FILTER_INVALID', 'That object does not exist.');
    const [object] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, query.objectId));
    if (object === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
    level = baseLevel({ objectId: query.objectId });
    own = await loadAttributes(tx, query.objectId);
  }
  const named = attributeIdsOf(query.filter, query.sorts ?? []).filter((id) => !own.has(id));
  const attributes = new Map([...own, ...(await loadAttributesById(tx, named))]);
  const relationshipIds = [...attributes.values()].flatMap((attribute) =>
    attribute.type === 'record_reference' && attribute.relationshipId !== null ? [attribute.relationshipId] : [],
  );
  const context: CompileContext = {
    attributes,
    relationships: await loadRelationships(tx, [...new Set(relationshipIds)]),
    clock: {
      ...(query.now === undefined ? {} : { now: query.now }),
      timeZone: query.timeZone ?? 'UTC',
      weekStart: query.weekStart ?? 'monday',
    },
    actor: scope.actor,
  };
  // UTC, the default, is always known; any other zone is checked against the database's own list.
  if (context.clock.timeZone !== undefined && context.clock.timeZone !== 'UTC') {
    const known = await tx.execute<{ ok: boolean }>(
      sql`select exists (select 1 from pg_timezone_names where name = ${context.clock.timeZone}) as ok`,
    );
    if (known.rows[0]?.ok !== true) throw refuse('FILTER_INVALID', 'That time zone is not known.');
  }
  const searches = search ? await runSearches(tx, context, query.filter) : new Map<string, readonly string[]>();
  return { context: searches.size === 0 ? context : { ...context, searches }, level };
}

/**
 * Asks the search function (spec 0004, stored sort keys, AC-24) about the
 * contains that can narrow the page (`searchTermsOf`), at most 3, each within
 * 2 s, and keeps the answers that came back complete (under the cap), without
 * repeats. It stops at the first complete answer every row must match. The
 * function reads past row level security but only inside this transaction's
 * workspace, and returns only ids.
 */
async function runSearches(
  tx: WorkspaceTx,
  context: CompileContext,
  filter: FilterGroup | undefined,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const found = new Map<string, readonly string[]>();
  const terms = searchTermsOf(context, filter).slice(0, MAX_SEARCHES);
  if (terms.length === 0) return found;
  // A full answer is thrown away, so only its count comes back, not its 5,000 ids.
  // Each search gets SEARCH_TIMEOUT under a savepoint; one that runs out takes the narrowed path instead.
  const before = await tx.execute<{ timeout: string }>(sql`select current_setting('statement_timeout') as timeout`);
  await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${SEARCH_TIMEOUT}'`)}`);
  for (const term of terms) {
    await tx.execute(sql`savepoint crm_search`);
    try {
      const result = await tx.execute<{ n: number; ids: string[] | null }>(sql`
        select count(*)::int as n, case when count(*) < ${SEARCH_CAP} then array_agg(id::text) end as ids
        from crm_search_text(${term.attributeId}::uuid, ${term.text}, ${SEARCH_CAP}::int) as id
      `);
      await tx.execute(sql`release savepoint crm_search`);
      const answer = result.rows[0];
      if (answer !== undefined && answer.n < SEARCH_CAP) {
        found.set(searchKey(term), [...new Set(answer.ids ?? [])]);
        // A rare contains every row must match already narrows the page; the rest are cheap row by row.
        if (term.narrows) break;
      }
    } catch (error) {
      if (postgresError(error)?.code !== '57014') throw error;
      await tx.execute(sql`rollback to savepoint crm_search`);
    }
  }
  await tx.execute(sql`select set_config('statement_timeout', ${before.rows[0]?.timeout ?? STATEMENT_TIMEOUT}, true)`);
  return found;
}

/** The view's tables and the conditions that keep only its live rows; lateral sort joins sit between the two. */
function fromParts(level: Level): { tables: SQL; where: SQL } {
  return level.listId === null
    ? { tables: sql`records r`, where: sql`r.object_id = ${level.objectId} and r.deleted_at is null` }
    : {
        tables: sql`list_entries r join records rec on rec.workspace_id = r.workspace_id and rec.id = r.record_id and rec.deleted_at is null`,
        where: sql`r.list_id = ${level.listId} and r.deleted_at is null`,
      };
}

/** Checks a page query's limit, cursor and position, returning the limit and the decoded cursor. */
function checkPage(query: PageQuery): { limit: number; cursor?: Cursor } {
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw refuse('FILTER_INVALID', `Ask for 1 to ${String(MAX_PAGE)} rows at a time.`);
  }
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  if (query.position !== undefined) {
    const filtered = query.filter !== undefined && query.filter.conditions.length > 0;
    if (
      !Number.isInteger(query.position) ||
      query.position < 0 ||
      query.position > MAX_POSITION ||
      filtered ||
      (query.sorts?.length ?? 0) > 1 ||
      cursor !== undefined
    ) {
      throw refuse(
        'FILTER_INVALID',
        'Jump to a position only on a view with no filter and at most one sort; page by cursor otherwise.',
      );
    }
  }
  return cursor === undefined ? { limit } : { limit, cursor };
}

/** One row of a page statement: the row id, its record's id, and each sort key as text (`key0`, `key1`). */
type PageRow = Record<string, string | number | null> & { id: string; record_id: string };

/** One part of a page: it returns up to `take` rows in order, after skipping `skip`. */
type Branch = (tx: WorkspaceTx, take: number, skip: number) => Promise<readonly PageRow[]>;

/** A built page: its parts in order, its shape, and its statements for EXPLAIN. */
interface BuiltPage {
  readonly branches: readonly Branch[];
  readonly keyCount: number;
  readonly limit: number;
  readonly isList: boolean;
  /** Counts the first part's rows, for a position past them all. */
  readonly countFirst?: SQL;
  readonly explain: (take: number, skip: number) => readonly SQL[];
}

/**
 * How many rows, in sort order, a page reads before checking each one's
 * filters, when its first sort can drive from an index. Past this the page
 * asks Postgres to filter first instead.
 */
const CANDIDATES = 5000;

/**
 * How many rows the empties read in id order, each checked on its own, before
 * the page filters them first instead (correct, but it may be slow). Sparse
 * empties end up filtered first either way, so the scan stays short.
 */
const EMPTIES_SCAN = 5000;

/**
 * Builds a page. Usually one statement; when the first sort can drive from
 * its index (`drivingSort`), two parts: the rows with a value in key order,
 * then the rows without one. The first part reads up to 5,000 rows in key
 * order and checks each one's filters, stopping at the limit; when that
 * doesn't fill the page (a selective filter), it filters first and sorts.
 */
async function buildPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  query: PageQuery,
  candidates = CANDIDATES,
  search = true,
): Promise<BuiltPage> {
  const { limit, cursor } = checkPage(query);
  const { context, level } = await prepare(tx, scope, query, search);
  const sorts = query.sorts ?? [];
  const keys = compileSorts(context, level, sorts);
  const filter = compileFilter(context, level, query.filter);
  const { tables, where } = fromParts(level);
  const recordColumn = level.listId === null ? sql`r.id` : sql`r.record_id`;
  const isList = level.listId !== null;
  const tie = tieDirection(keys);
  const keyColumns = (used: readonly SortKey[], from: number) =>
    used.map((key, index) => sql`, ${keyText(key)} as ${sql.raw(`key${String(index + from)}`)}`);
  const joinsOf = (used: readonly SortKey[]) =>
    sql.join(
      used.flatMap((key) => (key.join === undefined ? [] : [key.join])),
      sql` `,
    );
  const page = (skip: number, take: number) => sql`limit ${take}${skip > 0 ? sql` offset ${skip}` : sql``}`;
  /** `nulls` leading key columns that are all null (the empties' first sort), then `used`'s keys. */
  const nullKeys = (nulls: number) =>
    sql.join(
      Array.from({ length: nulls }, (_, index) => sql`, null::text as ${sql.raw(`key${String(index)}`)}`),
      sql``,
    );
  /** `count` null key columns, numbered from `from`. */
  const nullKeysFrom = (from: number, count: number) =>
    sql.join(
      Array.from({ length: count }, (_, index) => sql`, null::text as ${sql.raw(`key${String(index + from)}`)}`),
      sql``,
    );
  const plain =
    (used: readonly SortKey[], source: SQL, extra: SQL, after: SQL, nulls: number) =>
    (take: number, skip: number) => sql`
      select r.id::text as id, ${recordColumn}::text as record_id${nullKeys(nulls)}${sql.join(keyColumns(used, nulls), sql``)}
      from ${tables} ${source} ${joinsOf(used)}
      where ${where} and ${filter} and ${extra} and ${after}
      order by ${orderBy(used, tie)}
      ${page(skip, take)}
    `;
  const run =
    (statement: (take: number, skip: number) => SQL): Branch =>
    async (inner, take, skip) =>
      (await inner.execute<PageRow>(statement(take, skip))).rows;

  const first = sorts[0];
  const firstAttribute = first === undefined ? undefined : context.attributes.get(first.attributeId);
  const optionIds =
    firstAttribute !== undefined && (firstAttribute.type === 'select' || firstAttribute.type === 'status')
      ? (
          await tx
            .select({ id: attributeOptions.id })
            .from(attributeOptions)
            .where(eq(attributeOptions.attributeId, firstAttribute.id))
            .orderBy(asc(attributeOptions.position), asc(attributeOptions.id))
        ).map((row) => row.id)
      : [];
  // The first sort drives when its stored keys are exactly the keys it compiles to (one, or two for currency).
  const firstKeyCount = first === undefined ? 0 : compileSorts(context, level, [first]).length;
  const candidate = drivingSort(context, level, first, optionIds);
  // A rare contains narrows the view to the search's few ids, so filtering first beats reading in key order.
  const drive =
    candidate !== undefined && candidate.keys.length === firstKeyCount && !narrowedBySearch(context, query.filter)
      ? candidate
      : undefined;
  if (drive === undefined) {
    const statement = plain(keys, sql``, sql`true`, cursor === undefined ? sql`true` : afterCursor(keys, cursor), 0);
    return {
      branches: [run(statement)],
      keyCount: keys.length,
      limit,
      isList,
      explain: (take, skip) => [statement(take, skip)],
    };
  }

  if ((query.position ?? 0) > 0 && drive.count === undefined) {
    throw refuse(
      'FILTER_INVALID',
      'A list sorted by its records’ values pages by cursor; jump on an entry value instead.',
    );
  }
  const n = drive.keys.length;
  const driven = [...drive.keys, ...keys.slice(n)];
  const rest = keys.slice(n);
  const inEmpties = cursor !== undefined && cursor.keys[0] === null;
  const filterFirst = plain(
    driven,
    drive.source,
    sql`true`,
    cursor === undefined ? sql`true` : afterCursor(driven, cursor),
    0,
  );
  const restCursor = cursor === undefined ? undefined : { id: cursor.id, keys: cursor.keys.slice(n) };
  const emptiesAfter = inEmpties && restCursor !== undefined ? afterCursor(rest, restCursor, tie) : sql`true`;
  const empties = plain(rest, sql``, drive.empty, emptiesAfter, n);

  // Each row's filters, kept a per row check, for the passes that read rows in key or id order first.
  const fenced = compileFilter({ ...context, fence: true }, level, query.filter);
  const tieDir = sql.raw(tie === 'ascending' ? 'asc' : 'desc');

  // With no later sort, the empties come in id order: read up to EMPTIES_SCAN rows that way, checking each
  // one's filters on its own, and stop at the limit; past the scan, filter first instead.
  const scanEmpties = (
    take: number,
    skip: number,
    extra: SQL = drive.emptyFenced,
    after: SQL = emptiesAfter,
    keyTexts: readonly string[] = [],
  ) => sql`
    with c0 as materialized (
      select r.id as id_, r.workspace_id as ws_ from ${tables} where ${where} and ${after}
      order by r.id ${tieDir} limit ${EMPTIES_SCAN}
    ), edge as (select count(*)::int as n from c0)
    select edge.n as scanned_, p.* from edge left join lateral (
      select r.id::text as id, ${recordColumn}::text as record_id${sql.join(
        keyTexts.map((text, index) => sql`, ${text}::text as ${sql.raw(`key${String(index)}`)}`),
        sql``,
      )}${nullKeys(0)}${sql.join(
        Array.from(
          { length: n + rest.length - keyTexts.length },
          (_, index) => sql`, null::text as ${sql.raw(`key${String(index + keyTexts.length)}`)}`,
        ),
        sql``,
      )}
      from c0, ${tables}
      where r.workspace_id = c0.ws_ and r.id = c0.id_ and ${fenced} and ${extra}
      order by c0.id_ ${tieDir}
      ${page(skip, take)}
    ) p on true
  `;
  const emptiesBranch: Branch = async (inner, take, skip) => {
    // A later sort orders the empties by it, and an offset past the scan can't be served from it.
    if (rest.length > 0 || skip >= EMPTIES_SCAN) return run(empties)(inner, take, skip);
    const result = (await inner.execute<Omit<PageRow, 'id'> & { id: string | null }>(scanEmpties(take, skip))).rows;
    const found = result.filter((row): row is PageRow => row.id !== null);
    const scanned = Number(result[0]?.scanned_ ?? 0);
    return found.length >= take || scanned < EMPTIES_SCAN ? found : run(empties)(inner, take, skip);
  };

  const ascending = drive.keys[0]?.direction !== 'descending';
  const keyOp = sql.raw(ascending ? '>' : '<');
  const keyOpOrEqual = sql.raw(ascending ? '>=' : '<=');
  const keyDir = sql.raw(ascending ? 'asc' : 'desc');
  const keyDirBack = sql.raw(ascending ? 'desc' : 'asc');
  const row = (items: readonly SQL[]) => sql`(${sql.join([...items], sql`, `)})`;
  const typed = (texts: readonly string[]) =>
    texts.map((text, index) => {
      const key = drive.keys[index];
      if (key === undefined) throw new Error('A drive key is missing.');
      return fromText(key, text);
    });
  const cursorDrive = cursor === undefined || inEmpties ? undefined : cursor.keys.slice(0, n);
  /**
   * Where a pass over the keys starts. After the cursor: with no later sort, a row comparison seeks
   * straight to (keys, id); with one, to the cursor's keys (the outer check settles the rest). After a
   * group (`after`), strictly past its keys.
   */
  const startOf = (exprs: readonly SQL[], rowId: SQL, after?: readonly string[]): SQL => {
    if (after !== undefined) return sql`${row(exprs)} ${keyOp} ${row(typed(after))}`;
    if (cursor === undefined || cursorDrive === undefined || cursorDrive.some((key) => key === null)) return sql`true`;
    const values = typed(cursorDrive as string[]);
    const seek = sql`${row(exprs)} ${keyOpOrEqual} ${row(values)}`;
    return rest.length === 0
      ? sql`${seek} and ${row([...exprs, rowId])} ${keyOp} ${row([...values, sql`${cursor.id}::uuid`])}`
      : seek;
  };
  const dkey = (index: number) => sql.raw(`dkey${String(index)}_`);
  const outerKeys: readonly SortKey[] = [
    ...drive.keys.map((key, index) => ({ ...key, expression: sql`c0.${dkey(index)}` })),
    ...rest,
  ];
  /** Up to `cap` key rows in key order from `start`, then each one's filters, stopping at `take`; with the last keys read. */
  const capped = (take: number, cap: number, rows: SQL, exprs: readonly SQL[], start: SQL, skip = 0) => sql`
    with c0 as materialized (
      select ${drive.rowId} as id_, d.workspace_id as ws_, ${sql.join(
        exprs.map((expr, index) => sql`${expr} as ${dkey(index)}`),
        sql`, `,
      )}
      ${rows} and ${start}
      order by ${sql.join(
        exprs.map((_, index) => sql`${dkey(index)} ${keyDir}`),
        sql`, `,
      )}, id_ ${tieDir}
      ${skip > 0 ? sql`offset ${skip}` : sql``} limit ${cap}
    ), edge as (
      -- Each last key as text, aliased apart from its column: ORDER BY would otherwise sort the text.
      select (select count(*)::int from c0) as n${sql.join(
        exprs.map(
          (_, index) =>
            sql`, (select ${dkey(index)}::text as last_ from c0 order by ${sql.join(
              exprs.map((__, inner) => sql`${dkey(inner)} ${keyDirBack}`),
              sql`, `,
            )} limit 1) as ${sql.raw(`last${String(index)}_`)}`,
        ),
        sql``,
      )}
    )
    select edge.*, p.* from edge left join lateral (
      select r.id::text as id, ${recordColumn}::text as record_id${sql.join(keyColumns(outerKeys, 0), sql``)}
      from c0, ${tables} ${joinsOf(rest)}
      where r.workspace_id = c0.ws_ and r.id = c0.id_ and ${where} and ${fenced}
        and ${cursor === undefined ? sql`true` : afterCursor(outerKeys, cursor)}
      order by ${orderBy(outerKeys, tie)}
      limit ${take}
    ) p on true
  `;
  type CappedRow = Omit<PageRow, 'id'> & { id: string | null; n: number } & Record<string, string | number | null>;
  const rounds = (take: number) => [
    ...new Set([take * 2, take * 16, candidates].map((size) => Math.min(size, candidates))),
  ];
  /**
   * Reads rows in key order in growing rounds. `complete` means the page is settled up to here; when
   * the cap cut a group of equal keys and a later sort may still move rows inside it, that group is
   * left out and named as `edge`, for `group` to read on its own.
   */
  const pass = async (
    inner: WorkspaceTx,
    take: number,
    rows: SQL,
    exprs: readonly SQL[],
    after?: readonly string[],
  ): Promise<{ rows: readonly PageRow[]; complete: boolean; edge?: readonly string[] }> => {
    for (const cap of rounds(take)) {
      // One row always comes back (the counts), with the page's fields null when nothing matched.
      const result = (
        await inner.execute<CappedRow>(capped(take, cap, rows, exprs, startOf(exprs, drive.rowId, after)))
      ).rows;
      const head = result[0];
      const scanned = head?.n ?? 0;
      const edge = exprs.map((_, index) => {
        const value = head?.[`last${String(index)}_`];
        return value === null || value === undefined ? '' : String(value);
      });
      const found = result.filter((item): item is CappedRow & PageRow => item.id !== null);
      const inEdge = (item: PageRow) => edge.every((value, index) => String(item[`key${String(index)}`]) === value);
      const cut = scanned >= cap && rest.length > 0;
      const safe = cut ? found.filter((item) => !inEdge(item)) : found;
      if (safe.length >= take || scanned < cap) return { rows: safe.slice(0, take), complete: true };
      if (cut && cap === candidates) return { rows: safe, complete: false, edge };
    }
    return { rows: [], complete: false };
  };

  // A group of equal first keys with later sorts, read on its own. A small group (up to GROUP_SORT rows) comes
  // from the first sort's own key index and is sorted by the rest. A big one is driven by the second sort's
  // stored keys, with "first keys equal the group's" checked per row like any other filter; then its rows with
  // no second value, from the first sort's key index in id order.
  const second = sorts[1];
  const secondDrive = sorts.length === 2 ? drivingSort(context, level, second, []) : undefined;
  const byGroup =
    secondDrive !== undefined && secondDrive.options === undefined && secondDrive.keys.length === rest.length
      ? secondDrive
      : undefined;
  const edgeKeys = (edge: readonly string[]) =>
    sql.join(
      edge.map((text, index) => sql`, ${text}::text as ${sql.raw(`key${String(index)}`)}`),
      sql``,
    );
  const group = async (
    inner: WorkspaceTx,
    take: number,
    edge: readonly string[],
  ): Promise<{ rows: readonly PageRow[]; complete: boolean } | undefined> => {
    const inThisGroup = cursorDrive !== undefined && cursorDrive.every((key, index) => key === edge[index]);
    const groupCursor = inThisGroup && cursor !== undefined ? { id: cursor.id, keys: cursor.keys.slice(n) } : undefined;
    const groupRows = sql`${drive.rows} and ${drive.within(edge)}`;
    const size = await inner.execute<{ n: number }>(
      sql`select count(*)::int as n from (select 1 ${groupRows} limit ${GROUP_SORT + 1}) s`,
    );
    if ((size.rows[0]?.n ?? 0) <= GROUP_SORT) {
      const result = await inner.execute<PageRow>(sql`
        select r.id::text as id, ${recordColumn}::text as record_id${edgeKeys(edge)}${sql.join(keyColumns(rest, n), sql``)}
        from (select ${drive.rowId} as id_, d.workspace_id as ws_ ${groupRows}) g, ${tables} ${joinsOf(rest)}
        where r.workspace_id = g.ws_ and r.id = g.id_ and ${where} and ${filter}
          and ${groupCursor === undefined ? sql`true` : afterCursor(rest, groupCursor, tie)}
        order by ${orderBy(rest, tie)}
        limit ${take}
      `);
      return { rows: result.rows, complete: true };
    }
    if (byGroup === undefined) return undefined;
    const equals = drive.equals(edge);
    const secondAscending = byGroup.keys[0]?.direction !== 'descending';
    const groupDir = sql.raw(secondAscending ? 'asc' : 'desc');
    const groupKeys: readonly SortKey[] = byGroup.keys.map((key, index) => ({
      ...key,
      expression: sql`c0.${dkey(index)}`,
    }));
    const found: PageRow[] = [];
    // The group's rows with a value for the second sort, in its key order.
    if (groupCursor === undefined || groupCursor.keys.every((key) => key !== null)) {
      const seek =
        groupCursor === undefined
          ? sql`true`
          : sql`${row(byGroup.keys.map((key) => key.expression))} ${sql.raw(secondAscending ? '>=' : '<=')} ${row(
              byGroup.keys.map((key, index) => fromText(key, groupCursor.keys[index] ?? '')),
            )}`;
      let settled = false;
      for (const cap of rounds(take)) {
        const statement = sql`
          with c0 as materialized (
            select ${byGroup.rowId} as id_, d.workspace_id as ws_, ${sql.join(
              byGroup.keys.map((key, index) => sql`${key.expression} as ${dkey(index)}`),
              sql`, `,
            )}
            ${byGroup.rows} and ${seek}
            order by ${sql.join(
              byGroup.keys.map((_, index) => sql`${dkey(index)} ${groupDir}`),
              sql`, `,
            )}, id_ ${tieDir}
            limit ${cap}
          ), edge as (select count(*)::int as n from c0)
          select edge.*, p.* from edge left join lateral (
            select r.id::text as id, ${recordColumn}::text as record_id${edgeKeys(edge)}${sql.join(keyColumns(groupKeys, n), sql``)}
            from c0, ${tables}
            where r.workspace_id = c0.ws_ and r.id = c0.id_ and ${where} and ${fenced} and ${equals}
              and ${groupCursor === undefined ? sql`true` : afterCursor(groupKeys, groupCursor, tie)}
            order by ${orderBy(groupKeys, tie)}
            limit ${take}
          ) p on true
        `;
        const result = (await inner.execute<CappedRow>(statement)).rows;
        const scanned = result[0]?.n ?? 0;
        const rows = result.filter((item): item is CappedRow & PageRow => item.id !== null);
        if (rows.length >= take) return { rows: rows.slice(0, take), complete: true };
        if (scanned < cap) {
          found.push(...rows);
          settled = true;
          break;
        }
      }
      if (!settled) return { rows: [], complete: false };
    }
    // Then the group's rows with no value for the second sort: the group's own key rows, in id order.
    const idAfter =
      groupCursor !== undefined && groupCursor.keys.some((key) => key === null)
        ? sql`${drive.rowId} ${sql.raw(tie === 'ascending' ? '>' : '<')} ${groupCursor.id}::uuid`
        : sql`true`;
    for (const cap of rounds(take - found.length)) {
      const result = (
        await inner.execute<CappedRow>(sql`
          with c0 as materialized (
            select ${drive.rowId} as id_, d.workspace_id as ws_ ${groupRows} and ${idAfter}
            order by id_ ${tieDir} limit ${cap}
          ), edge as (select count(*)::int as n from c0)
          select edge.*, p.* from edge left join lateral (
            select r.id::text as id, ${recordColumn}::text as record_id${edgeKeys(edge)}${nullKeysFrom(n, rest.length)}
            from c0, ${tables}
            where r.workspace_id = c0.ws_ and r.id = c0.id_ and ${where} and ${fenced} and ${byGroup.emptyFenced}
            order by c0.id_ ${tieDir}
            limit ${take - found.length}
          ) p on true
        `)
      ).rows;
      const rows = result.filter((item): item is CappedRow & PageRow => item.id !== null);
      if (found.length + rows.length >= take || (result[0]?.n ?? 0) < cap) {
        return { rows: [...found, ...rows].slice(0, take), complete: true };
      }
    }
    return { rows: [], complete: false };
  };

  /** Rows in key order from `rows`: passes, and a group read whenever a pass leaves a cut group out. */
  const walk = async (
    inner: WorkspaceTx,
    take: number,
    rows: SQL,
    exprs: readonly SQL[],
  ): Promise<{ rows: readonly PageRow[]; complete: boolean }> => {
    const found: PageRow[] = [];
    let after: readonly string[] | undefined;
    for (let groups = 0; groups <= MAX_GROUPS; groups += 1) {
      const part = await pass(inner, take - found.length, rows, exprs, after);
      found.push(...part.rows);
      if (found.length >= take || part.complete) return { rows: found.slice(0, take), complete: true };
      if (part.edge === undefined) return { rows: [], complete: false };
      const read = await group(inner, take - found.length, part.edge);
      if (read === undefined || !read.complete) return { rows: [], complete: false };
      found.push(...read.rows);
      if (found.length >= take) return { rows: found.slice(0, take), complete: true };
      after = part.edge;
    }
    return { rows: [], complete: false };
  };

  const options = drive.options;
  const exprs = drive.keys.map((key) => key.expression);
  /** A jump on stored keys: an index only offset straight to the row (the view is unfiltered, `checkPage` says so). */
  const jump = async (inner: WorkspaceTx, take: number, skip: number): Promise<readonly PageRow[]> => {
    const at = async (rows: SQL, keyExprs: readonly SQL[], offset: number, count: number) =>
      (await inner.execute<CappedRow>(capped(count, count, rows, keyExprs, sql`true`, offset))).rows.filter(
        (item): item is CappedRow & PageRow => item.id !== null,
      );
    if (options === undefined) return at(drive.rows, exprs, skip, take);
    // A select or status: count the options in walk order until the position falls inside one, then offset there.
    const order = options.map((_, index) => index);
    if (!ascending) order.reverse();
    const found: PageRow[] = [];
    let remaining = skip;
    for (const index of order) {
      const optionRows = options[index];
      const optionId = optionIds[index];
      if (optionRows === undefined || optionId === undefined || drive.optionCount === undefined) continue;
      const size =
        found.length > 0
          ? Infinity
          : ((await inner.execute<{ n: number }>(drive.optionCount(optionId))).rows[0]?.n ?? 0);
      if (size === 0) continue;
      if (remaining >= size) {
        remaining -= size;
        continue;
      }
      found.push(...(await at(optionRows, [sql`${index}::int`], remaining, take - found.length)));
      remaining = 0;
      if (found.length >= take) break;
    }
    return found;
  };
  const valued: Branch = async (inner, take, skip) => {
    if (skip > 0) return drive.count === undefined ? run(filterFirst)(inner, take, skip) : jump(inner, take, skip);
    if (options === undefined) {
      const read = await walk(inner, take, drive.rows, exprs);
      return read.complete ? read.rows : run(filterFirst)(inner, take, skip);
    }
    // A select or status: one option's index range at a time, in option order, from the cursor's option on.
    const order = options.map((_, index) => index);
    if (!ascending) order.reverse();
    const fromOption = cursorDrive?.[0] === undefined || cursorDrive[0] === null ? undefined : Number(cursorDrive[0]);
    const found: PageRow[] = [];
    let walked = 0;
    for (const index of order) {
      if (fromOption !== undefined && (ascending ? index < fromOption : index > fromOption)) continue;
      const optionRows = options[index];
      if (optionRows === undefined) continue;
      // Many options and a selective filter: one statement per option costs more than filtering first.
      if (walked === MAX_OPTION_WALK) return run(filterFirst)(inner, take, skip);
      walked += 1;
      // With a later sort the whole option is one group of equal keys: read it on its own.
      const part =
        rest.length > 0
          ? await group(inner, take - found.length, [String(index)])
          : await walk(inner, take - found.length, optionRows, [sql`${index}::int`]);
      if (part === undefined || !part.complete) return run(filterFirst)(inner, take, skip);
      found.push(...part.rows);
      if (found.length >= take) break;
    }
    return found.slice(0, take);
  };
  return {
    branches: inEmpties ? [emptiesBranch] : [valued, emptiesBranch],
    keyCount: keys.length,
    limit,
    isList,
    ...(inEmpties
      ? {}
      : {
          countFirst:
            drive.count ?? sql`select count(*)::int as n from ${tables} ${drive.source} where ${where} and ${filter}`,
        }),
    explain: (take, skip) =>
      inEmpties
        ? [rest.length > 0 ? empties(take, skip) : scanEmpties(take, skip)]
        : skip > 0 && drive.count !== undefined && options === undefined
          ? [capped(take, take, drive.rows, exprs, sql`true`, skip)]
          : [
              capped(
                take,
                take * 2,
                options?.[0] ?? drive.rows,
                options === undefined ? exprs : [sql`0::int`],
                startOf(exprs, drive.rowId),
              ),
              filterFirst(take, skip),
              rest.length > 0 ? empties(take, skip) : scanEmpties(take, skip),
            ],
  };
}

/**
 * A page's rows, one more than the limit when there are more: each part in
 * turn until the page is full. A position skips that many rows first.
 */
async function pageRows(tx: WorkspaceTx, built: BuiltPage, position = 0): Promise<readonly PageRow[]> {
  const rows: PageRow[] = [];
  let skip = position;
  for (const [index, branch] of built.branches.entries()) {
    const take = built.limit + 1 - rows.length;
    if (take <= 0) break;
    const found = await branch(tx, take, skip);
    rows.push(...found);
    if (skip > 0 && found.length === 0 && index === 0 && built.countFirst !== undefined) {
      // The position is past every row with a value: skip those, then count on into the empties.
      const counted = await tx.execute<{ n: number }>(built.countFirst);
      skip = Math.max(0, skip - (counted.rows[0]?.n ?? 0));
    } else {
      skip = 0;
    }
  }
  return rows;
}

/**
 * For the scale benchmark: runs a page and returns how many rows it found,
 * or, with `explain`, each of its statements' plans (EXPLAIN ANALYZE).
 */
export async function benchPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  query: PageQuery,
  explain = false,
): Promise<{ rows: number; plans: readonly string[] }> {
  const built = await buildPage(tx, scope, query);
  if (!explain) return { rows: (await pageRows(tx, built, query.position)).length, plans: [] };
  const plans: string[] = [];
  for (const statement of built.explain(built.limit + 1, query.position ?? 0)) {
    const plan = await tx.execute<{ 'QUERY PLAN': string }>(sql`explain (analyze, buffers) ${statement}`);
    plans.push(plan.rows.map((row) => row['QUERY PLAN']).join('\n'));
  }
  return { rows: 0, plans };
}

/**
 * Knobs for tests: a lower first pass cap, a short statement timeout (one
 * fixed value, so no text reaches the raw SQL), and `search: false` to answer
 * every contains by the narrowed path, as if the search function were absent.
 */
export interface PageTuning {
  readonly candidates?: number;
  readonly timeout?: '200ms';
  readonly search?: false;
}

/**
 * The first page of a view, the page after a cursor, or the page at a
 * position. Each statement has a 10 second timeout; past it the refusal is
 * `QUERY_CANCELLED`. `tuning` is for tests.
 */
export async function queryPage(scope: EngineScope, query: PageQuery, tuning: PageTuning = {}): Promise<Page> {
  checkPage(query);
  try {
    return await scope.db.withWorkspace(scope.workspaceId, (tx) => readPage(tx, scope, query, tuning));
  } catch (error) {
    const code = postgresError(error)?.code;
    if (code === '57014') throw refuse('QUERY_CANCELLED', 'That page took too long. Narrow the filter and try again.');
    // A cursor key that has the right shape but no such value (a 30th of February).
    if (query.cursor !== undefined && code !== undefined && ['22003', '22007', '22008', '22P02'].includes(code)) {
      throw refuse('FILTER_INVALID', 'That page cursor is not valid. Start from the first page.');
    }
    throw error;
  }
}

/** The body of `queryPage`, inside its workspace transaction. */
async function readPage(tx: WorkspaceTx, scope: EngineScope, query: PageQuery, tuning: PageTuning): Promise<Page> {
  await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${tuning.timeout ?? STATEMENT_TIMEOUT}'`)}`);
  const built = await buildPage(tx, scope, query, tuning.candidates, tuning.search ?? true);
  const all = await pageRows(tx, built, query.position);
  const { limit, keyCount, isList } = built;
  const rows = all.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor =
    all.length > limit && last !== undefined
      ? encodeCursor({
          id: last.id,
          keys: Array.from({ length: keyCount }, (_, index) => {
            const value = last[`key${String(index)}`];
            return value === null || value === undefined ? null : String(value);
          }),
        })
      : undefined;
  const recordIds = [...new Set(rows.map((row) => row.record_id))];
  const records = await readRecords(tx, recordIds);
  const page: Page = !isList
    ? { records }
    : {
        records,
        entries: await readEntriesById(
          tx,
          rows.map((row) => row.id),
        ),
      };
  return nextCursor === undefined ? page : { ...page, nextCursor };
}

/** Whether `signal` has aborted, read fresh (a call, so a check made earlier doesn't narrow it). */
const isAborted = (signal: AbortSignal | undefined) => signal?.aborted === true;

/** Where a filtered count stops: past it, the view says "10,000+". */
export const COUNT_CAP = 10_000;

/** A view's row count: exact up to the cap (`atLeast` false), otherwise the cap with `atLeast` true. */
export interface MatchCount {
  readonly count: number;
  readonly atLeast: boolean;
}

/**
 * How many rows a view's filter matches (spec 0004, stored sort keys, AC-23),
 * in its own statement with a 10 second timeout: exact up to 10,000, then
 * "at least 10,000". An unfiltered object or list always gets its exact
 * total. Aborting `signal` cancels it; either way the refusal is
 * `QUERY_CANCELLED`. For tests, `tuning.cap` lowers the cap, and `tuning.search`
 * false answers every contains by the narrowed path.
 */
export async function countMatches(
  scope: EngineScope,
  query: ViewSource & QueryClock & { readonly filter?: FilterGroup },
  signal?: AbortSignal,
  tuning: { readonly cap?: number; readonly search?: false } = {},
): Promise<MatchCount> {
  const cap = tuning.cap ?? COUNT_CAP;
  const cancelled = () => refuse('QUERY_CANCELLED', 'The count took too long or was cancelled.');
  if (signal?.aborted === true) throw cancelled();
  try {
    return await scope.db.withWorkspace(scope.workspaceId, async (tx) => {
      // Set first, so the searches the filter runs while it is prepared are bounded too.
      await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${STATEMENT_TIMEOUT}'`)}`);
      // A name only this count's transaction carries: the cancel checks it, so a connection the pool has
      // since handed to another request (another workspace's) is never the one cancelled.
      const tag = `crm-count:${randomUUID()}`;
      await tx.execute(sql`select set_config('application_name', ${tag}, true)`);
      const pid = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      const backend = pid.rows[0]?.pid;
      const cancel = () => {
        if (backend === undefined) return;
        void scope.db
          .withWorkspace(scope.workspaceId, (other) =>
            other.execute(sql`
              select pg_cancel_backend(pid) from pg_stat_activity
              where pid = ${backend} and application_name = ${tag} and state = 'active'
            `),
          )
          .catch(() => undefined);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      // An abort while the tag was set fired before the listener existed.
      if (signal?.aborted === true) throw cancelled();
      try {
        // Prepared under the listener, so an abort cancels the filter's searches too.
        const { context, level } = await prepare(tx, scope, query, tuning.search ?? true);
        // A cancel that landed on a search looks like its timeout there, which only narrows that contains.
        if (isAborted(signal)) throw cancelled();
        const filter = compileFilter(context, level, query.filter);
        const { tables, where } = fromParts(level);
        const filtered = query.filter !== undefined && query.filter.conditions.length > 0;
        if (!filtered) {
          // The whole object: its live records, index only. The whole list: its entry count, less the live
          // entries of records in the trash (which keep their slots until the purge).
          const total =
            level.listId === null
              ? sql`select count(*)::int as n from records r where r.object_id = ${level.objectId} and r.deleted_at is null`
              : sql`
                select l.entry_count - (
                  select count(*)::int from records t
                  join list_entries e on e.workspace_id = t.workspace_id and e.record_id = t.id
                  where t.deleted_at is not null and e.list_id = ${level.listId} and e.deleted_at is null
                ) as n from lists l where l.id = ${level.listId}
              `;
          const result = await tx.execute<{ n: number }>(total);
          return { count: result.rows[0]?.n ?? 0, atLeast: false };
        }
        const result = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from (select 1 from ${tables} where ${where} and ${filter} limit ${cap + 1}) s`,
        );
        const n = result.rows[0]?.n ?? 0;
        return n > cap ? { count: cap, atLeast: true } : { count: n, atLeast: false };
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    });
  } catch (error) {
    if (postgresError(error)?.code === '57014') throw cancelled();
    throw error;
  }
}
