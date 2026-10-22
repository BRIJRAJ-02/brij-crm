/** The comments and inbox screens' copy (spec 0038). */
export const strings = {
  comments: 'Comments',
  /** AC-1162: the tab with no threads yet, over the composer. */
  noComments: 'No comments yet',
  /** Under No comments yet, for someone who can write one. */
  noCommentsText: 'Start the conversation.',
  loadFailed: 'Comments didn’t load',
  loadFailedText: 'Check your connection and try again.',
  unavailable: 'Comments aren’t available for this record',
  /** AC-1161: a link to a thread that is gone or hidden. */
  threadUnavailable: 'That comment isn’t available.',
  dismiss: 'Dismiss',
  earlierThreads: 'Show earlier threads',
  loadingThreads: 'Loading comments',
  resolvedThreads: 'Resolved threads',
  resolvedFailed: 'Resolved threads didn’t load.',
  moreResolved: 'Show more resolved threads',
  formerMember: 'Former member',
  // The delete confirm (AC-1156): a delete has no Undo, so it asks first.
  deleteTitle: 'Delete this comment?',
  deleteText: 'It leaves the thread for everyone and can’t be brought back.',
  keep: 'Keep',
  delete: 'Delete',
} as const;
