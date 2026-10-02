// One page of a view (spec 0004, AC-6, AC-14, AC-15): the compiled filter and
// sorts over an object's records or a list's entries, paged by keyset cursor
// (or a jump to a position on an unfiltered view), then read back whole. And
// the exact count, as its own cancellable statement.
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
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
  orderBy,
  tieDirection,
  type CompileContext,
  type Cursor,
  type Level,
  type QueryClock,
  type SortKey,
} from './compile.ts';

const { attributeOptions, lists } = schema;

/** The largest page a view may ask for. */
export const MAX_PAGE = 200;
/** The furthest a view may jump. */
const MAX_POSITION = 10_000_000;

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
): Promise<{ context: CompileContext; level: Level }> {
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
  if (context.clock.timeZone !== undefined) {
    const known = await tx.execute<{ ok: boolean }>(
      sql`select exists (select 1 from pg_timezone_names where name = ${context.clock.timeZone}) as ok`,
    );
    if (known.rows[0]?.ok !== true) throw refuse('FILTER_INVALID', 'That time zone is not known.');
  }
  return { context, level };
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
): Promise<BuiltPage> {
  const { limit, cursor } = checkPage(query);
  const { context, level } = await prepare(tx, scope, query);
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
  const plain =
    (used: readonly SortKey[], source: SQL, extra: SQL, after: SQL, nullFirstKey: boolean) =>
    (take: number, skip: number) => sql`
      select r.id::text as id, ${recordColumn}::text as record_id${nullFirstKey ? sql`, null::text as key0` : sql``}${sql.join(keyColumns(used, nullFirstKey ? 1 : 0), sql``)}
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
  const drive = keys.length === sorts.length ? drivingSort(context, level, first, optionIds) : undefined;
  if (drive === undefined) {
    const statement = plain(
      keys,
      sql``,
      sql`true`,
      cursor === undefined ? sql`true` : afterCursor(keys, cursor),
      false,
    );
    return {
      branches: [run(statement)],
      keyCount: keys.length,
      limit,
      isList,
      explain: (take, skip) => [statement(take, skip)],
    };
  }

  const driven = [drive.key, ...keys.slice(1)];
  const rest = keys.slice(1);
  const inEmpties = cursor !== undefined && cursor.keys[0] === null;
  const filterFirst = plain(
    driven,
    drive.source,
    sql`true`,
    cursor === undefined ? sql`true` : afterCursor(driven, cursor),
    false,
  );
  const empties = plain(
    rest,
    sql``,
    drive.empty,
    inEmpties ? afterCursor(rest, { id: cursor.id, keys: cursor.keys.slice(1) }, tie) : sql`true`,
    true,
  );

  // The capped first pass: the next rows in key order, read straight from the index, then each one's filters.
  const fenced = compileFilter({ ...context, fence: true }, level, query.filter);
  const ascending = drive.key.direction === 'ascending';
  const cursorKey = cursor?.keys[0];
  const tieOp = sql.raw(tie === 'ascending' ? '>' : '<');
  const keyOp = sql.raw(ascending ? '>' : '<');
  const innerAfter = (key: SQL) =>
    cursor === undefined || cursorKey === null || cursorKey === undefined
      ? sql`true`
      : rest.length === 0
        ? sql`(${key} ${keyOp} ${fromText(drive.key, cursorKey)} or (${key} = ${fromText(drive.key, cursorKey)} and d.owner_id ${tieOp} ${cursor.id}::uuid))`
        : sql`${key} ${sql.raw(ascending ? '>=' : '<=')} ${fromText(drive.key, cursorKey)}`;
  const outerKeys: readonly SortKey[] = [{ ...drive.key, expression: sql`c0.dkey_` }, ...rest];
  const capped = (take: number, cap: number, rows: SQL, key: SQL) => sql`
    with c0 as materialized (
      select d.owner_id as id_, d.workspace_id as ws_, ${key} as dkey_
      ${rows} and ${innerAfter(key)}
      order by 3 ${sql.raw(ascending ? 'asc' : 'desc')}, 1 ${sql.raw(tie === 'ascending' ? 'asc' : 'desc')}
      limit ${cap}
    ), edge as (
      select count(*)::int as n, (array_agg(dkey_::text order by dkey_ ${sql.raw(ascending ? 'desc' : 'asc')}))[1] as last from c0
    )
    select edge.n as scanned_, edge.last as edge_, p.* from edge left join lateral (
      select r.id::text as id, ${recordColumn}::text as record_id${sql.join(keyColumns(outerKeys, 0), sql``)}
      from c0, ${tables} ${joinsOf(rest)}
      where r.workspace_id = c0.ws_ and r.id = c0.id_ and ${where} and ${fenced}
        and ${cursor === undefined ? sql`true` : afterCursor(outerKeys, cursor)}
      order by ${orderBy(outerKeys, tie)}
      limit ${take}
    ) p on true
  `;
  const rounds = (take: number) => [...new Set([take * 2, take * 16, candidates].map((n) => Math.min(n, candidates)))];
  /** Reads rows in key order in growing rounds; `complete` is false when even the largest round couldn't settle the page. */
  const pass = async (
    inner: WorkspaceTx,
    take: number,
    rows: SQL,
    key: SQL,
  ): Promise<{ rows: readonly PageRow[]; complete: boolean }> => {
    for (const cap of rounds(take)) {
      // One row always comes back (the counts), with the page's fields null when nothing matched.
      const result = (await inner.execute<Omit<PageRow, 'id'> & { id: string | null }>(capped(take, cap, rows, key)))
        .rows;
      const scanned = Number(result[0]?.scanned_ ?? 0);
      const edge = result[0]?.edge_ ?? null;
      const found = result.filter((row): row is PageRow => row.id !== null);
      // When the cap cut a group of equal first keys, a later sort may still move rows inside it: drop that group.
      const safe = scanned >= cap && rest.length > 0 ? found.filter((row) => String(row.key0) !== edge) : found;
      if (safe.length >= take || scanned < cap) return { rows: safe.slice(0, take), complete: true };
    }
    return { rows: [], complete: false };
  };
  const options = drive.options;
  const valued: Branch = async (inner, take, skip) => {
    if (skip > 0) return run(filterFirst)(inner, take, skip);
    if (options === undefined) {
      const single = await pass(inner, take, drive.rows, drive.key.expression);
      return single.complete ? single.rows : run(filterFirst)(inner, take, skip);
    }
    // A select or status: one option's index range at a time, in option order, from the cursor's option on.
    const order = options.map((_, index) => index);
    if (!ascending) order.reverse();
    const from = cursorKey === null || cursorKey === undefined ? undefined : Number(cursorKey);
    const found: PageRow[] = [];
    for (const index of order) {
      if (from !== undefined && (ascending ? index < from : index > from)) continue;
      const optionRows = options[index];
      if (optionRows === undefined) continue;
      const part = await pass(inner, take - found.length, optionRows, sql`${index}::int`);
      if (!part.complete) return run(filterFirst)(inner, take, skip);
      found.push(...part.rows);
      if (found.length >= take) break;
    }
    return found.slice(0, take);
  };
  return {
    branches: inEmpties ? [run(empties)] : [valued, run(empties)],
    keyCount: keys.length,
    limit,
    isList,
    ...(inEmpties
      ? {}
      : { countFirst: sql`select count(*)::int as n from ${tables} ${drive.source} where ${where} and ${filter}` }),
    explain: (take, skip) =>
      inEmpties
        ? [empties(take, skip)]
        : [capped(take, take * 2, drive.rows, drive.key.expression), filterFirst(take, skip), empties(take, skip)],
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
 * The first page of a view, the page after a cursor, or the page at a
 * position. `tuning.candidates` lowers the first pass's cap, for tests.
 */
export async function queryPage(
  scope: EngineScope,
  query: PageQuery,
  tuning: { readonly candidates?: number } = {},
): Promise<Page> {
  checkPage(query);
  return scope.db.withWorkspace(scope.workspaceId, async (tx) => {
    const built = await buildPage(tx, scope, query, tuning.candidates);
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
  });
}

/** How long a count may run before it is cancelled. */
const COUNT_TIMEOUT = '10s';

/**
 * The exact number of rows a view's filter matches, in its own statement
 * with a 10 second timeout. Aborting `signal` cancels it; either way the
 * refusal is `QUERY_CANCELLED`.
 */
export async function countMatches(
  scope: EngineScope,
  query: ViewSource & QueryClock & { readonly filter?: FilterGroup },
  signal?: AbortSignal,
): Promise<number> {
  const cancelled = () => refuse('QUERY_CANCELLED', 'The count took too long or was cancelled.');
  if (signal?.aborted === true) throw cancelled();
  try {
    return await scope.db.withWorkspace(scope.workspaceId, async (tx) => {
      const { context, level } = await prepare(tx, scope, query);
      const filter = compileFilter(context, level, query.filter);
      const { tables, where } = fromParts(level);
      await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${COUNT_TIMEOUT}'`)}`);
      const pid = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      const backend = pid.rows[0]?.pid;
      const cancel = () => {
        if (backend === undefined) return;
        void scope.db
          .withWorkspace(scope.workspaceId, (other) => other.execute(sql`select pg_cancel_backend(${backend})`))
          .catch(() => undefined);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const result = await tx.execute<{ n: string }>(
          sql`select count(*)::text as n from ${tables} where ${where} and ${filter}`,
        );
        return Number(result.rows[0]?.n ?? 0);
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    });
  } catch (error) {
    if (postgresError(error)?.code === '57014') throw cancelled();
    throw error;
  }
}
