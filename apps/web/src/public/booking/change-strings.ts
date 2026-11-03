// The guest page's changes' copy (spec 0025, milestone 2), apart from the booking page's strings so the booking
// page's first load carries none of it: the guest page loads in its own chunk.
export const changeStrings = {
  guestsTerm: 'Guests',
  /** A redirect page, right after booking (spec 0062, AC-6201). */
  takingYou: (site: string) => `Taking you to ${site}`,
  goNow: 'Go now',
  /** Inside a page's cancel or move cutoff (spec 0062, AC-6202): the server's TOO_LATE says the same. */
  tooLate: 'Too close to the meeting to change it here. Reply to your confirmation email.',
  poweredBy: 'Powered by Timefix (opens in a new tab)',
  pickNewTime: 'Pick a new time',
  timesIn: (zone: string) => `Times in ${zone}`,
  moveTo: (time: string, day: string) => `Move to ${time} on ${day}`,
  moving: 'Moving',
  finding: (host: string) => `Finding ${host}’s free times…`,
  noTimes: (host: string) =>
    `${host} has no free times in the next three weeks. Cancelling and booking again later may be easier.`,
  moved: 'Moved.',
  // Said of what we do, never of calendars we may not hold (QA Q79).
  movedText: (host: string) => `${host} has been told, and a confirmation with the new time is on its way.`,
  cancelled: 'Cancelled.',
  cancelledText: (host: string) => `${host} has been told.`,
  taken: 'That time has just gone. Pick another.',
  reason: 'Reason',
} as const;
