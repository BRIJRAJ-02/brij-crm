import { replacedStrings } from './replaced.ts';

/** The workspace frame's and the object page's copy. */
export const strings = {
  product: 'Timefix',
  workspaceMenu: 'Workspace',
  workspaces: 'Workspaces',
  createWorkspace: 'Create workspace',
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
  /** The sign out confirm (the owner, 21 October 2026). */
  signOutTitle: 'Sign out?',
  signOutText: 'You’ll need to sign in again on this device.',
  /** Leaving the workspace (spec 0031, AC-812), from the workspace menu: it asks first. */
  leaveWorkspace: 'Leave workspace',
  leaveTitle: (workspace: string) => `Leave ${workspace}?`,
  leaveText: 'You lose access at once. To come back, someone has to invite you again.',
  leaving: 'Leaving',
  records: 'Records',
  /** The sidebar's way to the trash (spec 0022), at its foot (spec 0034, AC-930). */
  trash: 'Trash',
  /** The sidebar's way to the bookings, first under Scheduling (spec 0034, AC-928). */
  bookings: 'Bookings',
  /** The sidebar's way to the booking pages and forms, after Bookings (spec 0022; one row, the owner, 22 October 2026). */
  captures: 'Captures',
  /** The member's own public page (spec 0051), out of Settings and into the sidebar (owner, 25 October 2026). */
  linkPage: 'Link page',
  /** The sidebar's first row and the workspace's landing page (owner, 21 October 2026). */
  home: 'Home',
  /** The tasks page's row (spec 0019), after the sections, as timefix has it; Tasks, as the page is named (owner, 21 October 2026). */
  inbox: 'Inbox',
  tasks: 'Tasks',
  /** The group above the sections holding Tasks (and Inbox once it exists), for screen readers. */
  yourWork: 'Your work',
  /** The sidebar's sections (spec 0034). */
  favourites: 'Favourites',
  lists: 'Lists',
  scheduling: 'Scheduling',
  /** The foot's way to the shortcut list (AC-930: it opens the keyboard shortcuts until a help centre exists). */
  help: 'Help and shortcuts',
  /** Item and section menus (spec 0034, AC-932, AC-933). */
  hideFromSidebar: 'Hide from sidebar',
  removeFavourite: 'Remove from favourites',
  /** The star on a record's or a view's header (AC-934). */
  addFavourite: 'Add to favourites',
  moveUp: 'Move up',
  moveDown: 'Move down',
  customiseSidebar: 'Customise sidebar',
  /** Customise sidebar's code didn't load. */
  customiseUnavailable: 'Couldn’t open Customise sidebar. Reload the page, then try again.',
  /** An item's and a section's menu, for screen readers: "Deals options". */
  itemOptions: (name: string) => `${name} options`,
  sectionOptions: (title: string) => `${title} options`,
  /** A favourite record with no name (spec 0034, AC-925): "Unnamed person". */
  unnamedRecord: (singular: string) => `Unnamed ${singular.toLowerCase()}`,
  /** The workspace menu's way into settings (spec 0012), above Sign out. */
  settings: 'Settings',
  noObjects: 'No objects yet',
  noObjectsText: 'This workspace has no records to show yet.',
  loadingTitle: 'Loading',
  failedTitle: 'Couldn’t load this workspace',
  failedText: 'Something went wrong. Try again in a moment.',
  workspaceMissingTitle: 'Workspace not found',
  // A deleted workspace, as its owner sees it within the window (spec 0031, AC-823).
  deletedTitle: (name: string) => `${name} is deleted`,
  deletedText: (day: string) => `It goes for good on ${day}. Until then, you can restore it.`,
  restoreWorkspace: 'Restore workspace',
  restored: (name: string) => `${name} is back.`,
  restoreFailed: 'Couldn’t restore it. Try again in a moment.',
  backToWorkspaces: 'Back to your workspaces',
  /** The way home when the deleted workspace was the person's last: first run makes a new one. */
  startWorkspace: 'Start a new workspace',
  workspaceMissingText: 'That workspace doesn’t exist, or you’re not a member of it.',
  pageMissingTitle: 'Page not found',
  pageMissingText: 'There’s nothing at this address.',
  checkAddress: 'Check the address for a typo, or open your workspace.',
  openWorkspace: 'Open your workspace',
  // A workspace's sign in rules holding this session back (spec 0033, AC-894).
  twoFactorRequiredTitle: (workspace: string) => `${workspace} requires two factor sign in`,
  twoFactorRequiredText:
    'Set up an authenticator app to open it. Your other workspaces open as usual from the workspace menu.',
  twoFactorDone: 'You’re set up. Two factor sign in now protects your account in every workspace.',
  setUpNow: 'Set up now',
  continueToWorkspace: 'Continue',
  signInAgainTitle: (workspace: string) => `${workspace} asks you to sign in again`,
  signInAgainText:
    'Its owner set how long a sign in lasts, or signed everyone out. Confirm it’s you to open it again. Your other workspaces stay open.',
  signInAgainFailed: 'Couldn’t sign you out. Check your connection, then try again.',
  confirmItsYou: 'Confirm it’s you',
  sendCode: 'Email me a code',
  signOutInstead: 'Sign out instead',
  signOutEverywhereText: 'You’ll need to sign in again on this device, for every workspace.',
  stillHeld: 'The workspace still asks for two factor sign in. Try again in a moment.',
  stillHeldSignIn: 'The workspace still asks you to sign in again. Sign out, then sign in.',
  emptyTitle: (pluralName: string) => `No ${pluralName.toLowerCase()} yet`,
  emptyText: (pluralName: string) => `${pluralName} you add show here.`,
  /** The TopBar's action and the new record dialog's title ("New person"). */
  newRecord: (singularName: string) => `New ${singularName.toLowerCase()}`,
  creating: 'Creating',
  /** The table's footer, under the name column: how many records the view holds ("10,000+ records"). */
  recordCount: (count: string, isOne: boolean) => (isOne ? `${count} record` : `${count} records`),
  /** The person's own filter changed while rows were ticked: the old rows can't be known to match. */
  selectionCleared: 'Selection cleared: the filter changed.',
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
  /** New record's footer Switch: Create keeps the dialog open, emptied, for the next one (as Attio's). */
  createMore: 'Create more',
  /** The toast once a new record is made, with Open to its page. */
  recordCreated: (name: string) => `${name} created`,
  openRecord: 'Open',
  /** The create dialog's way to the attributes that aren't asked for first. */
  addMoreFields: 'Add more fields',
  /** While another filter's or order's first rows load (spec 0006, AC-57; spec 0020). */
  updating: 'Updating',
  retry: 'Retry',
  /** A failure the server didn't explain. */
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** Above the table while the live connection is down (AC-38). */
  livePaused: 'Live updates paused, reconnecting',
  groupingTooMany: (field: string, count: number, max: number) =>
    `Not grouped: ${field} has ${String(count)} options (max ${String(max)})`,
  groupingArchived: (field: string) => `Not grouped: ${field} is archived`,
  groupingCant: (field: string) => `Not grouped: ${field} can’t group a table`,
  groupingGone: 'Not grouped: field unavailable',
  /** A row with no name ("Unnamed person"), muted in its row header. */
  unnamed: (singularName: string) => `Unnamed ${singularName.toLowerCase()}`,
  /** A linked record this person can't see, or that was deleted. */
  unavailableRecord: 'Unavailable',
  /** Why a reference cell that can't link (one way, or its far object hidden) can't be edited here. */
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
  /** Someone else's later save replaced the person's value (AC-46), and who changed it, from replaced.ts. */
  ...replacedStrings,
  /** ShortcutHelp, opened with ? anywhere in the workspace. */
  shortcutsEverywhere: 'Everywhere',
  /** The new record dialog's one email field: one address here, more in the table. */
  emailAddress: 'Email address',
  undoShortcut: 'Undo your last change',
  showShortcuts: 'Show keyboard shortcuts',
  toggleRail: 'Fold the sidebar to icons, or open it',
} as const;
