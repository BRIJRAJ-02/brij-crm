/** The Bookings page's copy. */
export const strings = {
  title: 'Bookings',
  /** After New makes a page from here: where it, and every booking page, lives (flow walks B1). */
  pageMadeWhere: (title: string) => `Made “${title}”, in Captures › Links.`,
  /** The page's tab strip, as Captures has: its name, read by screen readers, and each tab. */
  pageTabsLabel: 'Bookings',
  pageTabs: {
    calendar: 'Calendar',
    list: 'List',
    availability: 'Availability',
    // "Round robin" is what the feature is called everywhere else in the product, so the tab says it too.
    'round-robin': 'Round robin',
    calendars: 'Calendars',
  },
  tabsLabel: 'Which bookings',
  tabs: { upcoming: 'Upcoming', past: 'Past', cancelled: 'Cancelled' },
  listLabel: { upcoming: 'Upcoming meetings', past: 'Past meetings', cancelled: 'Cancelled meetings' },
  sourceLabel: 'Show',
  sources: { all: 'Everything', bookings: 'Bookings only', calendar: 'Calendar events only' },
  noMatch: 'Nothing matches these filters',
  more: 'Show more',
  moreFailed: 'Couldn’t load more. Try again',
  /** Each tab's own empty state: one line. */
  empty: {
    upcoming: { title: 'Nothing coming up', text: 'Bookings from your booking pages show up here.' },
    past: { title: 'Nothing behind you yet', text: 'Meetings that have happened show up here.' },
    cancelled: { title: 'Nothing has been called off', text: 'Cancelled bookings show up here.' },
  },
  /** The list's way to share a booking page when nothing is coming up. */
  shareBookingPage: 'Share a booking page',
  failedTitle: 'Bookings didn’t load',
  failedText: 'Check your connection and try again.',
  today: 'Today',
  todayOn: (day: string) => `Today · ${day}`,
  tomorrow: 'Tomorrow',
  allDay: 'All day',
  dayToDay: (first: string, last: string) => `${first} to ${last}`,
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  previousDay: 'Previous day',
  nextDay: 'Next day',
  goToToday: 'Go to today',
  /** The bar's Day and Week switch. */
  calendarView: 'View',
  dayView: 'Day',
  weekView: 'Week',
  /** An empty week's way on: the day of the reader's next booking after it. */
  nextBooking: (day: string) => `Next booking: ${day}`,
  weekLabel: (range: string) => `Bookings, ${range}`,
  weekSummary: (count: number) =>
    count === 0
      ? 'Nothing booked this week.'
      : count === 1
        ? '1 booking this week.'
        : `${String(count)} bookings this week.`,
  weekLoading: 'Loading this week…',
  /** The week grid's quiet line when nothing is on it. */
  noMeetingsWeek: 'No meetings this week',
  nothingOnWeek: (calendar: string) => `Nothing on ${calendar} this week`,
  /** The same in the day view, while the day shown is empty. */
  noMeetingsDay: 'No meetings this day',
  nothingOnDay: (calendar: string) => `Nothing on ${calendar} this day`,
  calendarsRetry: 'Calendars didn’t load. Try again',
  /** The calendars panel's small month. */
  goToDate: 'Go to date',
  cancelled: 'Cancelled',
  /** Who provides a meeting link, by its host. */
  providers: { google: 'Google Meet', microsoft: 'Microsoft Teams', zoom: 'Zoom', other: 'the call' },
  /** Filters. */
  filter: 'Filter',
  filterCount: (count: number) => `Filter · ${String(count)}`,
  filterMenu: 'Filter bookings',
  links: 'Link',
  allLinks: 'All links',
  calendars: 'Calendars',
  allCalendars: 'All calendars',
  /** Whose bookings an admin sees (HostsSwitch). */
  hostsLabel: 'Whose bookings',
  hosts: { mine: 'Mine', all: 'Everyone' },
  /** A colleague's booking on the week (an admin's Everyone): the guest, then whose it is. */
  withHost: (guest: string, host: string) => `${guest} · ${host}`,
  /** A colleague's booking's card: whose it is. */
  hostRow: 'Host',
  bookingsOnly: 'Bookings',
  moreCalendars: 'More calendars',
  moreCount: (count: number) => (count === 1 ? '1 more calendar' : `${String(count)} more calendars`),
  calendarsFailed: 'Couldn’t load your calendars.',
  connectCalendar: 'Connect a calendar',
  connectCalendarShort: 'Connect calendar',
  noCalendarConnected: 'No calendar connected.',
  dismiss: 'Dismiss',
  movedTo: (now: string, was: string) => `New bookings now go to ${now}. ${was} stopped taking them.`,
  clearFilters: 'Clear filters',
  /** Sort. */
  sortSoonest: 'Soonest first',
  sortLatest: 'Latest first',
  sortRecent: 'Most recent first',
  sortOldest: 'Oldest first',
  sortLabel: (current: string) => `Sort: ${current}. Change`,
  /** The details card. */
  details: 'Booking',
  status: { confirmed: 'Confirmed', cancelled: 'Cancelled' },
  when: 'When',
  /** New meeting's day: the drawn span's, or the next free one, and changed in place. */
  day: 'Day',
  /** Under Their time zone: it doesn't move From and To, which are on the member's clock. */
  theirTimeZoneHint: 'Only changes how their invitation shows the time.',
  who: 'Who',
  page: 'Booking page',
  guests: 'Also invited',
  timeZone: 'Their time zone',
  where: 'Where',
  note: 'Note',
  /** A booking's answers to its page's own questions (spec 0057): the row's name and how many. */
  answers: 'Answers',
  answerCount: (count: number) => (count === 1 ? '1 answer' : `${String(count)} answers`),
  someNotSaved: 'Those marked Not saved weren’t taken by the person’s record. They stay with the booking.',
  quoted: (note: string) => `“${note}”`,
  /** A booking made by chat on the booking page (spec 0042). */
  bookedHow: 'Booked',
  bookedByChat: 'By chat on the booking page',
  showChat: 'Chat',
  chatVisitor: 'Visitor',
  chatAssistant: 'Assistant',
  cancelReason: 'Why it was cancelled',
  openPerson: 'Open their page',
  joinCall: 'Join call',
  /** The card's Join: short on screen, its name the provider ("Join Google Meet"). */
  join: 'Join',
  joinProvider: (provider: string) => `Join ${provider}`,
  /** The card's people row, for screen readers. */
  cardPeople: 'Who',
  /** Booked by chat: the transcript under the row. */
  viewChat: (count: number) => `View chat (${String(count)})`,
  hideChat: 'Hide chat',
  /** A booking's card heading: who, then which page ("Grace Hopper · Intro call"). */
  cardTitle: (guest: string, page: string) => `${guest} · ${page}`,
  // A removed host's booking stays for an admin to hand on (spec 0031, AC-815).
  hostRemoved: 'Host removed',
  eventFailed: 'This booking isn’t on your calendar: the event couldn’t be made. Add it by hand.',
  video: 'Video call',
  /** Under a video call still to come that no calendar made a link for, as the host's email says it. */
  videoNoLink: 'No link was made. Send the guest one.',
  phone: 'Phone call to their number',
  calendar: 'Calendar',
  /** An event's call, as the card's row. */
  call: 'Call',
  /** A calendar event card's note, for screen readers. */
  aboutEvent: 'About this event',
  fromCalendar: 'From your calendar. Timefix keeps the time blocked but doesn’t manage this event.',
  // The member's own calendar time with nobody else invited (spec 0024, the owner's call on 20 October 2026).
  busy: 'Busy',
  busyNote:
    'Something on your calendar with nobody else invited. Its details stay in your calendar, and nobody can book this time.',
  // Time the member closed (spec 0027).
  blocked: 'Blocked',
  held: 'Reserved time',
  why: 'Why',
  repeats: 'Repeats',
  everyWeek: (weekday: string) => `Every ${weekday}`,
  heldNote: 'Only your link only pages can book it.',
  blockedNote: 'None of them offers this time.',
  removeBlock: 'Remove',
  releaseHold: 'Release',
  removeFailed: 'That time couldn’t be opened again. Try again.',
  reopened: 'That time is open again.',
  removeEvery: (weekday: string) => `Remove every ${weekday}`,
  // Removing closed time asks first (the house rule in Modal's README): nothing brings a removed block back.
  removeBlockTitle: (label: string | undefined) =>
    label === undefined ? 'Remove this block?' : `Remove the “${label}” block?`,
  removeWeeklyTitle: (label: string | undefined) =>
    label === undefined ? 'Remove this weekly block?' : `Remove the weekly “${label}” block?`,
  releaseHoldTitle: (label: string | undefined) =>
    label === undefined ? 'Release this reserved time?' : `Release “${label}”?`,
  reopensOnce: (day: string, from: string, to: string) =>
    `${day}, ${from} to ${to}, opens for booking again. This can’t be undone.`,
  reopensWeekly: (weekday: string, from: string, to: string) =>
    `Every ${weekday}, ${from} to ${to}, opens for booking again. This can’t be undone.`,
  releasesHold: (day: string, from: string, to: string) =>
    `${day}, ${from} to ${to}, opens to every booking page again. This can’t be undone.`,
  removeBlockAction: 'Remove block',
  releaseHoldAction: 'Release reserved time',
  removing: 'Removing',
  releasing: 'Releasing',
  bookingPages: 'Booking pages',
  from: 'From',
  to: 'To',
  overlaps: (count: number) =>
    count === 1 ? '1 booking in this time stays booked.' : `${String(count)} bookings in this time stay booked.`,
  // Drawing on the week (spec 0027).
  drawCard: (span: string) => `${span}: what is this time for?`,
  minutes: (count: number) => `${String(count)} min`,
  hours: (count: number) => `${String(count)} hr`,
  blockThisTime: 'Block this time',
  howOften: 'How often',
  justThis: (weekday: string) => `Just this ${weekday}`,
  onlyYou: 'Only you see this.',
  onlyYouAnd: (name: string) => `Only you, ${name} and whoever manages ${name}’s scheduling see this.`,
  blockIt: 'Block it',
  blocking: 'Blocking',
  blockFailed: 'That time couldn’t be blocked. Try again.',
  timeBlocked: 'Time blocked.',
  // Acting for a colleague whose scheduling the member Manages (spec 0037, AC-1272).
  seeOnly: (host: string) =>
    host === '' ? 'You can see this booking but not change it.' : `You can see ${host}’s bookings but not change them.`,
  forWhom: 'For',
  forMe: 'Me',
  timeBlockedFor: (name: string) => `Time blocked on ${name}’s calendar.`,
  noPagesFor: (name: string) => `${name} has no live booking pages you can book on.`,
  forHint: (name: string) => `On ${name}’s calendar. ${name} is told.`,
  bookSomeoneIn: 'Book someone in',
  newMeeting: 'New meeting',
  /** The TopBar's New: it reads New, as Captures' does, and is named New meeting. */
  newButton: 'New',
  /** Why the TopBar's New is off: a meeting goes on a booking page that is on. */
  /** New's name when booking pages exist but none is on: it opens them. */
  turnOnPageFirst: 'Turn on a booking page to book someone in',
  /** New's name with no booking page yet: it makes one first. */
  newPageFirst: 'New booking page, to book someone in',
  /** What the TopBar's count counts, for screen readers: "4 upcoming bookings". */
  with: 'With',
  theirName: 'Their name',
  /** With, when it searches People as you type. */
  withPlaceholder: 'Their name, or someone in People',
  /** The rows under With, for screen readers. */
  fromPeople: 'People',
  noPeopleMatch: 'No one in People matches',
  email: 'Email',
  emailPlaceholder: 'them@example.com',
  theirTimeZone: 'Their time zone',
  about: 'Booking page',
  /** Booking page's InfoTip in New meeting. */
  aboutHelp:
    'The meeting takes this page’s title and place, and counts toward its daily limit. The page’s hours, notice and buffers don’t apply.',
  aboutExample: 'Pick Demo to book Ana in, and the meeting is called Demo with Ana.',
  length: 'Length',
  alsoInvite: 'Also invite',
  guestsFull: (max: number) => `Up to ${String(max)} guests.`,
  /** New meeting's Calendar, with two or more calendars that take events: where its event goes. */
  calendarChoice: 'Calendar',
  message: 'Message',
  messagePlaceholder: 'Grabbing the hour we talked about.',
  cancel: 'Cancel',
  bookIt: 'Book it',
  booking: 'Booking',
  whoWith: 'Enter their name.',
  whatEmail: 'Enter their email, so the invitation reaches them.',
  bookFailed: 'That booking couldn’t be made. Try again.',
  booked: (name: string) => `Booked with ${name}. The invitation is on its way from your calendar.`,
  bookedQuietly: (name: string) => `Booked with ${name}.`,
  /** How long that notice stays: two sentences and something to fix, longer than a confirmation's 5 seconds. */
  notInCrmToastMs: 12_000,
  /** Booked, but the guest's records couldn't be made: the reason, so it can be fixed (late trap #71). */
  bookedNotInCrm: (name: string, reason: string) => `Booked with ${name}, but they weren’t added to the CRM. ${reason}`,
  /** New meeting without a calendar: the guest is still emailed, with the invitation attached (Q57). What's missing
   * is the event on the member's own calendar, and a video call's link. */
  noCalendar:
    'They’re still emailed an invitation. With no calendar connected, it won’t go on your calendar and a video call gets no link.',
  holdThisTime: 'Reserve for link only pages',
  holdFor: 'For',
  anyPrivatePage: 'Any link only page',
  noPrivatePages: 'Time only your link only pages can book. You have none yet.',
  createLinkOnly: 'Create a link only page',
  reservedTime: 'Reserved time',
  holdIt: 'Reserve it',
  holding: 'Reserving',
  holdFailed: 'That time couldn’t be reserved. Try again.',
  timeHeld: 'Reserved. Only your link only pages can book it.',
  undo: 'Undo',
  // The host's changes to a booking (spec 0025, AC-640).
  changeBooking: 'Change this booking',
  reschedule: 'Reschedule',
  copyGuestLink: 'Copy guest link',
  guestLinkCopied: 'Guest link copied. It opens their booking, so share it only with them.',
  cancelBooking: 'Cancel booking',
  /** The booking card's overflow menu. */
  moreForBooking: 'More for this booking',
  // Linking a booking to a record by hand (polish F2).
  linkRecord: 'Link to a record',
  changeLinkedRecord: 'Change linked record',
  /** Unlink is the one verb for taking a link off: More's item, the row's ×, and the toast. */
  unlinkRecord: 'Unlink record',
  /** Names the booking, as Reschedule's title does: "Link Quick chat with Ada Lovelace to a record". */
  linkTitle: (title: string, name: string) => `Link ${title} with ${name} to a record`,
  linkedRecordField: 'Record',
  linkIt: 'Link',
  linking: 'Linking',
  linkedTo: 'Linked to',
  /** A record with no name (its name hidden, or not read yet) is left out: never "Linked to Record.". */
  linkedToast: (name: string) => (name === '' ? 'Linked.' : `Linked to ${name}.`),
  unlink: (name: string) => (name === '' ? 'Unlink record' : `Unlink ${name}`),
  unlinkedToast: (name: string) => (name === '' ? 'Unlinked.' : `Unlinked from ${name}.`),
  linkFailed: 'That link didn’t go through. Try again.',
  unlinkFailed: 'Couldn’t unlink it. Try again.',
  searchFailed: 'The search didn’t answer. Type again to try again.',
  rescheduleTitle: (title: string, name: string) => `Reschedule ${title} with ${name}`,
  tryAgain: 'Try again',
  copyFailed: 'Couldn’t copy the link. Try again.',
  timesIn: (zone: string) => `Times in ${zone}`,
  keepTime: 'Keep this time',
  pickTime: 'Pick a new time',
  moving: 'Moving',
  moveTo: (time: string, day: string) => `Move to ${time} on ${day}`,
  findingTimes: 'Finding free times…',
  noMoveTimes: 'No free times on this page in the next two weeks. Free some up on Availability, or cancel instead.',
  slotName: (time: string, day: string, minutes: number) => `${time}, ${day}, ${String(minutes)} minutes`,
  timeGone: 'That time has just gone. Pick another.',
  changeFailed: 'That didn’t go through. Try again in a moment.',
  /** Names the booking, as Reschedule's title does: "Cancel Quick chat with Ada Lovelace?" */
  cancelTitle: (title: string, name: string) => `Cancel ${title} with ${name}?`,
  cancelText: (name: string) => `${name} will be emailed and it comes off your calendar. This can’t be undone.`,
  reason: 'Reason',
  reasonHint: (name: string) => `Optional. ${name} sees it in their email.`,
  /** Cancel's dismiss: it can't be called Cancel too. */
  keepBooking: 'Keep booking',
  confirmCancel: 'Cancel booking',
  cancelling: 'Cancelling',
  movedToast: (name: string) => `Moved. ${name} is emailed the new time.`,
  cancelledToast: (name: string) => `Cancelled. ${name} is emailed.`,
  /** The detail's line for why a round robin booking went to its host (spec 0029, AC-742). */
  assignedTerm: 'Assigned',
  /** Reassigning a round robin seat (spec 0029, AC-748). */
  needsHost: 'Needs a host',
  // A no show (spec 0043, AC-1613).
  noShow: 'No show',
  markNoShow: 'Mark as no show',
  undoNoShow: 'Undo no show',
  markedNoShow: 'Marked as a no show',
  unmarkedNoShow: 'No show removed',
  needsHostText: 'Its host left the workspace and nobody else was free then. Reassign it, or cancel it.',
  reassignAction: 'Reassign',
  reassignTitle: (page: string, visitor: string) => `Reassign ${page} with ${visitor}`,
  seat: 'Round robin group',
  newHost: 'New host',
  nowWith: (member: string, rotation: string) =>
    `With ${member} in ${rotation} today. The new host, the guest and ${member} are emailed.`,
  nextInRotation: 'Next in the group',
  nextInRotationHint: 'Whoever is free then and next by the group’s rules',
  keepHost: 'Keep host',
  reassignNamesFailed: 'Couldn’t load the group’s members, so only Next in the group is offered.',
  reassign: 'Reassign',
  reassigning: 'Reassigning',
  reassigned: 'Reassigned. The guest and both hosts are emailed.',
  assignedIn: (rotation: string) => `Assigned in ${rotation}`,
  assignedLine: (member: string, why: string) => `${member} ${why}`,
  noLongerCounts: (line: string) => `${line} (no longer counts)`,
  assignedFailed: 'Couldn’t load why this booking went to its host.',
  assignedWhy: {
    fair: (count: string, days: string, weight: string) =>
      `had the fewest meetings in the last ${days} days: ${count}, at weight ${weight}`,
    fairPlain: 'had the fewest meetings lately',
    priority: 'was the first free by priority',
    even: 'was next in turn for an even share',
    owner: 'owns this person’s record',
    last_host: 'hosted this person last time',
    standin: 'stood in for the usual host',
    only_free: 'was the only one free then',
    routed: 'was chosen by the routing form',
    manual: 'was picked by hand',
    reassigned: 'was reassigned by hand',
    adjustment: 'had their count adjusted by hand',
  },
} as const;
