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
 * The draft once `patch` saved as `next`: the saved settings, with only the person's own unsaved changes kept on
 * top. What the patch sent counts as saved, so a change that saved at once outside the draft (Pause or Resume, which
 * sends `status` alone) never reads as an unsaved change of the old value (Q61: the bar stayed up after Pause, and
 * Save sent the page live again).
 */
export function draftAfterSave(
  next: BookingPageSettings,
  current: BookingPageSettings,
  patch: Partial<BookingPageSettings>,
): BookingPageSettings {
  return { ...next, ...changed(next, { ...current, ...patch }) };
}
