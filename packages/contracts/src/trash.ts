// The trash (spec 0022): every trashed record the member may see, newest
// first, and restoring some of them. Records stay 30 days, then the daily
// cleanup removes them for good.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { BULK_INLINE_MAX, BULK_TOO_MANY_MESSAGE, RestoreResults } from './bulk.ts';
import { ActorReferenceValue, Timestamp } from './values/attribute-values.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** The most rows one `trash.query` answers. */
export const MAX_TRASH_PAGE = 200;

/**
 * One record in the trash: its name and look (`display`, "Unnamed <singular>"
 * when its name is empty or hidden from the reader), its object, when and by
 * whom it was deleted, and when the daily cleanup removes it for good.
 */
export const TrashItem = z.object({
  recordId: Uuid,
  objectId: Uuid,
  display: RecordRefDisplay,
  deletedAt: Timestamp,
  /** Absent where a field rule hides Created by or Updated by on the record's object from the reader (spec 0017). */
  deletedBy: ActorReferenceValue.optional(),
  expiresAt: Timestamp,
});
/** One record in the trash. */
export type TrashItem = z.infer<typeof TrashItem>;

/** A page of the trash, of one object or all: after `cursor` (the last page's `nextCursor`), up to `limit` (100). */
export const QueryTrashInput = WorkspaceScoped.extend({
  objectId: Uuid.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_TRASH_PAGE, `Ask for at most ${String(MAX_TRASH_PAGE)} rows.`)
    .optional(),
});
/** A page of the trash to read. */
export type QueryTrashInput = z.infer<typeof QueryTrashInput>;

/** A page of the trash, most recently deleted first, and the cursor for the next when there are more. */
export const TrashPage = z.object({
  items: z.array(TrashItem),
  nextCursor: z.string().optional(),
});
/** A page of the trash. */
export type TrashPage = z.infer<typeof TrashPage>;

/** How many records the trash holds, of one object or all. */
export const CountTrashInput = WorkspaceScoped.extend({
  objectId: Uuid.optional(),
});
/** A trash count to read. */
export type CountTrashInput = z.infer<typeof CountTrashInput>;

/** The trash's count: exact up to 10,000, then 10,000 with `atLeast`. */
export const TrashCount = z.object({
  count: z.number().int().min(0),
  atLeast: z.boolean(),
});
/** The trash's count. */
export type TrashCount = z.infer<typeof TrashCount>;

/** Up to 500 records to bring back from the trash, of any objects. */
export const RestoreTrashInput = WorkspaceScoped.extend({
  recordIds: z
    .array(Uuid)
    .min(1, 'Choose at least one record.')
    .max(BULK_INLINE_MAX * 2, BULK_TOO_MANY_MESSAGE),
  mutationId: Uuid,
});
/** Records to restore. */
export type RestoreTrashInput = z.infer<typeof RestoreTrashInput>;

/** Up to 500 records in the trash to delete forever (owners and admins, `records.purge`). */
export const DeleteForeverInput = RestoreTrashInput;
/** Records to delete forever. */
export type DeleteForeverInput = z.infer<typeof DeleteForeverInput>;

/** One record's outcome in Delete forever: removed for good, or not in the trash (live, gone, or hidden). */
export const PurgeOutcome = z.object({
  recordId: Uuid,
  state: z.enum(['purged', 'not-in-trash']),
});
/** One record's outcome in Delete forever. */
export type PurgeOutcome = z.infer<typeof PurgeOutcome>;

/** Delete forever's outcomes, one per record asked, and how many change events carry its `mutationId`. */
export const DeleteForeverResults = z.object({
  results: z.array(PurgeOutcome),
  echoes: z.number().int().min(0),
});
/** Delete forever's outcomes. */
export type DeleteForeverResults = z.infer<typeof DeleteForeverResults>;

/**
 * The trash. `query` refuses a cursor that doesn't decode with
 * `FILTER_INVALID`, and an object the member can't see with `NOT_FOUND`;
 * `restore` answers each record's outcome (refused ones stay in the trash
 * with their reason), 422 `CONFIG_INVALID` over 500. `deleteForever` (spec
 * 0022, milestone 4) answers 403 `FORBIDDEN` "Only workspace owners and admins
 * can delete records forever." to anyone without `records.purge`, removing
 * nothing; Empty trash and more than 500 start a `records.purge` job
 * (`records.startBulk`).
 */
export const trashContract = {
  query: oc.input(QueryTrashInput).output(TrashPage),
  count: oc.input(CountTrashInput).output(TrashCount),
  restore: oc.input(RestoreTrashInput).output(RestoreResults),
  deleteForever: oc.input(DeleteForeverInput).output(DeleteForeverResults),
};
