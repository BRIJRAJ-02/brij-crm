// Round robin's copy (spec 0029): Settings › Scheduling › Round robin, the group dialog, and a round robin page's
// Team card. Plain words, no dashes as punctuation. In code these are rotations; on screen, round robin groups (the
// owner, 22 October 2026: "if this is round robin, call it that").

/** Who can be in a group (SS-R1), said in the member picker's hint until the picker can mark who can't. */
const CAN_JOIN = 'Only people with hours or a calendar can join.';

export const strings = {
  title: 'Round robin',
  group: 'Scheduling',
  description: 'Groups of people that team booking pages share meetings across fairly.',
  memberDescription: 'The round robin groups you are in, and your share of their meetings.',
  newRotation: 'New group',
  editRotation: 'Edit group',
  emptyTitle: 'No round robin groups yet',
  emptyText: 'Share meetings across your team: each booking goes to the next free teammate.',
  emptyMemberText: 'You are not in a round robin group yet. An admin adds people to them.',
  /** With the reader alone in the workspace. */
  emptyAloneTitle: 'Round robin needs teammates',
  emptyAloneText: 'Invite people to the workspace, then make a group to share meetings across them.',
  inviteTeammates: 'Invite teammates',
  /** The help beside the title. */
  helpLabel: 'How round robin works',
  helpSteps: [
    'Make a group of teammates.',
    'On a booking page, set Who it books to this group.',
    'Each booking goes to a free teammate, shared fairly.',
  ],
  createPage: 'Create a booking page',
  failedTitle: 'Round robin didn’t load',
  failedText: 'Check your connection and try again.',
  summary: (strategy: 'fair' | 'priority' | 'even', days: number, pages: number) =>
    [
      strategy === 'fair' ? 'Fair' : strategy === 'priority' ? 'Priority' : 'Even',
      `last ${String(days)} days`,
      pages === 0 ? 'not on a booking page yet' : pages === 1 ? '1 booking page' : `${String(pages)} booking pages`,
    ].join(' · '),
  members: (name: string) => `Members of ${name}`,
  columns: {
    member: 'Member',
    share: 'Share',
    weight: 'Weight',
    priority: 'Priority',
    cap: 'Meetings a day',
    weekly: 'Meetings a week',
    on: 'On',
    remove: 'Remove',
  },
  shareOf: (count: number) => (count === 1 ? '1 meeting' : `${String(Math.round(count))} meetings`),
  hidden: 'Only admins see this',
  priorities: ['Lowest', 'Low', 'Medium', 'High', 'Highest'] as const,
  noCap: 'No limit',
  /** The caps' columns' help: which count it is, beside the member's own meeting limits (Availability). */
  capInfo: 'The most meetings this group gives them a day. Their own meeting limits still apply.',
  weeklyInfo: 'The most meetings this group gives them a week. Their own meeting limits still apply.',
  isOn: 'On',
  isOff: 'Off',
  edit: 'Edit',
  delete: 'Delete',
  rowActions: (name: string) => `More for ${name}`,
  // The dialog.
  name: 'Name',
  namePlaceholder: 'Sales team',
  nameRequired: 'Give the group a name.',
  strategy: 'How it picks',
  fair: 'Fair: fewest meetings for their weight',
  fairCard: 'Fair',
  fairLine: 'The free person with the fewest meetings for their weight.',
  priorityCard: 'Priority',
  priorityLine: 'The free person with the highest priority first.',
  evenCard: 'Even',
  evenLine: 'Anyone ahead waits until the others catch up.',
  priority: 'Priority: highest priority free person first',
  even: 'Even: anyone ahead waits until the others catch up',
  evenGap: 'Waits when ahead by',
  meetings: (count: number) => (count === 1 ? '1 meeting' : `${String(count)} meetings`),
  returning: 'Returning guests go to',
  returningChoices: { owner: 'Their owner', last_host: 'The host they met last', none: 'The group' } as const,
  returningHint: 'When that person is in this group and free.',
  window: 'Count meetings from the last',
  windowInfo: 'Fair and Even compare meetings from this period.',
  days: (count: number) => `${String(count)} days`,
  addMember: 'Add a member',
  addMemberPlaceholder: 'Search people',
  /** On the server's refusal of someone who can't take meetings yet: their hours, in a new tab, so the group stays. */
  setHours: 'Set hours',
  /** Set hours' name: whose hours, and that they open in a new tab, as booking's "Open X in a new tab" says. */
  setHoursFor: (name: string) => `Set hours for ${name}, in a new tab`,
  /** On the server's refusal of one member: save the group without them. Short, so a long name never widens it. */
  removeFromGroup: 'Remove from group',
  /** Remove from group's name: its visible words first (WCAG 2.5.3), then the member it removes. */
  removeRefused: (name: string) => `Remove from group: ${name}`,
  noMembersLeft: 'Everyone is in it already.',
  /** The member picker's hint: how many, and who can join. */
  membersHint: (count: number) => `${String(count)} of 20 members. ${CAN_JOIN}`,
  needTwo: 'Add at least 2 members.',
  tooMany: 'A group holds at most 20 members.',
  weightFor: (name: string, rotation: string) => `Weight for ${name} in ${rotation}`,
  weightInvalid: 'A weight is 1 to 100.',
  priorityFor: (name: string, rotation: string) => `Priority for ${name} in ${rotation}`,
  capFor: (name: string, rotation: string) => `Meetings a day for ${name} in ${rotation}`,
  weeklyFor: (name: string, rotation: string) => `Meetings a week for ${name} in ${rotation}`,
  onFor: (name: string, rotation: string) => `${name} takes meetings from ${rotation}`,
  remove: (name: string) => `Remove ${name}`,
  cancel: 'Cancel',
  create: 'Create group',
  creating: 'Creating',
  save: 'Save',
  saving: 'Saving',
  saved: (name: string) => `Saved ${name}.`,
  made: (name: string) => `Made ${name}.`,
  somethingWrong: 'Something went wrong. Try again.',
  // Confirms.
  removeTitle: (names: readonly string[], rotation: string) =>
    names.length === 1
      ? `Remove ${names[0] ?? ''} from ${rotation}?`
      : `Remove ${String(names.length)} people from ${rotation}?`,
  removeText: 'They stop getting new meetings from it. Meetings they already have stay theirs.',
  removeAction: 'Remove and save',
  deleteTitle: (name: string) => `Delete ${name}?`,
  deleteText: 'It goes from Settings for good. Bookings it already gave out stay with their hosts.',
  deleteAction: 'Delete group',
  deleting: 'Deleting',
  deleted: (name: string) => `Deleted ${name}.`,
  deleteFailed: (name: string) => `Couldn’t delete ${name}. It’s back in the list.`,
  // A round robin page's Hosts card (spec 0037, AC-1323).
  hosts: 'Hosts',
  hostsLine: (fixed: readonly string[], rotations: readonly string[]) =>
    rotations.length === 0
      ? 'Pick a round robin group'
      : `Every booking: ${[...fixed, ...rotations.map((name, index) => (index === 0 && fixed.length === 0 ? `one from ${name}` : `plus one from ${name}`))].join(', ')}`,
  fixedHosts: 'Fixed hosts',
  fixedHint: 'They attend every meeting.',
  /** Why Add a fixed host or Add a group is off: the page holds its most hosts. */
  fixedFull: (max: number) => `A page has at most ${String(max)} fixed hosts. Remove one to add another.`,
  hostsFull: (max: number) => `A page has at most ${String(max)} hosts and groups together. Remove one to add another.`,
  addFixed: 'Add a fixed host',
  noFixed: 'None. Each booking goes to the round robin groups only.',
  moveUp: (name: string) => `Move ${name} up`,
  moveDown: (name: string) => `Move ${name} down`,
  removeFixed: (name: string) => `Remove ${name} as a fixed host`,
  hostActions: 'Actions',
  hostsSaved: 'Hosts saved.',
  /** Handing a member's upcoming bookings on (spec 0029, AC-750). */
  handOnAction: (count: number) => (count === 1 ? 'Reassign 1 upcoming' : `Reassign ${String(count)} upcoming`),
  handOnTitle: (name: string, count: number) =>
    count === 1 ? `Reassign ${name}’s upcoming booking?` : `Reassign ${name}’s ${String(count)} upcoming bookings?`,
  handOnText: (rotation: string, count: number) =>
    count === 1
      ? `It goes to the next free member of ${rotation}, who is emailed with the guest. If nobody is free then, Bookings marks it Needs a host and the admins are emailed.`
      : `Each goes to the next free member of ${rotation}, who is emailed with the guest. Any nobody can take shows Needs a host on Bookings, and the admins are emailed.`,
  handOnConfirm: (count: number) => (count === 1 ? 'Reassign it' : `Reassign ${String(count)}`),
  keepThem: 'Keep them',
  keptNote: 'Kept. Each booking can still be reassigned from Bookings.',
  handedOn: (count: number) =>
    count === 1
      ? 'Handing it on. Bookings shows it as Needs a host until someone takes it.'
      : `Handing ${String(count)} on. Bookings shows each as Needs a host until someone takes it.`,
  removeFixedTitle: (name: string) => `Remove ${name} as a fixed host?`,
  removeFixedText: 'They stop joining new meetings from this page. Meetings already booked keep them.',
  removeFixedAction: 'Remove host',
  stopRotationTitle: (name: string) => `Stop booking from ${name}?`,
  stopRotationText: 'New meetings stop taking a host from it. Meetings already booked keep their hosts.',
  stopRotationAction: 'Stop booking from it',
  removing: 'Saving',
  rotations: 'Round robin groups',
  rotationsHint: 'One host from each, up to 3. Host changes save straight away.',
  rotationAt: (index: number) => `Group ${String(index + 1)}`,
  oneFrom: (name: string) => `One from ${name}`,
  addRotation: 'Add a group',
  removeRotation: (name: string) => `Stop booking from ${name}`,
  rotation: 'Group',
  pickRotation: 'Pick a group',
  manageRotations: 'Manage round robin',
  hoursMembers: 'Each member’s own hours',
  hoursShared: 'One schedule for everyone',
  reschedule: 'When a guest reschedules',
  rescheduleSame: 'Same host when they are free',
  rescheduleRotation: 'Through the group again',
  // New booking page.
  whoBooks: 'Who it books',
  bookMe: 'Me',
  bookRotation: 'Round robin group',
  bookEveryone: 'Workspace link',
  /** The one help for Who it books, in its InfoTip. */
  whoBooksInfo:
    'Me: guests book you. Round robin group: one host from a group, in turn. Workspace link: whoever is free, on nobody’s profile.',
  rosterNote: (on: number, all: number) =>
    `${String(on)} of ${String(all)} on. Everyone in the workspace except guests is in this group, and new members join by themselves. Switch someone off to keep them out.`,
  everyoneSwitch: 'Everyone in the workspace, including people who join later',
  everyoneSwitchOn: (on: number) =>
    `${String(on)} ${on === 1 ? 'person takes' : 'people take'} turns. Leave someone out in Manage round robin.`,
  everyoneSwitchOff: 'Pick the group and fixed hosts this link books instead.',
  switchOffRefused: (name: string) => `Switch ${name} off`,
  rosterSummary: (on: number, pages: number) =>
    `Everyone in the workspace, ${String(on)} on · used by ${String(pages)} ${pages === 1 ? 'link' : 'links'}`,
  noRotations: 'Make a round robin group first. Round robin opens in a new tab, and what you typed here stays.',
  rotationRequired: 'Pick a group.',
  /** The rotation card's two views (spec 0037, AC-1330). */
  views: (rotation: string) => `${rotation} views`,
  membersTab: 'Members',
  distributionTab: 'Distribution',
  distribution: {
    intro: (days: number) => `Meetings in the last ${String(days)} days, against each person’s fair share.`,
    /** A member's line: they see only their own row, with no fair share column. */
    ownIntro: (days: number) => `Your meetings in the last ${String(days)} days.`,
    failed: 'Couldn’t load the distribution',
    count: 'Meetings',
    fair: 'Fair share',
    difference: 'Difference',
    adjusted: 'Adjusted',
    how: 'How',
    off: 'Off',
    howLine: (reasons: Readonly<Partial<Record<string, number>>>) => {
      const words: Readonly<Record<string, string>> = {
        fair: 'by fair share',
        priority: 'by priority',
        even: 'by even turns',
        owner: 'owner',
        last_host: 'last host',
        standin: 'stand in',
        only_free: 'only one free',
        routed: 'routed',
        manual: 'picked by hand',
        reassigned: 'reassigned',
      };
      const parts = Object.entries(reasons).flatMap(([reason, count]) =>
        reason === 'adjustment' || count === undefined || count === 0
          ? []
          : [`${String(count)} ${words[reason] ?? reason}`],
      );
      return parts.join(', ');
    },
    /** The window is said once, in the section's line under it. */
    shareTitle: 'Share of meetings',
    weeksTitle: 'Each week',
    weeksShow: 'Show the weeks as',
    weeksChart: 'Chart',
    weeksTable: 'Table',
    weeksRange: (from: string, to: string) => `Weeks of ${from} to ${to}`,
    total: 'Total',
    weekBar: (week: string, count: number) =>
      `Week of ${week}: ${String(count)} ${count === 1 ? 'meeting' : 'meetings'}`,
    memberWeeks: (name: string) => `${name}, meetings each week`,
    adjustmentsTitle: 'Adjustments',
    shareLabel: (rotation: string) => `Share of meetings in ${rotation}`,
    weeksLabel: (rotation: string) => `Meetings each week in ${rotation}, last 12 weeks`,
    adjustmentsLabel: (rotation: string) => `Count adjustments in ${rotation}`,
    change: 'Change',
    note: 'Note',
    by: 'By',
    when: 'When',
    undo: 'Undo',
    undoneBadge: 'Undone',
    undone: (name: string) => `Undone. ${name}’s count is back.`,
    adjust: 'Adjust count',
    adjustTitle: (rotation: string) => `Adjust a count in ${rotation}`,
    by20: 'Adjust by',
    by20Hint: 'Add meetings they had elsewhere (for example 2), or take some away (for example -2).',
    unitsInvalid: 'Use a whole number from -20 to 20, not 0.',
    noteRequired: 'Say why, in a few words.',
    adjustedNotice: (name: string) => `${name}’s count adjusted.`,
  },
} as const;
