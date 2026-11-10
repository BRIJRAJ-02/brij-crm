// Live or Hidden, as one change (the owner, 9 November 2026: booking pages work like Calendly's, with no draft or
// publish). Hidden pauses the page. Live on a page that was made as a draft and never published publishes it first,
// so what guests meet is what the editor saved; on any other page it only takes bookings again.
import type { BookingPageView, DataLayer } from '@crm/data';
import { isDraftPage } from './draft-page.ts';

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
