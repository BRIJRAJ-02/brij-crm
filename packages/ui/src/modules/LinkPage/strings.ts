/** LinkPage's built in copy. */
export const strings = {
  /** Read after a link's own words: it opens in a new tab. */
  newTab: '(opens in a new tab)',
  /** The blocks as one list, for screen readers, when no heading names them. */
  blocks: 'Links',
  loading: 'Loading…',
  /** What a set of questions is called when its owner gave it no title of its own (spec 0052, AC-5209). */
  questions: 'Questions',
  /** The one primary action under the person: their contact card, downloaded as a vCard. */
  saveContact: 'Save contact',
  /** The address pill under the bio: its visible label is the address itself, so its name says what pressing it does. */
  copyAddress: (address: string) => `${address}, copy link`,
  /** The toast the address pill raises once it has copied. */
  addressCopied: 'Link copied',
  /**
   * Read on a folded section's row after its words (AC-5416): the number beside the chevron is shown, and this
   * says what it counts, so the row reads as "Work, 3 links inside, collapsed" rather than as a bare number.
   */
  inside: (count: number) => (count === 1 ? '1 link inside' : `${String(count)} links inside`),
} as const;
