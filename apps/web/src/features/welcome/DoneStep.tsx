// Brief
// Purpose: first run's end (27 October 2026): what the run made, so it finishes on the things it was for rather
// than dropping the person into an empty workspace.
// Main task: copy or open the booking page's link and the link page's link (spec 0058, AC-7), then Go to dashboard.
// Leaves out: everything there is to change about either page (their editors), and a step count: there is nothing
// to do here, so it is not a step.
import { Button, ButtonLink, LinkCard, TileGrid, Tooltip } from '@crm/ui';
import { useEffect, useRef } from 'react';
import { publicBookingOrigin, publicBookingPath, publicProfileUrl } from '../booking/links.ts';
import { strings } from './strings.ts';

/** The booking page first run made (or one the workspace already had), as its link needs it. */
export interface DoneBookingPage {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
  readonly slug: string;
  readonly publicKey: string;
  readonly isPrivate: boolean;
}

/** Props for the end. */
export interface DoneStepProps {
  /** The handle claimed on Your link page. */
  readonly handle: string;
  /** The booking page to hand out; without one, only the link page's tile shows. */
  readonly bookingPage?: DoneBookingPage | undefined;
  /** Opens the workspace. */
  readonly onGo: () => void;
}

/** Open in a new tab, as Captures › Links' cards offer it: a quiet icon link with its tooltip. */
function OpenLink({ href, title }: { readonly href: string; readonly title: string }) {
  return (
    <Tooltip content={strings.doneOpenTip}>
      <ButtonLink
        variant="ghost"
        size="lg"
        icon="external-link"
        label={strings.doneOpen(title)}
        href={href}
        isExternal
      />
    </Tooltip>
  );
}

/**
 * The end: two equal tiles that ease in one after the other, the booking page's link and the link page's link,
 * each with Copy link (a quick Copied tick) and Open, then Go to dashboard. Focus starts on Go to dashboard, so
 * Enter finishes the run. The addresses are the ones every other screen shows (`features/booking/links.ts`).
 */
export function DoneStep({ handle, bookingPage, onGo }: DoneStepProps) {
  const go = useRef<HTMLButtonElement>(null);
  // Nothing here has to be filled in, so the way on takes focus and Enter ends the run.
  useEffect(() => {
    go.current?.focus();
  }, []);
  const linkPage = publicProfileUrl(handle);
  const booking =
    bookingPage === undefined ? undefined : `${publicBookingOrigin()}${publicBookingPath({ ...bookingPage, handle })}`;
  const shown = (address: string) => address.replace(/^https?:\/\//, '');
  return (
    <>
      <TileGrid fill="fill" isEntering>
        {bookingPage !== undefined && booking !== undefined && (
          <LinkCard
            title={bookingPage.title}
            titleLevel={2}
            colourKey={bookingPage.id}
            facts={[strings.doneBooking, strings.doneMinutes(bookingPage.minutes)]}
            // The same word its card in Captures › Links shows for a page reached by its link alone.
            {...(bookingPage.isPrivate ? { badge: strings.doneLinkOnly } : {})}
            address={shown(booking)}
            copyValue={booking}
            actions={<OpenLink href={booking} title={bookingPage.title} />}
          />
        )}
        <LinkCard
          title={strings.doneLinkPage}
          titleLevel={2}
          colourKey={handle}
          facts={[strings.doneLinkPageFacts]}
          address={shown(linkPage)}
          copyValue={linkPage}
          actions={<OpenLink href={linkPage} title={strings.doneLinkPage} />}
        />
      </TileGrid>
      <Button ref={go} variant="primary" size="lg" isFullWidth="center" onPress={onGo}>
        {strings.doneGo}
      </Button>
    </>
  );
}
