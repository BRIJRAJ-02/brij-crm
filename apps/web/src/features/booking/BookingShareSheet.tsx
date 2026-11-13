// The one share sheet for a booking page (spec 0074, batch 2, AC-7406): the page's link and its QR code, with the
// page's own ways beside Email and WhatsApp (Offer specific times and One-time link, both on the page's Share tab,
// and Add to link page for the owner's public page), and "Put it on your site" to the same tab's snippet. Opened from
// the page's editor header and from its card's ⋯ on the list; the one press Copy link stays where it is (owner,
// 5 November 2026). The sheet's code loads apart from both screens (`features/share`), on first open or when idle.
import type { BookingPageView } from '@crm/data';
import { ButtonLink } from '@crm/ui';
import { useState } from 'react';
import { lazyShareSheet } from '../share/LazyShareSheet.tsx';
import { linkPageHref } from '../workspace/objects.ts';
import { pageEditorHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

const { ShareSheet, usePreload } = lazyShareSheet(() => import('../share/share-sheet.ts'));

/** Loads the sheet's code once the screen is idle, so a first Share never waits on it. */
export const usePreloadBookingShare = usePreload;

/** Props for BookingShareSheet. */
export interface BookingShareSheetProps {
  readonly slug: string;
  /** The page shared; left out, the sheet is closed. */
  readonly page: BookingPageView | undefined;
  readonly onClose: () => void;
  /** The reader's own page (not a colleague's or the workspace's): only then does Add to link page apply. */
  readonly isOwnPage: boolean;
}

/** Share for one booking page: ShareSheet with the page's own ways. */
export function BookingShareSheet({ slug, page: asked, onClose, isOwnPage }: BookingShareSheetProps) {
  // The page last asked for stays drawn while the sheet plays its exit.
  const [page, setPage] = useState(asked);
  if (asked !== undefined && asked !== page) setPage(asked);
  if (page === undefined) return null;
  const shareTab = pageEditorHref(slug, page.id, 'share');
  // Offer specific times and One-time links are made on the Share tab, by whoever may change the page.
  const canMake = page.canChange;
  // A public page of the owner's own, under their handle, sits on their link page (spec 0051).
  const isOnLinkPage = isOwnPage && page.handle !== undefined && !page.isPrivate && page.scope !== 'workspace';
  const ways =
    canMake || isOnLinkPage ? (
      <>
        {canMake && (
          <ButtonLink variant="ghost" icon="calendar-clock" href={shareTab} onPress={onClose}>
            {strings.shareSheet.offerTimes}
          </ButtonLink>
        )}
        {canMake && (
          <ButtonLink variant="ghost" icon="link" href={shareTab} onPress={onClose}>
            {strings.shareSheet.oneTimeLink}
          </ButtonLink>
        )}
        {isOnLinkPage && (
          <ButtonLink variant="ghost" icon="at-sign" href={linkPageHref(slug)} onPress={onClose}>
            {strings.shareSheet.addToLinkPage}
          </ButtonLink>
        )}
      </>
    ) : undefined;
  return (
    <ShareSheet
      isOpen={asked !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={strings.shareSheet.title(page.title)}
      url={publicBookingUrl(page)}
      name={page.title}
      invite={strings.shareSheet.invite}
      {...(canMake ? { embedHref: shareTab } : {})}
      {...(ways === undefined ? {} : { extra: ways })}
    />
  );
}
