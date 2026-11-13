/** ShareSheet's built in copy. */
export const strings = {
  done: 'Done',
  putOnSite: 'Put it on your site',
  /** The row of the caller's own ways to share (Offer specific times, One-time link). */
  moreWays: 'More ways to share',
  qrLabel: (name: string) => `QR code for ${name}`,
  qrSaveFailed: 'The QR code didn’t save. Try again.',
  /** Shown in place of everything else when the address isn't a web address (spec 0073, AC-7318). */
  refused: 'This link can’t be shared, because it isn’t a web address.',
} as const;
