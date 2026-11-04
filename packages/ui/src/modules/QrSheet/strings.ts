/** QrSheet's built in copy. */
export const strings = {
  /** The line every card carries under the table's name. */
  scan: 'Scan for the menu',
  /** A sheet's name for screen readers: which page of how many. */
  page: (at: number, of: number) => `Page ${String(at)} of ${String(of)}`,
  /** The code's name for screen readers. */
  code: (name: string) => `QR code for ${name}`,
  /** The logo beside the venue's name says nothing the name doesn't. */
  decorative: '',
} as const;
