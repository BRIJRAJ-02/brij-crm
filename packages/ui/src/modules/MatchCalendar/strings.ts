/** MatchCalendar's built in copy. */
export const strings = {
  cta: 'Match with your calendar',
  ctaHint: 'See the times you’re both free.',
  title: 'Match with your calendar',
  // Why, before leaving for Google.
  whyLead: (host: string) => `See when you and ${host} are both free.`,
  whyNote: 'We only see free or busy, just for this booking.',
  continue: 'Continue with Google',
  notNow: 'Not now',
  // Waiting, while Google and the return leg happen.
  waitingLead: 'Matching your calendars',
  waitingNote: 'One moment.',
  waitingSaid: 'Matching your calendars. One moment.',
  // Matched.
  matchedLead: (when: string) => `You’re both free at ${when}.`,
  matchedCount: (count: number) => (count === 1 ? 'One time matched.' : `${String(count)} times matched.`),
  matchedWhy: 'The soonest in working hours, with a gap either side.',
  // Where the server found no time that passed those tests, the first shared one is offered without the claim.
  matchedSoonest: 'The soonest time you’re both free.',
  book: 'Book this time',
  others: 'See the other times',
  othersLabel: 'The next matching times',
  // Nothing matched.
  noneLead: (host: string) => `No shared free time with ${host} yet.`,
  noneNote: 'All their times are still on the page.',
  showAll: 'Show all times',
  // It failed.
  failedLead: 'We couldn’t read your calendar.',
  failedNote: 'Nothing was saved. Try again, or pick a time on the page.',
  retry: 'Try again',
  close: 'Close',
  // The two faces.
  yourCalendar: 'Your calendar',
} as const;
