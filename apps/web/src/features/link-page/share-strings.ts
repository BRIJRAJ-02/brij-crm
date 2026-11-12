// The link page's Share copy (spec 0051, AC-5122; the owner's Share design, 25 October 2026), drawn since spec 0074
// by the library's ShareSheet, which says its own Copy link, Email, WhatsApp, More and Download.
import { homeStrings } from './home-strings.ts';

export const shareStrings = {
  title: 'Share your link page',
  /** What the page is passed on as: the email's subject, the code's name and its file ("@priya", "priya-qr.png"). */
  name: (handle: string) => `@${handle}`,
  /** Whose page the code opens: each workspace has its own (spec 0056, AC-5617). */
  inWorkspace: (name: string) => `Your link page in ${name}.`,
  qrLabel: 'A QR code that opens your link page',
  download: 'Download QR code',
  open: 'Open page',
  downloadFailed: 'The code didn’t save. Take a screenshot of it instead.',
  /** While the page is private (spec 0058, AC-23), in the sheet's line: the same words as everywhere. */
  privateLine: homeStrings.privateLine,
  goLive: 'Turn on Live',
} as const;
