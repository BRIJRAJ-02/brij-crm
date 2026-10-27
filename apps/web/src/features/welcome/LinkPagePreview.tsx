// Brief
// Purpose: the page beside first run's Your link and Your booking page (27 October 2026): the person's own link
// page as a visitor will see it, drawn from what the step has typed.
// Main task: show the address as it is typed and the booking page as it is named, so the thing being made is on
// screen while it is made.
// Leaves out: every other block, the look, the socials and the contact card (the link page editor), and anything
// that presses: it is inert (`isPreview`).
import { LinkPage, PhonePreview, type LinkPageBlock } from '@crm/ui';
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
  /** The booking pages on it: the ones that exist, and the one being named while Your booking page is the step. */
  readonly pages?: readonly { readonly id: string; readonly title: string; readonly minutes: number }[];
  /** The optional links being typed, or the ones that landed: they draw under the booking pages, as the page has them. */
  readonly links?: readonly { readonly title: string; readonly url: string }[];
  /** Places for blocks that aren't there yet, so a page with one row on it doesn't read as the finished thing. */
  readonly ghosts?: number;
  /** Their account photo, when they have one: the page shows it in place of the initials. */
  readonly image?: string;
}

/**
 * The link page as it stands: the person, the address under them, and the
 * booking page's row once it has a name. Inert and never on the public
 * origin, like the editor's own phone.
 */
export function LinkPagePreview({ name, id, handle, pages = [], links = [], ghosts = 0, image }: LinkPagePreviewProps) {
  const host = publicBookingHost();
  const label = `${host}/${handle}`;
  // A page with no name yet is left off: an empty row would read as a page that exists and has none.
  const pageBlocks: readonly LinkPageBlock[] = pages.flatMap((page) => {
    const title = page.title.trim();
    return title === ''
      ? []
      : [
          {
            kind: 'page' as const,
            id: page.id,
            title,
            // Nothing is pressable here, so the address is only what the row reads as.
            href: `/${handle}`,
            facts: strings.bookingLengthLabel(page.minutes),
          },
        ];
  });
  // A link with no title yet is left off, as a page with no name is: an empty row reads as a block that exists.
  const linkBlocks: readonly LinkPageBlock[] = links.flatMap((link, index) =>
    link.title.trim() === ''
      ? []
      : [
          {
            kind: 'link' as const,
            id: `welcome-link-${String(index)}`,
            title: link.title.trim(),
            href: link.url.trim(),
            hue: 'blue' as const,
          },
        ],
  );
  const blocks = [...pageBlocks, ...linkBlocks];
  return (
    // The same phone the booking page's preview and the editors use, so first run's two pages read alike.
    <PhonePreview>
      <LinkPage
        isPreview
        person={{ name, id, ...(image === undefined ? {} : { image }) }}
        blocks={blocks}
        address={{ label, value: `https://${label}` }}
        ghosts={Math.max(0, ghosts - linkBlocks.length)}
      />
    </PhonePreview>
  );
}
