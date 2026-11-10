// What an email says, as data: a subject, the inbox preview line, a heading,
// a list of blocks and the footer's reason line. Every template returns one,
// and one renderer draws it twice, as HTML and as plain text, so the two
// parts always say the same thing and every email shares one design.

/** One label and value line, its value linked when `url` is set (an address on the app's own origin). */
export interface DocumentRow {
  readonly label: string;
  readonly value: string;
  readonly url?: string;
}

/** A block of an email's body. */
export type EmailBlock =
  /** A paragraph of body text. */
  | { readonly type: 'paragraph'; readonly text: string }
  /**
   * Label and value lines. `compact` puts short labels beside their values
   * (a booking's When and Where); `stacked` puts each label over its value
   * (a form's questions and answers, whose labels run long).
   */
  | { readonly type: 'rows'; readonly layout: 'compact' | 'stacked'; readonly rows: readonly DocumentRow[] }
  /** A code to type in, large and spaced, with what it is for read out first. */
  | { readonly type: 'code'; readonly code: string; readonly label: string }
  /** The one action, as a button, on the app's own origin. */
  | { readonly type: 'button'; readonly label: string; readonly url: string }
  /**
   * The one button that may leave the app: a meeting's video call (a
   * booking's reminder), https only. A block of its own, so every link to
   * another site is one a reviewer can find.
   */
  | { readonly type: 'callButton'; readonly label: string; readonly url: string }
  /** Someone's words, set apart: a message, an excerpt. */
  | { readonly type: 'quote'; readonly text: string }
  /** A quieter line: what happens next, what to do if it wasn't you. */
  | { readonly type: 'note'; readonly text: string }
  /** Who someone is with, by name beside their initials (a round robin booking's host, spec 0029). */
  | { readonly type: 'person'; readonly label: string; readonly name: string }
  /**
   * A booking's time, the one line the eye goes to first, with its zone quietly under it. `struck` crosses it out:
   * a time that no longer stands (a cancelled booking).
   */
  | { readonly type: 'when'; readonly line: string; readonly zone: string; readonly struck?: boolean }
  /** A hairline between parts. */
  | { readonly type: 'rule' }
  /**
   * A quiet line of text links after its lead words ("Need a change? Reschedule · Cancel"), each on the app's
   * own origin (or a declared public origin of ours), checked as a button is.
   */
  | {
      readonly type: 'links';
      readonly lead: string;
      readonly links: readonly { readonly label: string; readonly url: string }[];
    };

/** A whole email's words. */
export interface EmailDocument {
  readonly subject: string;
  /** The line an inbox shows after the subject. */
  readonly preheader: string;
  /** A small line over the heading: the workspace the email is about. */
  readonly eyebrow?: string;
  /**
   * The workspace's own logo over the eyebrow, on the app's own origin (a visitor's copy of a form, forms fixes 2):
   * the business's mark heads the email, and the product's stays in the footer. `alt` is the workspace's name.
   */
  readonly logo?: { readonly url: string; readonly alt: string };
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  /** Why the reader got this email, for the footer: "You got this email because …". */
  readonly why: string;
  /**
   * The booking emails' one Timefix look (bookings redesign, 10 November 2026): the Timefix logo heads the card, and
   * the footer sits inside it under a hairline, the reply line first. Every other email keeps the footer under the card.
   */
  readonly masthead?: boolean;
  /** A line that opens the footer, where a reply goes ("Reply to reach Ada Lovelace"): plain words, no link. */
  readonly reply?: string;
}
