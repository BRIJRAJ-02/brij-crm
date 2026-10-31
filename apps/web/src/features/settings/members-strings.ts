import type { RemovalPreview } from '@crm/data';
import { sharedStrings } from '@crm/ui';

/** Settings › Workspace › Members' copy (spec 0031). */
/** "an Admin", "an Owner", "a Member", "a Guest". */
const article = (role: string): string => (/^[AEIOU]/.test(role) ? 'an' : 'a');

export const strings = {
  title: 'Members',
  membersTab: 'Members',
  /** Everyone on their way in: requests to join, pending invitations, and the link and company email (SW1). */
  joiningTab: 'Joining',
  tabsLabel: 'Members and people joining',
  askingSection: 'Asking to join',
  pendingSection: 'Pending invitations',
  otherWaysSection: 'Other ways to join',
  invite: 'Invite people',
  /** The page's second action and the Invite dialog's fold: what each role lets someone do (owner, 27 October 2026). */
  roleGuide: 'What each role can do',
  /** The guide's role switch. */
  roleGuideRoles: 'Role',
  /** The guide's list, named by the role it explains: "What the Admin role can do". */
  rolePowers: (role: string) => `What the ${role} role can do`,
  columns: {
    name: 'Name',
    email: 'Email',
    role: 'Role',
    joined: 'Joined',
    twoFactor: 'Two factor',
    actions: 'Actions',
    invitedBy: 'Invited by',
    expires: 'Expires',
  },
  /** The Two factor column (spec 0033, AC-895): an authenticator app. */
  twoFactorOn: 'On',
  twoFactorOff: 'Off',
  you: 'You',
  search: 'Search members',
  searchPlaceholder: 'Name or email',
  /** A guest searches by name alone (spec 0031, AC-829). */
  searchNamePlaceholder: 'Name',
  noMatches: 'No members match',
  showMore: 'Show more members',
  // A lone member: the one quiet nudge toward inviting.
  aloneTitle: 'Just you so far',
  aloneText: 'Invite your team to work together.',
  roleFor: (name: string) => `Role for ${name}`,
  rowActions: (name: string) => `Actions for ${name}`,
  remove: 'Remove from workspace',
  transfer: 'Transfer ownership',
  transferred: (name: string) => `${name} is now an owner. You’re an admin.`,
  roleChanged: (name: string, role: string) => `${name} is now ${article(role)} ${role}.`,
  /** A role change that takes access away asks first (the owner, 21 October 2026). */
  roleDownTitle: (name: string, role: string) => `Make ${name} ${article(role)} ${role}?`,
  /** What a step down takes, by the role left: an owner's billing and owners, an admin's members and settings. */
  roleDownText: (name: string, from: string) =>
    from === 'owner'
      ? `${name} can no longer manage billing or owners.`
      : `${name} can no longer manage members or settings.`,
  roleGuestText: (name: string) => `${name} will see only what’s shared with guests.`,
  roleDownAction: (role: string) => `Make ${role}`,
  whatChanges: 'What changes',
  /** What becoming a guest will do, as chips in that confirm (spec 0031, slice 9). */
  guestPages: (count: number) => `${String(count)} ${count === 1 ? 'page' : 'pages'} paused`,
  guestRotations: (count: number) => `Leaves ${String(count)} round ${count === 1 ? 'robin' : 'robins'}`,
  guestBookings: (count: number) => `${String(count)} ${count === 1 ? 'booking needs' : 'bookings need'} a host`,
  guestUncounted: 'Couldn’t count what changes',
  guestLinkPage: 'Link page hidden',
  guestDelegations: (count: number) => `${String(count)} scheduling ${count === 1 ? 'share' : 'shares'} removed`,
  removed: (name: string) => `${name} was removed from the workspace.`,
  /** Invite pressed with no role this person may invite as: the server lets only owners and admins invite. */
  inviteForbidden: 'Only workspace owners and admins can invite people or change roles.',
  noInvitations: 'No pending invitations',
  expired: 'Expired',
  resend: 'Resend',
  revoke: 'Cancel invite',
  invitationActions: (email: string) => `Actions for the invitation to ${email}`,
  resent: (email: string) => `Invitation sent again to ${email}.`,
  resentUnsent: (email: string) =>
    `The invitation to ${email} is renewed, but its email didn’t go out. Try Resend again.`,
  revoked: (email: string) => `Invitation to ${email} cancelled.`,
  /** A role change took away what their invitations needed (late trap): they were cancelled, said with the change. */
  roleInvitationsCancelled: (count: number) =>
    count === 1
      ? 'An invitation they sent was cancelled, since their new role can’t send it.'
      : `${String(count)} invitations they sent were cancelled, since their new role can’t send them.`,
  // The confirms (the owner, 21 October 2026: anything that ends something asks first).
  revokeTitle: (email: string) => `Cancel the invitation to ${email}?`,
  revokeText: 'The link in their email stops working at once.',
  revokeAction: 'Cancel invitation',
  /** The confirm's way out when its verb is itself a Cancel: never two buttons called Cancel (as Jobs' Keep job). */
  keepInvitation: 'Keep invitation',
  removeTitle: (name: string, workspace: string) => `Remove ${name} from ${workspace}?`,
  removeText: 'They lose access now.',
  removeAction: 'Remove member',
  removedHandingOn: (name: string, to: string) =>
    `${name} was removed. Their open tasks and records are moving to ${to}, shown in Background jobs.`,
  /**
   * What the removal changes, as rows of a small table (31 October 2026: counts are a table, never a paragraph):
   * what it touches, then how many. A row appears only when its count is above zero.
   */
  removalRows: (counts: RemovalPreview) =>
    [
      { term: 'Open tasks', count: counts.openTasks },
      { term: 'Records they own', count: counts.records },
      { term: 'Booking pages that pause', count: counts.pausedPages },
      { term: 'Calendars disconnected', count: counts.calendars },
      { term: 'Defaults cleared', count: counts.defaults },
      { term: 'Forms left without an owner', count: counts.ownedForms },
      { term: 'Invitations cancelled', count: counts.invitations },
    ]
      .filter((row) => row.count > 0)
      .map((row) => ({ term: row.term, value: row.count.toLocaleString('en') })),
  /** The removal's one effect that stops other people's work, apart in a warning (late trap #70). */
  requiredDefaultsLost: (count: number) =>
    count === 1
      ? 'A required field loses its default. Forms and booking pages can’t add records there.'
      : `${String(count)} required fields lose their default. Forms and booking pages can’t add records there.`,
  previewFailed: 'We couldn’t check what else this changes. You can still remove them.',
  handTo: 'Hand over to',
  handToNobody: 'Keep them as they are',
  handToSearch: 'Search members',
  transferTitle: (name: string, workspace: string) => `Make ${name} the owner of ${workspace}?`,
  transferText: 'They get every permission, and you become an admin.',
  transferAction: 'Transfer ownership',
  failedTitle: 'Couldn’t load the members',
  failedText: 'Check your connection, then try again.',
  // The invite link card (spec 0031, AC-818).
  linkTitle: 'Invite link',
  /** The Invite dialog's foot: the workspace's link, turned on as a Member link when it is off (with Undo). */
  copyInviteLink: 'Copy invite link',
  inviteLinkCopied: 'Link copied.',
  inviteLinkOnCopied: 'Link on and copied.',
  inviteLinkCopyFailed: sharedStrings.couldntCopy,
  inviteLinkSpent: 'The invite link has run out. Reset it in Members › Joining.',
  linkDescription: 'Anyone with the link can join as a member.',
  linkField: 'Link',
  linkCopy: 'Copy link',
  linkUses: (uses: number) =>
    uses === 0
      ? 'Nobody has joined with it yet.'
      : uses === 1
        ? '1 person joined with it.'
        : `${String(uses)} people joined with it.`,
  /** The fold holding Expires and Most uses. */
  linkSettings: 'Link settings',
  linkExpires: 'Expires',
  linkNever: 'Never',
  linkDays: (days: number) => (days === 1 ? 'In 1 day' : `In ${String(days)} days`),
  linkUntil: (when: string) => `On ${when}`,
  linkMostUses: 'Most uses',
  linkNoCap: 'No limit',
  linkCap: (cap: number) => `${String(cap)} people`,
  linkSpent: 'This link has expired or reached its limit, so change it or reset it.',
  linkReset: 'Reset link',
  linkResetTitle: 'Reset the invite link?',
  linkResetText: 'The old link stops working.',
  linkResetAction: 'Reset link',
  linkWasReset: 'The invite link was reset.',
  linkOffTitle: 'Turn off the invite link?',
  linkOffText: 'The link stops working.',
  linkOffAction: 'Turn off link',
  linkTurnedOff: 'The invite link is off.',
  /** Expires or Most uses changed (the save rule): Undo puts the previous value back. */
  linkSaved: 'Invite link saved.',
  undo: 'Undo',
  /** An Undo pressed after the link changed again (here or by another admin): it leaves the newer value alone. */
  undoStale: sharedStrings.undoStale,
  // Domain join (spec 0031, AC-819, AC-820).
  domainTitle: 'Company email',
  /** The row's title once the reader's domain is known: the switch is for this domain alone. */
  domainRowTitle: (domain: string) => `Let @${domain} ask to join`,
  domainTurnedOn: (domain: string) => `People at @${domain} can now ask to join.`,
  domainSaving: (domain: string) => `Turning on for @${domain}`,
  domainPublic: 'Public mail domains can’t be used.',
  domainUnverified: 'Verify your email address to use its domain.',
  requested: 'Requested',
  approve: 'Approve',
  decline: 'Decline',
  approved: (name: string) => `${name} joined the workspace.`,
  declineTitle: (name: string) => `Decline ${name}’s request?`,
  declineText: 'They won’t be told.',
  declineAction: 'Decline request',
  declined: (name: string) => `Declined ${name}’s request.`,
  approveFor: (name: string) => `Approve ${name}`,
  declineFor: (name: string) => `Decline ${name}`,
  requestActions: (name: string) => `Answer ${name}’s request`,
  domainOffTitle: 'Turn off company email?',
  domainOffText: (domain: string) => `People at @${domain} can no longer ask. Open requests close.`,
  domainOffAction: 'Turn off company email',
  domainTurnedOff: 'Company email is off.',
  // Help beside labels that don't say it all (the owner's Settings sweep, 21 October 2026).
  // The invite dialog.
  inviteTitle: 'Invite people',
  emailFor: (row: number) => (row === 1 ? 'Email' : `Email ${String(row)}`),
  emailPlaceholder: 'name@company.com',
  rowName: (row: number) => `row ${String(row)}`,
  removeRow: (what: string) => `Remove ${what}`,
  addAnother: 'Add another',
  badEmail: 'Enter a valid email address.',
  repeatedEmail: 'Already in the list.',
  alreadyMember: 'Already a member.',
  aboutRoles: 'Role',
  alreadyInvited: 'Already invited.',
  inviteCount: (count: number) =>
    count === 0 ? 'Invite' : count === 1 ? 'Invite 1 person' : `Invite ${String(count)} people`,
  sending: 'Inviting',
  cancel: 'Cancel',
  noEmails: 'Add at least one email address.',
  partlySent: (count: number, reason: string) =>
    `${count === 1 ? '1 address is' : `${count} addresses are`} done and off the list. The rest weren’t sent: ${reason} Invite again to retry them.`,
  pasteTooMany: (count: number) => `Added the first ${count}. Invite the rest in the next batch.`,
  sentTo: (list: string) => `Invited ${list}.`,
  /** The toast after a clean send, when the dialog closes. */
  invitedToast: (count: number) => (count === 1 ? 'Invited 1 person' : `Invited ${String(count)} people`),
  alreadyMembers: (list: string) => `Already members: ${list}.`,
  inviteMore: 'Invite more',
  done: 'Done',
  unsent: (list: string) => `Saved, but the email didn’t go out to ${list}. Use Resend on the Joining tab.`,
  // The invite dialog opened outside Settings › Members (InviteTeamDialog), when its first read fails.
  inviteLoadFailed: 'Couldn’t load your team. Check your connection, then try again.',
  inviteTryAgain: 'Try again',
  /** "What can Priya do" (spec 0037, AC-1243). */
  capabilities: {
    menu: (first: string) => `What can ${first} do`,
    title: (first: string) => `What ${first} can do`,
    openRole: 'Open role',
    readOnly: 'Can see records, but not change them.',
    sees: 'Sees scheduling of',
    manages: 'Manages scheduling of',
    managedBy: 'Scheduling managed by',
    ownersAndAdmins: 'Owners and admins',
    holdersOf: (role: string) => `Everyone with ${role}`,
    teamHoldersOf: (role: string) => `${role} in their teams`,
    everyoneGrant: (name: string) => `${name} (everyone)`,
    unread: 'Couldn’t read this. Try again later.',
  },
  /** Change role for several at once (spec 0037, AC-1242). */
  bulkRole: 'Change role',
  bulkRoleLabel: (count: number) => `Change role for ${String(count)} ${count === 1 ? 'person' : 'people'}`,
  bulkRoleTitle: (count: number, role: string) => `Make ${String(count)} ${count === 1 ? 'person' : 'people'} ${role}?`,
  bulkRoleText: 'Some of them will lose access they have now.',
  bulkRoleChanged: (count: number, role: string) =>
    `${String(count)} ${count === 1 ? 'person is' : 'people are'} now ${role}.`,
  selectMember: (name: string) => `Select ${name}`,
  roleCustomDown: (name: string) => `${name} will lose some of what they can do now.`,
  custom: 'Custom',
} as const;
