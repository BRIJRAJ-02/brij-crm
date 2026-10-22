/** RelativeTime's built in copy. */
export const strings = {
  /** Under a minute ago (or ahead): the language's own "now" read as a word on its own, as the timeline and panels say it. */
  justNow: 'just now',
  /** Read after the relative time by screen readers: ", Oct 8, 2026, 12:30 PM GMT+1". */
  exact: (time: string) => `, ${time}`,
} as const;
