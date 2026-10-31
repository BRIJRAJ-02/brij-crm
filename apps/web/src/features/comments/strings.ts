/** The comments and inbox screens' copy (spec 0038). */
export const strings = {
  comments: 'Comments',
  /** AC-1162: the tab with no threads yet, for someone who can't write one (a writer sees the composer alone). */
  noComments: 'No comments yet',
  loadFailed: 'Comments didn’t load',
  loadFailedText: 'Check your connection and try again.',
  unavailable: 'Comments aren’t available for this record',
  /** AC-1161: a link to a thread that is gone or hidden. */
  threadUnavailable: 'That comment isn’t available.',
  dismiss: 'Dismiss',
  earlierThreads: 'Show earlier threads',
  loadingThreads: 'Loading comments',
  resolvedThreads: 'Resolved threads',
  /** The toast once a thread is resolved, with Undo. */
  threadResolved: 'Thread resolved',
  undo: 'Undo',
  resolvedFailed: 'Resolved threads didn’t load.',
  moreResolved: 'Show more resolved threads',
  formerMember: 'Former member',
  // The delete confirm (AC-1156): a delete has no Undo, so it asks first.
  deleteTitle: 'Delete this comment?',
  deleteText: 'This can’t be undone.',
  keep: 'Keep',
  delete: 'Delete',
} as const;
