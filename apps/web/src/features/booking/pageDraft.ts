// The booking page editor's draft, as plain functions: what differs from the saved page, and the draft once a save
// has landed.
import type { BookingPageSettings } from '@crm/data';

/** The settings that differ between two drafts. */
export function changed(saved: BookingPageSettings, draft: BookingPageSettings): Partial<BookingPageSettings> {
  const keys = Object.keys(draft) as (keyof BookingPageSettings)[];
  const entries = keys
    .filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))
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
