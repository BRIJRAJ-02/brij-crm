// Whether the booking page a form sends its visitors on to can still take them (late trap #53). A paused page (by
// hand, or because its last host left) or a deleted one quietly turns every visit into the form's message instead of
// a meeting, so the editor says so. Pure, so the rule is tested apart from the screens.
import type { BookingPageView, FormDocument } from '@crm/data';

/** Why the After page can't take visitors: paused, with the page, or gone (deleted). */
export type AfterPageProblem = { readonly kind: 'paused'; readonly page: BookingPageView } | { readonly kind: 'gone' };

/**
 * The problem with `document`'s After page, or undefined: none when it doesn't send to a page, the pages haven't
 * loaded, or the page is live. A page missing from the list is gone only to a reader who sees every page
 * (`seesAll`, booking.admin); to anyone else it may just be a colleague's, so nothing is said.
 */
export function afterPageProblem(
  document: Pick<FormDocument, 'after'> | undefined,
  pages: readonly BookingPageView[] | undefined,
  seesAll: boolean,
): AfterPageProblem | undefined {
  if (document?.after.kind !== 'booking' || pages === undefined) return undefined;
  const { bookingPageId } = document.after;
  const page = pages.find((each) => each.id === bookingPageId);
  if (page === undefined) return seesAll ? { kind: 'gone' } : undefined;
  return page.status === 'paused' ? { kind: 'paused', page } : undefined;
}
