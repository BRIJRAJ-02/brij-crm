/** The Trash screen's copy (spec 0022). */
export const strings = {
  title: 'Trash',
  /** The sidebar's way in, at the foot of Records. */
  navLabel: 'Trash',
  /** The count beside the title ("1,234 records"). */
  countLabel: 'records',
  objectFilter: 'Object',
  allObjects: 'All objects',
  archived: (pluralName: string) => `${pluralName} (archived)`,
  filterLabel: 'Trash filter',
  columns: {
    name: 'Name',
    object: 'Object',
    deletedBy: 'Deleted by',
    deletedAt: 'Deleted',
    expiresAt: 'Removed after',
  },
  /** Why a trashed record's cells don't edit. */
  readOnly: 'Restore it to change it.',
  emptyTitle: 'The trash is empty',
  emptyText: 'Deleted records stay here for 30 days.',
  /** The object filter matching nothing. */
  emptyObject: (pluralName: string) => `No deleted ${pluralName.toLowerCase()}`,
  emptyObjectText: (pluralName: string) => `Deleted ${pluralName.toLowerCase()} stay here for 30 days.`,
  showAll: 'Show all objects',
  retry: 'Retry',
  restore: 'Restore',
  /** No selected record's object is one the person may change (AC-534). */
  cannotRestore: 'You can view these records but not restore them.',
  tooMany: 'Changes to more than 500 records arrive soon.',
  oneRecord: '1 record',
  records: (count: string) => `${count} records`,
  restoredOne: (name: string) => `Restored ${name}.`,
  restored: (records: string) => `Restored ${records}.`,
  someRefused: (refused: number) =>
    refused === 1
      ? '1 couldn’t be restored; its row says why.'
      : `${new Intl.NumberFormat().format(refused)} couldn’t be restored; each row says why.`,
  noneRestored: (records: string) => `${records} couldn’t be restored. Each row says why.`,
  somethingWrong: 'Something went wrong. Try again in a moment.',
  failedTitle: 'Couldn’t load the trash',
  theSystem: 'The system',
  anApiKey: 'An API key',
  anAutomation: 'An automation',
  aForm: 'A form',
  removedMember: 'Someone removed from this workspace',
} as const;
