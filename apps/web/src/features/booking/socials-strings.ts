/** The booking page editor's Social links card (booking socials, 25 Oct 2026). */
export const strings = {
  title: 'Social links',
  shown: 'Show on this page',
  yours: 'Your links',
  everywhere: 'Your links, set once for all your booking pages and your profile.',
  hiddenHere: 'Not shown on this page.',
  none: 'You haven’t added any yet.',
  edit: 'Edit social links',
  add: 'Add social links',
  team: 'A team page names no host before booking, so it shows no one’s social links.',
  notOwner: 'Only the page’s owner chooses whether it shows their social links.',
  /** The same on a page whose owner is named (spec 0037, AC-1273). */
  setBy: (name: string) => `Set by ${name.trim().split(/\s+/)[0] ?? name}`,
  failed: 'Couldn’t load your social links.',
  tryAgain: 'Try again',
  dialogTitle: 'Social links',
  cancel: 'Cancel',
  save: 'Save',
  discardTitle: 'Discard your changes?',
  discardText: 'Your social links stay as they were.',
  keepEditing: 'Keep editing',
  discard: 'Discard',
} as const;
