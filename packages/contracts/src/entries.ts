// List entries (spec 0048): each record in a list is an entry, with values of
// its own (a stage, an owner on this list) beside the record's. A list's rows
// are windows of entries, each read with its record, which the browser keeps in
// the record store, so one record shows one copy everywhere (AC-4840).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiRefusal } from './errors.ts';
import { BOARD_GROUPS_PER_CALL, BOARD_MAX_GROUP_LIMIT } from './board-model.ts';
import {
  GroupId,
  MAX_QUERY_LIMIT,
  QueryClock,
  ReadAttributeIds,
  RecordView,
  ValueChangeInput,
  WriteTimeZone,
} from './records.ts';
import { ActorReferenceValue, Timestamp } from './values/attribute-values.ts';
import { FilterGroup } from './values/filters.ts';
import { SortRules } from './values/sorts.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';
import { BULK_EXCEPT_MAX, BULK_IDS_MAX, BulkTarget } from './bulk.ts';
import { JobView } from './jobs.ts';

/** The most entries one batch write (`remove`, `restore`) names, and `get` reads. */
export const MAX_ENTRY_BATCH = 500;

/** The most records one `entries.membership` asks about: the Add dialog's results. */
export const MAX_MEMBERSHIP_IDS = 50;

/**
 * One entry as a screen holds it: its list and record, who added it and when
 * (the list's Added and Added by fields read these too), who changed it last,
 * its own values by list attribute id (system fields included) and each cell's
 * current version, as a record's (spec 0006, AC-45). A list attribute hidden
 * from the reader is absent.
 */
export const EntryView = z.object({
  id: Uuid,
  listId: Uuid,
  recordId: Uuid,
  createdAt: Timestamp,
  createdBy: ActorReferenceValue,
  updatedAt: Timestamp,
  updatedBy: ActorReferenceValue,
  values: z.record(z.string(), z.unknown()),
  versions: z.record(z.string(), Uuid),
});
/** One entry. */
export type EntryView = z.infer<typeof EntryView>;

/**
 * One window of a list's entries (AC-4809), as `records.query` reads an
 * object's: from row `position` or after `cursor`, `limit` rows (1 to 200, 50
 * when not given), in the view's `filter` and `sorts`, which name list fields
 * and the object's fields alike. With no sort, rows come in entry order, which
 * is the order they were added. `attributeIds` names the record fields the
 * rows show (the record's name always comes); every list field comes.
 */
export const QueryEntriesInput = WorkspaceScoped.extend({
  listId: Uuid,
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
/** One window of a list's entries. */
export type QueryEntriesInput = z.infer<typeof QueryEntriesInput>;

/** Entries in order, their records (each once), and the cursor for the next window when there are more. */
export const EntryPage = z.object({
  entries: z.array(EntryView),
  records: z.array(RecordView),
  nextCursor: z.string().optional(),
});
/** A window of entries and their records. */
export type EntryPage = z.infer<typeof EntryPage>;

/** How many of a list's live entries there are (or match `filter`), as the caller may see them. */
export const CountEntriesInput = WorkspaceScoped.extend({
  listId: Uuid,
  filter: FilterGroup.optional(),
  ...QueryClock,
});
/** How many of a list's entries there are. */
export type CountEntriesInput = z.infer<typeof CountEntriesInput>;

/** Entries by id, up to 500, with their records: what a live event's ids are read back through. */
export const GetEntriesInput = WorkspaceScoped.extend({
  ids: z.array(Uuid).max(MAX_ENTRY_BATCH, `Read at most ${String(MAX_ENTRY_BATCH)} entries at once.`),
  attributeIds: ReadAttributeIds.optional(),
});
/** Entries by id. */
export type GetEntriesInput = z.infer<typeof GetEntriesInput>;

/** Which of these records already have a live entry in the list (the Add dialog's "Already in this list"). */
export const EntryMembershipInput = WorkspaceScoped.extend({
  listId: Uuid,
  recordIds: z.array(Uuid).max(MAX_MEMBERSHIP_IDS, `Ask about at most ${String(MAX_MEMBERSHIP_IDS)} records at once.`),
});
/** Which records are in a list already. */
export type EntryMembershipInput = z.infer<typeof EntryMembershipInput>;

/** The asked records that have a live entry in the list, as the caller may see them. */
export const EntryMembership = z.object({ recordIds: z.array(Uuid) });
/** The asked records already in a list. */
export type EntryMembership = z.infer<typeof EntryMembership>;

/**
 * A new entry (AC-4813): a UUID v7 the browser mints (the retry key: the same
 * add again answers the entry already made for that list and record), the
 * list, the record, its first list values by attribute id, and the writer's
 * time zone for date defaults.
 */
export const AddEntryInput = WorkspaceScoped.extend({
  id: uuidV7('The entry id must be a UUID v7.'),
  listId: Uuid,
  recordId: Uuid,
  values: z.record(z.uuid(), z.unknown()).optional(),
  timeZone: WriteTimeZone,
  mutationId: Uuid,
});
/** A new entry. */
export type AddEntryInput = z.infer<typeof AddEntryInput>;

/**
 * Records to add to a list, 1 to 500 at once (AC-4825). `ids` are the entries'
 * client minted UUID v7s, one per record in the same order: the same call
 * again answers the entries it made.
 */
export const AddEntriesInput = WorkspaceScoped.extend({
  listId: Uuid,
  recordIds: z
    .array(Uuid)
    .min(1, 'Name at least one record.')
    .max(MAX_ENTRY_BATCH, `Add at most ${String(MAX_ENTRY_BATCH)} records at once.`),
  ids: z
    .array(uuidV7('The entry id must be a UUID v7.'))
    .max(MAX_ENTRY_BATCH, `Add at most ${String(MAX_ENTRY_BATCH)} records at once.`)
    .optional(),
  timeZone: WriteTimeZone,
  mutationId: Uuid,
}).refine((input) => input.ids === undefined || input.ids.length === input.recordIds.length, {
  error: 'Give one entry id for each record.',
  path: ['ids'],
});
/** Records to add to a list. */
export type AddEntriesInput = z.infer<typeof AddEntriesInput>;

/** What adding many records answers: who went in (with their entry), who was already in, and who was refused. */
export const AddedEntries = z.object({
  added: z.array(z.object({ recordId: Uuid, entryId: Uuid })),
  alreadyIn: z.array(Uuid),
  refused: z.array(z.object({ recordId: z.string(), code: z.string(), message: z.string() })),
  echoes: z.number().int().min(0),
});
/** What adding many records answers. */
export type AddedEntries = z.infer<typeof AddedEntries>;

/** One record whose entries are read, for its page's Lists section (AC-4822). */
export const EntriesForRecordInput = WorkspaceScoped.extend({ recordId: Uuid });
/** One record whose entries are read. */
export type EntriesForRecordInput = z.infer<typeof EntriesForRecordInput>;

/** New list values for one entry, all or none, as `records.setValues` takes a record's (AC-4810). */
export const SetEntryValuesInput = WorkspaceScoped.extend({
  entryId: Uuid,
  values: z.record(z.uuid(), ValueChangeInput),
  timeZone: WriteTimeZone,
  mutationId: Uuid,
});
/** New list values for one entry. */
export type SetEntryValuesInput = z.infer<typeof SetEntryValuesInput>;

/**
 * An entry a write answers, fresh, with its record: `written` holds the version this write made
 * for each attribute it changed, and `echoes` how many change events carry the
 * write's `mutationId`, so the tab skips exactly its own (spec 0006, AC-60).
 */
export const WrittenEntry = EntryView.extend({
  /** The entry's record, so the row that just showed holds its fields too (an add). */
  record: RecordView.optional(),
  written: z.record(z.uuid(), Uuid),
  echoes: z.number().int().min(0),
});
/** An entry a write answers. */
export type WrittenEntry = z.infer<typeof WrittenEntry>;

/** Entries to take out of their lists, or bring back (Undo), 1 to 500 at once. */
export const EntryIdsInput = WorkspaceScoped.extend({
  entryIds: z
    .array(Uuid)
    .min(1, 'Name at least one entry.')
    .max(MAX_ENTRY_BATCH, `Change at most ${String(MAX_ENTRY_BATCH)} entries at once.`),
  mutationId: Uuid,
});
/** Entries to remove or restore. */
export type EntryIdsInput = z.infer<typeof EntryIdsInput>;

/**
 * Each entry's outcome, in the order asked (AC-4818): done, or the refusal
 * that kept it (`ENTRY_EXISTS` when its record is in an "Each record once"
 * list again, `LIMIT_REACHED` when the list is full, `NOT_FOUND` when it is
 * gone or hidden). A blocked entry never fails the call.
 */
export const EntryResults = z.object({
  results: z.array(z.object({ entryId: Uuid, refusal: ApiRefusal.optional() })),
  echoes: z.number().int().min(0),
});
/** Each entry's outcome. */
export type EntryResults = z.infer<typeof EntryResults>;

/**
 * A list board's first cards (AC-4820), as `records.groups` reads an
 * object's: the list's entries in the view's `filter` and `sorts`, split by
 * `groupBy`, a status, single select, checkbox or member field of the list or
 * of its object.
 */
export const EntryGroupsInput = WorkspaceScoped.extend({
  listId: Uuid,
  groupBy: Uuid,
  groupIds: z
    .array(GroupId.nullable())
    .min(1, 'Name at least one column.')
    .max(BOARD_GROUPS_PER_CALL, `Read at most ${String(BOARD_GROUPS_PER_CALL)} columns at once.`)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Name each column once.' }),
  filter: FilterGroup.optional(),
  sorts: SortRules.optional(),
  attributeIds: ReadAttributeIds.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(BOARD_MAX_GROUP_LIMIT, `Ask for at most ${String(BOARD_MAX_GROUP_LIMIT)} cards a column.`)
    .optional(),
  ...QueryClock,
});
/** A list board's first cards. */
export type EntryGroupsInput = z.infer<typeof EntryGroupsInput>;

/** One column of a list board: its first entries with their records, the cursor for its next page, and its count. */
export const EntryGroup = z.object({
  id: GroupId.nullable(),
  entries: z.array(EntryView),
  records: z.array(RecordView),
  nextCursor: z.string().optional(),
  count: z.number().int().min(0),
  atLeast: z.boolean(),
});
/** One column of a list board. */
export type EntryGroup = z.infer<typeof EntryGroup>;

/** A list board's columns, in the order asked. */
export const EntryGroups = z.object({ groups: z.array(EntryGroup) });
/** A list board's columns. */
export type EntryGroups = z.infer<typeof EntryGroups>;

/**
 * Adds every record a selection names to a list as a background job (spec
 * 0048, AC-4825): more than 500 ticked records, or every record an object
 * view matches ("all matching"), counted first and confirmed with
 * `jobs.confirm`, as spec 0022's bulk jobs are. `id` is the browser's UUID v7,
 * so a retry answers the same job. The target is an object's (`ids` or
 * `matching` over the list's object).
 */
export const AddMatchingInput = WorkspaceScoped.extend({
  id: uuidV7('The job id must be a UUID v7.'),
  listId: Uuid,
  target: BulkTarget,
  timeZone: z.string().min(1).max(64).optional(),
  mutationId: Uuid,
});
/** A bulk add to start. */
export type AddMatchingInput = z.infer<typeof AddMatchingInput>;

/**
 * What a bulk removal works on (AC-4817): entries by id, or every entry a
 * list view's filter matches (`asOf` when Select all was pressed), minus up to
 * 1,000 left out.
 */
export const EntryTarget = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ids'),
    entryIds: z
      .array(Uuid)
      .min(1, 'Name at least one entry.')
      .max(
        BULK_IDS_MAX * 2,
        `Select at most ${BULK_IDS_MAX.toLocaleString('en')} entries one by one, or select all matching.`,
      ),
  }),
  z.strictObject({
    kind: z.literal('matching'),
    filter: FilterGroup.optional(),
    except: z
      .array(Uuid)
      .max(
        BULK_EXCEPT_MAX * 2,
        `You can leave out at most ${BULK_EXCEPT_MAX.toLocaleString('en')} entries from all matching.`,
      ),
    asOf: z.iso.datetime({ offset: true }),
    now: z.iso.datetime({ offset: true }).optional(),
    timeZone: z.string().min(1).max(64).optional(),
  }),
]);
/** What a bulk removal works on. */
export type EntryTarget = z.infer<typeof EntryTarget>;

/** Takes many entries out of a list as a background job (AC-4817), counted and confirmed first. */
export const RemoveMatchingInput = WorkspaceScoped.extend({
  id: uuidV7('The job id must be a UUID v7.'),
  listId: Uuid,
  target: EntryTarget,
  mutationId: Uuid,
});
/** A bulk removal to start. */
export type RemoveMatchingInput = z.infer<typeof RemoveMatchingInput>;

/**
 * Undoes a finished bulk add or removal of the caller's (AC-4818, AC-4825):
 * a job of its own (`id`, the browser's UUID v7), run with no confirm, that
 * removes exactly the entries the add made, or brings back exactly the ones
 * the removal took out.
 */
export const UndoEntriesJobInput = WorkspaceScoped.extend({
  id: uuidV7('The job id must be a UUID v7.'),
  jobId: Uuid,
  mutationId: Uuid,
});
/** A bulk add or removal to undo. */
export type UndoEntriesJobInput = z.infer<typeof UndoEntriesJobInput>;

/**
 * A list's entries (spec 0048). Every call follows the list's object
 * (decision 2): a list the caller can't read answers `NOT_FOUND` with the
 * words an unknown list gets, and a write needs write on the object (403
 * `FORBIDDEN`). Entries whose record a record rule hides are absent from
 * every read, count and group (AC-4836).
 *
 * `query`, `count` and `groups` share the records reads' gate and refuse as
 * they do (`FILTER_INVALID`, `QUERY_CANCELLED`). `get` leaves out ids that are
 * unknown, removed or hidden. `add` refuses `ENTRY_EXISTS` ("That record is
 * already in this list.") in a list that lets each record in once,
 * `CONFIG_INVALID` for another object's record, `RECORD_DELETED`,
 * `VALUE_REQUIRED` and `LIMIT_REACHED` (AC-4816); the same add again answers
 * the entry already made. `setValues` refuses as `records.setValues` does.
 * `remove` and `restore` answer per entry. `addMany` adds up to 500 records,
 * each on its own: a record already in an "Each record once" list goes in
 * `alreadyIn`, any other refusal in `refused`, and neither fails the rest.
 * `forRecord` answers at most 100 live entries of one record in lists the
 * caller may read, by list name then when added (a list they can't read leaves
 * no gap); a record they can't see is `NOT_FOUND`. Every write stores an
 * `entries` event and answers `echoes`. `addMatching` and `removeMatching`
 * start counted jobs (spec 0022's rules: 409 `LIMIT_REACHED` at 20 unfinished,
 * `FILTER_INVALID`, `CONFIG_INVALID` for a target of another object), and
 * `undoJob` starts the job that takes one of them back (`NOT_FOUND` for a job
 * that isn't the caller's bulk add or removal).
 */
export const entriesContract = {
  query: oc.input(QueryEntriesInput).output(EntryPage),
  count: oc.input(CountEntriesInput).output(z.object({ count: z.number().int().min(0), atLeast: z.boolean() })),
  groups: oc.input(EntryGroupsInput).output(EntryGroups),
  get: oc.input(GetEntriesInput).output(EntryPage.omit({ nextCursor: true })),
  membership: oc.input(EntryMembershipInput).output(EntryMembership),
  add: oc.input(AddEntryInput).output(WrittenEntry),
  addMany: oc.input(AddEntriesInput).output(AddedEntries),
  forRecord: oc.input(EntriesForRecordInput).output(z.object({ entries: z.array(EntryView) })),
  setValues: oc.input(SetEntryValuesInput).output(WrittenEntry),
  remove: oc.input(EntryIdsInput).output(EntryResults),
  restore: oc.input(EntryIdsInput).output(EntryResults),
  addMatching: oc.input(AddMatchingInput).output(JobView),
  removeMatching: oc.input(RemoveMatchingInput).output(JobView),
  undoJob: oc.input(UndoEntriesJobInput).output(JobView),
};
