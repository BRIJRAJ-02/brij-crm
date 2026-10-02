// One page of a view (spec 0004, AC-6, AC-14, AC-15): the compiled filter and
// sorts over an object's records or a list's entries, paged by keyset cursor
// (or a jump to a position on an unfiltered view), then read back whole. And
// the exact count, as its own cancellable statement.
import { eq, sql, type SQL } from 'drizzle-orm';
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
  isUuid,
  keyText,
  orderBy,
  type CompileContext,
  type Cursor,
  type Level,
  type QueryClock,
} from './compile.ts';

const { lists } = schema;

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

/** The first page of a view, the page after a cursor, or the page at a position. */
export async function queryPage(scope: EngineScope, query: PageQuery): Promise<Page> {
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
  return scope.db.withWorkspace(scope.workspaceId, async (tx) => {
    const { context, level } = await prepare(tx, scope, query);
    const keys = compileSorts(context, level, query.sorts ?? []);
    const filter = compileFilter(context, level, query.filter);
    const { tables, where } = fromParts(level);
    const joins = sql.join(
      keys.flatMap((key) => (key.join === undefined ? [] : [key.join])),
      sql` `,
    );
    const keyColumns = keys.map((key, index) => sql`, ${keyText(key)} as ${sql.raw(`key${String(index)}`)}`);
    const after = cursor === undefined ? sql`true` : afterCursor(keys, cursor);
    const offset = query.position === undefined ? sql`` : sql` offset ${query.position}`;
    const recordColumn = level.listId === null ? sql`r.id` : sql`r.record_id`;
    const result = await tx.execute<Record<string, string | null> & { id: string; record_id: string }>(sql`
      select r.id::text as id, ${recordColumn}::text as record_id${sql.join(keyColumns, sql``)}
      from ${tables} ${joins}
      where ${where} and ${filter} and ${after}
      order by ${orderBy(keys)}
      limit ${limit + 1}${offset}
    `);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    const nextCursor =
      result.rows.length > limit && last !== undefined
        ? encodeCursor({ id: last.id, keys: keys.map((_, index) => last[`key${String(index)}`] ?? null) })
        : undefined;
    const recordIds = [...new Set(rows.map((row) => row.record_id))];
    const records = await readRecords(tx, recordIds);
    const page: Page =
      level.listId === null
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
