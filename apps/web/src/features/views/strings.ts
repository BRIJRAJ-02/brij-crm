/** The view screen's copy (spec 0020). */
export const strings = {
  toolbar: 'View options',
  sort: 'Sort',
  filter: 'Filter',
  sorts: 'Sorts',
  filters: 'Filters',
  discard: 'Discard changes',
  save: 'Save',
  saving: 'Saving',
  /** After Save: the view now runs this for everyone who sees it. */
  saved: (name: string) => `Filters saved on ${name}.`,
  /** Someone else saved the view's filters while this tab had no draft (AC-468). */
  changedBy: (name: string) => `${name} changed the filters on this view.`,
  removedMember: 'A removed member',
  /** A link whose draft couldn't be read (AC-467). */
  draftUnreadable: 'That link’s filter couldn’t be read, so the saved view is shown.',
  /** A link's draft named fields this person can't use (AC-467). */
  draftDropped: 'Some filters in this link use fields that aren’t available to you, so they were left out.',
  dismiss: 'Dismiss',
  /** A filter that matches nothing (AC-486). */
  noMatchesTitle: (plural: string) => `No ${plural.toLowerCase()} match these filters`,
  noMatchesText: 'Change the filters to see more.',
  editFilters: 'Edit filters',
  /** The count after a filter, for screen readers (AC-487). */
  matching: (count: string, plural: string) => `${count} ${plural.toLowerCase()} match`,
  /** The clash dialog (AC-469). */
  changedTitle: 'This view changed',
  changedText: (sentence: string) => `${sentence} Replace them with yours? Cancel keeps your changes here, unsaved.`,
  replace: 'Replace',
  keepMine: 'Cancel',
  /** A view this person can't open (AC-463). */
  notFoundText: 'This view doesn’t exist or isn’t shared with you.',
  goTo: (name: string) => `Go to ${name}`,
  /** An object with no view this person may open (AC-462). */
  noViewsTitle: 'No views are available to you',
  noViewsText: 'Ask a workspace owner or admin about the views on this object.',
  /** A board before boards arrive (spec 0021). */
  boardSoon: 'Boards arrive soon. This view shows as a table for now.',
  /** The column menu's Filter on a relationship, until record search (spec 0014). */
  referenceFilterSoon: 'Filtering by a relationship arrives soon. Filter by its other fields for now.',
  saveFailed: 'Couldn’t save this view. Try again in a moment.',
} as const;
