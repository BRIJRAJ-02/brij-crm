// The booking page's share sheet itself (spec 0074, batch 2, AC-7406), loaded apart from the screens that open it
// (`BookingShareSheet.tsx`): the page's link and its QR code, with the page's own ways beside Email and WhatsApp.
import { ButtonLink, ShareSheet } from '@crm/ui';
import { useState } from 'react';
import { useMyAccess } from '../workspace/WorkspacePage.tsx';
import { linkPageHref } from '../workspace/objects.ts';
import { SHARE_CARDS, type BookingShareSheetProps } from './BookingShareSheet.tsx';
import { pageEditorHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

/** Share for one booking page: ShareSheet with the page's own ways, each to its card on the page's Share tab. */
export function BookingShareBody({ slug, page: asked, onClose, note }: BookingShareSheetProps) {
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
