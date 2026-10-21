/** The invitation page's copy (spec 0031, AC-805). */
export const strings = {
  product: 'Timefix',
  title: 'Join a workspace',
  invited: (inviter: string, workspace: string, role: string) =>
    inviter === ''
      ? `You’re invited to ${workspace} as ${article(role)} ${role}.`
      : `${inviter} invited you to ${workspace} as ${article(role)} ${role}.`,
  forAddress: (masked: string) => `This invitation is for ${masked}.`,
  newHere: 'Sign in with that address to accept it. New to Timefix? Signing in makes your account.',
  accept: 'Accept invitation',
  signInToAccept: 'Sign in to accept',
  signedInAs: (email: string) => `Signed in as ${email}.`,
  useAnother: 'Sign in with another address',
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
