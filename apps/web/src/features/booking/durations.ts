// Meeting lengths (22 Oct 2026): the ready picks, and a custom length typed in minutes. Plain functions, so the new
// page dialog, the editor and tests share them.

/** The lengths offered as ready picks, in minutes: four, as many as a page offers; others come from + Custom. */
export const PRESET_LENGTHS: readonly number[] = [15, 30, 45, 60];
/** At most this many lengths on one page (the server's `BOOKING_DURATIONS_MAX`): the public page shows four. */
export const LENGTHS_MAX = 4;

/** A typed length in minutes the server takes (5 to 480, in steps of 5), or undefined. */
export function lengthOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const minutes = Number(trimmed);
  return minutes >= 5 && minutes <= 480 && minutes % 5 === 0 ? minutes : undefined;
}

/** The lengths to show as chips: the ready picks, and any other the page has or had, shortest first. */
export function lengthChoices(...lists: readonly (readonly number[])[]): readonly number[] {
  return [...new Set([...PRESET_LENGTHS, ...lists.flat()])].sort((left, right) => left - right);
}
