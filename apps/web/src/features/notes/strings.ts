/** The notes screens' copy (spec 0019, milestone 3). */
export const strings = {
  notes: 'Notes',
  newNote: 'New note',
  untitled: 'Untitled note',
  /** The Notes tab with none yet. */
  noNotes: 'No notes yet',
  /** The workspace's Notes page with none: where notes come from. */
  noNotesBody: 'Notes written on a record show here.',
  /** The Notes page's list didn't load. */
  loadFailedList: 'Notes didn’t load',
  listLabel: 'Notes',
  // The note window.
  note: 'Note',
  title: 'Title',
  titlePlaceholder: 'Untitled',
  body: 'Note',
  /** The bar's word for a note opened again: "Edited 3 hours ago". */
  edited: 'Edited',
  close: 'Close',
  more: 'More actions',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy the link. Copy it from the address bar.',
  deleteNote: 'Delete note',
  /** The More menu's way to link the note to other records (migration 0135), and the field that holds them. */
  linkRecord: 'Link record',
  linkedRecords: 'Linked records',
  linkForbidden: 'You can’t link a note to a record you can’t change.',
  linksFull: (max: number) => `A note links at most ${String(max)} records.`,
  searchFailed: 'The search didn’t answer. Type again to try again.',
  noteDeleted: 'Note deleted',
  undo: 'Undo',
  notDeleted: 'The note wasn’t deleted.',
  notRestored: 'Couldn’t restore the note.',
  saving: 'Saving…',
  saved: 'Saved',
  retrying: 'Not saved. Retrying…',
  notSaved: 'Not saved.',
  retry: 'Retry',
  loading: 'Loading the note',
  loadFailed: 'This note didn’t load.',
  editorFailed: 'The editor didn’t load. Check your connection and try again.',
  tryAgain: 'Try again',
  unavailable: 'This note isn’t available. Its record may have been deleted, or you may not have access to it.',
  readOnly: 'You can view this note but not change it.',
  /** AC-443's notices. */
  theirVersion: (name: string) => `${name} edited this note, so it now shows their version.`,
  savedOverTheirs: (name: string) => `${name} edited this note at the same time. Your version was saved over theirs.`,
  dismiss: 'Dismiss',
  formerMember: 'Former member',
  someone: 'Someone',
} as const;
