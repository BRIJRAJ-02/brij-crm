// The record timeline's order (spec 0017, 0017-activity.md), as plain
// TypeScript with no Zod: the browser's lazily loaded activity source merges
// and orders entries by it, and the engine pages by the same rule. Every
// entry's `key` is `<at with microseconds>|<rank>|<id>`: newest first, then
// rank, then id, so the order is total and pages never repeat or skip one.

/** Entries one `records.activity` page holds at most, and by default (spec 0017). */
export const ACTIVITY_PAGE = 50;

/** Entries Overview's "Recent activity" shows (spec 0017, AC-383). */
export const ACTIVITY_RECENT = 5;

/** Related records an Overview card shows per relationship side (spec 0017, AC-383). */
export const RELATED_PREVIEW = 5;

/** Records a link entry names before "and N others" (spec 0017, AC-379). */
export const LINKS_SHOWN_PER_ENTRY = 3;

/**
 * Each kind's rank, which breaks a tie at one moment: links, then changes,
 * comments, notes, tasks, meetings and form submissions, and the creation last, so it is always the
 * oldest entry of its moment.
 */
export const ACTIVITY_RANKS = {
  // Another record merged into this one (spec 0049): first at its moment, before the moves it made.
  merged: 0,
  links: 1,
  change: 2,
  comment: 3,
  note: 4,
  task: 5,
  meeting: 6,
  // A form submission that touched the record (spec 0023, AC-561).
  submission: 7,
  // The record moved to the trash (it reads as of its delete; a restore clears it).
  deleted: 8,
  created: 9,
} as const;

/** An entry's place in the timeline: its moment with microseconds, its kind's rank and its id. */
export interface ActivityKeyParts {
  /** ISO 8601 in UTC with six fraction digits, as Postgres stores the moment. */
  readonly at: string;
  readonly rank: number;
  readonly id: string;
}

/** An entry's key, `<at>|<rank>|<id>`. */
export function activityKey(parts: ActivityKeyParts): string {
  return `${parts.at}|${String(parts.rank)}|${parts.id}`;
}

/** A key's parts, or undefined when it isn't one. */
export function parseActivityKey(key: string): ActivityKeyParts | undefined {
  const first = key.indexOf('|');
  const second = key.indexOf('|', first + 1);
  if (first < 0 || second < 0) return undefined;
  const rank = Number(key.slice(first + 1, second));
  if (!Number.isInteger(rank)) return undefined;
  return { at: key.slice(0, first), rank, id: key.slice(second + 1) };
}

/** Plain code unit order, never the locale's. */
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The timeline's order (spec 0017): `at` descending, then `rank` ascending,
 * then `id` ascending. Negative when `a` comes first. Every key's `at` has the
 * same width (UTC with six fraction digits), so it compares as text.
 */
export function compareActivityKeys(a: string, b: string): number {
  const left = parseActivityKey(a);
  const right = parseActivityKey(b);
  if (left === undefined || right === undefined) return byCode(a, b);
  return byCode(right.at, left.at) || left.rank - right.rank || byCode(left.id, right.id);
}
