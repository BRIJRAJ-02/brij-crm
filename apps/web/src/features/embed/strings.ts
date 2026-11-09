/** The embedded frame's own words (spec 0070, AC-7031, AC-7032): short, plain, and never naming the partner's app. */
export const embedStrings = {
  /** The bar's title on the frame's own pages: the module it opens, whatever happened. */
  title: 'Link page',
  opening: 'Opening',
  expiredTitle: 'This timed out',
  endedTitle: 'Session ended',
  openAgain: 'Open again',
  blockedTitle: 'Your browser blocked sign in here',
  openInNewTab: 'Open in a new tab',
  /** Outside a frame there is no app around it to ask: the person goes back to it. */
  goBackText: 'Open it again from the app you came from.',
  /** A press that the app around the frame didn't answer within a few seconds. */
  noAnswerText: 'If nothing opens, open it again from the app you came from.',
  failedTitle: 'This didn’t open',
  failedText: 'Something went wrong on our side.',
} as const;
