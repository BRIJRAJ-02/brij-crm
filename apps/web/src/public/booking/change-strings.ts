// The guest page's changes' copy (spec 0025, milestone 2), apart from the booking page's strings so the booking
// page's first load carries none of it: the guest page loads in its own chunk.
export const changeStrings = {
  guestsTerm: 'Guests',
  poweredBy: 'Powered by Timefix (opens in a new tab)',
  pickNewTime: 'Pick a new time',
  timesIn: (zone: string) => `Times in ${zone}`,
  moveTo: (time: string, day: string) => `Move to ${time} on ${day}`,
  moving: 'Moving…',
  finding: (host: string) => `Finding ${host}’s free times…`,
  noTimes: (host: string) =>
    `${host} has no free times in the next three weeks. Cancelling and booking again later may be easier.`,
  moved: 'Moved.',
  movedText: 'Both calendars are updated and a confirmation is on its way.',
  cancelled: 'Cancelled.',
  cancelledText: (host: string) => `${host} has been told, and it comes off both calendars.`,
  taken: 'That time has just gone. Pick another.',
  reason: 'Reason',
} as const;
