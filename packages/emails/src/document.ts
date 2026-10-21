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
  /** The one action, as a button. */
  | { readonly type: 'button'; readonly label: string; readonly url: string }
  /** Someone's words, set apart: a message, an excerpt. */
  | { readonly type: 'quote'; readonly text: string }
  /** A quieter line: what happens next, what to do if it wasn't you. */
  | { readonly type: 'note'; readonly text: string };

/** A whole email's words. */
export interface EmailDocument {
  readonly subject: string;
  /** The line an inbox shows after the subject. */
  readonly preheader: string;
  /** A small line over the heading: the workspace the email is about. */
  readonly eyebrow?: string;
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  /** Why the reader got this email, for the footer: "You got this email because …". */
  readonly why: string;
}
