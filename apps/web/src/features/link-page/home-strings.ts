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
  /** Saves the page to the person's own wallet, so they can show its code without opening the app. */
  addToWallet: 'Add to Wallet',
  /** Every membership gets its page made with it (26 Oct 2026): the badge beside the title says whether it is public. */
  live: 'Live',
  /** Made with the membership and not yet edited or shared (27 Oct 2026): only its owner can see it. */
  private: 'Private',
  privateTitle: 'Only you can see your page',
  privateText: (address: string) =>
    `${address} goes public the first time you edit it or share it. Until then, anyone else who opens it finds nothing.`,
  makePublic: 'Make it public',
  preview: 'Preview',
  madePublic: 'Your page is public',
  makePublicFailed: 'Your page didn’t go public. Try again.',
  /** Only when the page couldn't be made with the membership (the daily cleanup tries again). */
  noHandle: 'Pick a handle to get your link page',
  noHandleText: 'Pick a handle in your profile, and your page and its QR code are ready at once.',
  goToProfile: 'Go to Profile',
  failed: 'Your link page didn’t load',
  unavailable: 'Reload the page to try again.',
} as const;
