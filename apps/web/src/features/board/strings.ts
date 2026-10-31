import { sharedStrings } from '@crm/ui';

/** The board view's copy (spec 0021). */
export const strings = {
  /** The board's name for screen readers. */
  label: (plural: string, groupBy: string) => `${plural} by ${groupBy}`,
  /** A board or table grouped by a checkbox: its two columns. */
  checked: 'Checked',
  unchecked: 'Not checked',
  /** The column of records with no value (AC-494). */
  noValue: (title: string) => `No ${title}`,
  /** The Table and Board switch (AC-492). */
  layout: 'Layout',
  table: 'Table',
  board: 'Board',
  /** An object with nothing to group by (AC-493). */
  nothingToGroupTitle: 'Pick a field to group by',
  nothingToGroupText: 'Boards group by a status or select field.',
  nothingToGroupTextReader: 'Boards group by a status or select field. Ask an admin to add one.',
  addGroupField: 'Add status or select',
  /** Past 50 options (AC-494). */
  tooManyTitle: 'Boards show up to 50 columns',
  tooManyText: (title: string, count: string) => `${title} has ${count} options.`,
  /** The grouping field was archived (AC-506). */
  groupArchivedTitle: (title: string) => `${title} is archived.`,
  /** The view's own grouping field isn't one this reader can use (late trap #29): the board stands in with another. */
  standIn: (field: string) => `Grouped by ${field}: this view’s field is unavailable`,
  /** Its ways out are its buttons (late trap #14); a reader, who has no Restore, hears who can. */
  groupArchivedTextReader: 'Only owners and admins can restore it.',
  showAsTable: 'Show as table',
  restoreGroup: (title: string) => `Restore ${title}`,
  restoringGroup: 'Restoring…',
  restoredGroup: (title: string) => `${title} restored.`,
  restoreGroupFailed: (title: string, why: string) => `Couldn’t restore ${title}. ${why}`,
  tryAgain: sharedStrings.couldntDoThat,
  /** A required field's no value column, while a card moves (AC-502). */
  requiredRefuses: (title: string) => `${title} is required. Cards can’t move here.`,
  /** An object the member may only read: why no card moves. */
  readOnly: (plural: string) => `${plural} are view only.`,
  /** The column after the last, for whoever may add an option to the grouping field (the CRM flow pass). */
  addStage: 'Add stage',
  addOption: 'Add option',
  /** After a move, for screen readers (AC-509). */
  moved: (name: string, column: string) => `Moved ${name} to ${column}.`,
} as const;
