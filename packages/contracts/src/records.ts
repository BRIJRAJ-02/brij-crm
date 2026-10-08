// Records as the People table reads and writes them (spec 0005): a window of
// rows, the total, records by id (what a change event's ids are read back
// through), creating one, and setting its values.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiRefusal } from './errors.ts';
import { ActorReferenceValue, Timestamp } from './values/attribute-values.ts';
import { FilterGroup } from './values/filters.ts';
import { RecordRefDisplay } from './values/options.ts';
import { SortRules } from './values/sorts.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The most rows one `records.query` answers. */
export const MAX_QUERY_LIMIT = 200;

/** The most links one multi reference cell carries in a RecordView; `linkTotals` counts the rest. */
export const MAX_CELL_LINKS = 20;

/** The most records one `records.get` reads. */
export const MAX_GET_IDS = 500;

/** The most attributes one read names (`attributeIds`, spec 0006, AC-55). */
export const MAX_READ_ATTRIBUTES = 250;

/**
 * Which attributes a read returns (spec 0006, AC-55): only these, plus the
 * object's primary attribute (the record's name). Ids that aren't the
 * object's are ignored, not refused, so they reveal nothing. Absent reads
 * every attribute.
 */
const ReadAttributeIds = z
  .array(z.uuid())
  .max(MAX_READ_ATTRIBUTES, `Read at most ${String(MAX_READ_ATTRIBUTES)} attributes at once.`);

/**
 * The query clock (spec 0006, AC-51): relative dates in a filter ("in the
 * last 7 days") resolve against `now` in `timeZone`. The browser takes one
 * `now` per window and sends it with every block and count of that window,
 * so two blocks never disagree about "today". The server's clock and UTC
 * when absent; an unknown zone is refused `FILTER_INVALID`.
 */
const QueryClock = {
  now: Timestamp.optional(),
  timeZone: z.string().min(1).max(64).optional(),
};

/** The most records one `records.setValuesBatch` changes (spec 0006, AC-50); more is refused 422 `CONFIG_INVALID`. */
export const MAX_BATCH_RECORDS = 500;

/** The most cells one `records.setValuesBatch` changes across its records; more is refused 422 `CONFIG_INVALID`. */
export const MAX_BATCH_CELLS = 5_000;

/**
 * A record as a screen holds it: its id and object, who made and last changed
 * it and when, how it shows as a chip (`display`), and its current values by
 * attribute id, system attributes included, each in its type's shape (empty
 * is `null`). A multi reference cell lists at most `MAX_CELL_LINKS` links, in
 * order; `linkTotals` holds the full count only for the cells cut short
 * (absent means the list is whole), so a cell can show "and 4,980 more".
 *
 * `versions` holds each cell's current value version by attribute id: the
 * uuid v7 of the write that set it (a cleared cell keeps the clearing
 * write's; a reference cell has its latest current link's). A cell never set,
 * a reference with no current link, and a system attribute have none. Later
 * writes have greater versions, so the client orders by them: a RecordView or
 * event read back never replaces a cell the client holds at a newer version
 * with an older one.
 *
 * `revision` grows with every write to the record's row (each value or near
 * side link write, a delete, a restore; spec 0006, AC-44): the client never
 * lets a read with a lower revision than the one it holds replace it.
 */
export const RecordView = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  createdAt: Timestamp,
  createdBy: ActorReferenceValue,
  updatedAt: Timestamp,
  updatedBy: ActorReferenceValue,
  display: RecordRefDisplay,
  revision: z.number().int().min(0),
  values: z.record(z.string(), z.unknown()),
  versions: z.record(z.string(), z.uuid()),
  linkTotals: z.record(z.string(), z.number().int().min(0)),
});
/** A record as a screen holds it. */
export type RecordView = z.infer<typeof RecordView>;

/**
 * One window of an object's records: from row `position` (a scrollbar jump,
 * on a view `canJump` allows: no filter, and no sort or one on a stored key
 * kind, created at, updated at or record id) or after `cursor` (the last
 * page's `nextCursor`), `limit` rows (1 to 200, 50 when not given). With no
 * sort, rows come in id order, which is creation order. A cursor belongs to
 * the object, filter and sorts it came from: sent with any other, it is
 * refused 400 `INPUT_INVALID` on `cursor` (start again from the top).
 */
export const QueryRecordsInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  position: z.number().int().min(0).optional(),
  cursor: z.string().min(1).max(4_096).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_QUERY_LIMIT, `Ask for at most ${String(MAX_QUERY_LIMIT)} rows.`)
    .optional(),
  filter: FilterGroup.optional(),
  sorts: SortRules.optional(),
  attributeIds: ReadAttributeIds.optional(),
  ...QueryClock,
}).refine((input) => input.position === undefined || input.cursor === undefined, {
  error: 'Give a position or a cursor, not both.',
  path: ['cursor'],
});
/** One window of an object's records. */
export type QueryRecordsInput = z.infer<typeof QueryRecordsInput>;

/** A window of records in order, and the cursor for the next when there are more. */
export const RecordPage = z.object({
  records: z.array(RecordView),
  nextCursor: z.string().optional(),
});
/** A window of records. */
export type RecordPage = z.infer<typeof RecordPage>;

/** How many of an object's live records there are (or match `filter`). */
export const CountRecordsInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  filter: FilterGroup.optional(),
  ...QueryClock,
});
/** How many of an object's records there are. */
export type CountRecordsInput = z.infer<typeof CountRecordsInput>;

/** A count: exact for an unfiltered object; a filtered one stops at 10,000 with `atLeast` true. */
export const RecordCount = z.object({
  count: z.number().int().min(0),
  atLeast: z.boolean(),
});
/** A count of records. */
export type RecordCount = z.infer<typeof RecordCount>;

/** Records by id, up to 500, in the order asked. */
export const GetRecordsInput = WorkspaceScoped.extend({
  ids: z.array(z.uuid()).max(MAX_GET_IDS, `Read at most ${String(MAX_GET_IDS)} records at once.`),
  attributeIds: ReadAttributeIds.optional(),
});
/** Records by id. */
export type GetRecordsInput = z.infer<typeof GetRecordsInput>;

/** Values by attribute id, as a write gives them. */
const ValuesById = z.record(z.uuid(), z.unknown());

/**
 * A new record: its object, a uuid v7 the browser mints (the retry key:
 * sending the same request again answers the record already made), its first
 * values by attribute id, and the write's `mutationId`. An id whose time is
 * more than 10 minutes from the server's clock is refused 400 `INPUT_INVALID`
 * on `id` (the device's clock is wrong), unless it is a retry of a record
 * already made.
 */
export const CreateRecordInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  id: z.uuid({ version: 'v7', message: 'The record id must be a UUID v7.' }),
  values: ValuesById.optional(),
  mutationId: z.uuid(),
});
/** A new record. */
export type CreateRecordInput = z.infer<typeof CreateRecordInput>;

/**
 * One attribute's new value (`null` clears it). `baseVersionId` is the
 * version the browser's server copy held when the edit began (`null` when it
 * held none): a save over a newer version still lands (the last save wins),
 * and the change event names the version it replaced (spec 0006, AC-45,
 * AC-46). `ifVersionId` (undo, AC-49) lands the record's write only while the
 * cell is still at exactly that version: otherwise 409 `VERSION_CHANGED`,
 * naming the attribute, and nothing on the record is written.
 */
export const ValueChangeInput = z.object({
  value: z.unknown(),
  baseVersionId: z.uuid().nullable().optional(),
  ifVersionId: z.uuid().optional(),
});
/** One attribute's new value. */
export type ValueChangeInput = z.infer<typeof ValueChangeInput>;

/** New values for one record, by attribute id, all or none, and the write's `mutationId`. */
export const SetValuesInput = WorkspaceScoped.extend({
  recordId: z.uuid(),
  values: z.record(z.uuid(), ValueChangeInput),
  mutationId: z.uuid(),
});
/** New values for one record. */
export type SetValuesInput = z.infer<typeof SetValuesInput>;

/**
 * A record a write answers: fresh, plus `echoes`, how many change events
 * carry the write's `mutationId` (one per object it touched; 0 when it
 * changed nothing), so the tab that sent it skips exactly its own echoes
 * (spec 0006, AC-60). An older client ignores it.
 */
export const WrittenRecord = RecordView.extend({
  echoes: z.number().int().min(0),
  /**
   * The version this write made for each attribute it changed, by attribute
   * id; an attribute it left unchanged is absent. Taken from the write
   * itself, never from the read back after it (someone may have written in
   * between), so it is what the tab can call its own (spec 0006).
   */
  written: z.record(z.uuid(), z.uuid()),
});
/** A record a write answers, with its echo count. */
export type WrittenRecord = z.infer<typeof WrittenRecord>;

/** One record's new values in a batch. */
export const BatchItem = z.object({
  recordId: z.uuid(),
  values: z.record(z.uuid(), ValueChangeInput),
});
/** One record's new values in a batch. */
export type BatchItem = z.infer<typeof BatchItem>;

/**
 * New values for up to 500 records at once (a paste, a range clear, an undo;
 * spec 0006, AC-50), one `mutationId` for the whole batch. More than 500 is
 * refused whole, 422 `CONFIG_INVALID`.
 */
export const SetValuesBatchInput = WorkspaceScoped.extend({
  // Twice the cap, so a batch a little over it still answers the engine's CONFIG_INVALID, and junk stops at parsing.
  items: z.array(BatchItem).max(MAX_BATCH_RECORDS * 2, `Change at most ${String(MAX_BATCH_RECORDS)} records at once.`),
  mutationId: z.uuid(),
});
/** New values for many records. */
export type SetValuesBatchInput = z.infer<typeof SetValuesBatchInput>;

/**
 * One record's outcome in a batch, in the order asked: the fresh `record`
 * when its values landed (each record all or none), or its `refusals` (one
 * per attribute, as a single write's error data lists them). A record that
 * landed and was then trashed before the read back answers `RECORD_DELETED`.
 */
export const BatchRecordResult = z.object({
  recordId: z.uuid(),
  record: RecordView.optional(),
  /** With `record`: the version this write made for each attribute it changed (as `WrittenRecord.written`). */
  written: z.record(z.uuid(), z.uuid()).optional(),
  refusals: z.array(ApiRefusal).optional(),
});
/** One record's outcome in a batch. */
export type BatchRecordResult = z.infer<typeof BatchRecordResult>;

/** A batch's outcomes, one per record asked, and how many change events carry its `mutationId`. */
export const BatchResults = z.object({
  results: z.array(BatchRecordResult),
  echoes: z.number().int().min(0),
});
/** A batch's outcomes. */
export type BatchResults = z.infer<typeof BatchResults>;

/**
 * An object's records. `query` refuses a bad cursor or filter with
 * `FILTER_INVALID` and a statement past its time with `QUERY_CANCELLED`;
 * `query` and `count` are cancelled with their request, and together run at
 * most 6 at once per workspace (per API process): one more answers 429
 * `TOO_MANY_REQUESTS`, worth retrying a moment later. `get` leaves out ids that are
 * unknown or in the trash. `create` and `setValues` answer the fresh record;
 * their refusals list one entry per attribute (`VALUE_REQUIRED`,
 * `ATTRIBUTE_VALUE_INVALID`, `UNIQUE_CONFLICT`). `create` with an id already
 * made for this object answers that record (a retry after a lost response),
 * or `RECORD_DELETED` once it is in the trash; `setValues` on a record in the
 * trash is `RECORD_DELETED`. Either write answering `RECORD_DELETED` after
 * its values were accepted means the record went to the trash between the
 * write and its read back: the write committed, and the client should drop
 * the record (as for an event that trashes it). A replay answers only the member who made the
 * record: another member's record with that id is `ID_TAKEN` on `id`. An
 * unknown object or record is 404 `NOT_FOUND`. `setValues` with an
 * `ifVersionId` the cell has moved on from is 409 `VERSION_CHANGED`.
 * `setValuesBatch` answers 200 with each record's outcome; only a malformed
 * or oversized batch is refused whole. Every write answers `echoes`.
 */
export const recordsContract = {
  query: oc.input(QueryRecordsInput).output(RecordPage),
  count: oc.input(CountRecordsInput).output(RecordCount),
  get: oc.input(GetRecordsInput).output(z.array(RecordView)),
  create: oc.input(CreateRecordInput).output(WrittenRecord),
  setValues: oc.input(SetValuesInput).output(WrittenRecord),
  setValuesBatch: oc.input(SetValuesBatchInput).output(BatchResults),
};
