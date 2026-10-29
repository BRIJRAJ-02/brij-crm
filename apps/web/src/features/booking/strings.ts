// Booking pages' copy for members (spec 0025, 0025-experience.md).
export const strings = {
  // Captures › Links.
  linksTitle: 'Links',
  captures: 'Captures',
  listLabel: 'Booking pages',
  /** The create button's name; it reads `newButton`, the same word as Forms', so switching tabs moves nothing. */
  newPage: 'New booking page',
  addLinkOnlyPage: 'New link only page',
  newButton: 'New',
  copyLink: 'Copy link',
  more: (title: string) => `More for ${title}`,
  openNewTab: 'Open in a new tab',
  visibility: 'Visibility',
  on: 'On: the link works',
  off: 'Off: the link stops working',
  isOn: (title: string) => `${title} is live`,
  /** The switch's hint on a link's card: what it does now. */
  takingBookings: 'Live',
  notTakingBookings: 'Paused',
  openPage: (title: string) => `Open ${title} in a new tab`,
  /** Open's tooltip on a link card. */
  openInNewTab: 'Open in a new tab',
  /** Beside the Public link field: opens the page in a new tab. */
  openLink: 'Open',
  /** A page's kind, among its facts on its card. */
  kindLabel: { personal: 'One on one', collective: 'Collective', round_robin: 'Round robin' },
  searchPages: 'Search booking pages',
  copying: 'Copying',
  duplicated: (title: string) => `Made “${title}”.`,
  turnOffFailed: (title: string) => `Couldn’t turn off ${title}. It’s back on.`,
  turnOnFailed: (title: string) => `Couldn’t turn on ${title}. It’s off again.`,
  duplicateFailed: (title: string) => `Couldn’t duplicate ${title}.`,
  notYours: 'Only its owner or a workspace admin can change it',
  deleted: (title: string) => `Deleted “${title}”.`,
  duplicate: 'Duplicate',
  hours: 'Hours',
  delete: 'Delete',
  copyOf: (title: string) => `${title} (copy)`,
  minutesShort: (count: number) => `${String(count)} min`,
  /** A page's lengths on its card: "30 min", "30 or 60 min", "15, 30 or 60 min". */
  minutesChoice: (counts: readonly number[]) => {
    const all = counts.map(String);
    const last = all.at(-1);
    if (last === undefined) return '';
    return all.length === 1 ? `${last} min` : `${all.slice(0, -1).join(', ')} or ${last} min`;
  },
  locationChip: { phone: 'Phone', address: 'In person', custom: 'Custom place' },
  emptyTitle: 'No booking pages yet',
  emptyText: 'Make a page, share its link, and people book time inside your hours.',
  failedTitle: 'Booking pages didn’t load',
  failedText: 'Check your connection and try again.',
  deleteTitle: (title: string) => `Delete “${title}”?`,
  deleteText: 'The link stops working, and this can’t be undone. Bookings already made stay.',
  deleteAction: 'Delete booking page',
  deletePage: 'Delete booking page',
  deleting: 'Deleting',
  cancel: 'Cancel',
  somethingWrong: 'Something went wrong. Try again.',
  // New booking page.
  addPage: 'Add a booking page',
  title: 'Title',
  titlePlaceholder: 'Quick chat',
  titleRequired: 'Give the page a title.',
  whereRequired: 'Say where the meeting happens.',
  /** Above a paused page's editor: what visitors see, and how to turn it back on. */
  pausedNote: 'This page is off, so visitors see it closed. Resume it from More actions to take bookings again.',
  duration: 'Duration',
  durationRequired: 'Pick at least one length.',
  durationCustom: 'Custom',
  customMinutes: 'Minutes',
  customMinutesHint: 'Any length from 5 to 480 minutes, in steps of 5.',
  customMinutesInvalid: 'Type 5 to 480 minutes, in steps of 5.',
  addLength: 'Add a length',
  /** The editor's tabs (22 Oct 2026): one per group, the chosen one in `?tab=`. */
  tabsLabel: 'Booking page settings',
  hostsTab: 'Hosts',
  /** Said to screen readers after a tab's name when a field on it holds an error. */
  needsFix: 'needs a fix',
  add: 'Add',
  lengthsFull: 'A page offers at most 4 lengths. Turn one off to add another.',
  minutesUnit: 'min',
  createPage: 'Create page',
  creating: 'Creating',
  // The editor.
  live: 'Live',
  page: 'Page',
  description: 'Description',
  descriptionPlaceholder: 'What the meeting is for, in a line or two',
  /** The Page tab's sections (22 Oct 2026): Details, Sharing, and Profile for a Public page. */
  details: 'Details',
  sharing: 'Sharing',
  profile: 'Profile',
  /** The page's one address row: its full link, the part after the owner's handle editable (22 Oct 2026). */
  address: 'Web address',
  /** Copy and Open, while the address has unsaved changes: the new one works once saved. */
  saveAddressFirst: 'Save to use this address',
  /** The preview's note while the hours or limits have unsaved changes: its times come from the server. */
  previewSavedTimes: 'Shows your saved times until you save.',
  /** With no handle yet, the page keeps its /b/ link and this links to Settings › Profile. */
  setHandle: 'Set your handle to get a short address',
  slugChanging: 'Links with the old address keep working and move to the new one.',
  slugRequired: 'Give the page a web address.',
  slugInvalid: 'Use lowercase letters, numbers and single hyphens.',
  onLinkPage: 'On your link page',
  onLinkPageLine: 'Public pages join your link page. Move, hide or archive them there.',
  linkPage: 'Link page',
  editLinkPage: 'Edit link page',
  /**
   * The Page tab's "Opens in" row (the owner, 25 Oct 2026, looking at their page with Chat open: "default it to
   * this on my meeting page"): the view the page opens in for a visitor who hasn't picked one of their own.
   */
  opensIn: 'Opens in',
  opensInLine: 'Which way to pick a time a visitor sees first. They can switch, and their choice is remembered.',
  /** The three views, each named as the page's own switch names it. */
  opensInViews: { month: 'Month', list: 'List', chat: 'Book by chat' },
  meeting: 'Meeting',
  /** The Meeting tab's switch (spec 0057, AC-5708; moved there 27 Oct 2026), in a form's words. */
  afterBooking: 'After someone books',
  addToCrm: 'Add each booking to the CRM',
  addToCrmLine:
    'Every booking finds or adds the person who booked, and their company, and files their answers on them. Off, the answers stay with the booking.',
  targetsFailedTitle: 'Where answers go didn’t load',
  targetsFailed: 'The object’s fields couldn’t be read, so questions can’t be filed onto them right now.',
  /** The Questions tab's object picker (booking answers parity, 27 Oct 2026), in the forms editor's words. */
  answersObject: 'Where the answers go',
  answersObjectLine: (objectName: string) =>
    `Each answer is filed on the ${objectName} record the person’s email finds or makes. The booking still adds them to People either way.`,
  answersObjectMoved: (objectName: string) =>
    `Answers now go to ${objectName}. Choose a field for each question again.`,
  answersObjectFailed: 'That object couldn’t be used for the answers.',
  /** Under an object a booking can't file onto, in the list. */
  answersObjectNoEmail: 'Needs a unique email field',
  /** The rule under the object picker, while some object breaks it: said where the keyboard and a reader reach it too. */
  answersObjectRule: 'Only objects with a unique email field can take booking answers.',
  /** The object chosen can no longer take answers: its unique email field was archived or made not unique since. */
  answersObjectBrokenTitle: (pluralName: string) => `Bookings can’t find the visitor in ${pluralName}`,
  answersObjectBroken: 'It has no unique email field now, so a booking can’t find or make the visitor’s record.',
  answersObjectBrokenAsk:
    'It has no unique email field now, so a booking can’t find or make the visitor’s record. Ask an admin to add one.',
  answersObjectAddField: 'Add an email field',
  tryAgain: 'Try again',
  /** Book by chat (spec 0042) doesn't ask the page's questions yet (spec 0057 follow up). */
  chatAsksNone: 'Visitors who book by chat skip these questions, since they’re all optional.',
  /** A required question turns Book by chat off: chat can't ask it. */
  chatOffRequired: 'Book by chat is off while a question must be answered: chat can’t ask it.',
  durations: 'Durations',
  location: 'Location',
  locations: { video: 'Video', address: 'In person', phone: 'Phone', custom: 'Somewhere else' },
  /** Under Location's Video when the page's owner has no live calendar, so no video link is made (Q57, Q77). */
  noVideoLink: 'No calendar is connected, so no video link is made. Connect one, or send the link yourself.',
  /** The same, where calendars can't be connected here (calendar sync off). */
  noVideoLinkNoSync: 'No calendar is connected, so no video link is made. Send the link yourself.',
  /** The same, when their calendar's account has expired and needs reconnecting in Settings › Calendars. */
  noVideoLinkReconnect:
    'Your calendar needs reconnecting, so no video link is made. Reconnect it in Settings, or send the link yourself.',
  addressOrRoom: 'Address or room',
  numberToCall: 'Number to call',
  where: 'Where',
  /** The Hours tab's way to Availability, where every schedule is kept. */
  manageSchedules: 'Manage schedules',
  /** Under the Schedule picker when other pages book by the same schedule. */
  sharedSchedule: (name: string, pages: number) =>
    `${String(pages)} pages use ${name}. Changes here apply to all of them.`,
  /** Why the week shows read only when the owner's schedules couldn't be read. */
  hoursUnreadable: 'Couldn’t load the schedules, so these hours show read only. Reload to edit them.',
  /** Why the Schedule picker waits: its hours have changes not saved yet. */
  saveHoursFirst: 'Save or discard the changes to these hours first.',
  followOwnerHint: 'This page books by its owner’s schedule.',
  readOnlyTitle: 'You can view this page',
  readOnlyText: 'Only its owner or a workspace admin can change it.',
  timeZone: 'Time zone',
  timeZoneText: 'These hours follow this zone.',
  weeklyHours: 'Weekly hours',
  limits: 'Limits',
  buffersSummary: (before: number, after: number) =>
    before === after ? `${String(before)} min buffers` : `${String(before)} min before, ${String(after)} min after`,
  aheadSummary: (days: number) => `up to ${days === 1 ? '1 day' : `${String(days)} days`} ahead`,
  stepSummary: (minutes: number) => `starts every ${String(minutes)} min`,
  dailySummary: (count: number) => (count === 1 ? '1 a day' : `${String(count)} a day`),
  /** Who can book (the owner, 22 Oct 2026): Public or Link only, in the same words everywhere. */
  whoCanBook: 'Who can book',
  /** The Hours tab (22 Oct 2026): every label above its content, as the Schedule select's. */
  to: 'to',
  unavailable: 'Unavailable',
  edit: 'Edit',
  manage: 'Manage',
  checksConflictsIn: 'Checks for conflicts in',
  noCalendars: 'No calendars connected',
  noneChecked: 'None, so this page can double book.',
  reservedTime: 'Reserved time',
  /** The Hours and Meeting tabs' sections (22 Oct 2026). */
  calendarSection: 'Calendar',
  reservedTimeLine: 'This page can also book your reserved time: time only your link only pages can book.',
  /** On Minimum notice, while the page is link only. */
  noticeIgnored: 'Link only pages ignore this.',
  statusFailed: (title: string) => `Couldn’t change ${title}. Try again.`,
  publicPage: 'Public',
  linkOnly: 'Link only',
  // A page the system paused when its last host was removed (spec 0031, AC-814).
  hostRemoved: 'Host removed',
  noticeSummary: (notice: string) => `${notice} notice`,
  /** The Limits card's groups, and a word of help on each setting (its InfoTip). */
  limitGroups: { buffers: 'Buffers', window: 'Booking window', pace: 'Pace' },
  limitHelp: {
    before: {
      text: 'Free time kept before each meeting, so a booking can’t start right after another event.',
      example: 'With 15 minutes, after a meeting ending at 10:00 AM the first slot is 10:15 AM.',
    },
    after: {
      text: 'Free time kept after each meeting, to wrap up or get to the next one.',
      example: 'With 10 minutes, a 9:00 to 9:30 AM booking keeps 9:30 to 9:40 AM free.',
    },
    notice: {
      text: 'How much warning you need before a meeting. Times sooner than this are hidden.',
      example: 'With 4 hours, at 1:00 PM the first slot offered is 5:00 PM.',
    },
    ahead: {
      text: 'How many days ahead people can book.',
      example: 'With 60 days, on 1 March the last day offered is 30 April.',
    },
    daily: {
      text: 'The most bookings this page takes in one day. Once reached, the day offers no more slots.',
      example: 'With 3, a day with three bookings is full.',
    },
    step: {
      text: 'How often a start time is offered. Meeting length starts one right after another.',
      example: 'On Meeting length, a 30 minute meeting offers 9:00, 9:30 and 10:00 AM.',
    },
  },
  /** Under Who can book, for Link only: what it does that Public doesn't. */
  linkOnlyHint: 'Not on your profile. It can also book your reserved time.',
  /** InfoTips on the editor's settings that a new member wouldn't read from the label alone. */
  tips: {
    schedule: {
      text: 'The one marked Default follows whichever schedule is your default in Availability, even after you change it.',
      example: 'Pick Evenings and the page offers only your evening hours.',
    },
    bufferBefore: {
      text: 'Time kept free before each meeting, so nobody books right up to its start.',
      example: 'With 15 minutes, a 10:00 AM meeting keeps 9:45 to 10:00 clear.',
    },
    bufferAfter: {
      text: 'Time kept free after each meeting, for notes or a break.',
      example: 'With 10 minutes, nothing can start before 11:10 AM after a meeting that ends at 11:00.',
    },
    notice: {
      text: 'How much warning you need before a meeting. Times sooner than this are hidden.',
      example: 'With 4 hours, a 2:00 PM slot can’t be booked after 10:00 AM that day.',
    },
    window: {
      text: 'How many days ahead people can book. The window moves forward each day.',
      example: 'With 30 days, on 1 March people can book up to about 31 March.',
    },
    dailyLimit: {
      text: 'The most bookings this page takes in one day. Once a day is full, it shows no times. Meetings from your other pages don’t count toward it.',
      example: 'With 3, once three people book Tuesday, Tuesday shows no times.',
    },
    step: {
      text: 'How often a start time is offered. Meeting length starts one right after another.',
      example: 'With 15 minutes, a 30 minute meeting offers 9:00, 9:15, 9:30 and so on.',
    },
  },
  bufferBefore: 'Buffer before',
  bufferAfter: 'Buffer after',
  notice: 'Minimum notice',
  window: 'How far ahead',
  dailyLimit: 'Bookings a day',
  noLimit: 'No limit',
  step: 'Start times every',
  stepDuration: 'Meeting length',
  none: 'None',
  minutes: (count: number) => `${String(count)} minutes`,
  hoursCount: (count: number) => (count === 1 ? '1 hour' : `${String(count)} hours`),
  days: (count: number) => (count === 1 ? '1 day' : `${String(count)} days`),
  fixHours: 'Fix the hours marked in red to save.',
  fixPage: 'Fix what’s marked in red to save.',
  /** The save bar's reason, naming the tabs that hold what's red. */
  fixTabs: (tabs: readonly string[]) => `Fix ${tabs.join(' and ')} to save.`,
  /** Add events to: the page's own destination calendar (spec 0024, AC-997). */
  addBookingsTo: 'Add bookings to',
  addBookingsHint: 'Saves as soon as you choose.',
  myDefaultCalendar: 'Default calendar',
  yourDefault: (name: string) => `Default (${name})`,
  conflicts: 'Conflicts',
  checksCalendars: (count: number) =>
    count === 0
      ? 'Checks no calendars, so this page can double book.'
      : count === 1
        ? 'Checks 1 calendar.'
        : `Checks ${String(count)} calendars.`,
  calendarSettings: 'Change in Calendar settings',
  followsDefault: 'Follows your default in Settings',
  ownersDefault: 'Owner’s default',
  ownersPick: 'A calendar the owner picked',
  /**
   * The page's pick stopped taking bookings (or went): the page uses the owner's default, named when they have one,
   * until the pick can again or they choose another.
   */
  destinationFellBack: (name: string | undefined, fallback: string | undefined) => {
    const stopped =
      name === undefined ? 'Your calendar stopped taking bookings' : `Your calendar ${name} stopped taking bookings`;
    return fallback === undefined
      ? `${stopped}, so new bookings on this page aren’t added to any calendar until you pick one.`
      : `${stopped}, so this page uses your default calendar ${fallback}.`;
  },
  destinationUnusableColleague: 'The owner’s pick can’t take bookings now, so they go on the owner’s default.',
  destinationFailed: 'Couldn’t load calendars. Reload the page to try again.',
  destinationOwnerOnly: 'Only the page’s owner sees their calendars.',
  destinationLoading: 'Loading calendars',
  noCalendarTitle: 'No calendar connected',
  connectCalendar: 'Connect calendar',
  notNow: 'Not now',
  statusLive: 'Live',
  statusOff: 'Paused',
  noCalendar: 'Until calendar sync is on, pages offer your hours minus their bookings, not your other meetings.',
  notFoundTitle: 'This booking page isn’t here',
  notFoundText: 'It was deleted, or it isn’t yours.',
  endBeforeStart: 'End these hours after they start.',
  quarterHour: 'Use times on the quarter hour, such as 9:15 AM.',
  overlap: 'Hours on one day can’t overlap.',
  // Bookings › Availability.
  availability: 'Availability',
  bookings: 'Bookings',
  daysOff: 'Days off',
  daysOffText: 'Days you’re closed, whatever your weekly hours say.',
  /** A day off row's remove button: the day opens again by the weekly hours. */
  removeDayOff: (date: string) => `Remove the day off on ${date}`,
  noDaysOff: 'No days off yet',
  /** Days off while the schedules load, for screen readers. */
  daysOffLoading: 'Loading days off',
  pickDate: 'Pick the day to close.',
  pickLaterDate: 'Pick today or a later day.',
  addDayOff: 'Add day off',
  addDayOffCommit: 'Add',
  dayOffDate: 'Day to close',
  why: 'Note',
  whyHint: 'Only you see it.',
  dayOffColumns: { date: 'Date', why: 'Note', actions: 'Actions' },
  weekday: {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  },
} as const;
