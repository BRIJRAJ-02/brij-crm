/** A record's Files tab's copy (#32). */
export const strings = {
  files: 'Files',
  /** The drop zone, for someone who may add files. */
  addFiles: 'Add files',
  noFiles: 'No files yet',
  loadingFiles: 'Loading files',
  loadFailed: 'Files didn’t load',
  loadFailedText: 'Check your connection and try again.',
  unavailable: 'Files aren’t available for this record',
  formerMember: 'Former member',
  /** Who added a file, before when. */
  addedBy: (name: string) => `${name}, `,
  deleted: (name: string) => `Deleted ${name}.`,
  undo: 'Undo',
} as const;
