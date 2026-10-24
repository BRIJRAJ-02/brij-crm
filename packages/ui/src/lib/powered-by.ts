// The Timefix links on the public pages (the booking page, a person's profile, the guest's pages, the hosted form):
// "Powered by Timefix" under each, and "Claim your free page" for a visitor we don't know. Built by
// `@crm/contracts/brand`, the one place the tags live, so these pages tag their links exactly as the emails do.
import { timefixUrl, type PoweredByPage } from '@crm/contracts/brand';

/** Which public page a link sits on (`utm_medium`): the booking page, a profile, the guest's pages, or a hosted form. */
export type { PoweredByPage } from '@crm/contracts/brand';

/** "Powered by Timefix": www.timefix.com tagged as the page's footer wordmark, and the workspace as `ref` when the page knows it. */
export function poweredByHref(page: PoweredByPage, workspaceSlug?: string): string {
  return timefixUrl({ surface: page, workspaceSlug });
}

/** "Claim your free page": www.timefix.com tagged as the page's claim link. */
export function claimPageHref(page: PoweredByPage): string {
  return timefixUrl({ surface: page, placement: 'claim_link' });
}
