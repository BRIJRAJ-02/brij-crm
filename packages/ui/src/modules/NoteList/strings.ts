/** NoteList's built in copy. */
export const strings = {
  loading: 'Loading notes',
  empty: 'No notes',
  emptyBody: 'Notes you write show here, newest first.',
  failed: 'Notes didn’t load',
  noAccess: 'You can’t see these notes',
  noAccessBody: 'Ask a workspace admin for access.',
  /** A note with no title yet. */
  untitled: 'Untitled note',
  /** Before the relative time of the last edit: "Edited 3 hours ago". */
  edited: 'Edited',
  /** Between the author and the time, for screen readers: "by Ada Lovelace". */
  by: 'by',
  /** Between the author and the time. */
  separator: '·',
} as const;
