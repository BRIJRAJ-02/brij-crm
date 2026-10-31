// The words of Sharing (spec 0037, AC-1331): a booking page's or a rotation's editors.

/** Sharing's copy. */
export const sharingStrings = {
  /** A rotation's tab, and a booking page's menu item and dialog: "Editors", since the page's own Sharing card is its address and who can book (spec 0037 calls it Sharing). */
  title: 'Editors',
  menuItem: 'Editors',
  close: 'Done',
  add: 'Add an editor',
  addPlaceholder: 'Add an editor…',
  full: 'Full: 20 editors',
  /** The Editor badge on what the reader edits (AC-1332). */
  editorBadge: 'Editor',
  none: 'No editors yet',
  nobodyToAdd: 'Nobody else to add',
  failed: 'Couldn’t load who edits this.',
  remove: (name: string) => `Remove ${name}`,
  removeTitle: (name: string) => `Remove ${name}?`,
  removeText: (name: string, what: string) => `${name} can no longer edit ${what}.`,
  keep: 'Keep',
  removeAction: 'Remove',
  added: (name: string) => `${name} can now edit this.`,
  removed: (name: string) => `${name} can no longer edit this.`,
  refused: 'That didn’t save.',
} as const;
