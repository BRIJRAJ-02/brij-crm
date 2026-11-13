// The one share sheet for a booking page (spec 0074, batch 2, AC-7406): the page's link and its QR code, with the
// page's own ways beside Email and WhatsApp (Share specific times and One-time link, each to its card on the page's
// Share tab, and Edit link page for the owner's public page), and "Put it on your site" to the tab's snippet. Opened from
// the page's editor header and from its card's ⋯ on the list; the one press Copy link stays where it is (owner,
// 5 November 2026). The sheet's code loads apart from both screens (`features/share`), on first open or when idle.
import type { BookingPageView } from '@crm/data';
import { ButtonLink } from '@crm/ui';
import { useLocation } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMyAccess } from '../workspace/WorkspacePage.tsx';
import { lazyShareSheet } from '../share/LazyShareSheet.tsx';
import { linkPageHref } from '../workspace/objects.ts';
import { pageEditorHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

const { ShareSheet, usePreload } = lazyShareSheet(() => import('../share/share-sheet.ts'));

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

/** Share for one booking page: ShareSheet with the page's own ways, each to its card on the page's Share tab. */
export function BookingShareSheet({ slug, page: asked, onClose, note }: BookingShareSheetProps) {
  const me = useMyAccess()?.memberId;
  // The page last asked for stays drawn while the sheet plays its exit.
  const [page, setPage] = useState(asked);
  if (asked !== undefined && asked !== page) setPage(asked);
  if (page === undefined) return null;
  const toCard = (card: string) => `${pageEditorHref(slug, page.id, 'share')}#${card}`;
  // Specific times and one-time links are made on the Share tab, by whoever may change the page.
  const canMake = page.canChange;
  // The reader's own public page under their handle is on their link page already (spec 0051): the way is to edit
  // where it sits there. Never a colleague's or the workspace's.
  const isOnLinkPage =
    me !== undefined &&
    page.ownerMemberId === me &&
    page.scope !== 'workspace' &&
    page.handle !== undefined &&
    !page.isPrivate;
  const ways =
    canMake || isOnLinkPage ? (
      <>
        {canMake && (
          <ButtonLink variant="ghost" icon="calendar-clock" href={toCard(SHARE_CARDS.times)} onPress={onClose}>
            {strings.shareSheet.shareTimes}
          </ButtonLink>
        )}
        {canMake && (
          <ButtonLink variant="ghost" icon="link" href={toCard(SHARE_CARDS.oneTime)} onPress={onClose}>
            {strings.shareSheet.oneTimeLink}
          </ButtonLink>
        )}
        {isOnLinkPage && (
          <ButtonLink variant="ghost" icon="pencil" href={linkPageHref(slug)} onPress={onClose}>
            {strings.editLinkPage}
          </ButtonLink>
        )}
      </>
    ) : undefined;
  // A page guests can't book yet says so, rather than handing out a code that leads nowhere.
  const footer = note ?? (page.status === 'live' ? undefined : strings.shareSheet.notLive);
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
      embedHref={toCard(SHARE_CARDS.embed)}
      {...(ways === undefined ? {} : { extra: ways })}
      {...(footer === undefined ? {} : { footer })}
    />
  );
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
