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
  saved: (name: string) => `${name} saved for everyone on this view.`,
  /** Someone else saved the view's filters while this tab had no draft (AC-468). */
  changedBy: (name: string) => `${name} changed the filters on this view.`,
  someone: 'Someone',
  removedMember: 'A removed member',
  /** A link whose draft couldn't be read (AC-467). */
  draftUnreadable: 'That link’s filter couldn’t be read, so the saved view is shown.',
  /** A link's draft named fields this person can't use (AC-467). */
  draftDropped: 'Some filters in this link use fields that aren’t available to you, so they were left out.',
  /** A view naming an archived attribute (AC-480). */
  archived: (titles: string) =>
    `This view uses ${titles}, which is archived. It’s left out until the attribute is restored. Saving a new filter removes it for good.`,
  archivedMany: (titles: string) =>
    `This view uses ${titles}, which are archived. They’re left out until they’re restored. Saving a new filter removes them for good.`,
  both: (first: string, second: string) => `${first} and ${second}`,
  dismiss: 'Dismiss',
  /** A filter that matches nothing (AC-486). */
  noMatchesTitle: (plural: string) => `No ${plural.toLowerCase()} match these filters`,
  noMatchesText: 'Change the filters to see more.',
  editFilters: 'Edit filters',
  /** The count after a filter, for screen readers (AC-487). */
  matching: (count: string, plural: string) => `${count} ${plural.toLowerCase()} match`,
  /** The clash dialog (AC-469). */
  changedTitle: 'This view changed',
  changedText: (sentence: string) => `${sentence} Replace them with yours, or keep your changes and save later?`,
  replace: 'Replace',
  keepMine: 'Cancel',
  /** A view this person can't open (AC-463). */
  notFoundTitle: 'View not found',
  notFoundText: 'This view doesn’t exist or isn’t shared with you.',
  goTo: (name: string) => `Go to ${name}`,
  /** An object with no view this person may open (AC-462). */
  noViewsTitle: 'No views are available to you',
  noViewsText: 'Ask a workspace owner or admin about the views on this object.',
  /** A board before boards arrive (spec 0021). */
  boardSoon: 'Boards arrive soon. This view shows as a table for now.',
  saveFailed: 'Couldn’t save this view. Try again in a moment.',
  /** While the far side of a through filter loads. */
  loadingFilter: 'Loading filters',
} as const;
