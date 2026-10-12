// Records as the People table reads and writes them (spec 0005): a window of
// rows, creating a record with a browser minted id (and answering a retry of
// it), and setting values, each write answering the fresh record. Every read
// and write goes through the scope the access door made.
import { and, eq, isNotNull } from 'drizzle-orm';
import type { BatchRecordResult, RecordPage, RecordView, TrashedRecord } from '@crm/contracts';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
import { schema } from '@crm/db';
import { canonicalId, checkId, isUuidV7, uuidV7Time } from '../engine/ids.ts';
import { queryPage } from '../engine/query/page.ts';
import {
  createRecord,
  getRecords,
  readRecords,
  setRecordValues,
  setRecordValuesBatch,
  type AttributeResult,
  type ValueInput,
} from '../engine/records.ts';
import { inputInvalid, isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { AttributeDef } from '../engine/values.ts';
import type { AfterWrite } from '../engine/write.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, UNKNOWN_RECORD } from '../access/visibility.ts';

const { objects, records } = schema;

/** One window of an object's records: from a position, or after a cursor. */
export interface RecordWindow {
  readonly objectId: string;
  readonly position?: number;
  readonly cursor?: string;
  readonly limit?: number;
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
  /** Only these attributes' values, plus the primary (spec 0006, AC-55). */
  readonly attributeIds?: readonly string[];
  /** The window's clock (spec 0006, AC-51): relative dates resolve against it. */
  readonly now?: string;
  readonly timeZone?: string;
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
      ...(window.attributeIds === undefined ? {} : { attributeIds: window.attributeIds }),
      ...(window.now === undefined ? {} : { now: window.now }),
      ...(window.timeZone === undefined ? {} : { timeZone: window.timeZone }),
    },
    signal === undefined ? {} : { signal },
  );
  return page.nextCursor === undefined
    ? { records: [...page.records] }
    : { records: [...page.records], nextCursor: page.nextCursor };
}

/**
 * Live records by id, in the order asked; unknown, malformed and trashed ids
 * are left out. With `attributeIds`, only those attributes and the primary.
 */
export async function readRecordsById(
  scope: EngineScope,
  ids: readonly string[],
  attributeIds?: readonly string[],
): Promise<RecordView[]> {
  return [...(await getRecords(scope, { ids, ...(attributeIds === undefined ? {} : { attributeIds }) }))];
}

/**
 * A record in the trash the principal may see (spec 0017): its values as a
 * read gives them, its links hidden until a restore, and when and by whom it
 * was deleted. A live, missing or hidden record is `NOT_FOUND`, the same
 * answer for each: a record the principal couldn't see live is absent from
 * the trash too.
 */
export async function readTrashedRecord(scope: EngineScope, recordId: string): Promise<TrashedRecord> {
  const id = checkId(recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({
        objectId: records.objectId,
        deletedAt: records.deletedAt,
        deletedByType: records.deletedByType,
        deletedById: records.deletedById,
        objectArchivedAt: objects.archivedAt,
      })
      .from(records)
      .innerJoin(objects, and(eq(objects.workspaceId, records.workspaceId), eq(objects.id, records.objectId)))
      .where(and(eq(records.id, id), isNotNull(records.deletedAt)));
    // An archived object's records answer as missing, as `records.activity` does (#13 shows its archived page).
    if (
      row?.deletedAt === null ||
      row?.deletedAt === undefined ||
      row.deletedByType === null ||
      row.objectArchivedAt !== null
    ) {
      throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    }
    // A hidden object answers as a missing record; `readRecords` applies the record rule and the field rules.
    await checkObject(tx, scope.access, row.objectId, 'read', UNKNOWN_RECORD);
    const [record] = await readRecords(tx, scope.access, [id], { trashed: true });
    if (record === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    return {
      record,
      deletedAt: row.deletedAt.toISOString(),
      deletedBy: { type: row.deletedByType, id: row.deletedById },
    };
  });
}

/**
 * A write's answer: the record, read back after it committed, and the
 * version the write itself made for each attribute it changed (spec 0006).
 * The read back may already hold someone else's later version; `written`
 * never does, so the browser calls only these its own.
 */
export interface WrittenView {
  readonly record: RecordView;
  readonly written: Readonly<Record<string, string>>;
}

/** The versions a write made, by attribute id; an unchanged attribute is left out. */
function writtenOf(results: Readonly<Record<string, AttributeResult>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(results).flatMap(([attributeId, result]) =>
      result.versionId === undefined ? [] : [[attributeId, result.versionId]],
    ),
  );
}

/** Attribute definitions a write already loaded, by object id, so its read back doesn't load them again. */
type LoadedAttributes = ReadonlyMap<string, ReadonlyMap<string, AttributeDef>>;

/**
 * One live record, read after its write committed. `RECORD_DELETED` means it
 * went to the trash between the write and this read: the write committed,
 * and the client should drop the record.
 */
async function freshRecord(scope: EngineScope, recordId: string, attributes?: LoadedAttributes): Promise<RecordView> {
  const [view] = await getRecords(scope, { ids: [recordId], ...(attributes === undefined ? {} : { attributes }) });
  if (view === undefined) throw refuse('RECORD_DELETED', 'That record is in the trash. Restore it first.');
  return view;
}

/** A new record: its object, the browser's uuid v7, and its first values by attribute id. */
export interface AddRecordInput {
  readonly objectId: string;
  readonly id: string;
  readonly values?: Readonly<Record<string, unknown>>;
  /** The creator's time zone: date defaults and a rule's relative dates resolve in it (UTC when absent). */
  readonly timeZone?: string | undefined;
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
): Promise<WrittenView> {
  // A replay wrote nothing this time.
  const replay = (record: RecordView): WrittenView => ({ record, written: {} });
  if (isUuidV7(input.id) && Math.abs(uuidV7Time(input.id) - now) > MAX_ID_CLOCK_SKEW_MS) {
    const replayed = await replayCreate(scope, input);
    if (replayed !== undefined) return replay(replayed);
    throw inputInvalid('id', CLOCK_SKEW_MESSAGE);
  }
  try {
    const { recordId, objectId, attributes, versions } = await createRecord(
      scope,
      {
        objectId: input.objectId,
        id: input.id,
        ...(input.values === undefined ? {} : { values: input.values }),
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      },
      hooks,
    );
    return {
      record: await freshRecord(scope, recordId, new Map([[objectId, attributes]])),
      written: writtenOf(versions),
    };
  } catch (error) {
    if (!isRefusal(error) || error.refusal.code !== 'ID_TAKEN') throw error;
    const replayed = await replayCreate(scope, input);
    if (replayed === undefined) throw error;
    return replay(replayed);
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
  const [row] = await inWorkspace(scope, (tx) =>
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
  /** The writer's time zone, for a rule's relative dates (spec 0013); UTC when absent. */
  readonly timeZone?: string | undefined;
}

/**
 * Sets values on one record, all or none, and answers it fresh (spec 0005,
 * AC-36). Refuses as the engine's `setValues` does: one refusal per attribute,
 * `RECORD_DELETED` for a record in the trash, `NOT_FOUND` for an unknown one.
 * The read back reuses the attributes the write loaded. A `RECORD_DELETED`
 * from the read back means the write committed and the record was trashed
 * meanwhile.
 */
export async function editRecord(
  scope: EngineScope,
  input: EditRecordInput,
  hooks: readonly AfterWrite[] = [],
): Promise<WrittenView> {
  const { attributesByObject, results } = await setRecordValues(
    scope,
    {
      recordId: input.recordId,
      values: input.values,
      ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
    },
    hooks,
  );
  return {
    record: await freshRecord(scope, canonicalId(input.recordId), attributesByObject),
    written: writtenOf(results),
  };
}

/** New values for many records (spec 0006, AC-50): each record's by attribute id. */
export interface EditRecordsInput {
  readonly items: readonly EditRecordInput[];
  /** The writer's time zone, for every record's rules (spec 0013); UTC when absent. */
  readonly timeZone?: string | undefined;
}

/** What a record that landed and then went to the trash before its read back answers. */
const TRASHED_SINCE = 'That record is in the trash. Restore it first.';

/**
 * Sets values on up to 500 records in one write (spec 0006, AC-50): each
 * record lands all or nothing under its own savepoint, and the hooks see only
 * those that landed, so one write stores one outbox row per object. Answers
 * each record in the order asked: fresh when it landed (read back in one
 * read, reusing the attributes the write loaded), or its refusals. More than
 * 500 records is refused whole (`CONFIG_INVALID`). A retried batch writes
 * nothing twice: an unchanged value writes nothing.
 */
export async function editRecords(
  scope: EngineScope,
  input: EditRecordsInput,
  hooks: readonly AfterWrite[] = [],
): Promise<BatchRecordResult[]> {
  const { outcomes, attributesByObject } = await setRecordValuesBatch(
    scope,
    { items: input.items, ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }) },
    hooks,
  );
  const landed = [...new Set(outcomes.flatMap((outcome) => (outcome.ok ? [outcome.recordId] : [])))];
  const views = landed.length === 0 ? [] : await getRecords(scope, { ids: landed, attributes: attributesByObject });
  const byId = new Map(views.map((view) => [view.id, view]));
  return outcomes.map((outcome): BatchRecordResult => {
    if (!outcome.ok) {
      return {
        recordId: outcome.recordId,
        refusals: outcome.refusals.map((refusal) => ({
          code: refusal.code,
          message: refusal.message,
          ...(refusal.attributeId === undefined ? {} : { attributeId: refusal.attributeId }),
          ...(refusal.ruleId === undefined ? {} : { ruleId: refusal.ruleId }),
        })),
      };
    }
    const record = byId.get(outcome.recordId);
    return record === undefined
      ? { recordId: outcome.recordId, refusals: [{ code: 'RECORD_DELETED', message: TRASHED_SINCE }] }
      : { recordId: outcome.recordId, record, written: writtenOf(outcome.results) };
  });
}
