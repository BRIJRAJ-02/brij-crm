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
  claim: 'Claim handle',
  copyLink: 'Copy link',
  openPage: 'Open page',
  qrPng: 'Download QR code (PNG)',
  qrSvg: 'Download QR code (SVG)',
  downloadAll: 'Download all QR codes',
  zipping: 'Preparing…',
  zipped: (count: number) => `${count.toLocaleString()} QR ${count === 1 ? 'code' : 'codes'} downloaded.`,
  zipFailed: 'The QR codes didn’t download. Try again.',
  qrFailed: 'The QR code didn’t download. Try again.',
  copied: 'Link copied.',
  loadFailed: 'Team pages didn’t load.',
  retry: 'Try again',
  empty: 'Nobody here yet',
  emptyText: 'Invite people from Members, and their pages show here.',
  forbidden: 'Only people who manage the team’s link pages can see this.',
  /** The claim dialog. */
  claimTitle: (name: string) => `Claim a handle for ${firstOf(name)}`,
  claimText: 'The page starts private. Turn it Live when it’s ready.',
  handleLabel: 'Handle',
  claimAction: 'Claim',
  claiming: 'Claiming…',
  cancel: 'Cancel',
  claimed: (handle: string) => `/${handle} is theirs now.`,
  claimFailed: 'That handle couldn’t be claimed. Try another.',
  handleMissing: 'Add a handle.',
  /** The member's page, opened by a manager. */
  memberTitle: (name: string) => `${firstOf(name)}’s page`,
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
