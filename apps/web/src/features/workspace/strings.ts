import { replacedStrings } from './replaced.ts';

/** The workspace frame's and the object page's copy. */
export const strings = {
  product: 'Timefix',
  workspaceMenu: 'Workspace',
  signOut: 'Sign out',
  /** An archived object's address (spec 0012, AC-226). */
  objectArchived: (plural: string) => `${plural} is archived`,
  objectArchivedText: 'Its records are kept. Restore it to bring it back to the sidebar with everything it held.',
  objectArchivedMemberText: 'Its records are kept. A workspace owner or admin can restore it.',
  objectRestored: (plural: string) => `${plural} restored.`,
  restore: 'Restore',
  restoring: 'Restoring',
  backTo: (plural: string) => `Back to ${plural}`,
  openSettings: 'Open settings',
  signingOut: 'Signing out',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
  records: 'Records',
  /** The sidebar's way to the trash, at the foot of Records (spec 0022). */
  trash: 'Trash',
  /** The sidebar's way to the upcoming bookings, after Records. */
  bookings: 'Bookings',
  /** The sidebar's way to the booking links and the forms, after Bookings. */
  captures: 'Captures',
  /** The group holding Bookings, Captures and Trash after Records, for screen readers. */
  destinations: 'Workspace pages',
  /** The sidebar group above Records holding My tasks (spec 0019). */
  personal: 'Your work',
  /** The tasks page's row (the owner, 21 October 2026: the page is Tasks, with All tasks among its tabs). */
  myTasks: 'Tasks',
  /** The workspace menu's way into settings (spec 0012), above Sign out. */
  settings: 'Settings',
  noObjects: 'No objects yet',
  noObjectsText: 'This workspace has no records to show yet.',
  loadingTitle: 'Loading',
  failedTitle: 'Couldn’t load this workspace',
  failedText: 'Something went wrong. Try again in a moment.',
  workspaceMissingTitle: 'Workspace not found',
  workspaceMissingText: 'That workspace doesn’t exist, or you’re not a member of it.',
  pageMissingTitle: 'Page not found',
  pageMissingText: 'There’s nothing at this address.',
  checkAddress: 'Check the address for a typo, or open your workspace.',
  openWorkspace: 'Open your workspace',
  emptyTitle: (pluralName: string) => `No ${pluralName.toLowerCase()} yet`,
  emptyText: (pluralName: string) => `${pluralName} you add show here.`,
  /** The TopBar's action and the new record dialog's title ("New person"). */
  newRecord: (singularName: string) => `New ${singularName.toLowerCase()}`,
  creating: 'Creating',
  cancel: 'Cancel',
  addAttribute: 'Add attribute',
  /** After Add attribute: the new column often lands off screen, so say it was added. */
  attributeAdded: (title: string) => `${title} added.`,
  /** New person with no name typed. */
  recordNameMissing: (singularName: string) => `Name the ${singularName.toLowerCase()}.`,
  /** A required field left empty in the create dialog (spec 0012, AC-240). */
  valueMissing: (title: string) => `${title} is required. Give it a value.`,
  /** The create dialog's primary ("Create person"). */
  createRecord: (singularName: string) => `Create ${singularName.toLowerCase()}`,
  /** The create dialog's way to the attributes that aren't asked for first. */
  addMoreFields: 'Add more fields',
  /** While another filter's or order's first rows load (spec 0006, AC-57; spec 0020). */
  updating: 'Updating',
  retry: 'Retry',
  /** A failure the server didn't explain. */
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** Above the table while the live connection is down (AC-38). */
  livePaused: 'Live updates paused, reconnecting',
  /** A row with no name ("Unnamed person"), muted in its row header. */
  unnamed: (singularName: string) => `Unnamed ${singularName.toLowerCase()}`,
  /** A linked record this person can't see, or that was deleted. */
  unavailableRecord: 'Unavailable',
  /** Why a company or Owner cell can't be edited in this loop. */
  referenceReadOnly: 'You can’t change this here yet.',
  /** Clearing a relation cell that shows only its first 20 links (spec 0014). */
  clearTooMany: (title: string) =>
    `${title} holds more records than show here. Remove them from the record, one at a time.`,
  /** Spec 0006: a paste or range clear that landed, with Undo (AC-48). */
  /** Counts arrive formatted in the browser's language ("1,500"). */
  pasted: (cells: string) => `Pasted into ${cells} cells.`,
  cleared: (cells: string) => `Cleared ${cells} cells.`,
  undo: 'Undo',
  /** A paste over more records, or more data, than one write takes (AC-50): nothing shows or saves. */
  pasteTooMany: (limit: string) => `Nothing was pasted. Paste into at most ${limit} records at once.`,
  pasteTooBig: 'Nothing was pasted. That’s more than one change can save, so paste fewer cells at once.',
  /** After an undo (AC-48, AC-49). */
  undidCell: (attribute: string, record: string) => `Undid ${attribute} on ${record}.`,
  undidCells: (cells: string) => `Undid ${cells} changes.`,
  undidPaste: (cells: string) => `Undid the paste into ${cells} cells.`,
  undidClear: (cells: string) => `Undid the clear of ${cells} cells.`,
  /** A bulk edit undone (spec 0022, AC-530), in its object's words ("Undid the edit of 2 people."), as its toast said it. */
  undidBulk: (records: string) => `Undid the edit of ${records}.`,
  /** Cells an undo kept because they changed since; never says who (it may be the person, in another tab). */
  keptSince: (cells: number, shown: string) =>
    cells === 1 ? '1 cell was changed since, so it was kept.' : `${shown} cells were changed since, so they were kept.`,
  nothingToUndo: 'Nothing to undo.',
  /** A toast's Undo pressed after newer changes: nothing is undone. */
  undoStale: 'Newer changes came after that one, so it wasn’t undone. Undo them first.',
  /** The workspace menu's way to the shortcut list. */
  keyboardShortcuts: 'Keyboard shortcuts',
  /** Someone else's later save replaced the person's value (AC-46), and who changed it, from replaced.ts. */
  ...replacedStrings,
  /** ShortcutHelp, opened with ? anywhere in the workspace. */
  shortcutsEverywhere: 'Everywhere',
  /** The new record dialog's one email field: one address here, more in the table. */
  emailAddress: 'Email address',
  undoShortcut: 'Undo your last change',
  showShortcuts: 'Show keyboard shortcuts',
} as const;
