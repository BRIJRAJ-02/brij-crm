/** The Trash screen's copy (spec 0022). */
export const strings = {
  title: 'Trash',
  /** The count beside the title, as a screen reader hears it: "1 record", "1,234 records" (Q98). */
  countLabel: (count: number) => (count === 1 ? 'record' : 'records'),
  objectFilter: 'Object',
  allObjects: 'All objects',
  archived: (pluralName: string) => `${pluralName} (archived)`,
  filterLabel: 'Trash filter',
  columns: {
    name: 'Name',
    object: 'Object',
    deletedBy: 'Deleted by',
    deletedAt: 'Deleted',
    /** The day the record is deleted for good, 30 days after it was deleted. */
    expiresAt: 'Deleted forever on',
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
  /** The same for an owner or admin, whose Delete forever fails closed too (AC-538 as amended). */
  cannotChange: 'You can view these records but not restore or delete them.',
  /** Over the 500 a restore or Delete forever sends at once; Select all runs more as a background change. */
  tooMany: 'Pick up to 500 at a time, or use Select all to restore more.',
  tooManyDelete: 'Pick up to 500 at a time, or use Select all to delete more.',
  oneRecord: '1 record',
  records: (count: string) => `${count} records`,
  restoredOne: (name: string) => `Restored ${name}.`,
  restored: (records: string) => `Restored ${records}.`,
  someRefused: (refused: number) =>
    refused === 1
      ? '1 couldn’t be restored; its row says why.'
      : `${new Intl.NumberFormat().format(refused)} couldn’t be restored; each row says why.`,
  noneRestored: (records: string) => `${records} couldn’t be restored. Each row says why.`,
  /** Delete forever refused for some (an object the person may only read), in restore's words. */
  someNotDeleted: (refused: number) =>
    refused === 1
      ? '1 couldn’t be deleted; its row says why.'
      : `${new Intl.NumberFormat().format(refused)} couldn’t be deleted; each row says why.`,
  noneDeleted: (records: string) => `${records} couldn’t be deleted. Each row says why.`,
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** Delete forever and Empty trash (spec 0022, milestone 4): owners and admins only. */
  deleteForever: 'Delete forever',
  emptyTrash: 'Empty trash',
  confirmPurgeTitle: (records: string) => `Delete ${records} forever?`,
  confirmPurgeText: 'This can’t be undone.',
  confirmEmptyTitle: 'Empty the trash?',
  /** Empty trash narrowed to one object by the filter: it says so (the button and the confirm). */
  emptyObjectTrash: (pluralName: string) => `Empty deleted ${pluralName.toLowerCase()}`,
  confirmEmptyObjectTitle: (pluralName: string) => `Delete all ${pluralName.toLowerCase()} in the trash forever?`,
  /** Why Empty trash is off while a change runs (said to screen readers; the bar shows the change). */
  waitForChange: 'Wait for the change under way to finish.',
  restoreRecords: (records: string) => `Restore ${records}`,
  deleteRecordsForever: (records: string) => `Delete ${records} forever`,
  confirmEmptyText: (records: string) => `${records} will be deleted forever. This can’t be undone.`,
  confirmRestoreTitle: (records: string) => `Restore ${records}?`,
  confirmRestoreText: 'They come back with their links, list entries, notes and history.',
  cancel: 'Cancel',
  purgedOne: 'Deleted 1 record forever.',
  purged: (records: string) => `Deleted ${records} forever.`,
  purgedSkipped: (skipped: number) =>
    skipped === 1
      ? '1 was no longer in the trash.'
      : `${new Intl.NumberFormat().format(skipped)} were no longer in the trash.`,
  failedTitle: 'Couldn’t load the trash',
  theSystem: 'The system',
  anApiKey: 'An API key',
  anAutomation: 'An automation',
  aForm: 'A form',
  aBookingPage: 'A booking page',
  removedMember: 'Someone removed from this workspace',
} as const;
