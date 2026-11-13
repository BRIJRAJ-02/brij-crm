import { strings as shared } from '../../lib/strings.ts';

/** Modal's built in copy. */
export const strings = {
  close: 'Close',
  /** The keycap the footer's close button shows. */
  closeKey: 'ESC',
  /** The keycap the footer's submit shows: Enter, or ⌘Enter while the dialog holds a long text or an editor. */
  submitKey: '↵',
  submitLongKey: '⌘↵',
  /** The confirm a dirty form asks before it closes (`isDirty`): the shared words SaveBar asks with too. */
  discardTitle: shared.discardTitle,
  keepEditing: shared.keepEditing,
  discardChanges: shared.discardChanges,
} as const;
