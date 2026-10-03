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
  product: 'CRM',
  signInTitle: 'Sign in',
  signInDescription: 'Enter your email to get a sign in code.',
  verifyTitle: 'Check your email',
  failedTitle: 'Can’t reach the CRM',
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
  googleCancelled: 'Google sign in was cancelled. Try again, or use your email.',
  googleFailed: 'Couldn’t sign in with Google. Try again, or use your email.',
} as const;
