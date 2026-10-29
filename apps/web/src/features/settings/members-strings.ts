import type { RemovalPreview } from '@crm/data';

/** Settings › Workspace › Members' copy (spec 0031). */
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
  roleChanged: (name: string, role: string) =>
    `${name} is now ${role === 'Admin' || role === 'Owner' ? 'an' : 'a'} ${role}.`,
  removed: (name: string) => `${name} was removed from the workspace.`,
  /** The one read only note, the same words on every settings page (cross page note 1). */
  readOnlyNote: 'Only owners and admins can change this.',
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
  removeText: 'They lose access at once, and their work stays.',
  removeAction: 'Remove member',
  removedHandingOn: (name: string, to: string) =>
    `${name} was removed. Their open tasks and records are moving to ${to}, shown in Background jobs.`,
  removalEffects: (counts: RemovalPreview) =>
    [
      counts.openTasks > 0
        ? `${String(counts.openTasks)} open ${counts.openTasks === 1 ? 'task is' : 'tasks are'} assigned to them.`
        : '',
      counts.records > 0
        ? `${String(counts.records)} ${counts.records === 1 ? 'record names' : 'records name'} them as owner.`
        : '',
      counts.pausedPages > 0
        ? `${String(counts.pausedPages)} booking ${counts.pausedPages === 1 ? 'page pauses' : 'pages pause'}, with nobody left to host.`
        : '',
      counts.calendars > 0
        ? `${String(counts.calendars)} calendar ${counts.calendars === 1 ? 'connection is' : 'connections are'} disconnected.`
        : '',
      counts.defaults > 0
        ? `${String(counts.defaults)} ${counts.defaults === 1 ? 'field uses them as its default, and loses it' : 'fields use them as their default, and lose it'}.`
        : '',
      counts.invitations > 0
        ? counts.invitations === 1
          ? 'An invitation they sent is cancelled. Invite them again from Invite people if you still want them.'
          : `${String(counts.invitations)} invitations they sent are cancelled. Invite any you still want again from Invite people.`
        : '',
    ]
      .filter((sentence) => sentence !== '')
      .join(' '),
  /** The removal's one effect that stops other people's work, apart in a warning (late trap #70). */
  requiredDefaultsLost: (count: number) =>
    count === 1
      ? 'A required field will have no default. Give it one in its object’s settings, or forms and booking pages can’t add records there.'
      : `${String(count)} required fields will have no default. Give them one in their objects’ settings, or forms and booking pages can’t add records there.`,
  previewFailed: 'We couldn’t check what else this changes. You can still remove them.',
  handTo: 'Hand their open tasks and records to',
  handToHint: 'They move in the background. Leave it empty to keep them as they are.',
  handToNobody: 'Keep them as they are',
  handToSearch: 'Search members',
  transferTitle: (name: string, workspace: string) => `Make ${name} the owner of ${workspace}?`,
  transferText: 'They get every permission, and you become an admin.',
  transferAction: 'Transfer ownership',
  failedTitle: 'Couldn’t load the members',
  failedText: 'Check your connection, then try again.',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  // The invite link card (spec 0031, AC-818).
  linkTitle: 'Invite link',
  linkDescription: 'Anyone with the link can join as a member.',
  linkField: 'Link',
  linkCopy: 'Copy link',
  linkUses: (uses: number) =>
    uses === 0
      ? 'Nobody has joined with it yet.'
      : uses === 1
        ? '1 person joined with it.'
        : `${String(uses)} people joined with it.`,
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
  linkResetText: 'The current link stops working at once, and a new one replaces it. Its settings stay.',
  linkResetAction: 'Reset link',
  linkWasReset: 'The invite link was reset.',
  linkOffTitle: 'Turn off the invite link?',
  linkOffText: 'The link stops working at once. Turning it on again makes a new one.',
  linkOffAction: 'Turn off link',
  linkTurnedOff: 'The invite link is off.',
  /** Expires or Most uses changed (the save rule): Undo puts the previous value back. */
  linkSaved: 'Invite link saved.',
  undo: 'Undo',
  undone: 'Change undone.',
  /** An Undo pressed after the link changed again (here or by another admin): it leaves the newer value alone. */
  undoStale: 'The invite link changed again since, so nothing was undone.',
  // Domain join (spec 0031, AC-819, AC-820).
  domainTitle: 'Company email',
  domainOff: (domain: string) => `When on, anyone with an @${domain} email can ask to join. You approve each one.`,
  /** The server's rule: only the reader's own verified email's domain, and never a public mail domain. */
  domainInfo: 'Only the domain of your own verified email can be used. Public mail like Gmail can’t.',
  domainOn: (domain: string) => `People at @${domain} can ask to join. You approve each one.`,
  domainTurnedOn: (domain: string) => `People at @${domain} can now ask to join.`,
  domainSaving: (domain: string) => `Turning on for @${domain}`,
  domainPublic: 'Your address is at a public mail domain, so it can’t be used.',
  domainUnverified: 'Verify your email address to use its domain.',
  requested: 'Requested',
  approve: 'Approve',
  decline: 'Decline',
  approved: (name: string) => `${name} joined the workspace.`,
  declineTitle: (name: string) => `Decline ${name}’s request?`,
  declineText: 'They won’t be told, and their request stays open on their side.',
  declineAction: 'Decline request',
  declined: (name: string) => `Declined ${name}’s request.`,
  approveFor: (name: string) => `Approve ${name}`,
  declineFor: (name: string) => `Decline ${name}`,
  requestActions: (name: string) => `Answer ${name}’s request`,
  domainOffTitle: 'Turn off company email?',
  domainOffText: (domain: string) => `People at @${domain} can no longer ask, and open requests from them close.`,
  domainOffAction: 'Turn off company email',
  domainTurnedOff: 'Company email is off.',
  // Help beside labels that don't say it all (the owner's Settings sweep, 21 October 2026).
  linkMostUsesInfo: 'How many people can join with the link before it stops working.',
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
  sentTo: (list: string) => `Invited ${list}. They get an email with a link to join.`,
  alreadyMembers: (list: string) => `Already members: ${list}.`,
  inviteMore: 'Invite more',
  done: 'Done',
  unsent: (list: string) => `Saved, but the email didn’t go out to ${list}. Use Resend on the Joining tab.`,
  // The invite dialog opened outside Settings › Members (InviteTeamDialog), when its first read fails.
  inviteLoadFailed: 'Couldn’t load your team. Check your connection, then try again.',
  inviteTryAgain: 'Try again',
} as const;
