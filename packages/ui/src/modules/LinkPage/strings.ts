/** LinkPage's built in copy. */
export const strings = {
  /** Read after a link's own words: it opens in a new tab. */
  newTab: '(opens in a new tab)',
  /** The blocks as one list, for screen readers, when no heading names them. */
  blocks: 'Links',
  loading: 'Loading…',
  /** The one primary action under the person: their contact card, downloaded as a vCard. */
  saveContact: 'Save contact',
  /** The address pill under the bio: its visible label is the address itself, so its name says what pressing it does. */
  copyAddress: (address: string) => `${address}, copy link`,
  /** The toast the address pill raises once it has copied. */
  addressCopied: 'Link copied',
} as const;
