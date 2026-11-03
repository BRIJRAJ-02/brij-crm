// A booking's emails (spec 0025, Emails): core's `prepareBookingMail` chooses
// every word (who hears what, the subject, the heading, the rows, the one
// button, the quiet line under it, and why the reader got it), and this draws
// them on the shared layout. The one button is on the app's origin (the
// booking's page, the bookings list, booking again), or, on a reminder, the
// meeting's own video call, the one link an email may have to another site.
import type { EmailBlock, EmailDocument } from '../document.ts';

/** A booking email's words: core's `BookingMail`, less who it goes to and its calendar file. */
export interface BookingWords {
  readonly subject: string;
  /** The inbox preview line. */
  readonly preview: string;
  readonly heading: string;
  readonly intro: string;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  /** The one button. */
  readonly button?: { readonly label: string; readonly url: string };
  /** A quiet line under the button. */
  readonly footnote?: string;
  /** Why the reader got it, for the footer. */
  readonly why: string;
  /** Who they meet, shown by name beside their initials (a round robin booking's host, spec 0029). */
  readonly host?: { readonly label: string; readonly name: string };
}

/** Whether a link is on one of ours; a link that doesn't parse isn't (and the layout refuses it). */
function sameOrigin(link: string, origins: readonly string[]): boolean {
  try {
    const { origin } = new URL(link);
    return origins.some((each) => {
      try {
        return new URL(each).origin === origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * A booking email as the shared layout draws it, word for word. A button on
 * one of our own origins is a button; anything else can only be the meeting's
 * video call, so it is drawn as the call button (https only).
 *
 * `ours` matters more than it looks. The manage button and Book again are
 * built on `BOOKING_PUBLIC_ORIGIN` where that is set (`mail.ts`), and without
 * it here they are not recognised as ours — so "View your booking" would be
 * drawn and labelled as the join-the-call button, silently, with no error
 * anywhere (3 November 2026).
 */
export function bookingDocument(words: BookingWords, appOrigin: string, ours: readonly string[] = []): EmailDocument {
  const blocks: EmailBlock[] = [{ type: 'paragraph', text: words.intro }];
  if (words.host !== undefined) blocks.push({ type: 'person', label: words.host.label, name: words.host.name });
  if (words.rows.length > 0) blocks.push({ type: 'rows', layout: 'compact', rows: words.rows });
  if (words.button !== undefined) {
    blocks.push({
      type: sameOrigin(words.button.url, [appOrigin, ...ours]) ? 'button' : 'callButton',
      label: words.button.label,
      url: words.button.url,
    });
  }
  if (words.footnote !== undefined) blocks.push({ type: 'note', text: words.footnote });
  return {
    subject: words.subject,
    preheader: words.preview,
    heading: words.heading,
    blocks,
    why: words.why,
  };
}
