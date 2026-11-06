/** The embedded frame's own words (spec 0070, AC-7031, AC-7032): short, plain, and never naming the partner's app. */
export const embedStrings = {
  opening: 'Opening',
  openingText: 'One moment.',
  expiredTitle: 'Open this again',
  expiredText: 'This screen has timed out. Open it again to carry on.',
  endedTitle: 'Your session ended',
  endedText: 'Open this screen again to carry on where you left off.',
  openAgain: 'Open again',
  /** In a tab of its own there is no app around it to ask: the person goes back to it. */
  goBackText: 'Go back to the app you came from and open it from there.',
  blockedTitle: 'Open in a new tab',
  blockedText: 'Your browser keeps Timefix from signing you in inside this page. It works in a tab of its own.',
  openInNewTab: 'Open in a new tab',
  failedTitle: 'This didn’t open',
  failedText: 'Something went wrong on our side. Try again in a moment.',
  tryAgain: 'Try again',
} as const;
