/** MatchCalendar's built in copy. */
export const strings = {
  cta: 'Match with your calendar',
  ctaHint: 'See the times you’re both free.',
  title: 'Match with your calendar',
  // Why, before leaving for Google.
  whyLead: (host: string) => `We’ll put your calendar beside ${host}’s and show the times you’re both free.`,
  whyNote:
    'Free or busy only, never what’s on your calendar, and only for this booking. You’ll come back to this page.',
  continue: 'Continue with Google',
  notNow: 'Not now',
  // Waiting, while Google and the return leg happen.
  waitingLead: 'Matching your calendars',
  waitingNote: 'One moment. We’re reading when you’re both free.',
  waitingSaid: 'Matching your calendars. One moment.',
  // Matched.
  matchedLead: (when: string) => `You’re both free at ${when}. Shall we book it?`,
  matchedCount: (count: number) => (count === 1 ? 'One time matched.' : `${String(count)} times matched.`),
  matchedWhy: 'This is the soonest one in working hours, with a gap either side.',
  // Where the server found no time that passed those tests, the first shared one is offered without the claim.
  matchedSoonest: 'This is the soonest time you’re both free.',
  book: 'Book this time',
  others: 'See the other times',
  othersLabel: 'The next matching times',
  // Nothing matched.
  noneLead: (host: string) => `You and ${host} have no open time in common just now.`,
  noneNote: 'Every time they’re open is still on the page behind this.',
  showAll: 'Show all times',
  // It failed.
  failedLead: 'We couldn’t read your calendar.',
  failedNote: 'Nothing was saved. Try again, or pick from the times on the page.',
  retry: 'Try again',
  close: 'Close',
  // The two faces.
  yourCalendar: 'Your calendar',
} as const;
