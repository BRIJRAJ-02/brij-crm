/** RelativeTime's built in copy. */
export const strings = {
  /** Read after the relative time by screen readers: ", Oct 8, 2026, 12:30 PM GMT+1". */
  exact: (time: string) => `, ${time}`,
} as const;
