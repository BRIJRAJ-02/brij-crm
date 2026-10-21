// The Timefix link under the public pages (the booking guest's pages, the hosted form): one function, so every
// "made with Timefix" footer carries the same campaign tags.

/** Which public page the link sits under: the booking confirmation, the booking's own page, or a hosted form. */
export type PoweredByPage = 'booking_confirmation' | 'booking_manage' | 'form';

/** timefix.ai with the footer's campaign tags, and the workspace as the referrer when the page knows it. */
export function poweredByHref(page: PoweredByPage, workspaceSlug?: string): string {
  const query = new URLSearchParams({
    utm_source: 'timefix',
    utm_medium: page,
    utm_campaign: 'powered_by',
    utm_content: 'footer_logo',
    ...(workspaceSlug === undefined ? {} : { ref: workspaceSlug }),
  });
  return `https://timefix.ai/?${query.toString()}`;
}
