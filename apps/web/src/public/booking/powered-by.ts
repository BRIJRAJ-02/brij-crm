// The Timefix link under the guest's pages after booking: one small function, so
// the shared Powered by piece (wip/brandlinks) can take it over in one place.

/** Which guest page the link sits under: the confirmation right after booking, or the booking's own page. */
export type PoweredByPage = 'booking_confirmation' | 'booking_manage';

/** timefix.ai with the footer's campaign tags and the workspace as the referrer. */
export function poweredByHref(page: PoweredByPage, workspaceSlug: string): string {
  const query = new URLSearchParams({
    utm_source: 'timefix',
    utm_medium: page,
    utm_campaign: 'powered_by',
    utm_content: 'footer_logo',
    ref: workspaceSlug,
  });
  return `https://timefix.ai/?${query.toString()}`;
}
