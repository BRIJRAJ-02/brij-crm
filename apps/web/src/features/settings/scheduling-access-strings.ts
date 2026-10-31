// The words of scheduling access (spec 0037, AC-1266 to AC-1268): Settings › Account › Scheduling access, the
// Members page's Scheduling access column, and the confirm before taking access back (AC-1445).

/** A level as a person reads it. */
const levelWord = (level: 'view' | 'manage') => (level === 'manage' ? 'manage' : 'see');

export const strings = {
  /** The page's title, in the settings navigation and its h1. */
  title: 'Scheduling access',
  loadFailed: 'Scheduling access didn’t load.',
  somethingWrong: 'Something went wrong. Try again.',

  // Who can see or manage your scheduling.
  overMe: 'Who can see or manage your scheduling',
  overMeDescription: 'Manage can also change and book for you.',
  addSomeone: 'Add someone',
  ownersAndAdmins: 'Workspace owners and admins',
  ownersAndAdminsSource: 'Through their role',
  youAdded: 'You added',
  theyAdded: 'They added you',
  addedBy: (name: string) => `${name} added`,
  addedByAdmin: 'Added by an admin',
  nobodyOverMe: 'Nobody else yet.',

  // Whose scheduling you can see or manage.
  mine: 'Whose scheduling you can see or manage',
  mineDescription: 'Beyond your own. Pick them in Availability.',
  everyone: 'Everyone',
  everyoneFromRole: (role: string) => `Through your ${role} role`,
  onlyYours: 'Only your own',

  // Levels.
  level: 'Access',
  levelFor: (name: string) => `Access for ${name}`,
  see: 'See',
  manage: 'Manage',
  seeDescription: 'Read only. Guest details stay hidden.',
  manageDescription: 'Change hours, block time, book and cancel.',
  remove: 'Remove',
  removeFor: (name: string) => `Remove ${name}’s access`,

  // Add someone.
  addTitle: 'Add someone',
  person: 'Person',
  personPlaceholder: 'Choose a teammate',
  nobodyToAdd: 'Everyone already has access.',
  add: 'Add',
  cancel: 'Cancel',
  /** A member whose hours are set by others can't pass the right to change them (decision 9, AC-1255): Manage's line says so. */
  manageNoHours: 'Book and block time. Hours stay managed.',
  added: (name: string, level: 'view' | 'manage') => `${name} can now ${levelWord(level)} your scheduling.`,
  changed: (name: string, level: 'view' | 'manage') => `${name} can now ${levelWord(level)} your scheduling.`,

  // Take access back (AC-1445): the consequence in plain words.
  removeTitle: (name: string) => `Remove ${name}’s access?`,
  removeOverMe: (name: string, level: 'view' | 'manage') =>
    `${name} can no longer ${levelWord(level)} your scheduling.`,
  removeMine: (whose: string, level: 'view' | 'manage') => `You can no longer ${levelWord(level)} ${whose} scheduling.`,
  removeOver: (delegate: string, whose: string, level: 'view' | 'manage') =>
    `${delegate} can no longer ${levelWord(level)} ${whose} scheduling.`,
  giveUpTitle: (whose: string) => `Give up your access to ${whose} scheduling?`,
  removeAction: 'Remove access',
  keep: 'Keep access',
  removed: 'Access removed.',
  everyonesPossessive: 'everyone’s',
  possessive: (name: string) => `${name}’s`,
  /** A team's, as English writes it: "Sales’", "Support’s". */
  teamPossessive: (name: string) => (name.endsWith('s') ? `${name}’` : `${name}’s`),
  formerTeam: 'Deleted team',
  formerTeamPossessive: 'a deleted team’s',

  // The Members page's column (AC-1267).
  column: 'Scheduling access',
  cellFor: (name: string) => `Scheduling access for ${name}`,
  everyoneByRole: 'Everyone',
  theirs: 'Only their own',
  andOthers: (count: number) => `and ${String(count)} more`,
  and: ' and ',
  seesToo: (words: string) => `sees ${words}`,
  seesOnly: (words: string) => `Sees ${words}`,
  everyoneLower: 'everyone',
  formerMember: 'Former member',
  roleOwn: 'Reaches only their own.',
  cellFailed: 'Couldn’t load',
  cellFailedFor: (name: string) => `Scheduling access for ${name} didn’t load. Try again`,
  /** The popover's Give access row: whose access it gives, so it never reads as the other way round. */
  letFor: (name: string) => `Let ${name} see or manage`,
  targetPlaceholder: 'Choose',
  everyoneOption: 'Everyone',
  everyoneOptionText: 'Every member but owners and admins',
  /** A team in the Give access picker: its people now; joiners are reached as they join. */
  teamOptionText: (count: number) => `Team · ${String(count)} ${count === 1 ? 'person' : 'people'}`,
  give: 'Give access',
  given: (delegate: string, level: 'view' | 'manage', whose: string) =>
    `${delegate} can now ${levelWord(level)} ${whose} scheduling.`,
} as const;
