// The public booking pages' copy (spec 0025, 0025-experience.md).
export const strings = {
  // The visitor page.
  /** The product, after a page's heading in its tab's title (`tabTitle`). */
  product: 'Timefix',
  timeZone: 'Time zone',
  /** A team page's avatar stack, as screen readers name it (spec 0029, AC-759). */
  teamOf: (count: number) => `Team of ${String(count)}`,
  /** A team page's host, in a sentence. */
  theTeam: 'the team',
  minutesShort: (count: number) => `${String(count)} min`,
  /** A page's lengths in one phrase: "30 min", "15 or 30 min", "15, 30 or 60 min". */
  lengths: (minutes: readonly number[]) => {
    const all = minutes.map(String);
    const last = all.at(-1);
    if (last === undefined) return '';
    return all.length === 1 ? `${last} min` : `${all.slice(0, -1).join(', ')} or ${last} min`;
  },
  meeting: (minutes: number, where: string) => `${String(minutes)} min · ${where}`,
  locations: { video: 'Video call', phone: 'Phone call' },
  length: 'Meeting length',
  chooseTime: 'Choose a time',
  view: 'Choose how to view times',
  month: 'Month',
  chat: 'Book by chat',
  list: 'List',
  clock: 'Clock',
  hours12: '12h',
  hours24: '24h',
  timeName: (time: string, day: string, minutes: number) => `${time}, ${day}, ${String(minutes)} minutes`,
  book: 'Book',
  bookAt: (day: string, time: string) => `Book ${day} at ${time}`,
  /** The Book band's quiet line while no time is picked (critic A10): a wide page only, a phone shows no band. */
  pickTime: 'Pick a time',
  /**
   * The page's rules, stated plainly in the rail (bookings critics, 4 Nov 2026). Short enough that a page's usual
   * rules ("4 hours’ notice · Up to 60 days ahead") hold one line on a 320px phone: "Can’t be booked within 4 hours"
   * filled a 390px phone's row to the pixel and wrapped wherever the font drew a little wider (Linux), moving the
   * card under the rail as the page's facts arrived.
   */
  noticeRule: (minutes: number) =>
    minutes % 1440 === 0 && minutes >= 1440
      ? minutes === 1440
        ? '1 day’s notice'
        : `${String(minutes / 1440)} days’ notice`
      : minutes % 60 === 0
        ? minutes === 60
          ? '1 hour’s notice'
          : `${String(minutes / 60)} hours’ notice`
        : minutes === 1
          ? '1 minute’s notice'
          : `${String(minutes)} minutes’ notice`,
  windowRule: (days: number) => `Up to ${String(days)} days ahead`,
  /** A page that confirms each booking first (spec 0062, AC-6203). */
  request: 'Request',
  requestAt: (day: string, time: string) => `Request ${day} at ${time}`,
  // The best match in words, for the dialog's question ("You’re both free at 9:30 AM on Tue 20 Oct").
  matchWhen: (time: string, day: string) => `${time} on ${day}`,
  zoneSearch: 'Search city or GMT offset',
  zoneSearchPlaceholder: 'Search a city or GMT+4',
  /** The time zone list's groups: the zone in use (and the visitor's own) first, then every other. */
  zoneSuggested: 'Suggested',
  zoneAll: 'All time zones',
  /** The time zone picker with no zone chosen, which a page always has: only a stand in's empty state. */
  zoneChoose: 'Choose a time zone',
  // Book by chat (spec 0042).
  /** The chat's confirm card names the meeting as the confirmation does. */
  chatCardTitle: (title: string, host: string) => `${title} with ${host}`,
  /**
   * The chat speaks as the host (owner, 4 Nov 2026: "that person is doing it", not an assistant): their first name on
   * a personal page, the team's name on a team page, and the core agent's replies in the same voice.
   */
  // The assistant says what it is and whom it books for (review, 5 Nov 2026): under "Ada's booking assistant" it never
  // claims to be Ada.
  chatGreeting: (who: { readonly label: string; readonly isTeam: boolean }, title: string, minutes: number) =>
    `Hi, I can book you a ${String(minutes)} min ${title} with ${who.label}. When suits you?`,
  /** The chat's name over its first line (critic B-10): what it is, in the host's name. */
  chatAssistant: (host: string) => `${host}’s booking assistant`,
  chatTeamAssistant: 'Booking assistant',
  /** Few of the host's times fall in the visitor's daytime (critic B-10): said once, in the greeting. */
  chatOffHours: (host: string) => `Most of ${host}’s open times fall outside your daytime.`,
  /** The note, folded into the confirm card. */
  chatCardNote: (note: string) => `Note: ${note.length > 60 ? `${note.slice(0, 59)}…` : note}`,
  chatNoTimes: (host: string) => `${host} is fully booked right now. Check back soon.`,
  chatTeamNoTimes: 'The team is fully booked right now. Check back soon.',
  chatSuggestions: ['Something later', 'Next week'] as readonly string[],
  /**
   * What the prompt box asks after each reply (the owner, 4 Nov 2026: the words follow the conversation): the first
   * question while times run over several days, the time once they're one day's, then each detail the chat waits on,
   * then the read back's yes.
   */
  chatPrompts: {
    when: 'When works for you?',
    time: 'Which time?',
    details: 'Your name and email',
    name: 'Your name',
    email: 'Your email',
    phone: 'Your phone number',
    confirm: 'Or say what to change',
  },
  // Chat parity (4 Nov 2026): what the page itself asks in the host's voice, short and plain.
  /** The greeting's chip for the zone the times are in; it opens the rail's picker. */
  chatZoneChip: (zone: string) => `${zone} · Change`,
  chatZoneMoved: (zone: string) => `Times are in ${zone} now.`,
  /** One of the page's own questions, as the host asks it: its label, a question. */
  chatQuestion: (label: string, isFirst: boolean) => {
    const asked = /[?.!:]$/u.test(label.trim()) ? label.trim() : `${label.trim()}?`;
    return isFirst ? `One more thing. ${asked}` : asked;
  },
  chatMenu: {
    ask: (isTeam: boolean) => `Anything else before ${isTeam ? 'we book' : 'I book'} it?`,
    guest: 'Add a guest',
    note: 'Add a note',
    done: 'That’s all',
    /** The box's words while a row of chips is the answer: never the opening question again. */
    prompt: 'Tap one, or type here',
  },
  chatGuestAsk: 'Who else is joining? Their email, or a few.',
  chatGuestPrompt: 'Guest’s email',
  chatGuestWrong: 'That email doesn’t look right. Try again?',
  chatGuestAdded: (count: number) => (count === 1 ? 'Added.' : `Added all ${String(count)}.`),
  chatGuestCount: (count: number) => (count === 1 ? '1 guest' : `${String(count)} guests`),
  chatNoteAsk: (isTeam: boolean) => `What should ${isTeam ? 'we' : 'I'} know before we talk?`,
  chatNotePrompt: 'Your note',
  chatNoted: 'Got it.',
  chatAnswerWrong: (problem: string) => `Sorry. ${problem}`,
  /** The chips a question's answer takes, and the line for a country the page can't place. */
  chatAnswers: {
    yes: 'Yes',
    no: 'No',
    agree: 'I agree',
    noThanks: 'No thanks',
    unknownCountry: 'Which country is that? Try its name, like India.',
  },
  chatTooMany: 'That was a lot at once. Try again in a few seconds.',
  chatTooLong: 'This chat is too long to go on. Start over to book.',
  chatBooked: 'Booked. Opening your booking.',
  chatRequested: 'Request sent. Opening your request.',
  errors: {
    taken: 'Someone just took that time. Pick another.',
    gone: 'That time is no longer available. Pick another.',
    /** A next times chip whose time went between the link page drawing it and this page reading them (AC-6110). */
    atGone: 'That time was just taken. Here are the others.',
    /** A next times link whose time is already past (critic B-08). */
    atPast: 'That time has passed. Here are the next ones.',
    tooMany: 'Too many attempts just now. Wait a moment and try again.',
    closed: 'This page isn’t taking bookings any more.',
    failed: 'That did not go through. Try again in a moment.',
    /** A booking that failed: the visitor's first question is whether they are booked. */
    bookFailed: 'That did not go through, and nothing was booked. Try again in a moment.',
    bookOffline: 'That did not go through, and nothing was booked. Check your connection and try again.',
    /** The times couldn't be read: the visitor sent nothing, so nothing "went" anywhere. */
    timesFailed: 'We couldn’t load the times.',
    /** A refusal naming no field (the bot checks): something the visitor can check, not a shrug. */
    check: 'We couldn’t take that booking. Check your details and try again.',
    offline: 'That did not go through. Check your connection and try again.',
  },
  // States.
  noTimesTitle: 'No open times in the next two months.',
  /** A shared link (Share specific times) whose every time has been taken. */
  sharedGoneTitle: 'These times have been taken.',
  sharedGoneText: 'Pick another time from the page.',
  seeAllTimes: 'See all times',
  noTimesText: 'Check back soon.',
  /** A team page with nobody on it: not the same as a full diary. */
  noHostsTitle: 'No one is taking bookings here right now.',
  unreachable: 'Times unavailable. Try again shortly.',
  paused: 'Nothing is bookable here right now.',
  /** A paused page whose host we know (critic B-09). */
  pausedBy: (host: string) => `${host} isn’t taking bookings here right now`,
  pausedText: 'Their other pages may still be open.',
  seePage: (host: string) => `See ${host}’s page`,
  seeTheirPage: 'See their other pages',
  /** A one off link with nothing left to book (spec 0062, AC-6204). */
  linkUsedTitle: 'This link has been used',
  linkUsedText: 'Ask whoever sent it for a new one.',
  /** A page that books only through one-time links, opened without one (AC-6204). */
  invitationTitle: 'This page books by invitation',
  invitationText: 'Ask whoever sent you here for a link.',
  notFoundTitle: 'Page not found',
  notFoundText: 'There’s nothing at this address.',
  failedTitle: 'Couldn’t reach this page',
  failedText: 'Check your connection, then try again.',
  /** Refused 429 (B-18): too many reads from this address for a moment, not a broken page. */
  busyTitle: 'Busy, try again in a moment',
  busyText: 'Too many tries. Wait a moment, then try again.',
  retry: 'Try again',
  // The visitor's calendar (spec 0028).
  showAllTimes: 'Show all times',
  allBusy: (host: string) => `Every time ${host} has open clashes with your calendar.`,
  connectResults: {
    denied: 'Your calendar wasn’t connected. Every time still shows.',
    scope: 'Connect again and leave the busy times box ticked.',
    failed: 'Couldn’t connect your calendar. Try again in a moment.',
    off: 'Connecting a calendar isn’t available on this page yet.',
  },
  loading: 'Loading…',
  // A person's profile, /<handle> (22 Oct 2026).
  searchLinks: 'Search links',
  /** The social icons row's name for screen readers. */
  socials: (name: string) => `${name}’s social links`,
  /** The square button beside Save contact: it hands the page on. */
  sharePage: 'Share this page',
  /** Share beside Save contact, the two an equal pair. */
  share: 'Share',
  /** The browser can’t share, so the address went to the clipboard instead. */
  shareCopied: 'Link copied',
  /** Neither sharing nor copying worked: the address is in the bar, so there is still a way. */
  shareFailed: 'The link didn’t copy. Copy it from the address bar instead.',
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
    /** A long ended booking's link (B-13): its details are no longer kept. */
    ended: 'This booking ended',
  },
  what: 'What',
  /** The booked moment's What: "Intro call with Brij Raj, 30 min". */
  whatLine: (title: string, host: string, minutes: number) => `${title} with ${host}, ${String(minutes)} min`,
  who: 'Who',
  /** The guest page's summary, after the meeting's name: "Intro call  with Ada Lovelace" (spec 0058, AC-19). */
  where: 'Where',
  yourNote: 'Your note',
  /** A video call with no link made (no calendar that makes one): its host sends it, never a promise (QA Q77). */
  video: (host: string) => `Video call. ${host} will send you the link.`,
  phoneCall: 'Phone call to the number you gave.',
  bookAnother: (host: string) => `Book another time with ${host}`,
  bookAgain: 'Book again',
  // A title, so no full stop, and a way on (QA Q80).
  linkGone: 'This link doesn’t open a booking',
  linkGoneText: 'This link is out of date. Use the one in your latest email.',
} as const;

/** A tab's title: the page's heading, then the product, as every public page names its tab (QA Q76). */
export function tabTitle(heading: string): string {
  return `${heading} · ${strings.product}`;
}
