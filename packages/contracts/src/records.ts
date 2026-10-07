// Records as the People table reads and writes them (spec 0005): a window of
// rows, the total, records by id (what a change event's ids are read back
// through), creating one, and setting its values.
import { oc } from '@orpc/contract';
import * as z from 'zod';
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

/**
 * A record as a screen holds it: its id and object, who made and last changed
 * it and when, how it shows as a chip (`display`), and its current values by
 * attribute id, system attributes included, each in its type's shape (empty
 * is `null`). A multi reference cell lists at most `MAX_CELL_LINKS` links, in
 * order; `linkTotals` holds the full count only for the cells cut short
 * (absent means the list is whole), so a cell can show "and 4,980 more".
 */
export const RecordView = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  createdAt: Timestamp,
  createdBy: ActorReferenceValue,
  updatedAt: Timestamp,
  updatedBy: ActorReferenceValue,
  display: RecordRefDisplay,
  values: z.record(z.string(), z.unknown()),
  linkTotals: z.record(z.string(), z.number().int().min(0)),
});
/** A record as a screen holds it. */
export type RecordView = z.infer<typeof RecordView>;

/**
 * One window of an object's records: from row `position` (a scrollbar jump,
 * on a view with no filter and at most one sort) or after `cursor` (the last
 * page's `nextCursor`), `limit` rows (1 to 200, 50 when not given). With no
 * sort, rows come in id order, which is creation order.
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
});
/** Records by id. */
export type GetRecordsInput = z.infer<typeof GetRecordsInput>;

/** Values by attribute id, as a write gives them. */
const ValuesById = z.record(z.uuid(), z.unknown());

/**
 * A new record: its object, a uuid v7 the browser mints (the retry key:
 * sending the same request again answers the record already made), its first
 * values by attribute id, and the write's `mutationId`.
 */
export const CreateRecordInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  id: z.uuid({ version: 'v7', message: 'The record id must be a UUID v7.' }),
  values: ValuesById.optional(),
  mutationId: z.uuid(),
});
/** A new record. */
export type CreateRecordInput = z.infer<typeof CreateRecordInput>;

/** One attribute's new value (`null` clears it). */
export const ValueChangeInput = z.object({
  value: z.unknown(),
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
 * trash is `RECORD_DELETED`. An unknown object or record is 404 `NOT_FOUND`.
 */
export const recordsContract = {
  query: oc.input(QueryRecordsInput).output(RecordPage),
  count: oc.input(CountRecordsInput).output(RecordCount),
  get: oc.input(GetRecordsInput).output(z.array(RecordView)),
  create: oc.input(CreateRecordInput).output(RecordView),
  setValues: oc.input(SetValuesInput).output(RecordView),
};
