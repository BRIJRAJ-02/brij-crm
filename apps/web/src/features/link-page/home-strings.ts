// Home's "Your link page" card and its QR Modal (spec 0051, AC-5121 to AC-5123).

export const homeStrings = {
  title: 'Your link page',
  /** The one quiet line under the title: the page of the workspace they are in (spec 0056, AC-5617). */
  inWorkspace: (name: string) => `Your link page in ${name}.`,
  qrLabel: 'QR code for your link page',
  copyLink: 'Copy link',
  copied: 'Link copied',
  open: 'Open',
  edit: 'Edit',
  showQr: 'Show QR code',
  /** Saves the page to the person's own wallet, so they can show its code without opening the app. */
  addToWallet: 'Add to Wallet',
  /** Under the code while the page is private (spec 0058, AC-23); the switch beside Edit is the link page's own. */
  privateLine: 'Private. Only you can open it.',
  /** Only when the page couldn't be made with the membership (the daily cleanup tries again). */
  noHandle: 'Your page needs a link',
  noHandleText: 'Pick one and it’s ready.',
  claim: 'Claim your link',
  failed: 'Your link page didn’t load',
  unavailable: 'Reload the page to try again.',
} as const;
