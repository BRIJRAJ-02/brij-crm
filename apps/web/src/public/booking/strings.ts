// The public booking pages' copy (spec 0025, 0025-experience.md).
export const strings = {
  // The visitor page.
  what: 'What',
  timeZone: 'Time zone',
  poweredBy: 'Powered by',
  madeWith: 'Made with Timefix',
  product: 'Timefix',
  /** A team page's avatar stack, as screen readers name it (spec 0029, AC-759). */
  teamOf: (count: number) => `Team of ${String(count)}`,
  /** A team page's title line (spec 0037, AC-1339): "Intro call with Acme". */
  teamTitle: (title: string, workspace: string) => `${title} with ${workspace}`,
  minutesShort: (count: number) => `${String(count)} min`,
  meeting: (minutes: number, where: string) => `${String(minutes)} min · ${where}`,
  locations: { video: 'Video call', phone: 'Phone call' },
  minutes: (count: number) => `${String(count)} minutes`,
  length: 'Meeting length',
  chooseTime: 'Choose a time',
  view: 'Choose how to view times',
  month: 'Month',
  chat: 'Book by chat',
  list: 'List',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  today: 'today',
  noTimes: 'no times',
  clock: 'Clock',
  hours12: '12h',
  hours24: '24h',
  timesOn: (count: number, day: string) => (count === 1 ? `1 time on ${day}` : `${String(count)} times on ${day}`),
  timeName: (time: string, day: string, minutes: number) => `${time}, ${day}, ${String(minutes)} minutes`,
  book: 'Book',
  bookAt: (day: string, time: string) => `Book ${day} at ${time}`,
  // The best match in words, for the dialog's question ("You’re both free at 9:30 AM on Tue 20 Oct").
  matchWhen: (time: string, day: string) => `${time} on ${day}`,
  zoneSearch: 'Search city or GMT offset',
  /** The time zone picker with no zone chosen, which a page always has: only a stand in's empty state. */
  zoneChoose: 'Choose a time zone',
  zoneNone: (query: string) => `No time zone matches "${query}".`,
  changeZone: (zone: string) => `Show times in another time zone. Now ${zone}`,
  // Details.
  changeTime: 'Change time',
  yourName: 'Your name',
  email: 'Email',
  emailPlaceholder: 'you@example.com',
  addGuest: '+ Add guest',
  guest: (index: number) => `Guest ${String(index)} email`,
  guestPlaceholder: 'Guest email',
  removeGuest: (index: number) => `Remove guest ${String(index)}`,
  addAnotherGuest: 'Add another guest',
  phone: 'Number to call',
  note: 'Anything else the host should know?',
  optional: 'optional',
  bookingAs: (name: string) => `Booking as ${name}.`,
  notYou: 'Not you?',
  confirm: 'Confirm booking',
  booking: 'Booking',
  nameRequired: 'Give your name.',
  emailRequired: 'Give an email address such as name@example.com.',
  guestInvalid: 'Give each guest’s email address.',
  phoneRequired: 'Give a number to call you on.',
  trap: 'Leave this empty',
  // Book by chat (spec 0042).
  chatGreeting: (host: string, title: string, minutes: number) =>
    `I can book your ${String(minutes)} minute ${title} with ${host}. When works for you? Type something like “tomorrow afternoon”, or pick a time below.`,
  chatNoTimes: (host: string) => `${host} has nothing open right now. Check back soon.`,
  chatSuggestions: ['Something later', 'Next week'] as readonly string[],
  chatTooMany: 'That was a lot at once. Give it a few seconds and try again.',
  chatTooLong: 'This chat is too long to go on. Start over to book.',
  chatBooked: 'Booked. Opening your booking.',
  errors: {
    taken: 'Someone just took that time. Pick another.',
    gone: 'That time is no longer available. Pick another.',
    tooMany: 'Too many attempts just now. Wait a moment and try again.',
    closed: 'This page isn’t taking bookings any more.',
    failed: 'That did not go through. Try again in a moment.',
    /** A refusal naming no field (the bot checks): something the visitor can check, not a shrug. */
    check: 'We couldn’t take that booking. Check your details and try again.',
    offline: 'That did not go through. Check your connection and try again.',
  },
  // States.
  noTimesTitle: 'No open times in the next two months.',
  noTimesText: 'Check back soon.',
  unreachable: (name: string) =>
    `${name} can’t show times right now. Their calendar is temporarily unreachable. Try again shortly.`,
  paused: 'Nothing is bookable here right now.',
  notFoundTitle: 'Page not found',
  notFoundText: 'There’s nothing at this address.',
  failedTitle: 'This page didn’t load',
  failedText: 'Check your connection and try again.',
  retry: 'Try again',
  // The visitor's calendar (spec 0028).
  showAllTimes: 'Show all times',
  allBusy: (host: string) => `Every time ${host} has open clashes with your calendar.`,
  connectResults: {
    denied: 'Your calendar wasn’t connected. Every time still shows.',
    scope: 'Timefix needs to see when you’re busy to compare calendars. Connect again and leave that box ticked.',
    failed: 'Couldn’t connect your calendar. Try again in a moment.',
    off: 'Connecting a calendar isn’t available on this page yet.',
  },
  loading: 'Loading…',
  // A person's profile, /<handle> (22 Oct 2026).
  searchLinks: 'Search links',
  /** The social icons row's name for screen readers. */
  socials: (name: string) => `${name}’s social links`,
  team: 'Team',
  noLinksTitle: 'Nothing here yet',
  noLinksText: 'This person hasn’t added any links yet.',
  noMatchesTitle: (query: string) => `Nothing matches “${query}”`,
  matches: (count: number) => (count === 0 ? 'No matches' : count === 1 ? '1 match' : `${String(count)} matches`),
  noMatchesText: 'Try fewer or other words.',
  showMore: 'Show more',
  moreFailed: 'More links didn’t load. Try again.',
  searchFailed: 'That search didn’t go through. Try again in a moment.',
  /**
   * A profile with nothing to show. Since 25 Oct 2026 this is reached only when the address is somebody's, or a
   * word kept for Timefix, or the free read itself failed, so it no longer says no one has it: true in all three,
   * and it still says nothing about whether an account is behind the address.
   */
  profileNotFound: 'This address has no public page.',
  /** A free address (25 Oct 2026): the tab, which says what the page's heading says. The page's own copy is the component's. */
  handleFreeTab: (address: string) => `${address} is free`,
  // The guest page.
  titles: {
    welcome: 'You’re booked',
    confirmed: 'Your booking',
    cancelled: 'This booking was cancelled',
    past: 'This booking has passed',
  },
  marks: { confirmed: 'Confirmed', cancelled: 'Cancelled', past: 'Finished' },
  who: 'Who',
  where: 'Where',
  yourNote: 'Your note',
  host: 'Host',
  alsoInvited: (names: string) => `Also invited: ${names}`,
  joinCall: 'Join the call',
  addToCalendar: 'Add to calendar',
  addTo: (calendar: string) => `Add to ${calendar}`,
  google: 'Google',
  outlook: 'Outlook',
  apple: 'Apple / .ics',
  icsFile: 'Apple or any calendar, as an .ics file',
  /** A video call with no link made (no calendar that makes one): its host sends it, never a promise (QA Q77). */
  video: (host: string) => `Video call. ${host} will send you the link.`,
  phoneCall: 'Phone call to the number you gave.',
  cancelledNext: 'Nothing more to do here.',
  pastNext: 'This one has already happened.',
  bookAnother: (host: string) => `Book another time with ${host}`,
  bookAgain: 'Book again',
  // A title, so no full stop, and a way on (QA Q80).
  linkGone: 'This link doesn’t open a booking',
  linkGoneText: 'The link may be incomplete or out of date. Open the one in the latest email about this booking.',
} as const;

/** A tab's title: the page's heading, then the product, as every public page names its tab (QA Q76). */
export function tabTitle(heading: string): string {
  return `${heading} · ${strings.product}`;
}
