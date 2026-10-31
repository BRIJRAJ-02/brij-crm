// The words of Sharing (spec 0037, AC-1331): a booking page's or a rotation's editors.

/** Sharing's copy. */
export const sharingStrings = {
  title: 'Sharing',
  /** The menu item and the dialog that holds Sharing on a booking page. */
  menuItem: 'Sharing',
  dialogTitle: (name: string) => `Share ${name}`,
  close: 'Done',
  add: 'Add an editor',
  addPlaceholder: 'Add an editor…',
  full: 'Full: 20 editors',
  /** The Editor badge on what the reader edits (AC-1332). */
  editorBadge: 'Editor',
  editorTip: 'You can edit this. Only an admin can delete it or change who edits it.',
  none: 'No editors yet',
  nobodyToAdd: 'Everyone here already edits it.',
  failed: 'Couldn’t load who edits this.',
  editorLine: 'Editor',
  remove: (name: string) => `Remove ${name}`,
  removeTitle: (name: string) => `Remove ${name}?`,
  removeText: (name: string, what: string) => `${name} can no longer edit ${what}.`,
  keep: 'Keep',
  removeAction: 'Remove',
  added: (name: string) => `${name} can now edit this.`,
  removed: (name: string) => `${name} can no longer edit this.`,
  refused: 'That didn’t save.',
  /** Who can see the list but not change it. */
  readOnly: 'Only an admin can change who edits this.',
} as const;
