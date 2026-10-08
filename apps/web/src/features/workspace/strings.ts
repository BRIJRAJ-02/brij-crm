/** The workspace frame's and the object page's copy. */
export const strings = {
  product: 'CRM',
  workspaceMenu: 'Workspace',
  signOut: 'Sign out',
  signingOut: 'Signing out',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
  records: 'Records',
  noObjects: 'No objects yet',
  noObjectsText: 'This workspace has no records to show yet.',
  loadingTitle: 'Loading',
  failedTitle: 'Couldn’t load this workspace',
  failedText: 'Check your connection, then try again.',
  workspaceMissingTitle: 'Workspace not found',
  workspaceMissingText: 'That workspace doesn’t exist, or you’re not a member of it.',
  pageMissingTitle: 'Page not found',
  pageMissingText: 'There’s nothing at this address.',
  checkAddress: 'Check the address for a typo, or open your workspace.',
  openWorkspace: 'Open your workspace',
  emptyTitle: (pluralName: string) => `No ${pluralName.toLowerCase()} yet`,
  emptyText: (pluralName: string) => `${pluralName} you add show here.`,
  /** The object's one view in this loop ("All people"). */
  allRecords: (pluralName: string) => `All ${pluralName.toLowerCase()}`,
  /** The TopBar's action and the new record dialog's title ("New person"). */
  newRecord: (singularName: string) => `New ${singularName.toLowerCase()}`,
  create: 'Create',
  creating: 'Creating',
  cancel: 'Cancel',
  addAttribute: 'Add attribute',
  attributeName: 'Name',
  attributeType: 'Type',
  attributeNameMissing: 'Name the attribute.',
  attributeNameTaken: 'An attribute with this name exists.',
  /** After Add attribute: the new column often lands off screen, so say it was added. */
  attributeAdded: (title: string) => `${title} added.`,
  /** New person with no name typed. */
  recordNameMissing: (singularName: string) => `Name the ${singularName.toLowerCase()}.`,
  /** While another order's first rows load (spec 0006, AC-57). */
  sorting: 'Sorting',
  retry: 'Retry',
  /** A sort whose first rows didn't load; Retry asks again. */
  sortFailed: (column: string) => (column === '' ? 'Couldn’t sort the table.' : `Couldn’t sort by ${column}.`),
  /** A failure the server didn't explain. */
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** Above the table while the live connection is down (AC-38). */
  livePaused: 'Live updates are paused. Changes others make show here once the connection is back.',
  /** Why a company or Owner cell can't be edited in this loop. */
  referenceReadOnly: 'You can’t change this here yet.',
  /** Spec 0006: a paste or range clear that landed, with Undo (AC-48). */
  /** Counts arrive formatted in the browser's language ("1,500"). */
  pasted: (cells: string) => `Pasted into ${cells} cells`,
  cleared: (cells: string) => `Cleared ${cells} cells`,
  undo: 'Undo',
  /** A paste over more records, or more data, than one write takes (AC-50): nothing shows or saves. */
  pasteTooMany: (limit: string) => `Nothing was pasted. Paste into at most ${limit} records at once.`,
  pasteTooBig: 'Nothing was pasted. That’s more than one change can save, so paste fewer cells at once.',
  /** After an undo (AC-48, AC-49). */
  undidCell: (attribute: string, record: string) => `Undid ${attribute} on ${record}`,
  undidCells: (cells: string) => `Undid ${cells} changes`,
  undidPaste: (cells: string) => `Undid the paste into ${cells} cells`,
  undidClear: (cells: string) => `Undid the clear of ${cells} cells`,
  /** Cells an undo kept because they changed since; never says who (it may be the person, in another tab). */
  keptSince: (cells: number, shown: string) =>
    cells === 1 ? '1 cell was changed since, so it was kept.' : `${shown} cells were changed since, so they were kept.`,
  nothingToUndo: 'Nothing to undo',
  /** A toast's Undo pressed after newer changes: nothing is undone. */
  undoStale: 'Newer changes came after that one, so it wasn’t undone. Undo them first.',
  /** The workspace menu's way to the shortcut list. */
  keyboardShortcuts: 'Keyboard shortcuts',
  /** Someone else's later save replaced the person's value (AC-46). */
  replaced: (who: string, attribute: string, others: number, record: string) =>
    others === 0
      ? `${who} changed ${attribute} on ${record} just after you, so your value was replaced.`
      : `${who} changed ${attribute} and ${String(others)} more on ${record} just after you, so your values were replaced.`,
  useMine: 'Use mine',
  someone: 'Someone',
  anApiKey: 'An API key',
  anAutomation: 'An automation',
  /** ShortcutHelp, opened with ? anywhere in the workspace. */
  shortcutsEverywhere: 'Everywhere',
  undoShortcut: 'Undo your last change',
  showShortcuts: 'Show keyboard shortcuts',
} as const;
