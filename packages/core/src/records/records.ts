// Records as the People table reads and writes them (spec 0005): a window of
// rows, creating a record with a browser minted id (and answering a retry of
// it), and setting values, each write answering the fresh record. Every read
// and write goes through the scope the access door made.
import { eq } from 'drizzle-orm';
import type { RecordPage, RecordView } from '@crm/contracts';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
import { schema } from '@crm/db';
import { canonicalId } from '../engine/ids.ts';
import { queryPage } from '../engine/query/page.ts';
import { createRecord, getRecords, setValues, type ValueInput } from '../engine/records.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
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
 * there are more. Refuses as the engine's `queryPage` does.
 */
export async function queryRecords(scope: EngineScope, window: RecordWindow): Promise<RecordPage> {
  const page = await queryPage(scope, {
    objectId: window.objectId,
    ...(window.position === undefined ? {} : { position: window.position }),
    ...(window.cursor === undefined ? {} : { cursor: window.cursor }),
    ...(window.limit === undefined ? {} : { limit: window.limit }),
    ...(window.filter === undefined ? {} : { filter: window.filter }),
    ...(window.sorts === undefined ? {} : { sorts: window.sorts }),
  });
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

/**
 * Creates a record with the id the browser minted and answers it fresh
 * (spec 0005, AC-35). The id is the retry key: when it is already taken by a
 * live record of the same object (an earlier try whose response was lost),
 * that record is the answer; when that record is in the trash, the refusal
 * is `RECORD_DELETED`; when another object's record holds it, `ID_TAKEN`.
 * The hooks run in the write's transaction, and not at all on a replay.
 */
export async function addRecord(
  scope: EngineScope,
  input: AddRecordInput,
  hooks: readonly AfterWrite[] = [],
): Promise<RecordView> {
  try {
    const { recordId } = await createRecord(
      scope,
      { objectId: input.objectId, id: input.id, ...(input.values === undefined ? {} : { values: input.values }) },
      hooks,
    );
    return await freshRecord(scope, recordId);
  } catch (error) {
    if (!isRefusal(error) || error.refusal.code !== 'ID_TAKEN') throw error;
    return replayCreate(scope, input, error);
  }
}

/** Answers a create whose id is taken: the earlier try's record, or why not. */
async function replayCreate(scope: EngineScope, input: AddRecordInput, taken: Error): Promise<RecordView> {
  const id = canonicalId(input.id);
  const [row] = await scope.db.withWorkspace(scope.workspaceId, (tx) =>
    tx.select({ objectId: records.objectId, deletedAt: records.deletedAt }).from(records).where(eq(records.id, id)),
  );
  if (row === undefined || row.objectId !== canonicalId(input.objectId)) throw taken;
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
