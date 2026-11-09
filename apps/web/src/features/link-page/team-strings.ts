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
  copied: 'Link copied.',
  loadFailed: 'Team pages didn’t load.',
  retry: 'Try again',
  empty: 'Nobody here yet',
  emptyText: 'Add a page for someone, or invite people from Members.',
  forbiddenTitle: 'No access',
  forbidden: 'Only people who manage the team’s link pages can see this.',
  copyFailed: 'The link didn’t copy.',
  /** Why a member's name and title can't be changed on their page: they have a login, and change their own. */
  nameTheirs: 'They change this in their own Profile.',
  /** The same for a partner's person: the app that added them keeps it. */
  nameFromPartner: 'The app that added them keeps this.',
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
