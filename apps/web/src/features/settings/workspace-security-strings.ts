// Settings › Workspace › Security: the page's copy (spec 0033, milestone 4), apart from Account › Sign in and devices's own.

/** Days as the session length Select says them. */
const days = (count: number) => (count === 1 ? '1 day' : `${String(count)} days`);

/** Settings › Workspace › Security's copy (AC-893 to AC-895, AC-899). */
export const strings = {
  /** The entry in the settings navigation, under Workspace. */
  navLabel: 'Security',
  title: 'Workspace security',
  twoFactor: 'Two factor sign in',
  twoFactorDescription: 'A second step at sign in, so access to someone’s email alone doesn’t open the workspace.',
  require: 'Require two factor sign in',
  requireOff: 'When on, everyone signs in with an authenticator app or a passkey as well as their email.',
  requireOn: (without: number) =>
    without === 0
      ? 'Everyone here has two factor sign in set up.'
      : without === 1
        ? '1 person hasn’t set it up yet. They’re asked to the next time they open the workspace.'
        : `${String(without)} people haven’t set it up yet. They’re asked to the next time they open the workspace.`,
  youFirst: 'Set up two factor sign in for yourself first, then you can require it here.',
  setUpYours: 'Set up yours',
  confirmRequireTitle: 'Require two factor sign in?',
  confirmRequireText: (without: number, workspace: string) =>
    `${without === 1 ? '1 person' : `${String(without)} people`} will be asked to set it up the next time they open ${workspace}. Until they do, they can’t open it.`,
  requireAction: 'Require it',
  required: 'Two factor sign in is now required.',
  notRequired: 'Two factor sign in is no longer required.',
  sessions: 'Sessions',
  sessionsDescription: 'How long a sign in lasts here, and ending everyone’s at once.',
  sessionLength: 'Session length',
  sessionLengthDescription:
    'How long after signing in people can use the workspace before they sign in again. Confirming it’s them counts as signing in.',
  noLimit: 'No limit',
  days,
  lengthSaved: (count: number | undefined) =>
    count === undefined ? 'Sessions no longer end on a schedule.' : `Sessions now last ${days(count)}.`,
  signOutEveryone: 'Sign out everyone',
  signOutEveryoneDescription: 'Everyone has to sign in again to open the workspace. You stay signed in here.',
  lastSignedOut: (when: string) => `Last done ${when}.`,
  signOutEveryoneTitle: 'Sign out everyone?',
  signOutEveryoneText: (workspace: string) =>
    `Everyone in ${workspace} has to sign in again to open it, on every device. Anything unsaved is lost. You stay signed in on this device.`,
  signingOut: 'Signing out…',
  sendCode: 'Email me a code',
  confirmLengthTitle: (count: number) => `Make sessions last ${days(count)}?`,
  confirmLengthText: (count: number, workspace: string) =>
    `Anyone who signed in to ${workspace} more than ${days(count)} ago has to sign in again, you included if that’s you.`,
  shortenAction: 'Shorten sessions',
  signedOutEveryone: 'Everyone was signed out. They sign in again to open the workspace.',
  cancel: 'Cancel',
  failedTitle: 'Couldn’t load the workspace’s security',
  failedText: 'Check your connection, then try again.',
  saveFailed: 'Couldn’t save that. Check your connection, then try again.',
} as const;
