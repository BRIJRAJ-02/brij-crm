// The command menu's words (spec 0039), in plain words with no dash as punctuation.
export const strings = {
  /** The dialog's name, by how it opened (AC-1097). */
  commandMenu: 'Command menu',
  search: 'Search',
  /** The field's name and hint. */
  searchLabel: 'Search records, notes, tasks, pages and actions',
  searchOnlyLabel: 'Search records, notes, tasks and pages',
  placeholder: 'Type a command or search…',
  searchPlaceholder: 'Search records, notes and tasks…',
  /** Section headings (AC-1075, decision 6). */
  recent: 'Recent',
  records: 'Records',
  views: 'Views',
  notes: 'Notes',
  tasks: 'Tasks',
  /** A note row's kind, and an untitled one's name. */
  note: 'Note',
  untitledNote: 'Untitled note',
  task: 'Task',
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
  calendars: 'Calendars',
  roundRobin: 'Round robin',
  forms: 'Forms',
  /** The charts page (the reports lane), which has no sidebar item: Home and this menu reach it. */
  reports: 'Reports',
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
  reportsTerms: ['charts', 'forecast', 'pipeline', 'analytics', 'graph', 'dashboard'],
  trashTerms: ['deleted', 'bin', 'restore', 'go to trash'],
  settingsTerms: ['preferences', 'options'],
  preferencesTerms: ['theme', 'appearance', 'dark', 'light'],
  calendarsTerms: ['google', 'outlook', 'sync', 'connect'],
  roundRobinTerms: ['rotation', 'rotations', 'team', 'share out', 'distribution'],
  objectsTerms: ['attributes', 'fields', 'columns', 'schema'],
  jobsTerms: ['background', 'imports', 'exports', 'progress'],
  /** Account › Sign in and devices answers to what people call it elsewhere (it was Security). */
  signInTerms: ['security', 'password', 'two factor', 'sessions', 'devices', 'sign out'],
  /** Actions (AC-1086, AC-1087). */
  create: (singular: string) => `Create a ${singular.toLocaleLowerCase()}`,
  /** Nothing matched: make it, with what was typed as its name. */
  createNamed: (singular: string, name: string) => `Create ${singular.toLocaleLowerCase()} named “${name}”`,
  /** Anywhere: a new task, on the page when it can hold the dialog, else on Tasks. */
  createTask: 'Create a task',
  newWord: 'new',
  /** The record page's own actions, named after it. */
  newNoteOn: (name: string) => `New note on ${name}`,
  newTaskOn: (name: string) => `New task on ${name}`,
  noteTerms: ['note', 'write', 'add', 'create'],
  taskTerms: ['task', 'todo', 'to do', 'follow up', 'add', 'create'],
  addWord: 'add',
  useTheme: { light: 'Use light theme', dark: 'Use dark theme', system: 'Use system theme' },
  themeTerms: ['theme', 'appearance', 'mode'],
  /** The page's own actions: on an object's page, and on one of its views. */
  importPlural: (plural: string) => `Import ${plural.toLocaleLowerCase()}`,
  importTerms: ['csv', 'upload', 'spreadsheet'],
  exportView: 'Export this view',
  exportTerms: ['csv', 'download', 'spreadsheet'],
  createView: 'Create a view',
  invite: 'Invite members',
  inviteTerms: ['team', 'people', 'add members', 'teammates'],
  /** The three theme actions as one choice, for screen readers (Q47). */
  theme: 'Theme',
  themeOn: { light: 'Light theme on', dark: 'Dark theme on', system: 'Theme follows your system' },
} as const;
