// Booking pages' copy for members (spec 0025, 0025-experience.md).

/** A name's first word ("Bea" from "Bea Rao"), or the whole name when it has none. */
const firstOf = (name: string) => {
  const [first = ''] = name.trim().split(/\s+/);
  return first === '' ? name : first;
};

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
  /** A workspace link's kind on its card, in place of Round robin. */
  workspaceLink: 'Workspace link',
  /** The Links header's Team links menu (the bookings area, 4 November 2026): links that aren't page types. */
  teamLinks: 'Team links',
  workspaceLinkLine: 'Books whoever in the workspace is free.',
  copyWorkspaceLink: 'Copy workspace link',
  editWorkspaceLink: 'Edit workspace link',
  editWorkspaceLinkLine: 'Its hours, hosts and limits.',
  workspaceLinkCopied: 'Workspace link copied.',
  copyFailed: 'Couldn’t copy the link. Try again.',
  teamLink: 'Team link',
  teamLinkLine: 'Asks what they need, then books the right team',
  editHoursAndHosts: 'Edit hours and hosts',
  teamsSection: 'Teams',
  /** Bookings › Pages' actions at the TopBar's end, as a group. */
  pagesActions: 'Pages actions',
  manageTeams: 'Manage teams',
  addTeamLink: 'New team link',
  /** A workspace link a member may copy and open, not change. */
  viewOnly: 'View only',
  /** Captures › Links' groups, when the workspace has a link of its own. */
  workspaceGroup: 'Workspace',
  workspaceGroupLine: 'Links that book whoever on the team is free, in turn',
  /** The header's status, and the notice above the tabs, for a live page guests can't book. */
  statusCantBook: 'Live · can’t be booked',
  cantBookTitle: 'Guests can’t book this page',
  openRoundRobin: 'Open Round robin',
  nobodyOn: 'Nobody is switched on. Add a host, or switch someone on in Round robin.',
  noTimesAhead: 'No open times in the next two months. Check its booking window and your hosts’ hours.',
  noTimesAheadOwn: 'No open times in the next two months. Check its booking window and its hours.',
  /** On a list card: the same words as the editor's status. */
  cantBookShort: 'Can’t be booked',
  membersGroup: 'Members’ pages',
  /** The reader's own pages, once the list holds someone else's too (spec 0037, AC-1273). */
  yourGroup: 'Your pages',
  searchPages: 'Search booking pages',
  copying: 'Copying',
  duplicated: (title: string) => `Made “${title}”.`,
  turnOffFailed: (title: string) => `Couldn’t turn off ${title}. It’s back on.`,
  turnOnFailed: (title: string) => `Couldn’t turn on ${title}. It’s off again.`,
  duplicateFailed: (title: string) => `Couldn’t duplicate ${title}.`,
  notYours: 'Only its owner or a workspace admin can change it',
  deleted: (title: string) => `Deleted “${title}”.`,
  deleteFailed: (title: string) => `Couldn’t delete ${title}. It’s back.`,
  /** The ⋯ button's tooltip on a card. */
  moreTip: 'More',
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
  /** A page's card in Bookings › Pages (the mock of 9 November 2026): its facts, who it books with, its status menu. */
  pageCard: {
    video: 'Video call',
    place: { phone: 'Phone call', address: 'In person', custom: 'Custom place' },
    kind: { personal: 'One-on-one', collective: 'Team, all together', round_robin: 'Team, taking turns' },
    hosts: (count: number) => `${String(count)} hosts`,
    everyone: (count: number) => `Everyone, ${String(count)} ${count === 1 ? 'person' : 'people'}`,
    /** The Live or Hidden menu: its name on the trigger, then each choice with what it means. */
    statusName: (title: string, status: string) => `${status}, status of ${title}`,
    statusMenu: (title: string) => `${title} status`,
    live: 'Live',
    liveLine: 'Anyone with the link can book',
    hidden: 'Hidden',
    hiddenLine: 'Guests can’t book',
    madeLive: (title: string) => `${title} is live`,
    madeHidden: (title: string) => `${title} is hidden`,
    viewLive: 'View live page',
    embed: 'Embed',
    newPage: 'New page',
  },
  emptyTitle: 'No booking pages yet',
  failedTitle: 'Booking pages didn’t load',
  failedText: 'Check your connection and try again.',
  deleteTitle: (title: string) => `Delete “${title}”?`,
  /** Someone else's page (spec 0037, AC-1273): whose it is, said in the confirm. */
  deleteTitleFor: (owner: string, title: string) => `Delete ${firstOf(owner)}’s “${title}”?`,
  deleteText: 'Its link stops working. Bookings already made stay.',
  deleteAction: 'Delete booking page',
  deletePage: 'Delete booking page',
  deleting: 'Deleting',
  cancel: 'Cancel',
  somethingWrong: 'Something went wrong. Try again.',
  // New booking page.
  addPage: 'New booking page',
  addWorkspaceLink: 'New workspace link',
  /** The page's type (the bookings area, 4 November 2026): a mark, a name and one plain line each. */
  typeLabel: 'Type',
  typeMe: 'Just me',
  typeMeLine: 'Guests book time with you.',
  typeRoundRobin: 'Round robin',
  typeRoundRobinLine: 'Whoever on the team is free.',
  moreTypes: 'More types',
  typeManagedLine: 'You set it up once; each person gets their own copy.',
  needsTeammates: 'Round robin shares meetings between 2 or more people.',
  inviteTeammates: 'Invite teammates',
  peopleFailed: 'We couldn’t read your teammates.',
  retryPeople: 'Try again',
  peopleLine: 'Someone invited shows here once they join.',
  title: 'Title',
  titlePlaceholder: 'Quick chat',
  titleRequired: 'Give the page a title.',
  whereRequired: 'Say where the meeting happens.',
  duration: 'Duration',
  durationRequired: 'Pick at least one length.',
  durationCustom: 'Custom',
  customMinutes: 'Minutes',
  customMinutesHint: '5 to 480, in steps of 5.',
  customMinutesInvalid: 'Type 5 to 480 minutes, in steps of 5.',
  addLength: 'Add a length',
  /** The editor's tabs (22 Oct 2026): one per group, the chosen one in `?tab=`. */
  tabsLabel: 'Booking page settings',
  /** Hours and Limits as one tab, and the ways to hand the page out as another (the bookings area, 4 November 2026). */
  /** The editor's rows (critic A8, 4 Nov 2026): each row's help, in its tip. */
  linkSection: 'Link',
  addressHelp: 'Guests book at this address. Changing it goes live when saved.',
  bAddressHelp: 'Only people you send this link to can book it.',
  handleRow: 'Short address',
  setHandleShort: 'Set your handle',
  shareLinkSection: 'Share the link',
  notPublished: 'Not published yet',
  publishToShare: 'Publish the page to get its link.',
  durationsHelp: 'Guests pick one. Up to four.',
  addToCrmHelp: 'Each guest is found or added in the CRM.',
  opensInHelp: 'The view guests see first. They can switch.',
  /** The Questions tab's locked rows (critic A7): what every guest is asked first. */
  fixedName: 'Your name',
  fixedEmail: 'Your email',
  fixedNotes: 'Anything else the host should know',
  availabilityTab: 'Availability',
  /** The look of the page in a tab of its own (T21): how it opens, and the brand it wears. */
  appearanceTab: 'Appearance',
  layoutSection: 'Layout',
  /** The editor (the owner's mock of 9 November 2026): its sections' list, grouped, and its header. */
  sectionsLabel: 'Page sections',
  sectionGroups: { meeting: 'Meeting', guests: 'Guests', page: 'Page', activity: 'Activity' },
  hoursAndLimits: 'Hours and limits',
  afterBookingTab: 'After booking',
  lookTab: 'Look',
  bookingsCrumb: 'Bookings',
  pagesCrumb: 'Pages',
  lengths: 'Lengths',
  lengthsAside: 'guests pick one',
  previewTip: 'Preview your page',
  saveChanges: 'Save changes',
  noChangesYet: 'No changes yet',
  changesSaved: 'Changes saved',
  changesSavedHidden: 'Changes saved. The page is still hidden.',
  makeLive: 'Make live',
  changesDiscarded: 'Changes discarded',
  notSaved: 'Not saved',
  discardChanges: 'Discard changes',
  versionHistory: 'Version history',
  versionRestored: (version: number) => `Version ${String(version)} is back. Save changes to put it live.`,
  goTo: (section: string) => `Go to ${section}`,
  leaveTitle: (title: string) => `Save changes to ${title} before leaving?`,
  leaveText: 'You have edits that aren’t saved yet. Discard drops them; Save makes them live for guests.',
  leaveTextHidden:
    'You have edits that aren’t saved yet. Discard drops them; Save keeps them, and the page stays hidden.',

  /** Look's theme (the mock of 9 November 2026): Classic or Night, the workspace's own. */
  themeSection: 'Theme',
  themeLine: 'Logo and colour come from your brand. Every booking page, form and link page wears it.',
  themeOther: (name: string) =>
    `Your brand uses ${name}, which booking pages show as Classic. Pick one here to change it for every page.`,
  themeAdminsOnly: 'Owners and admins change it',
  themeSaved: (name: string) => `Every page now wears ${name}.`,
  shareTab: 'Share',
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
  workspaceLinkSharing: 'Books whoever on the team is free.',
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
  /** The three views, each named as the page's own switch names it. */
  opensInViews: { month: 'Month', list: 'List', chat: 'Book by chat' },
  meeting: 'Meeting',
  /** The Meeting tab's switch (spec 0057, AC-5708; moved there 27 Oct 2026), in a form's words. */
  afterBooking: 'After someone books',
  addToCrm: 'Add bookers to People',
  /** Spec 0062, L1: what a visitor sees once they book, and whether the host confirms each booking first. */
  confirmFirst: 'Confirm each booking first',
  confirmFirstHint: 'Unanswered requests decline after a day.',
  thenShow: 'Then show',
  afterChoices: { confirmation: 'Confirmation', redirect: 'Your site' },
  redirectUrl: 'Send them to',
  redirectPlaceholder: 'https://acme.com/thanks',
  redirectRequired: 'Give the address to send them to.',
  redirectInvalid: 'Use an address that starts with https://',
  sendDetails: 'Add their booking to the address',
  sendDetailsHint: 'Name, email, start, time zone and page.',
  /** The one off links card (AC-6204). */
  oneOffLinks: 'One-time links',
  oneOffLinksLine: 'Each books this page a set number of times, then stops.',
  newLink: 'New link',
  linkLabel: 'Label',
  linkLabelPlaceholder: 'For Grace',
  linkUses: 'Bookings',
  linkExpires: 'Expires',
  linkNever: 'Never',
  makeLink: 'Make link',
  linkMade: 'Copy it now. It won’t be shown again.',
  done: 'Done',
  linkUsesLeft: (left: number, max: number) => `${String(left)} of ${String(max)} left`,
  linkStates: { used: 'Used', expired: 'Expired', revoked: 'Revoked' },
  linkUntitled: 'Untitled link',
  revoke: 'Revoke',
  revokeTitle: 'Revoke this link?',
  revokeBody: 'Nobody can book with it after this.',
  noLinks: 'No links yet.',
  linksFailed: 'Links didn’t load.',
  linkFailed: 'That didn’t work. Try again.',
  /** The requests card (AC-6203). */
  requests: 'Requests',
  requestsFailed: 'Requests didn’t load.',
  confirm: 'Confirm',
  decline: 'Decline',
  declineTitle: 'Decline this request?',
  declineReason: 'Reason (optional)',
  declineReasonHint: 'Sent to them by email.',
  answerBy: (when: string) => `Expires ${when}`,
  /** A one-time links only page (AC-6204). */
  linksOnly: 'Book only through these links',
  linksOnlyHint: 'The page’s own address says it books by invitation.',
  targetsFailedTitle: 'Where answers go didn’t load',
  targetsFailed: 'The object’s fields couldn’t be read, so questions can’t be filed onto them right now.',
  /** The Questions tab's object picker (booking answers parity, 27 Oct 2026), in the forms editor's words. */
  answersObject: 'Where the answers go',
  answersObjectMoved: (objectName: string) =>
    `Answers now go to ${objectName}. Choose a field for each question again.`,
  answersObjectFailed: 'That object couldn’t be used for the answers.',
  /** Under an object a booking can't file onto, in the list. */
  answersObjectNoEmail: 'Needs a unique email field',
  /** The rule under the object picker, while some object breaks it: said where the keyboard and a reader reach it too. */
  answersObjectRule: 'Only objects with a unique email field can take booking answers.',
  /** The object chosen can no longer take answers: its unique email field was archived or made not unique since. */
  answersObjectBrokenTitle: (pluralName: string) => `Bookings can’t find the visitor in ${pluralName}`,
  answersObjectBroken: 'No unique email field.',
  answersObjectBrokenAsk: 'No unique email field. Ask an admin to add one.',
  answersObjectAddField: 'Add an email field',
  tryAgain: 'Try again',
  /** Book by chat asks the page's questions too (4 Nov 2026): required ones in turn, optional ones as a choice. */
  chatAsks: 'Book by chat asks these too: required ones in turn, optional ones if the visitor taps them.',
  durations: 'Durations',
  location: 'Location',
  locations: {
    video: 'Video',
    address: 'In person',
    phone: 'Phone',
    custom: 'Somewhere else',
    /** Video with no link made: the host sends it (critic B-07), the default while no calendar makes one. */
    sendLink: 'I’ll send a link',
  },
  /** Video's own link, asked for while no calendar makes one (critic B-07). */
  meetingLink: 'Meeting link',
  meetingLinkHelp: 'Guests get it in their confirmation, never on the page.',
  meetingLinkPlaceholder: 'https://zoom.us/j/…',
  meetingLinkRequired: 'Paste the meeting link, or pick I’ll send a link.',
  meetingLinkInvalid: 'Give the meeting link, starting https://.',
  /** The same, when their calendar's account has expired and needs reconnecting in Settings › Calendars. */
  noVideoLinkReconnect: 'No video link: reconnect your calendar.',
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
  readOnlyText: 'Only its owner or a workspace admin can change it.',
  timeZone: 'Time zone',
  timeZoneText: 'These hours follow this zone.',
  weeklyHours: 'Weekly hours',
  limits: 'Limits',
  buffersSummary: (before: number, after: number) =>
    before === after ? `${String(before)} min buffers` : `${String(before)} min before, ${String(after)} min after`,
  aheadSummary: (days: number) => `up to ${days === 1 ? '1 day' : `${String(days)} days`} ahead`,
  stepSummary: (minutes: number) => `starts every ${String(minutes)} min`,
  /** Who can book (the owner, 22 Oct 2026): Public or Link only, in the same words everywhere. */
  whoCanBook: 'Who can book',
  /** The Hours tab (22 Oct 2026): every label above its content, as the Schedule select's. */
  to: 'to',
  unavailable: 'Unavailable',
  edit: 'Edit',
  manage: 'Manage',
  checksConflictsIn: 'Checks for conflicts in',
  noCalendars: 'No calendars connected',
  /** Calendar sync isn't on for this deployment (the Calendars tab's "off" state): nothing to connect. */
  calendarSyncOff: 'Calendar sync isn’t available here',
  noneChecked: 'None, so this page can double book.',
  reservedTime: 'Reserved time',
  /** Reserved time's Manage link, named in full: "Manage" alone says nothing out of its card. */
  manageReservedTime: 'Manage reserved time',
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
  limitGroups: { buffers: 'Buffers', window: 'Booking window', pace: 'Pace', changes: 'Changes by guests' },
  cancelCutoff: 'Cancel up to',
  moveCutoff: 'Move up to',
  limitHelp: {
    before: {
      text: 'Free time before each meeting.',
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
      // The page's own cap; the person's cap across every page lives in Availability › Meeting limits, and the lower
      // one wins (the simplicity sweep's finding 6).
      text: 'Meetings from this page in one day. Your limit across all pages is in Availability, and the lower one wins.',
      example: 'With 3, a day with three meetings from this page is full.',
    },
    cancelCutoff: {
      text: 'How close to the meeting a guest can still cancel it. You can always cancel it.',
      example: 'With 24 hours, a guest can’t cancel a 10:00 AM meeting after 10:00 AM the day before.',
    },
    moveCutoff: {
      text: 'How close to the meeting a guest can still move it. You can always move it.',
      example: 'With 4 hours, a guest can’t move a 2:00 PM meeting after 10:00 AM.',
    },
    step: {
      text: 'How often a start time is offered. Meeting length starts one right after another.',
      example: 'On Meeting length, a 30 minute meeting offers 9:00, 9:30 and 10:00 AM.',
    },
  },
  /** Under Who can book, for Link only: what it does that Public doesn't. */
  linkOnlyHint: 'Not on your profile. It can also book your reserved time.',
  /** Under Who can book, while a public page is being switched to Link only: the old address stops working. */
  linkOnlyChanging: 'Old address stops working on save.',
  bufferBefore: 'Buffer before',
  bufferAfter: 'Buffer after',
  notice: 'Minimum notice',
  window: 'How far ahead',
  dailyLimit: 'Meetings a day from this page',
  noLimit: 'No limit',
  step: 'Start times every',
  stepDuration: 'Meeting length',
  none: 'None',
  /** A cancel or move cutoff of 0 (critic B-15): guests may change a booking any time before it starts. */
  anyTime: 'Any time',
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
  /** The same, on a page whose owner is named (spec 0037, AC-1273). */
  defaultOf: (owner: string) => `${firstOf(owner)}’s default`,
  pickOf: (owner: string) => `${firstOf(owner)}’s pick`,
  /**
   * The page's pick stopped taking bookings (or went): the page uses the owner's default, named when they have one,
   * until the pick can again or they choose another.
   */
  destinationFellBack: (name: string | undefined, fallback: string | undefined) => {
    const stopped =
      name === undefined ? 'Your calendar stopped taking bookings' : `Your calendar ${name} stopped taking bookings`;
    return fallback === undefined
      ? `${stopped}. Pick another.`
      : `${stopped}, so this page uses your default calendar ${fallback}.`;
  },
  destinationUnusableColleague: 'The owner’s pick can’t take bookings now, so they go on the owner’s default.',
  destinationFailed: 'Couldn’t load calendars. Reload the page to try again.',
  destinationOwnerOnly: 'Only the page’s owner sees their calendars.',
  /** Where someone else's page's events go, read only (spec 0037, AC-1273): only its owner chooses. */
  setBy: (name: string) => `Set by ${firstOf(name)}`,
  /** The editor's header on someone else's page (spec 0037, AC-1273). */
  editingFor: (name: string) => `${firstOf(name)}’s page`,
  destinationLoading: 'Loading calendars',
  connectCalendar: 'Connect calendar',
  statusLive: 'Live',
  statusOff: 'Paused',
  noCalendar: 'Other meetings don’t block times until you connect one.',
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
  /** A day off with no note, in Availability's Time off card: what the row is, beside time off's reasons. */
  dayOff: 'Day off',
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
