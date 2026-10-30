// Settings › Workspace › Security: the page's copy (spec 0033, milestone 4), apart from Account › Sign in and devices' own.

/** Days as the session length Select says them. */
const days = (count: number) => (count === 1 ? '1 day' : `${String(count)} days`);

/** Settings › Workspace › Security's copy (AC-893 to AC-895, AC-899). */
export const strings = {
  /** The entry in the settings navigation, under Workspace. */
  navLabel: 'Security',
  /** The nav's own name: the trail already says Workspace (Settings › Workspace › Security). */
  title: 'Security',
  twoFactor: 'Two factor sign in',
  require: 'Require two factor sign in',
  requireInfo: 'A code from an app on their phone, after the email code.',
  /** The row's line while the switch is on: who still has to set it up (nothing while it is off, the switch says it). */
  requireOn: (without: number) =>
    without === 0
      ? 'Everyone has it set up.'
      : without === 1
        ? '1 person hasn’t set it up.'
        : `${String(without)} people haven’t set it up.`,
  /** The row's line while the switch is off limits, the Set up yours link after it. */
  youFirst: 'You need it yourself first.',
  setUpYours: 'Set up yours',
  confirmRequireTitle: 'Require two factor sign in?',
  confirmRequireText: (without: number, workspace: string) =>
    `${without === 1 ? '1 person' : `${String(without)} people`} must set it up to open ${workspace}.`,
  requireAction: 'Require it',
  required: 'Two factor sign in is now required.',
  notRequired: 'Two factor sign in is no longer required.',
  sessions: 'Sessions',
  sessionLength: 'Session length',
  sessionLengthInfo: 'Confirming it’s you before a risky change, like signing everyone out, also counts as signing in.',
  noLimit: 'No limit',
  days,
  lengthSaved: (count: number | undefined) =>
    count === undefined ? 'No session limit.' : `Sessions last ${days(count)}.`,
  signOutEveryone: 'Sign out everyone',
  signOutEveryoneDescription: 'Everyone signs in again.',
  lastSignedOut: (when: string) => `Last done ${when}.`,
  signOutEveryoneTitle: 'Sign out everyone?',
  signOutEveryoneText: (workspace: string) => `Everyone in ${workspace} signs in again. Unsaved work is lost.`,
  signingOut: 'Signing out',
  sendCode: 'Email me a code',
  confirmLengthTitle: (count: number) => `Make sessions last ${days(count)}?`,
  confirmLengthText: (count: number, workspace: string) =>
    `Anyone signed in to ${workspace} over ${days(count)} ago signs in again.`,
  shortenAction: 'Shorten sessions',
  signedOutEveryone: 'Everyone was signed out.',
  cancel: 'Cancel',
  failedTitle: 'Couldn’t load the workspace’s security',
  failedText: 'Check your connection, then try again.',
  saveFailed: 'Couldn’t save. Try again.',
} as const;
