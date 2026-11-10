// Live or Hidden, as one change (the owner, 9 November 2026: booking pages work like Calendly's, with no draft or
// publish). Hidden pauses the page. Live on a page that was made as a draft and never published publishes it first,
// so what guests meet is what the editor saved; on any other page it only takes bookings again.
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { isDraftPage } from './draft-page.ts';
import { strings } from './strings.ts';

/** Makes the page live or hidden through the data layer (shown at once, put back on a refusal); answers the page. */
export function setPageLive(
  data: DataLayer,
  slug: string,
  page: Pick<BookingPageView, 'id' | 'status' | 'pausedReason'>,
  isLive: boolean,
): Promise<BookingPageView> {
  if (!isLive) return data.bookingPages.update(slug, page.id, { status: 'paused' });
  if (isDraftPage(page)) {
    return data.bookingPages
      .publish(slug, page.id)
      .then(() => data.bookingPages.update(slug, page.id, { status: 'live' }));
  }
  return data.bookingPages.update(slug, page.id, { status: 'live' });
}

/**
 * A refused Live or Hidden, said the same way on a card and in the editor: the server's reason (Live with nobody to
 * book, 6 November 2026), and Go to Hosts when the hosts are why.
 */
export function liveRefusal(error: unknown, title: string, toHosts?: () => void): ToastContent {
  return {
    tone: 'danger',
    message: isDataError(error) ? error.message : strings.statusFailed(title),
    ...(toHosts !== undefined && isDataError(error) && error.code === 'HOSTS_INVALID'
      ? { action: { label: strings.goTo(strings.hostsTab), onAction: toHosts } }
      : {}),
  };
}
