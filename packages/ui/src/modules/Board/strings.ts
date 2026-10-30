/** Board's built in copy. Counts take the number already formatted, and its plural category. */
export const strings = {
  /** A column's count, read after its title. */
  cards: (count: string, plural: Intl.LDMLPluralRule) => (plural === 'one' ? `${count} card` : `${count} cards`),
  /** A count that is a floor (a filtered count past its cap), read after the column's title, and as it shows. */
  cardsAtLeast: (count: string) => `${count} or more cards`,
  atLeast: (count: string) => `${count}+`,
  noCards: 'No cards',
  /** The column head's "+": names the column it adds to. */
  addCard: (column: string) => `Add to ${column}`,
  /** A column folded into a strip, and opened again. */
  collapse: (column: string) => `Collapse ${column}`,
  expand: (column: string) => `Expand ${column}`,
  /** The new column's name field, named by the screen's own label ("Add stage"). */
  newColumnName: (label: string) => `${label}: name`,
  /** Shown on an archived column while a card is moving. */
  archivedRefuses: 'Archived. Cards can’t move here.',
  hiddenColumns: (count: string, plural: Intl.LDMLPluralRule) =>
    plural === 'one' ? `${count} hidden column` : `${count} hidden columns`,
  hideEmpty: 'Hide empty columns',
  /** The drag handle's name. */
  move: (name: string) => `Move ${name}`,
  /** What a screen reader hears as a card moves. */
  lifted: (name: string, column: string) => `${name} picked up, in ${column}.`,
  over: (name: string, column: string) => `${name}, over ${column}.`,
  dropped: (name: string, column: string) => `${name}, moved to ${column}.`,
  putBack: (name: string) => `${name}, put back where it was.`,
  moving: (name: string) => `Moving ${name}`,
  loading: 'Loading the board',
  noColumns: 'Nothing to group by yet',
  noColumnsBody: 'Add options to this attribute to make columns.',
  failed: 'The board didn’t load',
  noAccess: 'You can’t see this board',
  noAccessBody: 'Ask a workspace admin for access.',
} as const;
