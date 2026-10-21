/** Whole units, rounded up so a wait never reads shorter than it is: "45 seconds", "10 minutes", "2 hours". */
function duration(seconds: number): string {
  const [amount, unit] =
    seconds <= 60
      ? [Math.max(1, seconds), 'second']
      : seconds <= 90 * 60
        ? [Math.ceil(seconds / 60), 'minute']
        : [Math.ceil(seconds / 3600), 'hour'];
  return `${String(amount)} ${unit}${amount === 1 ? '' : 's'}`;
}

/** The sign in and verify screens' copy. */
export const strings = {
  product: 'Timefix',
  /** One way in for both (spec 0036): the server decides whether it signs in or signs up. */
  signInTitle: 'Sign in or sign up',
  verifyTitle: 'Check your email',
  failedTitle: 'Can’t reach Timefix',
  failedText: 'Check your connection, then try again.',
  /** `/` while it works out where to send you. */
  openingTitle: 'Opening your workspace',
  duration,
  /** A code send refused for sending too often, with the server's wait. */
  sendLimited: (seconds: number) => `Too many codes sent to this email. Try again in ${duration(seconds)}.`,
  /** A resend refused for sending too often, on /verify, where the wait line under the button counts the wait. */
  resendLimited: 'Too many codes sent to this email.',
  /** A code check refused for trying too often, with the server's wait. */
  verifyLimited: (seconds: number) => `Too many sign in tries for this email. Try again in ${duration(seconds)}.`,
  signUpClosed: 'There’s no account for this email, and sign up isn’t open yet. Check the address.',
  /** A wrong code while a new one can't be sent yet: no point offering one. */
  codeWrongWaiting: 'That code isn’t right. Try again.',
  googleSignUpClosed:
    'There’s no account for that Google email, and sign up isn’t open yet. Try another account, or use your email.',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  googleCancelled: 'Google sign in was cancelled. Try again, or use your email.',
  /** The session ended under the person (a 401 mid use), from `?signedOut=ended`. */
  signedOutEnded: 'You were signed out. Sign in again to carry on.',
  /** The same, with a change still on its way that was lost, from `?signedOut=unsaved`. */
  /** The person deleted their account (spec 0033), from `?signedOut=deleted`. */
  signedOutDeleted: 'Your account was deleted.',
  signedOutUnsaved: 'You were signed out, so your last change wasn’t saved. Sign in again to carry on.',
  googleUnverified: 'Google hasn’t verified that account’s email, so it can’t sign you in. Use your email instead.',
  googleFailed: 'Couldn’t sign in with Google. Try again, or use your email.',
  /** Sign out's confirm (the owner, 21 October 2026: anything that ends something asks first). */
  signOutTitle: 'Sign out?',
  signOutText: 'You’ll need to sign in again on this device.',
  cancel: 'Cancel',
  signOut: 'Sign out',
  signingOut: 'Signing out',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
} as const;
