/** The Captures page's copy. */
export const strings = {
  title: 'Captures',
  /** The tab strip's name, read by screen readers. */
  tabsLabel: 'Captures',
  linksTab: 'Links',
  formsTab: 'Forms',
  /** What the TopBar's count counts, for screen readers: "3 booking pages", "2 forms". */
  linksCount: 'booking pages',
  formsCount: 'forms',
  /** The editors' shared header (22 Oct 2026): one set of words for a booking page and a form. */
  copyLink: 'Copy link',
  moreActions: 'More actions',
  pause: 'Pause',
  resume: 'Resume',
  duplicate: 'Duplicate',
  undo: 'Undo',
  pausedToast: (name: string) => `Paused “${name}”.`,
  resumedToast: (name: string) => `“${name}” is live again.`,
  /** The status beside an editor's name: Live (green) or Paused (grey). */
  live: 'Live',
  paused: 'Paused',
} as const;
