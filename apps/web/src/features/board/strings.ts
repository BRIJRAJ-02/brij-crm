/** The board view's copy (spec 0021). */
export const strings = {
  /** The board's name for screen readers. */
  label: (plural: string, groupBy: string) => `${plural} by ${groupBy}`,
  /** The column of records with no value (AC-494). */
  noValue: (title: string) => `No ${title}`,
  /** The Table and Board switch (AC-492). */
  layout: 'Layout',
  table: 'Table',
  board: 'Board',
  /** An object with nothing to group by (AC-493). */
  nothingToGroupTitle: (plural: string) => `${plural} have no status or select field to group by.`,
  nothingToGroupText: 'Add a status or select field, and the board makes a column for each of its options.',
  addAttribute: 'Add attribute',
  /** Past 50 options (AC-494). */
  tooManyTitle: 'Boards show up to 50 columns.',
  tooManyText: (title: string, count: string) => `${title} has ${count} options.`,
  /** The grouping field was archived (AC-506). */
  groupArchivedTitle: (title: string) => `${title} is archived.`,
  groupArchivedText: 'Pick another field to group by.',
  /** A required field's no value column, while a card moves (AC-502). */
  requiredRefuses: (title: string) => `${title} is required, so cards can’t move here.`,
  /** An object the member may only read: why no card moves. */
  readOnly: (plural: string) => `You can view ${plural.toLowerCase()} but not change them.`,
  /** After a move, for screen readers (AC-509). */
  moved: (name: string, column: string) => `Moved ${name} to ${column}.`,
} as const;
