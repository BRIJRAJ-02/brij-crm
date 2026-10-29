// The import and export toasts' copy and links (spec 0040), small enough for
// the first load, where the jobs' end toasts are raised.

/** What the toast says when an export's file is ready, and its action. */
export const exportToast = {
  ready: (fileName: string) => `${fileName} is ready`,
  /** Records changed while a sorted export was written (late trap #40): a row may be missing or twice. */
  readyChanged: (fileName: string) =>
    `${fileName} is ready, but records changed as it was written; export again for an exact copy.`,
  download: 'Download',
} as const;

/** Whether the person is on `href` already, so a toast's View would go nowhere. */
export const isHere = (href: string): boolean => globalThis.location.pathname === href;
