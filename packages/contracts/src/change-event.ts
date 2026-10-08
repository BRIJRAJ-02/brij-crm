// The change event (spec 0005, change events; spec 0007 names every kind):
// what the relay publishes to a workspace's channel, one per outbox row, and
// what `realtime.catchUp` answers. Ids only, never values: a browser fetches
// the named items again through the API, so the access door decides what each
// person sees. Every event carries its place in the workspace's stream
// (`seq`, numbered with no gaps) and its commit time (`at`).
import * as z from 'zod';

const ids = z.array(z.uuid());

/** `seq` and `at`, on every kind. */
const place = {
  seq: z.number().int().positive(),
  /** The commit time of the write (`outbox.created_at`), ISO 8601. */
  at: z.iso.datetime({ offset: true }),
};

/** The browser's own id for the write, so the tab that made it can skip its echo. Absent on a filtered copy. */
const mutationId = z.uuid().optional();

/**
 * True: too many to list, so the ids are empty and a screen refetches
 * everything it holds of the object or list. Absent (or false): the ids are
 * complete. The relay sends it only when true, as spec 0005's clients expect.
 */
const coarse = z.boolean().optional();

/**
 * A value a save replaced that its author never saw (spec 0006 fills it):
 * the record, the attribute, the replaced version and who replaced it. Never
 * on a catch up.
 */
export const ReplacedEntry = z.object({
  recordId: z.uuid(),
  attributeId: z.uuid(),
  versionId: z.uuid(),
  by: z.object({
    type: z.enum(['member', 'api_key', 'automation', 'system']),
    id: z.uuid().nullable(),
  }),
});
/** A value a save replaced. */
export type ReplacedEntry = z.infer<typeof ReplacedEntry>;

/** These records of the object changed (refetch the ones you hold), or, when `coarse`, too many to list. */
export const RecordsEvent = z.object({
  ...place,
  kind: z.literal('records'),
  objectId: z.uuid(),
  recordIds: ids,
  attributeIds: ids,
  coarse,
  mutationId,
  replaced: z.array(ReplacedEntry).optional(),
});

/** These entries of the list changed, with their records (`objectId` is the list's parent object). */
export const EntriesEvent = z.object({
  ...place,
  kind: z.literal('entries'),
  listId: z.uuid(),
  objectId: z.uuid().optional(),
  entryIds: ids,
  recordIds: ids,
  attributeIds: ids,
  coarse,
  mutationId,
  replaced: z.array(ReplacedEntry).optional(),
});

/**
 * Definitions changed: the object's attributes (`objectId`), the list's
 * (`listId`), or, naming neither, the workspace's object list. `attributeIds`
 * names the attributes when the write knew them.
 */
export const DefinitionsEvent = z.object({
  ...place,
  kind: z.literal('definitions'),
  objectId: z.uuid().optional(),
  listId: z.uuid().optional(),
  attributeIds: ids.optional(),
  mutationId,
});

/** Saved views changed (#20), on an object or a list. */
export const ViewsEvent = z.object({
  ...place,
  kind: z.literal('views'),
  objectId: z.uuid().optional(),
  listId: z.uuid().optional(),
  viewIds: ids,
  coarse,
  mutationId,
});

/** Notes changed (#19), with their parent records and those records' object. */
export const NotesEvent = z.object({
  ...place,
  kind: z.literal('notes'),
  objectId: z.uuid().optional(),
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
