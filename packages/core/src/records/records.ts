// Records as the People table reads and writes them (spec 0005): a window of
// rows, creating a record with a browser minted id (and answering a retry of
// it), and setting values, each write answering the fresh record. Every read
// and write goes through the scope the access door made.
import { eq } from 'drizzle-orm';
import type { RecordPage, RecordView } from '@crm/contracts';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
import { schema } from '@crm/db';
import { canonicalId, isUuidV7, uuidV7Time } from '../engine/ids.ts';
import { queryPage } from '../engine/query/page.ts';
import { createRecord, getRecords, setValues, type ValueInput } from '../engine/records.ts';
import { inputInvalid, isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { AfterWrite } from '../engine/write.ts';

const { records } = schema;

/** One window of an object's records: from a position, or after a cursor. */
export interface RecordWindow {
  readonly objectId: string;
  readonly position?: number;
  readonly cursor?: string;
  readonly limit?: number;
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
}

/**
 * One window of an object's live records in order (id order, which is
 * creation order, when no sort is given), and the cursor for the next when
 * there are more. Aborting `signal` (the request's) cancels the statement
 * running; an already aborted one takes no connection. Refuses as the
 * engine's `queryPage` does.
 */
export async function queryRecords(
  scope: EngineScope,
  window: RecordWindow,
  signal?: AbortSignal,
): Promise<RecordPage> {
  const page = await queryPage(
    scope,
    {
      objectId: window.objectId,
      ...(window.position === undefined ? {} : { position: window.position }),
      ...(window.cursor === undefined ? {} : { cursor: window.cursor }),
      ...(window.limit === undefined ? {} : { limit: window.limit }),
      ...(window.filter === undefined ? {} : { filter: window.filter }),
      ...(window.sorts === undefined ? {} : { sorts: window.sorts }),
    },
    signal === undefined ? {} : { signal },
  );
  return page.nextCursor === undefined
    ? { records: [...page.records] }
    : { records: [...page.records], nextCursor: page.nextCursor };
}

/** Live records by id, in the order asked; unknown, malformed and trashed ids are left out. */
export async function readRecordsById(scope: EngineScope, ids: readonly string[]): Promise<RecordView[]> {
  return [...(await getRecords(scope, { ids }))];
}

/** One live record, read after its write committed, or `RECORD_DELETED` if it went to the trash meanwhile. */
async function freshRecord(scope: EngineScope, recordId: string): Promise<RecordView> {
  const [view] = await getRecords(scope, { ids: [recordId] });
  if (view === undefined) throw refuse('RECORD_DELETED', 'That record is in the trash. Restore it first.');
  return view;
}

/** A new record: its object, the browser's uuid v7, and its first values by attribute id. */
export interface AddRecordInput {
  readonly objectId: string;
  readonly id: string;
  readonly values?: Readonly<Record<string, unknown>>;
}

/** How far a new record's id time may be from the server's clock: past it, the device's clock is wrong. */
export const MAX_ID_CLOCK_SKEW_MS = 10 * 60 * 1000;

/** What a create with an id from a device whose clock is off answers, on the `id` field. */
export const CLOCK_SKEW_MESSAGE =
  "This record couldn't be saved because this device's clock looks wrong. Check its time, then try again.";

/**
 * Creates a record with the id the browser minted and answers it fresh
 * (spec 0005, AC-35). The id is the retry key: when it is already taken by a
 * record this actor made for the same object (an earlier try whose response
 * was lost), that record is the answer, or `RECORD_DELETED` once it is in
 * the trash; when anyone else's record holds it, `ID_TAKEN`. An id whose
 * time is more than 10 minutes from `now` (the server's clock) is refused on
 * `id`, but only after that lookup, so a late retry still replays. The hooks
 * run in the write's transaction, and not at all on a replay.
 */
export async function addRecord(
  scope: EngineScope,
  input: AddRecordInput,
  hooks: readonly AfterWrite[] = [],
  now: number = Date.now(),
): Promise<RecordView> {
  if (isUuidV7(input.id) && Math.abs(uuidV7Time(input.id) - now) > MAX_ID_CLOCK_SKEW_MS) {
    const replayed = await replayCreate(scope, input);
    if (replayed !== undefined) return replayed;
    throw inputInvalid('id', CLOCK_SKEW_MESSAGE);
  }
  try {
    const { recordId } = await createRecord(
      scope,
      { objectId: input.objectId, id: input.id, ...(input.values === undefined ? {} : { values: input.values }) },
      hooks,
    );
    return await freshRecord(scope, recordId);
  } catch (error) {
    if (!isRefusal(error) || error.refusal.code !== 'ID_TAKEN') throw error;
    const replayed = await replayCreate(scope, input);
    if (replayed === undefined) throw error;
    return replayed;
  }
}

/**
 * A create's earlier try, if it made the record: that record when this actor
 * made it for this object, or why not (`RECORD_DELETED` for its own record in
 * the trash, `ID_TAKEN` for anyone else's). Undefined when no record holds
 * the id.
 */
async function replayCreate(scope: EngineScope, input: AddRecordInput): Promise<RecordView | undefined> {
  const id = canonicalId(input.id);
  const [row] = await scope.db.withWorkspace(scope.workspaceId, (tx) =>
    tx
      .select({
        objectId: records.objectId,
        deletedAt: records.deletedAt,
        createdByType: records.createdByType,
        createdById: records.createdById,
      })
      .from(records)
      .where(eq(records.id, id)),
  );
  if (row === undefined) return undefined;
  const isOwnTry =
    row.objectId === canonicalId(input.objectId) &&
    row.createdByType === scope.actor.type &&
    row.createdById === scope.actor.id;
  if (!isOwnTry) throw refuse('ID_TAKEN', 'A record with that id already exists.');
  if (row.deletedAt !== null) {
    throw refuse('RECORD_DELETED', 'That record was created, and is now in the trash. Restore it first.');
  }
  return freshRecord(scope, id);
}

/** New values for one record, by attribute id. */
export interface EditRecordInput {
  readonly recordId: string;
  readonly values: Readonly<Record<string, ValueInput>>;
}

/**
 * Sets values on one record, all or none, and answers it fresh (spec 0005,
 * AC-36). Refuses as the engine's `setValues` does: one refusal per attribute,
 * `RECORD_DELETED` for a record in the trash, `NOT_FOUND` for an unknown one.
 */
export async function editRecord(
  scope: EngineScope,
  input: EditRecordInput,
  hooks: readonly AfterWrite[] = [],
): Promise<RecordView> {
  await setValues(scope, { recordId: input.recordId, values: input.values }, hooks);
  return freshRecord(scope, canonicalId(input.recordId));
}
