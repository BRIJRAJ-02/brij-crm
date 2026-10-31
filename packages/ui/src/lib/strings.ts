/**
 * Lines the whole app says the same way, so a failure or a lock reads alike on every screen. A screen takes one
 * from here instead of keeping its own copy; the screen's own words stay in its feature's strings.ts.
 */
export const strings = {
  /** The one line for an unexpected failure, after a toast or a banner has said which action it was. */
  couldntDoThat: 'Couldn’t do that. Try again.',
  /** A link copy the browser refused: the fallback is the address bar. */
  couldntCopy: 'Couldn’t copy. Use the address bar.',
  /** An Undo that found newer changes on the same thing: it leaves them alone and says so. */
  undoStale: 'Something changed since. Not undone.',
  /** Why a control is off, said as the disabled control's tooltip, never as a box beside it. */
  ownersAndAdminsOnly: 'Only owners and admins can change this.',
} as const;
