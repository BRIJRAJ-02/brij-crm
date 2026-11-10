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
  joining: 'Joining workspace',
  /** The signed in card's one field (QA N14), as first run's. */
  yourName: 'Your name',
  yourNameHint: 'Shown to your team.',
  signInToAccept: 'Sign in to join',
  signedInAs: (email: string) => `Signed in as ${email}`,
  useAnother: 'Use another address',
  invalidTitle: 'This invitation is no longer valid',
  invalidText: 'Ask whoever invited you to send a new one.',
  goHome: 'Go to your workspaces',
  /** An invitation that opens nothing, for someone signed in with no workspace: making their own. */
  createWorkspace: 'Create a workspace',
  /** An invitation that opens nothing, for someone signed out: sign in finds their workspaces. */
  signIn: 'Sign in',
  /** The sign out confirm's line here: where signing in again leads. */
  signOutText: 'You’ll sign in again, then come back to this invitation.',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
  /** A page's hand over (Team pages, 9 Nov 2026): the person takes over the link page made for them. */
  pageTitle: 'Manage your page',
  pageInvited: (inviter: string, address: string | undefined, workspace: string) => {
    const page = address === undefined ? 'your link page' : `your link page, ${address},`;
    return inviter === ''
      ? `You’re invited to manage ${page} in ${workspace}.`
      : `${inviter} invited you to manage ${page} in ${workspace}.`;
  },
  setUpLogin: 'Set up my login',
  settingUp: 'Setting up…',
  pageSignedIn: (email: string) => `You’re signed in as ${email}. Sign out first to set up a login for this page.`,
  signOut: 'Sign out',
  pageSignOutText: 'You’ll come back to this invitation, signed out.',
  pageReadyTitle: 'Your login is ready',
  pageReadyText: (masked: string | undefined) =>
    masked === undefined
      ? 'Sign in with the address this invitation was sent to.'
      : `Sign in with ${masked} to manage your page.`,
  /**
   * A connected app's person's own Timefix login (spec 0070, AC-7023): the app keeps managing them, and they can also
   * sign in to Timefix directly.
   */
  loginTitle: 'Set up your Timefix login',
  loginInvited: (inviter: string, workspace: string, app: string | undefined) => {
    const asked =
      inviter === ''
        ? `You’re invited to set up a Timefix login in ${workspace}.`
        : `${inviter} asked for a Timefix login for you in ${workspace}.`;
    return `${asked} Keep using ${app ?? 'the app you use now'} as before. You can also sign in to Timefix directly.`;
  },
  loginSignedIn: (email: string) => `You’re signed in as ${email}. Sign out first to set up your own login.`,
  loginReadyText: (masked: string | undefined) =>
    masked === undefined
      ? 'Sign in with the address this invitation was sent to.'
      : `Sign in with ${masked} to open your page.`,
} as const;

/** "an Admin", "a Member". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
