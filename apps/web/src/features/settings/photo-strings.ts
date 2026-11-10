// Settings › Account › Profile: the photo switch's copy (owner ask A124, 23 Oct 2026), apart from the page's own.

/**
 * "Show my account photo on my pages": its row, its states and the toasts its changes raise. It covers the account
 * photo only (owner, 10 Nov 2026): a photo set on a link page always shows there, and on the booking pages beside it.
 */
export const strings = {
  title: 'Show my account photo on my pages',
  /** Under the title while it can change: what it doesn't cover, so a page photo never seems to be switched off. */
  hint: 'A photo you add to your link page always shows there.',
  /** No photo yet (an email code account has none): why the switch is off and can't turn on. */
  noPhoto: 'Add a photo first. Your pages show your initials.',
  /** A member with no sign in of their own, which the app never shows today: nothing to hide. */
  readOnly: 'Only a person who signs in has a photo to show.',
  /** Beside the title while a slow save is on its way, for screen readers. */
  saving: 'Saving',
  /** The toasts once a change lands: past tense, as every confirmation. */
  shown: 'Account photo shown on your pages',
  hidden: 'Account photo hidden on your pages',
  undo: 'Undo',
  undone: 'Change undone',
  tryAgain: 'Try again',
} as const;
