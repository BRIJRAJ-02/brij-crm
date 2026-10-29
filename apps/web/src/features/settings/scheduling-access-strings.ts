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
  overMeDescription: 'They see your hours, time off and bookings. With Manage they can change them and book for you.',
  addSomeone: 'Add someone',
  ownersAndAdmins: 'Workspace owners and admins',
  ownersAndAdminsSource: 'Through their role',
  admins: 'Workspace admins',
  ownersOnly: 'Workspace owners',
  youAdded: 'You added',
  addedBy: (name: string) => `${name} added`,
  addedByAdmin: 'Added by an admin',
  nobodyOverMe: 'Nobody else yet. Add an assistant or a colleague who covers for you.',

  // Whose scheduling you can see or manage.
  mine: 'Whose scheduling you can see or manage',
  mineDescription: 'Beyond your own. Pick them in Availability’s Viewing menu, and in Book someone in and Block time.',
  everyone: 'Everyone',
  everyoneFromRole: (role: string) => `Through your ${role} role`,
  onlyYours: 'Only your own',
  onlyYoursText: 'When someone lets you see or manage their scheduling, they show here.',

  // Levels.
  level: 'Access',
  levelFor: (name: string) => `Access for ${name}`,
  see: 'See',
  manage: 'Manage',
  seeDescription: 'Hours, time off and bookings, read only. Guest emails and answers stay hidden.',
  manageDescription: 'Change hours and time off, block time, and book, move or cancel meetings.',
  remove: 'Remove',
  removeFor: (name: string) => `Remove ${name}’s access`,

  // Add someone.
  addTitle: 'Add someone',
  person: 'Person',
  personPlaceholder: 'Choose a teammate',
  nobodyToAdd: 'Everyone in the workspace can already see your scheduling.',
  add: 'Add',
  cancel: 'Cancel',
  /** A member whose hours are set by others can't pass the right to change them (decision 9, AC-1255). */
  hoursStaySet:
    'They can book and block time for you, but can’t change your hours: those are set by the people who manage your scheduling.',
  added: (name: string, level: 'view' | 'manage') => `${name} can now ${levelWord(level)} your scheduling.`,
  changed: (name: string, level: 'view' | 'manage') => `${name} can ${levelWord(level)} your scheduling now.`,

  // Take access back (AC-1445): the consequence in plain words.
  removeTitle: (name: string) => `Remove ${name}’s access?`,
  removeOverMe: (name: string, level: 'view' | 'manage') =>
    `${name} will no longer be able to ${levelWord(level)} your scheduling.`,
  removeMine: (whose: string, level: 'view' | 'manage') =>
    `You will no longer be able to ${levelWord(level)} ${whose} scheduling.`,
  removeOver: (delegate: string, whose: string, level: 'view' | 'manage') =>
    `${delegate} will no longer be able to ${levelWord(level)} ${whose} scheduling.`,
  giveUpTitle: (whose: string) => `Give up your access to ${whose} scheduling?`,
  removeAction: 'Remove access',
  keep: 'Keep access',
  removed: 'Access removed.',
  everyonesPossessive: 'everyone’s',
  possessive: (name: string) => `${name}’s`,

  // The Members page's column (AC-1267).
  column: 'Scheduling access',
  columnInfo:
    'Whose hours, time off and bookings each person can manage (or only see) beyond their own. Owners and admins manage everyone through their role.',
  cellFor: (name: string) => `Scheduling access for ${name}`,
  everyoneByRole: 'Everyone',
  byRole: 'Through their role',
  roleReach: (role: string) => `As ${role}, they manage everyone’s scheduling.`,
  theirs: 'Only their own',
  andOthers: (count: number) => `and ${String(count)} more`,
  and: ' and ',
  seesToo: (words: string) => `sees ${words}`,
  seesOnly: (words: string) => `Sees ${words}`,
  everyoneLower: 'everyone',
  formerMember: 'Former member',
  sees: 'See',
  manages: 'Manage',
  roleOwnOnly: 'Their role reaches only their own scheduling. Give them more below.',
  addFor: 'Give access to',
  target: 'Whose scheduling',
  targetPlaceholder: 'Choose',
  everyoneOption: 'Everyone',
  everyoneOptionText: 'Every member but owners and admins',
  give: 'Give access',
  given: (delegate: string, level: 'view' | 'manage', whose: string) =>
    `${delegate} can now ${levelWord(level)} ${whose} scheduling.`,
} as const;
