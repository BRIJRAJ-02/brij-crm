/** The invitation page's copy (spec 0031, AC-805). */
export const strings = {
  product: 'Timefix',
  // Before the invitation is read (loading, a failed look up): no workspace name yet.
  pendingTitle: 'Join a workspace',
  title: (workspace: string) => `Join ${workspace}`,
  invited: (inviter: string, role: string) =>
    inviter === ''
      ? `You’re invited as ${article(role)} ${role}.`
      : `${inviter} invited you as ${article(role)} ${role}.`,
  forAddress: (masked: string | undefined) => (masked === undefined ? '' : `Sent to ${masked}.`),
  newHere: 'New to Timefix? Signing in creates your account.',
  accept: 'Join workspace',
  signInToAccept: 'Sign in to join',
  signedInAs: (email: string) => `Signed in as ${email}`,
  useAnother: 'Use another address',
  invalidTitle: 'This invitation is no longer valid',
  invalidText: 'Ask whoever invited you to send a new one.',
  goHome: 'Go to your workspaces',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
} as const;

/** "an Admin", "a Member". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
