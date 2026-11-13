import { strings as shared } from '../../lib/strings.ts';

/** SaveBar's built in copy. */
export const strings = {
  unsaved: 'Unsaved changes',
  saved: 'Saved',
  discard: 'Discard',
  save: 'Save',
  tryAgain: 'Try again',
  /** Discard's confirm: the question alone, which says what goes. */
  discardTitle: shared.discardTitle,
  keepEditing: shared.keepEditing,
  discardChanges: shared.discardChanges,
} as const;
