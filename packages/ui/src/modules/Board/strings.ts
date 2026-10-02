/** Board's built in copy. Counts take the number already formatted, and its plural category. */
export const strings = {
  /** A column's count, read after its title. */
  cards: (count: string, plural: Intl.LDMLPluralRule) => (plural === 'one' ? `${count} card` : `${count} cards`),
  noCards: 'No cards',
  /** Shown on an archived column while a card is moving. */
  archivedRefuses: 'Archived. Cards can’t move here.',
  hiddenColumns: (count: string, plural: Intl.LDMLPluralRule) =>
    plural === 'one' ? `${count} hidden column` : `${count} hidden columns`,
  hideEmpty: 'Hide empty columns',
  /** The drag handle's name. */
  move: (name: string) => `Move ${name}`,
  loading: 'Loading the board',
  noColumns: 'Nothing to group by yet',
  noColumnsBody: 'Add options to this attribute to make columns.',
  failed: 'The board didn’t load',
  noAccess: 'You can’t see this board',
  noAccessBody: 'Ask a workspace admin for access.',
} as const;
