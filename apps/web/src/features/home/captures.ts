// Home's New captures (spec 0041): the forms that took a submission most
// recently, newest first. Read from Forms' own list (each form's last
// submission and this month's count), so Home needs no read of its own. Pure.
import type { FormSummary } from '@crm/data';

/** How many forms New captures shows. */
export const CAPTURES_SHOWN = 5;

/** The forms with a submission, by their latest first, at most `limit`. */
export function latestCaptures(forms: readonly FormSummary[], limit = CAPTURES_SHOWN): readonly FormSummary[] {
  return forms
    .filter((form) => form.lastSubmissionAt !== undefined)
    .toSorted((a, b) => Date.parse(b.lastSubmissionAt ?? '') - Date.parse(a.lastSubmissionAt ?? ''))
    .slice(0, limit);
}
