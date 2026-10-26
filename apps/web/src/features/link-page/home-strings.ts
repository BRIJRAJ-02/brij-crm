// Home's "Your link page" card and its QR Modal (spec 0051, AC-5121 to AC-5123).

export const homeStrings = {
  title: 'Your link page',
  /** The one quiet line under the title: the page of the workspace they are in (spec 0056, AC-5617). */
  inWorkspace: (name: string) => `Your link page in ${name}.`,
  qrLabel: 'QR code for your link page',
  scan: 'Point a phone camera at the code to open your page. Print it on a badge, or show it from your phone.',
  copyLink: 'Copy link',
  copied: 'Link copied',
  open: 'Open',
  edit: 'Edit',
  showQr: 'Show QR code',
  noHandle: 'Claim your address to get a link page',
  noHandleText: 'Pick a handle in your profile, and your page and its QR code are ready at once.',
  goToProfile: 'Go to Profile',
  failed: 'Your link page didn’t load',
  unavailable: 'Reload the page to try again.',
} as const;
