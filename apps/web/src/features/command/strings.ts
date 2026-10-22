// The command menu's words (spec 0039), in plain words with no dash as punctuation.
export const strings = {
  /** The dialog's name, by how it opened (AC-1097). */
  commandMenu: 'Command menu',
  search: 'Search',
  /** The field's name and hint. */
  searchLabel: 'Search records, views, pages and actions',
  searchOnlyLabel: 'Search records, views and pages',
  placeholder: 'Type a command or search…',
  searchPlaceholder: 'Search records, views and pages…',
  /** Section headings (AC-1075, decision 6). */
  recent: 'Recent',
  records: 'Records',
  views: 'Views',
  pages: 'Pages',
  goTo: 'Go to',
  settingsSection: 'Settings',
  actions: 'Actions',
  /** Pages. */
  home: 'Home',
  myTasks: 'Tasks',
  bookings: 'Bookings',
  availability: 'Availability',
  bookingPages: 'Booking pages',
  forms: 'Forms',
  /** The trash, a quick action now it left the sidebar (the owner, 22 October 2026). */
  trash: 'Open trash',
  settings: 'Settings',
  settingsPage: (page: string) => `Settings › ${page}`,
  /** Other words each page answers to (AC-1082). */
  tasksTerms: ['todo', 'to do', 'assigned'],
  bookingsTerms: ['calendar', 'meetings', 'schedule'],
  homeTerms: ['dashboard', 'today', 'start'],
  availabilityTerms: ['hours', 'schedules', 'working hours'],
  bookingPagesTerms: ['links', 'scheduling links', 'captures'],
  formsTerms: ['enquiries', 'submissions', 'captures'],
  trashTerms: ['deleted', 'bin', 'restore'],
  settingsTerms: ['preferences', 'options'],
  preferencesTerms: ['theme', 'appearance', 'dark', 'light'],
  calendarsTerms: ['google', 'outlook', 'sync', 'connect'],
  objectsTerms: ['attributes', 'fields', 'columns', 'schema'],
  jobsTerms: ['background', 'imports', 'exports', 'progress'],
  /** Account › Sign in and devices answers to what people call it elsewhere (it was Security). */
  signInTerms: ['security', 'password', 'two factor', 'passkeys', 'sessions', 'devices', 'sign out'],
  /** Actions (AC-1086, AC-1087). */
  create: (singular: string) => `Create a ${singular.toLocaleLowerCase()}`,
  newWord: 'new',
  addWord: 'add',
  useTheme: { light: 'Use light theme', dark: 'Use dark theme', system: 'Use system theme' },
  themeTerms: ['theme', 'appearance', 'mode'],
  /** Create a <object> on an object with only boards, which have no new record dialog. */
  openTableToCreate: (singular: string) => `Open a table view to add a ${singular.toLocaleLowerCase()}`,
  themeOn: { light: 'Light theme on', dark: 'Dark theme on', system: 'Theme follows your system' },
  /** Shortcut list entries (AC-1099). */
  openMenu: 'Open the command menu',
  openSearch: 'Search',
} as const;
