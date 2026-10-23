// Settings › Account › Profile: the photo switch's copy (owner ask A124, 23 Oct 2026), apart from the page's own.

/** "Show my photo on booking pages": its row, its states and the toasts its changes raise. */
export const strings = {
  title: 'Show my photo on booking pages',
  /** The account has a photo: which one, and what turning it off does. */
  hint: 'Your Google photo. When off, your booking pages and profile show your initials.',
  /** No photo yet (an email code account has none): the choice still holds for when one comes. */
  noPhoto: 'You have no photo yet, so your pages show your initials.',
  /** A member with no sign in of their own, which the app never shows today: nothing to hide. */
  readOnly: 'Only a person who signs in has a photo to show.',
  /** Beside the title while a slow save is on its way, for screen readers. */
  saving: 'Saving',
  /** The toasts once a change lands: past tense, as every confirmation. */
  shown: 'Photo shown on booking pages',
  hidden: 'Photo hidden on booking pages',
  undo: 'Undo',
  undone: 'Change undone',
  tryAgain: 'Try again',
} as const;
