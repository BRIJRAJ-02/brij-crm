/** Board's built in copy. Counts take the number already formatted, and its plural category. */
export const strings = {
  /** What a column's count pill counts, read after its number ("3 cards"). */
  cardNoun: (plural: Intl.LDMLPluralRule) => (plural === 'one' ? 'card' : 'cards'),
  noCards: 'No cards',
  /** What a card's comment count counts, read after the number. */
  openThreads: (count: number) => (count === 1 ? 'open comment thread' : 'open comment threads'),
  /** The column head's "+": names the column it adds to. */
  addCard: (column: string) => `Add to ${column}`,
  /** A column folded into a strip, and opened again. */
  collapse: (column: string) => `Collapse ${column}`,
  expand: (column: string) => `Expand ${column}`,
  /** The new column's name field, named by the screen's own label ("Add stage"). */
  newColumnName: (label: string) => `${label}: name`,
  adding: 'Adding…',
  /** The column couldn't be made and the screen gave no reason (the connection dropped). */
  addFailed: 'Couldn’t add it. Try again.',
  /** Shown on an archived column while a card is moving. */
  archivedRefuses: 'Archived. Cards can’t move here.',
  hiddenColumns: (count: string, plural: Intl.LDMLPluralRule) =>
    plural === 'one' ? `${count} hidden column` : `${count} hidden columns`,
  /** A card's hover button that opens the record beside the board, as the table's row header has; Space does the same. */
  openInPanel: 'Open in panel',
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
  noColumnsBody: 'Add options to the grouping field.',
  failed: 'The board didn’t load',
  noAccess: 'You can’t see this board',
  noAccessBody: 'Ask a workspace admin for access.',
} as const;
