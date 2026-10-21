import { INVITE_BATCH_MAX, type RemovalPreview } from '@crm/data';

/** Settings › Workspace › Members' copy (spec 0031). */
export const strings = {
  title: 'Members',
  membersTab: 'Members',
  invitationsTab: 'Invitations',
  tabsLabel: 'Members and invitations',
  invite: 'Invite people',
  columns: {
    name: 'Name',
    email: 'Email',
    role: 'Role',
    joined: 'Joined',
    actions: 'Actions',
    invitedBy: 'Invited by',
    expires: 'Expires',
  },
  you: 'You',
  search: 'Search members',
  searchPlaceholder: 'Name or email',
  noMatches: 'No members match',
  noMatchesText: (search: string) => `Nobody’s name or email holds “${search}”.`,
  showMore: 'Show more members',
  roleFor: (name: string) => `Role for ${name}`,
  rowActions: (name: string) => `Actions for ${name}`,
  remove: 'Remove from workspace',
  transfer: 'Transfer ownership',
  transferred: (name: string) => `${name} is now an owner. You’re an admin.`,
  roleChanged: (name: string, role: string) =>
    `${name} is now ${role === 'Admin' || role === 'Owner' ? 'an' : 'a'} ${role}.`,
  removed: (name: string) => `${name} was removed from the workspace.`,
  readOnlyNote: 'Only workspace owners and admins can invite people or change roles.',
  noInvitations: 'No open invitations',
  noInvitationsText: 'People you invite show here until they join.',
  expired: 'Expired',
  resend: 'Resend',
  revoke: 'Revoke',
  invitationActions: (email: string) => `Actions for the invitation to ${email}`,
  resent: (email: string) => `Invitation sent again to ${email}.`,
  resentUnsent: (email: string) =>
    `The invitation to ${email} is renewed, but its email didn’t go out. Try Resend again.`,
  revoked: (email: string) => `Invitation to ${email} revoked.`,
  // The confirms (the owner, 21 October 2026: anything that ends something asks first).
  revokeTitle: (email: string) => `Revoke the invitation to ${email}?`,
  revokeText: 'The link in their email stops working at once. You can invite them again any time.',
  revokeAction: 'Revoke invitation',
  removeTitle: (name: string, workspace: string) => `Remove ${name} from ${workspace}?`,
  removeText: 'They lose access at once. Their records, notes, tasks and meetings stay.',
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
    ]
      .filter((sentence) => sentence !== '')
      .join(' '),
  previewFailed: 'We couldn’t check what else this changes. You can still remove them.',
  handTo: 'Hand their open tasks and records to',
  handToHint: 'They move in the background. Leave it empty to keep them as they are.',
  handToNobody: 'Keep them as they are',
  handToSearch: 'Search members',
  transferTitle: (name: string, workspace: string) => `Make ${name} the owner of ${workspace}?`,
  transferText:
    'They get every permission, including billing and deleting the workspace, and you become an admin. Only an owner can make you an owner again.',
  transferAction: 'Transfer ownership',
  selfRoleTitle: (role: string) => `Change your own role to ${role}?`,
  selfRoleText: 'You may lose permissions you have now, and only an owner or admin can give them back.',
  selfRoleAction: 'Change my role',
  failedTitle: 'Couldn’t load the members',
  failedText: 'Check your connection, then try again.',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  // The invite dialog.
  inviteTitle: 'Invite people',
  emails: 'Email addresses',
  emailsHint: `Separate addresses with commas, spaces or new lines. Up to ${String(INVITE_BATCH_MAX)} at once.`,
  emailsPlaceholder: 'ada@example.com, grace@example.com',
  role: 'Role',
  send: 'Send invitations',
  sending: 'Sending invitations',
  cancel: 'Cancel',
  noEmails: 'Add at least one email address.',
  tooMany: `Invite at most ${String(INVITE_BATCH_MAX)} people at once.`,
  badEmails: (list: string) => `These don’t look like email addresses: ${list}.`,
  sentCount: (count: number) => (count === 1 ? 'Invitation sent.' : `${String(count)} invitations sent.`),
  alreadyMembers: (list: string) => `Already members: ${list}.`,
  unsent: (list: string) => `Saved, but the email didn’t go out to ${list}. Use Resend on the Invitations tab.`,
} as const;
