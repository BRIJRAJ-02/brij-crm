/** The view screen's copy (spec 0020). */
export const strings = {
  /** The view menu's way to the trash, filtered to this object. */
  openTrash: 'Open trash',
  toolbar: 'View options',
  sort: 'Sort',
  filter: 'Filter',
  sorts: 'Sorts',
  filters: 'Filters',
  discard: 'Discard changes',
  /** After Discard changes, with Undo (30 October 2026: Undo over a confirm). */
  discarded: 'Changes discarded.',
  save: 'Save',
  saving: 'Saving',
  /** After Save: the view now runs this for everyone who sees it. */
  saved: (name: string) => `Filters saved on ${name}.`,
  /** Someone else saved the view's filters while this tab had no draft (AC-468). */
  changedBy: (name: string) => `${name} changed the filters on this view.`,
  /** The same, while rows were ticked: the selection goes with the old filters (spec 0022, AC-522, owner decision 5). */
  changedByCleared: (name: string) => `${name} changed the filters on this view, so your selection was cleared.`,
  removedMember: 'A removed member',
  /** A link whose draft couldn't be read (AC-467). */
  draftUnreadable: 'That link’s filter couldn’t be read, so the saved view is shown.',
  /** A link's draft named fields this person can't use (AC-467). */
  draftDropped: 'Some filters in this link use fields that aren’t available to you, so they were left out.',
  /** A view filtering or sorting on archived fields (spec 0020, AC-480), naming them. */
  archivedInView: (titles: readonly string[]) => {
    const named = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(titles);
    return titles.length === 1
      ? `This view uses ${named}, which is archived, so it’s left out.`
      : `This view uses ${named}, which are archived, so they’re left out.`;
  },
  dismiss: 'Dismiss',
  /** A filter that matches nothing (AC-486). */
  noMatchesTitle: (plural: string) => `No ${plural.toLowerCase()} match these filters`,
  noMatchesText: 'Change the filters to see more.',
  editFilters: 'Edit filters',
  /** The view's search (CRM flow pass): narrows by name, never saved. */
  searchView: (plural: string) => `Search ${plural.toLowerCase()}`,
  noSearchMatchesTitle: (plural: string, typed: string) => `No ${plural.toLowerCase()} match “${typed}”`,
  clearSearch: 'Clear search',
  /** A column hidden, moved or resized on a shared view: it changed for everyone at once (CRM flow pass). */
  layoutForEveryone: (name: string) => `Changed for everyone on ${name}.`,
  undo: 'Undo',
  /** The count after a filter, for screen readers (AC-487). */
  matching: (count: string, plural: string) => `${count} ${plural.toLowerCase()} match`,
  /** The clash dialog (AC-469). */
  changedTitle: 'This view changed',
  changedText: (sentence: string) =>
    `${sentence} Replace them with yours, or save yours as a new view? Cancel keeps your changes here, unsaved.`,
  replace: 'Replace',
  keepMine: 'Cancel',
  /** A view this person can't open (AC-463). */
  notFoundText: 'This view doesn’t exist or isn’t shared with you.',
  goTo: (name: string) => `Go to ${name}`,
  /** An object with no view this person may open (AC-462). */
  noViewsTitle: 'No views are available to you',
  noViewsText: 'Create one for yourself, or ask a workspace owner or admin about the shared views here.',
  saveFailed: 'Couldn’t save this view. Try again in a moment.',
  /** Milestone 2: making and managing views. */
  saveAsNew: 'Save as new view',
  createViewTitle: 'Create view',
  saveAsNewTitle: 'Save as new view',
  createView: 'Create view',
  creatingView: 'Creating view',
  cancel: 'Cancel',
  viewName: 'Name',
  nameMissing: 'Give the view a name.',
  /** Create view's Type (AC-472): a table, or a board (spec 0021). */
  viewType: 'Type',
  typeTable: 'Table',
  typeBoard: 'Board',
  createFailed: 'Couldn’t create this view. Try again in a moment.',
  created: (name: string) => `Created ${name}.`,
  privateSection: 'Private',
  viewSettings: 'View settings',
  /** Under View settings' columns: a new attribute is one more column. */
  addAttribute: 'Add attribute',
  columns: 'Columns',
  /** A table's View settings: the rows in runs by a status or single select (13 Oct reference batch 4). */
  groupBy: 'Group by',
  noGrouping: 'None',
  /** A board's View settings: what its cards show. */
  cardFields: 'Card fields',
  cardFieldsFull: (max: number) => `A card shows up to ${String(max)} fields. Hide one to show another.`,
  rename: 'Rename',
  renameTitle: 'Rename view',
  duplicate: 'Duplicate',
  duplicated: (name: string) => `Duplicated as ${name}.`,
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy the link. Copy it from the address bar.',
  linkTooLong: 'This filter is too long for a link. Save it as a view to share it.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  shareWithEveryone: 'Share with everyone',
  makePrivate: 'Make private',
  shared: (name: string) => `${name} is shared with everyone.`,
  madePrivate: (name: string) => `${name} is only yours now.`,
  /** Make private asks first: everyone else loses the view (the owner's rule for ending actions, 21 October 2026). */
  makePrivateTitle: (name: string) => `Make ${name} private?`,
  makePrivateText: 'Only you will see this view, and everyone else loses it from their list.',
  makingPrivate: 'Making private',
  lock: 'Lock',
  unlock: 'Unlock',
  locked: (name: string) => `${name} is locked.`,
  unlocked: (name: string) => `${name} is unlocked.`,
  setDefault: 'Set as default',
  // Late trap #27: a member's last opened view still wins for them (AC-462), so the toast says who lands on it.
  isDefaultNow: (name: string) => `${name} is the default view.`,
  deleteView: 'Delete view',
  deleting: 'Deleting',
  deleteSharedTitle: (name: string) => `Delete ${name} for everyone?`,
  deletePrivateTitle: (name: string) => `Delete ${name}?`,
  /** What a delete does, and that it can't be undone, in one sentence (the owner's rule for every confirm, 21 Oct). */
  deleteSharedText: 'Everyone who sees this view loses it for good, and its records stay.',
  deletePrivateText: 'This view goes for good, and its records stay.',
  deleted: (name: string) => `Deleted ${name}.`,
  /** Another member deleted the view this tab was on (AC-474). */
  deletedBy: (name: string, defaultName: string) =>
    `${name} isn’t available to you any more, so you’re on ${defaultName}.`,
  /** Opening another view dropped this one's unsaved filters and sorts (AC-466). */
  draftLeft: (name: string) => `Your changes on ${name} weren’t saved. Back brings them back.`,
  movedUp: (name: string) => `Moved ${name} up.`,
  movedDown: (name: string) => `Moved ${name} down.`,
  renaming: 'Renaming',
  actionFailed: 'That didn’t work. Try again in a moment.',
  /** The view menu's disabled reasons (spec 0020, the view menu table). */
  viewLocked: 'This view is locked.',
  /** Delete or Make private on the default view: what the person can do about it, short. */
  defaultFirstFix: 'Make another view the default first.',
  creatorGone: 'This view’s creator has left the workspace.',
  onlyCreator: (name: string) => `Only ${name} can make this view private.`,
  unlockFirst: 'Unlock it first.',
  shareFirst: 'Share it with everyone first.',
  theWorkspace: 'the workspace',
  /** The lock line in the view bar (AC-475, AC-476). */
  lockedBy: (name: string) => `Locked by ${name}.`,
  lockedUnsaved: (name: string) => `Locked by ${name}. Your changes here aren’t saved.`,
  thisView: 'This view',
} as const;
