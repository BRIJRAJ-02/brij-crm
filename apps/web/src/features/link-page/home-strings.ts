// Home's "Your link page" card and its QR Modal (spec 0051, AC-5121 to AC-5123).

export const homeStrings = {
  title: 'Your link page',
  /** Under the title only when they have a page in another workspace too: whose page the code opens (AC-5617). */
  inWorkspace: (name: string) => `In ${name}.`,
  /** The card's sharing buttons, read as one group. */
  shareLabel: 'Share your link page',
  qrLabel: 'QR code for your link page',
  copyLink: 'Copy link',
  copied: 'Link copied',
  open: 'Open',
  edit: 'Edit',
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
