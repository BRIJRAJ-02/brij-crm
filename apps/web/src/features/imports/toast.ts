// The import and export toasts' copy and links (spec 0040), small enough for
// the first load, where the jobs' end toasts are raised.

/** What the toast says when an export's file is ready, and its action. */
export const exportToast = {
  ready: (fileName: string) => `${fileName} is ready`,
  download: 'Download',
} as const;

/** Whether the person is on `href` already, so a toast's View would go nowhere. */
export const isHere = (href: string): boolean => globalThis.location.pathname === href;
