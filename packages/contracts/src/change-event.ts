// The change event (spec 0005, change events; spec 0007 names every kind):
// what the relay publishes to a workspace's channel, one per outbox row, and
// what `realtime.catchUp` answers. Ids only, never values: a browser fetches
// the named items again through the API, so the access door decides what each
// person sees. Every event carries its place in the workspace's stream
// (`seq`, numbered with no gaps) and its commit time (`at`).
import * as z from 'zod';
import { Uuid } from './values/ids.ts';

const ids = z.array(Uuid);

/** `seq` and `at`, on every kind. */
const place = {
  seq: z.number().int().positive(),
  /** The commit time of the write (`outbox.created_at`), ISO 8601. */
  at: z.iso.datetime({ offset: true }),
};

/** The browser's own id for the write, so the tab that made it can skip its echo. Absent on a filtered copy. */
const mutationId = Uuid.optional();

/**
 * True: too many to list, so the ids are empty and a screen refetches
 * everything it holds of the object or list. Absent (or false): the ids are
 * complete. The relay sends it only when true, as spec 0005's clients expect.
 */
const coarse = z.boolean().optional();

/** The most cells one event's `replaced` names (owner decision, 8 Oct 2026); past it the event carries no list. */
export const MAX_REPLACED_CELLS = 200;

/** A cell a save replaced: the record, the attribute and the replaced version, ids only. */
export const ReplacedCell = z.object({
  recordId: Uuid,
  attributeId: Uuid,
  versionId: Uuid,
});
/** A cell a save replaced. */
export type ReplacedCell = z.infer<typeof ReplacedCell>;

/**
 * The values a save replaced that its author never saw (spec 0006, AC-46):
 * who replaced them, named once (the write's actor), and the cells, at most
 * `MAX_REPLACED_CELLS`. A write that replaced more carries no list at all, so
 * its tab only refetches the records (no notice beats a wrong one). Never on
 * a catch up.
 */
export const Replaced = z.object({
  by: z.object({
    type: z.enum(['member', 'api_key', 'automation', 'system', 'form', 'booking']),
    id: Uuid.nullable(),
  }),
  cells: z.array(ReplacedCell).min(1).max(MAX_REPLACED_CELLS),
});
/** The values a save replaced. */
export type Replaced = z.infer<typeof Replaced>;

/**
 * The most record ids one records event names as created, deleted and
 * restored together (owner decision pending, 12 Oct 2026, spec 0007); past
 * it the write's event is coarse, so screens reread their windows and counts.
 */
export const MAX_LIFECYCLE_IDS = 200;

/**
 * Record ids a write created, moved to the trash or brought back, among the
 * event's `recordIds`: a screen's counts and windows settle on these, never
 * on a guess from the id. Absent means none. Never more than
 * `MAX_LIFECYCLE_IDS` across the three.
 */
const lifecycle = ids.max(MAX_LIFECYCLE_IDS).optional();

/** These records of the object changed (refetch the ones you hold), or, when `coarse`, too many to list. */
export const RecordsEvent = z.object({
  ...place,
  kind: z.literal('records'),
  objectId: Uuid,
  recordIds: ids,
  attributeIds: ids,
  /** Made by this write. */
  createdIds: lifecycle,
  /** Moved to the trash (or erased while live) by this write: they leave every read. */
  deletedIds: lifecycle,
  /** Brought back from the trash by this write. */
  restoredIds: lifecycle,
  coarse,
  mutationId,
  replaced: Replaced.optional(),
  /**
   * A background job's batch wrote it (spec 0022, milestone 3): open views
   * of the object refetch what they show at most every 5 seconds. The flag
   * only, never the job's id.
   */
  fromJob: z.literal(true).optional(),
});

/** These entries of the list changed, with their records (`objectId` is the list's parent object). */
export const EntriesEvent = z.object({
  ...place,
  kind: z.literal('entries'),
  listId: Uuid,
  objectId: Uuid.optional(),
  entryIds: ids,
  recordIds: ids,
  attributeIds: ids,
  coarse,
  mutationId,
  replaced: Replaced.optional(),
});

/**
 * Definitions changed: the object's attributes (`objectId`), the list's
 * (`listId`), or, naming neither, the workspace's object list. `attributeIds`
 * names the attributes when the write knew them; without it the object or
 * list itself changed (made, renamed, archived or restored), so a screen
 * reads its attributes and the workspace's objects (or lists) again.
 */
export const DefinitionsEvent = z.object({
  ...place,
  kind: z.literal('definitions'),
  objectId: Uuid.optional(),
  listId: Uuid.optional(),
  attributeIds: ids.optional(),
  mutationId,
});

/** Saved views changed (#20), on an object or a list. */
export const ViewsEvent = z.object({
  ...place,
  kind: z.literal('views'),
  objectId: Uuid.optional(),
  listId: Uuid.optional(),
  viewIds: ids,
  coarse,
  mutationId,
});

/** Notes changed (#19), with their parent records and those records' object. */
export const NotesEvent = z.object({
  ...place,
  kind: z.literal('notes'),
  objectId: Uuid.optional(),
  recordIds: ids,
  noteIds: ids,
  coarse,
  mutationId,
});

/** Tasks changed (#19), with the records they link. */
export const TasksEvent = z.object({
  ...place,
  kind: z.literal('tasks'),
  recordIds: ids,
  taskIds: ids,
  coarse,
  mutationId,
});

/**
 * Meetings changed (spec 0024): synced, moved, cancelled, or their privacy
 * changed, with every record they showed on before or after. A screen showing
 * one of those records reads its meetings (its timeline) again; `coarse`
 * means too many to list, so every open timeline reads again.
 */
export const MeetingsEvent = z.object({
  ...place,
  kind: z.literal('meetings'),
  recordIds: ids,
  meetingIds: ids,
  coarse,
  mutationId,
});

/**
 * Availability schedules changed (spec 0035, AC-977): made, renamed, their
 * hours changed, the default moved, or deleted. Screens holding a member's
 * schedules, or a page editor showing one, read them again. Ids only, and
 * only to an audience that may read them (the writer, `booking.admin`);
 * everyone else hears `coarse` with none.
 */
export const SchedulesEvent = z.object({
  ...place,
  kind: z.literal('schedules'),
  scheduleIds: ids,
  coarse,
  mutationId,
});

/** Members changed (#23): joined, left, renamed, or a role changed. */
export const MembersEvent = z.object({
  ...place,
  kind: z.literal('members'),
  memberIds: ids,
  mutationId,
});

/** These members' access changed (spec 0009): each reloads what they may see. */
export const AccessEvent = z.object({
  ...place,
  kind: z.literal('access'),
  memberIds: ids,
  mutationId,
});

/** Background jobs changed (spec 0008): refetch them, or when `coarse` the unfinished jobs you hold. */
export const JobsEvent = z.object({
  ...place,
  kind: z.literal('jobs'),
  jobIds: ids,
  coarse,
  mutationId,
});

/**
 * Something changed that this channel's audience may not see (spec 0009): it
 * keeps the stream gap free and names nothing. A catch up never carries one.
 */
export const RestrictedEvent = z.object({
  ...place,
  kind: z.literal('restricted'),
});

/**
 * One change, numbered per workspace with no gaps (`seq`), by kind. What each
 * kind asks of a screen is in spec 0007 (The event). A client ignores a kind
 * it doesn't know (a newer server during a deploy) after applying its `seq`.
 */
export const ChangeEvent = z.discriminatedUnion('kind', [
  RecordsEvent,
  EntriesEvent,
  DefinitionsEvent,
  ViewsEvent,
  NotesEvent,
  TasksEvent,
  MeetingsEvent,
  SchedulesEvent,
  MembersEvent,
  AccessEvent,
  JobsEvent,
  RestrictedEvent,
]);
/** One change event on a workspace's channel, or in a catch up. */
export type ChangeEvent = z.infer<typeof ChangeEvent>;

/** Every kind of change event, the stub `restricted` last. The registry tests hold every consumer to this list. */
export const CHANGE_EVENT_KINDS = [
  'records',
  'entries',
  'definitions',
  'views',
  'notes',
  'tasks',
  'meetings',
  'schedules',
  'members',
  'access',
  'jobs',
  'restricted',
] as const satisfies readonly ChangeEvent['kind'][];

/** A kind of change event. */
export type ChangeEventKind = (typeof CHANGE_EVENT_KINDS)[number];

/** The channel a workspace's change events go to: `workspace:<id>` (Centrifugo's `workspace` namespace). */
export function workspaceChannel(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}
