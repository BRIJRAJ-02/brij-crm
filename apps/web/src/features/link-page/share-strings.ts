// The Share modal's copy (spec 0051, AC-5122; the owner's Share design, 25 October 2026).
import { homeStrings } from './home-strings.ts';

export const shareStrings = {
  title: 'Share your link page',
  /** Whose page the code opens: each workspace has its own (spec 0056, AC-5617). */
  inWorkspace: (name: string) => `Your link page in ${name}.`,
  qrLabel: 'A QR code that opens your link page',
  address: 'Your link page address',
  copy: 'Copy link',
  download: 'Download QR code',
  open: 'Open page',
  downloadFailed: 'The code didn’t save. Take a screenshot of it instead.',
  /** While the page is private (spec 0058, AC-23), under the code: the same words as everywhere. */
  privateLine: homeStrings.privateLine,
  goLive: 'Turn on Live',
  /** The row of other ways to share under the address: Links for each place, Style the code, Add to Wallet. */
  more: 'More ways to share',
} as const;
