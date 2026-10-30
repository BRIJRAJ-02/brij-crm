// A board's first load (spec 0021, `records.groups`): one page and one count
// per column, each column being the view's filter and one option of the
// grouping attribute (or no value), all inside one workspace transaction
// under one deadline for the whole call. Unfiltered counts come from the
// stored sort keys, exact however large; filtered ones from `countMatches`'s
// capped statement. The pages are `queryPage`'s own, so no new compiler path.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { BOARD_BLOCK, BOARD_MAX_COLUMNS, CHECKBOX_COLUMNS, columnFilter, groupKindOf } from '@crm/contracts/board';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { canonicalId, isUuid } from '../ids.ts';
import type { RecordView } from '../records.ts';
import { postgresError, refuse } from '../refusals.ts';
import type { EngineScope } from '../scope.ts';
import { isArchivedNow, loadAttributes } from '../values.ts';
import { isAborted, withCancel } from './cancel.ts';
import { countIn, countsWhole, readPage, type MatchCount } from './page.ts';
import { attributeVisible, checkObject } from '../../access/visibility.ts';

const { attributeOptions, objects, sortKeys } = schema;

/** How long one `records.groups` call may take in all, every column together (spec 0021). */
export const GROUPS_DEADLINE_MS = 10_000;

/** What a board asks for: its object, grouping attribute, columns, the view's filter and sorts, and the clock. */
export interface GroupsQuery {
  readonly objectId: string;
  readonly groupBy: string;
  /** Each an option id of `groupBy`, or null for the records with no value, in the order to answer. */
  readonly groupIds: readonly (string | null)[];
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
  readonly attributeIds?: readonly string[];
  /** Cards per column: 25 when not given. */
  readonly limit?: number;
  /** Also name the archived options some live record still holds. */
  readonly probeArchived?: boolean;
  readonly now?: string;
  readonly timeZone?: string;
}

/** One column's first cards, its next cursor, and its count. */
export interface RecordGroup extends MatchCount {
  readonly id: string | null;
  readonly records: readonly RecordView[];
  readonly nextCursor?: string;
}

/** A board's columns in the order asked, and the archived options still held when probed. */
export interface Groups {
  readonly groups: readonly RecordGroup[];
  readonly archivedHolding?: readonly string[];
}

/** For tests: a shorter deadline, and a pause before each column (to prove the deadline covers the whole call). */
export interface GroupsTuning {
  readonly deadlineMs?: number;
  readonly beforeColumn?: (tx: WorkspaceTx, index: number) => Promise<void>;
}

const NOT_GROUPABLE = 'Boards group by a status, a single select, a checkbox or a member field.';

/**
 * A board's first cards and counts (spec 0021): for each column asked, the
 * first `limit` records of the view's filter and that option, in the view's
 * sorts, and its count. All of it or none: past the 10 second deadline for
 * the whole call (or when `signal` aborts), the statement running is
 * cancelled and the call refuses `QUERY_CANCELLED`. Refuses
 * `CONFIG_INVALID` when `groupBy` is not a live status or single select of
 * the object, has more than 50 live options, or a column names an option of
 * another attribute; a hidden grouping attribute is `FILTER_INVALID`, as any
 * filter naming it; a hidden object `NOT_FOUND`.
 */
export async function queryGroups(
  scope: EngineScope,
  query: GroupsQuery,
  signal?: AbortSignal,
  tuning: GroupsTuning = {},
): Promise<Groups> {
  const deadlineMs = tuning.deadlineMs ?? GROUPS_DEADLINE_MS;
  const endsAt = Date.now() + deadlineMs;
  const timeLeft = () => endsAt - Date.now();
  const deadline = AbortSignal.timeout(deadlineMs);
  const stop = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
  const tooLong = () => refuse('QUERY_CANCELLED', 'The board took too long to load. Narrow the filter and try again.');
  const cancelled = () =>
    isAborted(signal) ? refuse('QUERY_CANCELLED', 'The board was cancelled. Try again.') : tooLong();
  try {
    return await withCancel(scope, 'query', stop, cancelled, (tx, checkpoint) =>
      readGroups(tx, scope, query, checkpoint, timeLeft, tuning),
    );
  } catch (error) {
    const code = postgresError(error)?.code;
    if (code === '57014') throw cancelled();
    throw error;
  }
}

async function readGroups(
  tx: WorkspaceTx,
  scope: EngineScope,
  query: GroupsQuery,
  checkpoint: () => void,
  timeLeft: () => number,
  tuning: GroupsTuning,
): Promise<Groups> {
  const limitTime = () =>
    tx.execute(sql`set local statement_timeout = ${sql.raw(`'${String(Math.max(1, timeLeft()))}ms'`)}`);
  if (!isUuid(query.objectId)) throw refuse('NOT_FOUND', 'That object does not exist.');
  const objectId = canonicalId(query.objectId);
  await limitTime();
  const [object] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, objectId));
  if (object === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
  // A hidden object answers as an unknown one (spec 0009, AC-140).
  await checkObject(tx, scope.access, objectId, 'read');
  // 1. The grouping attribute: a hidden one answers as any filter naming it would.
  const attributes = await loadAttributes(tx, objectId);
  const groupBy = isUuid(query.groupBy) ? attributes.get(canonicalId(query.groupBy)) : undefined;
  if (groupBy === undefined || !attributeVisible(scope.access, groupBy)) {
    throw refuse('FILTER_INVALID', 'A filter or sort names an attribute that is not on this object.');
  }
  const kind = groupKindOf({
    type: groupBy.type,
    isMulti: groupBy.isMulti,
    isSystem: groupBy.isSystem,
    isArchived: isArchivedNow(groupBy),
  });
  if (kind === undefined) throw refuse('CONFIG_INVALID', NOT_GROUPABLE);
  if (kind !== 'option')
    return readOtherGroups(tx, scope, query, objectId, groupBy.id, kind, checkpoint, timeLeft, tuning);
  const options = await tx
    .select({ id: attributeOptions.id, archivedAt: attributeOptions.archivedAt })
    .from(attributeOptions)
    .where(eq(attributeOptions.attributeId, groupBy.id));
  const live = options.filter((option) => option.archivedAt === null);
  if (live.length > BOARD_MAX_COLUMNS) {
    throw refuse(
      'CONFIG_INVALID',
      `Boards show up to ${String(BOARD_MAX_COLUMNS)} columns. ${groupBy.title} has ${String(live.length)} options.`,
    );
  }
  const known = new Set(options.map((option) => option.id));
  const groupIds = query.groupIds.map((id) => (id === null ? null : isUuid(id) ? canonicalId(id) : id));
  if (groupIds.some((id) => id !== null && !known.has(id))) {
    throw refuse('CONFIG_INVALID', `A column is not an option of ${groupBy.title}.`);
  }
  checkpoint();

  // 2. Archived options some live record holds, so their columns show (and only those).
  const archived = options.filter((option) => option.archivedAt !== null).map((option) => option.id);
  // No record rule for the principal: stored keys count every record they may see.
  const ruleFree = await countsWhole(tx, scope, { objectId });
  const whole = ruleFree && (query.filter === undefined || query.filter.conditions.length === 0);
  checkpoint();
  let archivedHolding: readonly string[] | undefined;
  if (query.probeArchived === true && archived.length === 0) archivedHolding = [];
  else if (query.probeArchived === true) {
    archivedHolding = ruleFree
      ? await probeStored(tx, groupBy.id, archived, limitTime)
      : await probeRuled(tx, scope, objectId, groupBy.id, archived, checkpoint, timeLeft);
  }

  // 3. Counts: unfiltered from the stored keys, exact; filtered by the capped count, per column.
  const totals = whole ? await storedTotals(tx, objectId, groupBy.id, limitTime) : undefined;
  checkpoint();

  // 4. Pages, each column's own, in the order asked.
  const groups: RecordGroup[] = [];
  for (const [index, id] of groupIds.entries()) {
    await tuning.beforeColumn?.(tx, index);
    checkpoint();
    const filter = columnFilter(query.filter, groupBy.id, id, 'option');
    const clock = {
      ...(query.now === undefined ? {} : { now: query.now }),
      ...(query.timeZone === undefined ? {} : { timeZone: query.timeZone }),
    };
    const page = await readPage(
      tx,
      scope,
      {
        objectId,
        filter,
        ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
        limit: query.limit ?? BOARD_BLOCK,
        ...(query.attributeIds === undefined ? {} : { attributeIds: query.attributeIds }),
        ...clock,
      },
      {},
      checkpoint,
      timeLeft,
    );
    checkpoint();
    const count: MatchCount =
      totals === undefined
        ? await countIn(tx, scope, { objectId, filter, ...clock }, checkpoint, {}, timeLeft)
        : { count: id === null ? totals.empty : (totals.byOption.get(id) ?? 0), atLeast: false };
    checkpoint();
    groups.push({
      id,
      records: page.records,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      ...count,
    });
  }
  return archivedHolding === undefined ? { groups } : { groups, archivedHolding };
}

/**
 * A board grouped by a checkbox (Checked and Not checked) or by a member (one column per member, and no one): each
 * column is the view's filter and its condition, counted by the capped count, as a filtered option board is. No
 * archived options to probe. A member column names a member by id; one the reader can't see simply matches nothing.
 */
async function readOtherGroups(
  tx: WorkspaceTx,
  scope: EngineScope,
  query: GroupsQuery,
  objectId: string,
  groupBy: string,
  kind: 'checkbox' | 'member',
  checkpoint: () => void,
  timeLeft: () => number,
  tuning: GroupsTuning,
): Promise<Groups> {
  const allowed = (id: string | null) =>
    kind === 'checkbox'
      ? id !== null && (CHECKBOX_COLUMNS as readonly string[]).includes(id)
      : id === null || isUuid(id);
  if (query.groupIds.length > BOARD_MAX_COLUMNS + 1 || !query.groupIds.every(allowed)) {
    throw refuse('CONFIG_INVALID', 'A column is not one this field groups by.');
  }
  const clock = {
    ...(query.now === undefined ? {} : { now: query.now }),
    ...(query.timeZone === undefined ? {} : { timeZone: query.timeZone }),
  };
  const groups: RecordGroup[] = [];
  for (const [index, raw] of query.groupIds.entries()) {
    await tuning.beforeColumn?.(tx, index);
    checkpoint();
    const id = raw !== null && kind === 'member' ? canonicalId(raw) : raw;
    const filter = columnFilter(query.filter, groupBy, id, kind);
    const page = await readPage(
      tx,
      scope,
      {
        objectId,
        filter,
        ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
        limit: query.limit ?? BOARD_BLOCK,
        ...(query.attributeIds === undefined ? {} : { attributeIds: query.attributeIds }),
        ...clock,
      },
      {},
      checkpoint,
      timeLeft,
    );
    checkpoint();
    const count = await countIn(tx, scope, { objectId, filter, ...clock }, checkpoint, {}, timeLeft);
    checkpoint();
    groups.push({
      id,
      records: page.records,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      ...count,
    });
  }
  return query.probeArchived === true ? { groups, archivedHolding: [] } : { groups };
}

/**
 * Every option's exact count from the stored keys (index only), and the
 * records with no value: the object's live records less the ones with a key.
 */
async function storedTotals(
  tx: WorkspaceTx,
  objectId: string,
  groupBy: string,
  limitTime: () => Promise<unknown>,
): Promise<{ readonly byOption: ReadonlyMap<string, number>; readonly empty: number }> {
  await limitTime();
  const keyed = await tx.execute<{ option_id: string; n: number }>(sql`
    select option_id, count(*)::int as n from sort_keys
    where attribute_id = ${groupBy} and live and option_id is not null
    group by option_id
  `);
  await limitTime();
  const all = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from records r where r.object_id = ${objectId} and r.deleted_at is null`,
  );
  const byOption = new Map(keyed.rows.map((row) => [row.option_id, row.n]));
  const held = [...byOption.values()].reduce((sum, n) => sum + n, 0);
  return { byOption, empty: Math.max(0, (all.rows[0]?.n ?? 0) - held) };
}

/** The archived options of `groupBy` that some live record holds: one index only probe of the stored keys. */
async function probeStored(
  tx: WorkspaceTx,
  groupBy: string,
  archived: readonly string[],
  limitTime: () => Promise<unknown>,
): Promise<readonly string[]> {
  await limitTime();
  const rows = await tx
    .selectDistinct({ optionId: sortKeys.optionId })
    .from(sortKeys)
    .where(and(eq(sortKeys.attributeId, groupBy), eq(sortKeys.live, true), inArray(sortKeys.optionId, [...archived])));
  const held = new Set(rows.map((row) => row.optionId));
  return archived.filter((id) => held.has(id));
}

/**
 * The same under a record rule (spec 0009): a count of one through the
 * compiled predicate per archived option, so a record the principal can't
 * see never makes a column appear.
 */
async function probeRuled(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  groupBy: string,
  archived: readonly string[],
  checkpoint: () => void,
  timeLeft: () => number,
): Promise<readonly string[]> {
  const holding: string[] = [];
  for (const id of archived) {
    const filter = columnFilter(undefined, groupBy, id);
    const { count } = await countIn(tx, scope, { objectId, filter }, checkpoint, { cap: 1 }, timeLeft);
    if (count > 0) holding.push(id);
  }
  return holding;
}
