/** The invitation page's copy (spec 0031, AC-805). */
export const strings = {
  product: 'Timefix',
  /** While the invitation loads, and when its look up fails. */
  title: 'Join a workspace',
  joinTitle: (workspace: string) => `Join ${workspace}`,
  invited: (inviter: string, workspace: string, role: string) =>
    inviter === ''
      ? `You’re invited to ${workspace} as ${article(role)} ${role}.`
      : `${inviter} invited you to ${workspace} as ${article(role)} ${role}.`,
  forAddress: (masked: string) => `This invitation is for ${masked}.`,
  /** Signed out: the address, and that signing in with it makes an account for someone new, in one line. */
  signedOutLine: (masked: string) => `Sign in as ${masked} to accept. New to Timefix? Signing in makes your account.`,
  accept: 'Accept invitation',
  signInToAccept: 'Sign in to accept',
  useAnother: 'Sign in with another address',
  invalidTitle: 'This invitation is no longer valid',
  invalidText: 'Ask whoever invited you to send a new one.',
  goHome: 'Go to your workspaces',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** The sign out confirm's line here: where signing in again leads. */
  signOutText: 'You’ll sign in again, then come back to this invitation.',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
} as const;

/** "an Admin", "a Member". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
