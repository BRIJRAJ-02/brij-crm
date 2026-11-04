// Whether a booking page is a draft: made from New booking page and never published (the bookings area, 4 November
// 2026). Apart from the editor so the Links list reads it without loading the editor.
import type { BookingPageView } from '@crm/data';

/** A page made as a draft and never published: guests can't book it until its editor's Publish. */
export const isDraftPage = (page: Pick<BookingPageView, 'status' | 'pausedReason'>): boolean =>
  page.status === 'paused' && page.pausedReason === 'draft';
