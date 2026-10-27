// Brief
// Purpose: the page beside first run's Your link and Your booking page (27 October 2026): the person's own link
// page as a visitor will see it, drawn from what the step has typed.
// Main task: show the address as it is typed and the booking page as it is named, so the thing being made is on
// screen while it is made.
// Leaves out: every other block, the look, the socials and the contact card (the link page editor), and anything
// that presses: it is inert (`isPreview`).
import { LinkPage, type LinkPageBlock } from '@crm/ui';
import { publicBookingHost } from '../booking/links.ts';
import { strings } from './strings.ts';

/** Props for the page beside the step. */
export interface LinkPagePreviewProps {
  /** The person at the top of the page. */
  readonly name: string;
  /** Seeds the avatar's hue when there is no picture: their handle once claimed, else their user id. */
  readonly id: string;
  /** The link as typed, without the host; empty until they type one. */
  readonly handle: string;
  /** The booking page as it is being named, once Your booking page is the step. */
  readonly page?: { readonly title: string; readonly minutes: number } | undefined;
}

/**
 * The link page as it stands: the person, the address under them, and the
 * booking page's row once it has a name. Inert and never on the public
 * origin, like the editor's own phone.
 */
export function LinkPagePreview({ name, id, handle, page }: LinkPagePreviewProps) {
  const host = publicBookingHost();
  const label = `${host}/${handle}`;
  const title = page?.title.trim() ?? '';
  const blocks: readonly LinkPageBlock[] =
    page === undefined || title === ''
      ? []
      : [
          {
            kind: 'page',
            id: 'welcome-page',
            title,
            // Nothing is pressable here, so the address is only what the row reads as.
            href: `/${handle}`,
            facts: strings.bookingLengthLabel(page.minutes),
          },
        ];
  return <LinkPage isPreview person={{ name, id }} blocks={blocks} address={{ label, value: `https://${label}` }} />;
}
