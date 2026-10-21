// The command menu (spec 0039): one search over every object's records and
// every view the caller may see, and each member's recent items. Answers are
// displays only, never record bodies, and every one has passed the access
// door: something hidden is absent, never marked.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The longest query the command menu sends, and the most records one search answers. */
export const MAX_GLOBAL_QUERY = 200;
export const MAX_GLOBAL_RECORDS = 20;

/**
 * A search from the command menu (AC-1077, AC-1078): every readable object's
 * live records by name, email and domain, and the views the caller sees by
 * name. An empty (or blank) query answers nothing; the menu shows recent
 * items instead.
 */
export const GlobalSearchInput = WorkspaceScoped.extend({
  query: z
    .string()
    .max(MAX_GLOBAL_QUERY, `Search with at most ${String(MAX_GLOBAL_QUERY)} characters.`)
    .refine((query) => !query.includes('\u0000'), { error: 'This text holds a character that can’t be stored.' }),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_GLOBAL_RECORDS, `Ask for at most ${String(MAX_GLOBAL_RECORDS)} records.`)
    .optional(),
});
/** A search from the command menu. */
export type GlobalSearchInput = z.infer<typeof GlobalSearchInput>;

/** How a record matched (AC-1079): its name starts with the text, a word in it does, it contains it, or it is close. */
export const SearchMatch = z.enum(['prefix', 'word', 'contains', 'similar']);
/** How a record matched. */
export type SearchMatch = z.infer<typeof SearchMatch>;

/**
 * One record found: the record as a chip shows it, its first email or domain
 * the caller may see (`detail`, the row's second line), and how it matched.
 */
export const RecordHit = z.object({
  ref: RecordRefDisplay,
  detail: z.string().optional(),
  match: SearchMatch,
});
/** One record found. */
export type RecordHit = z.infer<typeof RecordHit>;

/** One view found or recently opened: its name, its object, its kind, and whether it is the object's default view. */
export const ViewHit = z.object({
  id: Uuid,
  objectId: Uuid,
  name: z.string(),
  kind: z.enum(['table', 'board']),
  isDefault: z.boolean(),
});
/** One view found. */
export type ViewHit = z.infer<typeof ViewHit>;

/** What a search found, each list in rank order (AC-1079, AC-1081). */
export const GlobalSearchResults = z.object({
  records: z.array(RecordHit),
  views: z.array(ViewHit),
});
/** What a search found. */
export type GlobalSearchResults = z.infer<typeof GlobalSearchResults>;

/** One recent item (AC-1076): a record as a chip shows it, or a view. */
export const RecentItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('record'), ref: RecordRefDisplay }),
  z.object({ kind: z.literal('view'), view: ViewHit }),
]);
/** One recent item. */
export type RecentItem = z.infer<typeof RecentItem>;

/** The member's recent items, newest first: only what they may still see. */
export const RecentItems = z.object({ items: z.array(RecentItem) });
/** The member's recent items. */
export type RecentItems = z.infer<typeof RecentItems>;

/** A record or a view the member just opened (AC-1088). */
export const VisitRecentInput = WorkspaceScoped.extend({
  kind: z.enum(['record', 'view']),
  id: Uuid,
});
/** A record or a view the member just opened. */
export type VisitRecentInput = z.infer<typeof VisitRecentInput>;

/**
 * Spec 0039. `query` searches every readable object's records and the views
 * the caller sees; it shares the read gate with `records.query`, is cancelled
 * with its request, and answers `QUERY_CANCELLED` past its time.
 */
export const searchContract = {
  query: oc.input(GlobalSearchInput).output(GlobalSearchResults),
};

/**
 * Spec 0039. `list` answers the caller's recent items they may still see;
 * `visit` keeps one as the newest (the member's own bookmark: no change
 * event). Something the caller can't see is quietly not kept, the same
 * answer as success (AC-1091).
 */
export const recentsContract = {
  list: oc.input(WorkspaceScoped).output(RecentItems),
  visit: oc.input(VisitRecentInput).output(z.void()),
};
