// A record's timeline (spec 0017): `records.activity` answers a page of
// entries, newest first, built on read from the history the engine keeps.
// The order and the constants live in `activity-keys.ts`, with no Zod, for
// the browser. The procedures sit in the records namespace (`records.ts`).
import * as z from 'zod';
import { ACTIVITY_PAGE } from './activity-keys.ts';
import { MeetingView } from './calendar.ts';
import { ActorReferenceValue, Timestamp } from './values/attribute-values.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

export {
  ACTIVITY_PAGE,
  ACTIVITY_RANKS,
  ACTIVITY_RECENT,
  activityKey,
  compareActivityKeys,
  LINKS_SHOWN_PER_ENTRY,
  parseActivityKey,
  RELATED_PREVIEW,
  type ActivityKeyParts,
} from './activity-keys.ts';

/** The longest cursor `records.activity` takes. */
export const MAX_ACTIVITY_CURSOR = 512;

/**
 * The kinds of timeline entry: #19 adds notes and tasks, #29 comments, spec
 * 0024 meetings, spec 0023 form submissions; a client ignores a kind it doesn't map.
 */
export const ActivityKind = z.enum(['created', 'change', 'links', 'note', 'task', 'comment', 'meeting', 'submission']);
/** A kind of timeline entry. */
export type ActivityKind = z.infer<typeof ActivityKind>;

/**
 * One entry of a record's timeline (spec 0017). `key` is the server's sort
 * key, `<at with microseconds>|<rank>|<id>`, which the browser orders and
 * merges by (`compareActivityKeys`); `at` is for display, cut to
 * milliseconds. A `change` names its attribute and the values before and
 * after in the attribute's own shape (`fromRefs` and `toRefs` for a side that
 * holds one record); `links` names up to 3 records added and removed on a
 * side that holds many, with the counts. `note`, `task` and `comment` come
 * with #19 and #29.
 */
export const ActivityItem = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  at: Timestamp,
  /** Who did it; absent when a field rule hides it from the reader (the creation's Created by). */
  actor: ActorReferenceValue.optional(),
  kind: ActivityKind,
  attributeId: Uuid.optional(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
  fromRefs: z.array(RecordRefDisplay).optional(),
  toRefs: z.array(RecordRefDisplay).optional(),
  added: z.array(RecordRefDisplay).max(3).optional(),
  addedCount: z.number().int().min(0).optional(),
  removed: z.array(RecordRefDisplay).max(3).optional(),
  removedCount: z.number().int().min(0).optional(),
  itemId: Uuid.optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
  isDone: z.boolean().optional(),
  meeting: MeetingView.optional(),
  /** A submission entry (spec 0023): the form, and what the submission did to this record. */
  formId: Uuid.optional(),
  action: z.enum(['created', 'updated', 'matched', 'linked']).optional(),
});
/** One entry of a record's timeline. */
export type ActivityItem = z.infer<typeof ActivityItem>;

/**
 * Where a page of the timeline ends, inside the opaque cursor (base64url
 * JSON): the last entry's moment with microseconds, its rank and its id.
 * Strict: anything else is a cursor the server refuses.
 */
export const ActivityCursor = z.strictObject({
  at: z.iso.datetime({ precision: 6 }),
  rank: z.number().int().min(0).max(9),
  id: z.string().min(1).max(400),
});
/** Where a page of the timeline ends. */
export type ActivityCursor = z.infer<typeof ActivityCursor>;

/** A page of a record's timeline: after `cursor` (the last page's `nextCursor`), `limit` entries (1 to 50, 50 when not given). */
export const RecordActivityInput = WorkspaceScoped.extend({
  recordId: Uuid,
  cursor: z.string().min(1).max(MAX_ACTIVITY_CURSOR).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(ACTIVITY_PAGE, `Ask for at most ${String(ACTIVITY_PAGE)} entries.`)
    .optional(),
});
/** A page of a record's timeline. */
export type RecordActivityInput = z.infer<typeof RecordActivityInput>;

/** A page of entries, newest first, and the cursor for the next when there are more. */
export const RecordActivity = z.object({
  entries: z.array(ActivityItem),
  nextCursor: z.string().optional(),
});
/** A page of entries. */
export type RecordActivity = z.infer<typeof RecordActivity>;
