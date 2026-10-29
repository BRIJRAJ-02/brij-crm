// The booking page editor's draft, as plain functions: what differs from the saved page, and the draft once a save
// has landed.
import type { BookingPageSettings } from '@crm/data';

/**
 * The settings the editor never sends: a page's place on its owner's profile is set by Settings › Profile's order
 * (owner ask A102), so a draft read before a reorder never puts the old place back.
 */
const NOT_EDITED: ReadonlySet<keyof BookingPageSettings> = new Set(['profilePosition']);

/**
 * A setting as text that two spellings of one value share: every object's keys in order, a list's items left in
 * theirs (moving a question is a change). Plain `JSON.stringify` follows the order keys were written in, and the
 * editor writes a question's keys in another order than the server answers them (`changeQuestion` puts `filedOn`
 * last, the schema puts it before `update`), so a question filed onto a field Save had just made never read as
 * saved: the bar said "Unsaved changes" after every Save, and leaving the page asked first (crm-f7, 28 Oct 2026).
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

/** The settings that differ between two drafts, by value, whatever order their keys were written in. */
export function changed(saved: BookingPageSettings, draft: BookingPageSettings): Partial<BookingPageSettings> {
  const keys = Object.keys(draft) as (keyof BookingPageSettings)[];
  const entries = keys
    .filter((key) => !NOT_EDITED.has(key))
    .filter((key) => canonical(draft[key]) !== canonical(saved[key]))
    .map((key) => [key, draft[key]]);
  return Object.fromEntries(entries) as Partial<BookingPageSettings>;
}

/**
 * The draft once a save landed as `next`: the saved settings, with only the person's own unsaved changes kept on
 * top, typing done while the save was out included. `status` always follows the server, since the person never
 * edits it in the draft: Pause and Resume save it at once from the ⋯ menu, so the old value never reads as an
 * unsaved change (Q61: the bar stayed up after Pause, and Save sent the page live again).
 */
export function draftAfterSave(next: BookingPageSettings, current: BookingPageSettings): BookingPageSettings {
  return { ...next, ...changed(next, current), status: next.status };
}
