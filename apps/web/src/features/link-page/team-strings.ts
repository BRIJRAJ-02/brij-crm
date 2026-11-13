// The words of Team pages (spec 0070, slice 1): everyone's link page, a handle claimed for someone, their QR codes, and
// the line a member reads about who last changed their page. Few and plain (the owner: less text).

/** First name, for the short lines ("Priya's page"). */
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const teamStrings = {
  title: 'Team pages',
  linkPage: 'Link page',
  /** The button on the person's own page that opens the list. */
  openList: 'Team pages',
  table: 'Team link pages',
  columns: { person: 'Person', page: 'Page', status: 'Status', views: 'Views this month', actions: 'Actions' },
  you: 'You',
  noPage: 'No page yet',
  live: 'Live',
  private: 'Private',
  views: (count: number) => count.toLocaleString(),
  viewsCounted: (count: number) => `${count.toLocaleString()} ${count === 1 ? 'view' : 'views'}`,
  rowActions: (name: string) => `Actions for ${name}`,
  edit: 'Edit page',
  claim: 'Claim link',
  copyLink: 'Copy link',
  openPage: 'Open page',
  qrPng: 'Download QR code (PNG)',
  qrSvg: 'Download QR code (SVG)',
  downloadAll: 'Download all QR codes',
  zipped: (count: number) => `${count.toLocaleString()} QR ${count === 1 ? 'code' : 'codes'} downloaded.`,
  zipFailed: 'The QR codes didn’t download. Try again.',
  qrFailed: 'The QR code didn’t download. Try again.',
  walletPass: 'Download Wallet pass',
  walletAll: 'Download all Wallet passes',
  walletZipped: (count: number) => `${count.toLocaleString()} Wallet ${count === 1 ? 'pass' : 'passes'} downloaded.`,
  walletFailed: 'The Wallet pass didn’t download. Try again.',
  walletAllFailed: 'The Wallet passes didn’t download. Try again.',
  walletSomeFailed: (count: number, missed: number) =>
    `${count.toLocaleString()} downloaded. ${missed.toLocaleString()} didn’t; try again for the rest.`,
  walletZipName: (workspace: string) =>
    `${workspace.trim().replace(/\s+/g, '-').toLowerCase() || 'team'}-wallet-passes.zip`,
  copied: 'Link copied.',
  loadFailed: 'Team pages didn’t load.',
  retry: 'Try again',
  empty: 'Nobody here yet',
  emptyText: 'Add a page for someone, or invite people from Members.',
  forbiddenTitle: 'No access',
  forbidden: 'Only people who manage the team’s link pages can see this.',
  copyFailed: 'The link didn’t copy.',
  /** Why a member's name and title can't be changed on their page: they have a login, and change their own. */
  nameTheirs: 'They change their name and title in their own Profile.',
  /** The same for a partner's person: the app that added them keeps it. */
  nameFromPartner: 'Their partner app keeps their name and title.',
  /** A member's page that can't be opened: gone, or theirs to keep. */
  unavailable: 'This page can’t be opened',
  unavailableText: 'They may have left the workspace, or it isn’t yours to change.',
  /** The claim dialog. */
  claimTitle: (name: string) => `Claim a link for ${firstOf(name)}`,
  claimText: 'It starts Private. Turn on Live to share it.',
  handleLabel: 'Link',
  claimAction: 'Claim',
  claiming: 'Claiming…',
  cancel: 'Cancel',
  claimed: (handle: string, name: string) => `Claimed /${handle} for ${firstOf(name)}.`,
  claimFailed: 'That link couldn’t be claimed. Try another.',
  handleMissing: 'Add a link.',
  /** Add a page (9 Nov 2026): a page for someone who never signs up. */
  addPage: 'Add a page',
  addTitle: 'Add a page',
  addText: 'For someone without a Timefix login. Uses a seat. The page starts Private.',
  nameLabel: 'Name',
  emailLabel: 'Email',
  emailAside: '(optional)',
  emailHint: 'Kept on their profile. We never email them.',
  nameMissing: 'Add their name.',
  emailInvalid: 'Enter a valid email address, or leave it empty.',
  handleChecking: 'Checking…',
  handleFree: 'Available',
  handleTaken: 'Taken. Pick another.',
  handleUnknown: 'Couldn’t check it now. Create checks it again.',
  handleFreeSaid: (handle: string) => `/${handle} is available.`,
  handleTakenSaid: (handle: string) => `/${handle} is taken.`,
  handleSuggestions: 'Try instead',
  addAction: 'Create page',
  adding: 'Creating…',
  added: (handle: string, name: string) => `Created /${handle} for ${firstOf(name)}.`,
  /** A page only person's quiet mark, beside their name. */
  pageOnly: 'Page only',
  /** Removing a page only person. */
  removePerson: 'Remove person',
  removeTitle: (name: string) => `Remove ${name}?`,
  removeText: (handle: string | undefined) =>
    handle === undefined
      ? 'Their seat is freed. Their page’s content is kept for 30 days.'
      : `/${handle} stops working and their seat is freed. The page’s content is kept for 30 days.`,
  removeAction: 'Remove person',
  removed: (name: string) => `Removed ${firstOf(name)}.`,
  /** Invite to manage their page (9 Nov 2026): a page only person handed their own page. */
  invitePerson: 'Invite to manage their page',
  /** Members' words for the same two actions on an invitation. */
  resendInvite: 'Resend invitation',
  revokeInvite: 'Revoke invitation',
  /** The quiet mark beside a page only person whose invitation is out, or ran out. */
  invited: 'Invited',
  inviteExpired: 'Invitation expired',
  inviteTitle: (name: string) => `Invite ${firstOf(name)} to manage their page`,
  inviteText:
    'They set up a login with this email and keep this page, its link and its views. The invitation works for 7 days.',
  resendHint: 'The link sent before stops working.',
  inviteEmailMissing: 'Add their email.',
  inviteEmailInvalid: 'Enter a valid email address.',
  inviteAction: 'Send invitation',
  inviting: 'Sending…',
  inviteSent: (email: string) => `Invitation sent to ${email}.`,
  inviteUnsent: 'Saved, but the email didn’t go out.',
  revokeInviteTitle: (name: string) => `Revoke the invitation to ${name}?`,
  revokeInviteText: (email: string) =>
    `The link sent to ${email} stops working. Their page stays as it is, and you can invite them again.`,
  keepInvite: 'Keep invitation',
  inviteRevoked: (email: string) => `Invitation to ${email} revoked.`,
  /**
   * A connected app's person's own Timefix login (spec 0070, AC-7023, 10 Nov 2026): set up by a manager on Team pages,
   * in Timefix only. Inside the app's frame the person reads only whom to ask. The app keeps them either way.
   */
  loginInvite: 'Set up their Timefix login',
  loginTitle: (name: string) => `Set up a Timefix login for ${firstOf(name)}`,
  loginText: (app: string | undefined) =>
    `They keep using ${app ?? 'the app that added them'}, and can also sign in to Timefix. The link works for 7 days.`,
  ownLoginTitle: 'Timefix login',
  ownLoginText: (workspace: string | undefined) =>
    `Want to sign in to Timefix directly? Ask an admin of ${workspace === undefined || workspace === '' ? 'your workspace' : workspace} to set up your login.`,
  /** The member's page, opened by a manager. */
  memberTitle: (name: string) => `${firstOf(name)}’s page`,
  /** The page card's title on someone else's page, where "Your page" would be wrong. */
  theirPage: 'Their page',
  back: 'Team pages',
  /** On the person's own page (AC-7004). */
  editedBy: (name: string) => `Edited by ${name}`,
  /** Files. */
  fileStem: (handle: string) => `${handle}-qr`,
  zipName: (workspace: string) =>
    `${
      workspace
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'team'
    }-qr-codes.zip`,
} as const;
