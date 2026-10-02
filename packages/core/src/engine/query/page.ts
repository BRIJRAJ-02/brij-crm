// One page of an object's records for a view (spec 0004, AC-14, AC-15): the
// compiled filter and sorts, paged by keyset cursor, then read back whole.
import { sql } from 'drizzle-orm';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
import { readRecords, type RecordView } from '../records.ts';
import { refuse } from '../refusals.ts';
import type { EngineScope } from '../scope.ts';
import { loadAttributes } from '../values.ts';
import { afterCursor, compileFilter, compileSorts, orderBy, type Cursor } from './compile.ts';

/** The largest page a view may ask for. */
export const MAX_PAGE = 200;

/** What a view asks for. */
export interface PageQuery {
  readonly objectId: string;
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
  /** The `nextCursor` of the page before, to continue after it. */
  readonly cursor?: string;
  readonly limit?: number;
}

/** One page, and the cursor for the next (absent on the last page). */
export interface Page {
  readonly records: readonly RecordView[];
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
      typeof parsed.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(parsed.id) &&
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

/** The first page of a view, or the page after a cursor. */
export async function queryPage(scope: EngineScope, query: PageQuery): Promise<Page> {
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw refuse('FILTER_INVALID', `Ask for 1 to ${String(MAX_PAGE)} rows at a time.`);
  }
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  return scope.db.withWorkspace(scope.workspaceId, async (tx) => {
    const attributes = await loadAttributes(tx, query.objectId);
    const keys = compileSorts(attributes, query.sorts ?? []);
    const filter = compileFilter(attributes, query.filter);
    const joins = sql.join(
      keys.flatMap((key) => (key.join === undefined ? [] : [key.join])),
      sql` `,
    );
    const keyColumns = keys.map((key, index) => sql`, ${key.asText} as ${sql.raw(`key${String(index)}`)}`);
    const after = cursor === undefined ? sql`true` : afterCursor(keys, cursor);
    const result = await tx.execute<Record<string, string | null> & { id: string }>(sql`
      select r.id::text as id${sql.join(keyColumns, sql``)}
      from records r ${joins}
      where r.object_id = ${query.objectId} and r.deleted_at is null and ${filter} and ${after}
      order by ${orderBy(keys)}
      limit ${limit + 1}
    `);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    const nextCursor =
      result.rows.length > limit && last !== undefined
        ? encodeCursor({ id: last.id, keys: keys.map((_, index) => last[`key${String(index)}`] ?? null) })
        : undefined;
    const records = await readRecords(
      tx,
      rows.map((row) => row.id),
    );
    return nextCursor === undefined ? { records } : { records, nextCursor };
  });
}
