// The second step of a sign in (spec 0033, AC-882, AC-884): its copy, apart from the other sign in screens' own.

/** The second step page's copy. */
export const strings = {
  title: 'Two factor sign in',
  appLabel: 'Code from your authenticator app',
  appHint: 'Enter the 6 digit code from your authenticator app.',
  backupLabel: 'Backup code',
  backupHint: 'Each backup code works once.',
  useBackup: 'Use a backup code',
  useApp: 'Use your authenticator app',
  remember: 'Remember this device for 30 days',
  continue: 'Continue',
  checking: 'Checking…',
  backupMissing: 'Enter one of your backup codes.',
  expired: 'This sign in has expired. Sign in again.',
  signInAgain: 'Sign in again',
  failed: 'Couldn’t check that code. Check your connection, then try again.',
} as const;
