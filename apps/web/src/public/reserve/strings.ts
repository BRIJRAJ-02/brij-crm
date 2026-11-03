// The reservation page's words (spec 0066 B7 lite): plain, short, and the restaurant's voice, never ours.
export const strings = {
  tabTitle: (place: string) => `Reserve a table · ${place}`,
  reserveTable: 'Reserve a table',
  guests: 'Guests',
  guestsCount: (party: number) => (party === 1 ? '1 guest' : `${String(party)} guests`),
  largerParty: (max: number, phone: string | undefined) =>
    phone === undefined
      ? `For more than ${String(max)} guests, call the restaurant.`
      : `For more than ${String(max)} guests, call ${phone}.`,
  largerPartyShort: (max: number) => `More than ${String(max)}? Call us`,
  chooseDay: 'Choose a day',
  lunch: 'Lunch',
  dinner: 'Dinner',
  times: 'Times',
  noTimes: 'No tables left that day for this party. Try another day or fewer guests.',
  closedNow: 'This restaurant isn’t taking reservations online right now.',
  callUs: (phone: string) => `Call ${phone} to reserve.`,
  reserve: 'Reserve',
  reserveAt: (day: string, time: string, party: number) => `Reserve ${day} at ${time} for ${String(party)}`,
  taken: 'That time was just taken. These are still free:',
  takenNone: 'That time was just taken, and nothing later that day is free. Try another day.',
  occasion: 'Occasion',
  occasions: ['Birthday', 'Anniversary', 'Date night', 'Business', 'Other'] as const,
  marketing: (business: string) => `Send me news and offers from ${business}.`,
  goodToKnow: (cutoffHours: number) =>
    cutoffHours <= 0
      ? 'You can change or cancel online any time before your visit.'
      : `You can change or cancel online until ${String(cutoffHours)} ${cutoffHours === 1 ? 'hour' : 'hours'} before.`,
  notFound: 'This page is no longer available.',
  tryAgain: 'Try again',
  offline: 'You’re offline. Check your connection and try again.',
  // The manage page.
  yourReservation: 'Your reservation',
  reserved: 'You’re booked',
  code: 'Reservation code',
  codeNote: 'Show it if anyone asks, or use it with your email to find this reservation.',
  where: 'Where',
  when: 'When',
  party: 'Guests',
  note: 'Your note',
  occasionTerm: 'Occasion',
  change: 'Change',
  changeTitle: 'Change your reservation',
  saveChange: 'Save change',
  changed: 'Your reservation is changed. We’ve emailed you the new time.',
  cancel: 'Cancel reservation',
  cancelTitle: 'Cancel this reservation?',
  cancelBody: (when: string) => `Your table on ${when} goes to someone else. This can’t be undone here.`,
  keep: 'Keep it',
  cancelled: 'Your reservation is cancelled. We’ve emailed you a confirmation.',
  tooLate: (phone: string | undefined) =>
    phone === undefined
      ? 'It’s too late to change this online. Call the restaurant.'
      : `It’s too late to change this online. Call ${phone}.`,
  reserveAgain: 'Reserve another table',
  findTitle: 'Find your reservation',
  findIntro: 'Use the code from your confirmation and the email you reserved with.',
  codeLabel: 'Reservation code',
  emailLabel: 'Email',
  find: 'Find reservation',
  withRestaurant: (business: string) => `at ${business}`,
  poweredBy: 'Powered by Timefix',
} as const;
