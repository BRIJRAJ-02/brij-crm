// The one share sheet for a booking page (spec 0074, batch 2, AC-7406): the page's link and its QR code, with the
// page's own ways beside Email and WhatsApp (Share specific times and One-time link, each to its card on the page's
// Share tab, and Edit link page for the owner's public page), and "Put it on your site" to the tab's snippet. Opened from
// the page's editor header and from its card's ⋯ on the list; the one press Copy link stays where it is (owner,
// 5 November 2026). The sheet (`BookingShareBody.tsx`) loads apart from both screens, on first open or when idle.
import type { BookingPageView } from '@crm/data';
import { useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { lazyOnOpen } from '../share/LazyShareSheet.tsx';

// The sheet, its ways and the library's ShareSheet are one chunk apart from the screens that open it
// (`BookingShareBody.tsx`): none of it is on a screen's first load.
const { Component: BookingShareSheet, usePreload } = lazyOnOpen(
  () => import('./BookingShareBody.tsx').then((module) => module.BookingShareBody),
  (props: BookingShareSheetProps) => props.page !== undefined,
);

/** Share for one booking page: ShareSheet with the page's own ways, each to its card on the page's Share tab. */
export { BookingShareSheet };

/** Loads the sheet's code once the screen is idle, so a first Share never waits on it. */
export const usePreloadBookingShare = usePreload;

/** Where each of the sheet's ways lands on the page's Share tab: its card, scrolled into view (`useShareCardInView`). */
export const SHARE_CARDS = { times: 'share-times', oneTime: 'one-time-links', embed: 'embed' } as const;

/** Props for BookingShareSheet. */
export interface BookingShareSheetProps {
  readonly slug: string;
  /** The page shared; left out, the sheet is closed. */
  readonly page: BookingPageView | undefined;
  readonly onClose: () => void;
  /** One quiet line at the sheet's foot that outranks the page's state: the editor's "Save the new address first". */
  readonly note?: string;
}

/**
 * On the Share tab, the card the address names (`#share-times`, from the share sheet's ways) scrolls into view, as
 * the tab opens and each time the name changes (a way pressed while the tab is already open).
 */
export function useShareCardInView(isShareTab: boolean): void {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (!isShareTab || hash === '') return;
    document.getElementById(hash)?.scrollIntoView({ block: 'start' });
  }, [isShareTab, hash]);
}
