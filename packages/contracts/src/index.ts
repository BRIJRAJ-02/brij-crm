import { accessContract, rolesContract } from './access.ts';
import { accountContract } from './account.ts';
import { auditContract } from './audit.ts';
import { attributesContract } from './attributes.ts';
import { bookingPagesContract, bookingsContract } from './booking/pages.ts';
import { schedulesContract } from './booking/schedules.ts';
import { timeOffContract } from './booking/time-off.ts';
import { limitsContract } from './booking/limits.ts';
import { availabilityContract } from './booking/team-week.ts';
import { preferencesContract } from './preferences.ts';
import { rotationsContract } from './booking/rotations.ts';
import { bulkRecordsContract } from './bulk.ts';
import { calendarContract } from './calendar.ts';
import { homeContract } from './home.ts';
import { commentsContract } from './comments.ts';
import { formsContract, submissionsContract } from './forms/forms.ts';
import { routingContract } from './forms/routing.ts';
import { exportsContract, importsContract } from './imports.ts';
import { automationsContract } from './automations.ts';
import { jobsContract } from './jobs.ts';
import { meContract } from './me.ts';
import { navContract } from './navigation.ts';
import { notificationsContract } from './notifications.ts';
import { operatorContract } from './operator.ts';
import { membersContract } from './members.ts';
import { workspaceSecurityContract } from './workspace-security.ts';
import { objectsContract } from './objects.ts';
import { optionsContract } from './options.ts';
import { realtimeContract } from './realtime.ts';
import { recordsContract } from './records.ts';
import { linksContract, relationshipsContract } from './relations.ts';
import { recentsContract, searchContract } from './search.ts';
import { systemContract } from './system.ts';
import { invitationsContract, joinContract, joinRequestsContract } from './team.ts';
import { trashContract } from './trash.ts';
import { notesContract } from './notes.ts';
import { tasksContract } from './tasks.ts';
import { usageContract } from './usage.ts';
import { viewsContract } from './views.ts';
import { workspacesContract } from './workspaces.ts';
import { deletedWorkspaceContract, workspaceContract } from './workspace-settings.ts';
import { profileContract } from './profile.ts';
import { schedulingContract } from './scheduling.ts';

export * from './access.ts';
export * from './account.ts';
export * from './activity.ts';
export * from './attributes.ts';
export * from './audit.ts';
export * from './board-model.ts';
export * from './booking/index.ts';
export * from './booking/blocks.ts';
export * from './booking/pages.ts';
export * from './booking/schedules.ts';
export * from './booking/time-off.ts';
export * from './booking/limits.ts';
export * from './booking/team-week.ts';
export * from './booking/rotations.ts';
export * from './bulk.ts';
export * from './bulk-ops.ts';
export * from './calendar.ts';
export * from './home.ts';
export * from './change-event.ts';
export * from './comments.ts';
export * from './errors.ts';
export * from './forms/index.ts';
export * from './imports.ts';
export * from './automations.ts';
export * from './jobs.ts';
export * from './scheduling.ts';
export * from './csv.ts';
export * from './me.ts';
export * from './pictures.ts';
export * from './members.ts';
export * from './member-names.ts';
export * from './nav-model.ts';
export * from './navigation.ts';
export * from './notifications.ts';
export * from './workspace-security.ts';
export * from './objects.ts';
export * from './operator.ts';
export * from './options.ts';
export * from './plain-errors.ts';
export * from './realtime.ts';
export * from './records.ts';
export * from './relations.ts';
export * from './search.ts';
export * from './system.ts';
export * from './trash.ts';
export * from './notes.ts';
export * from './tasks.ts';
export * from './preferences.ts';
export * from './team.ts';
export * from './usage.ts';
export * from './view-model.ts';
export * from './views.ts';
export * from './values/index.ts';
export * from './workspaces.ts';
export * from './workspace-settings.ts';
export * from './profile.ts';

/**
 * The one contract the web app, the API and the worker share. Each feature
 * adds its own namespace here. Every procedure outside the bootstrap list
 * (`system.*`, `me.get`, `workspaces.create`, `realtime.connectionToken`, `join.*`,
 * `deletedWorkspace.*`)
 * takes `WorkspaceScoped` input and is served behind the API's member door.
 */
export const contract = {
  system: systemContract,
  me: meContract,
  // The operator console (spec 0047): a session on OPERATOR_EMAILS with two factor, never a workspace role.
  operator: operatorContract,
  // The signed in person's own sessions and devices (spec 0033): a session, no workspace.
  account: accountContract,
  workspaces: workspacesContract,
  // Settings › Workspace › General and the owner's delete (spec 0031, slice 7); a deleted one's restore (bootstrap).
  workspace: workspaceContract,
  deletedWorkspace: deletedWorkspaceContract,
  // Settings › Account › Profile (spec 0031, slice 7).
  profile: profileContract,
  // A workspace's sign in rules (spec 0033, milestone 4): owners only.
  workspaceSecurity: workspaceSecurityContract,
  objects: objectsContract,
  attributes: attributesContract,
  options: optionsContract,
  // Bulk actions (spec 0022) join the records namespace from their own file.
  records: { ...recordsContract, ...bulkRecordsContract },
  relationships: relationshipsContract,
  links: linksContract,
  members: membersContract,
  invitations: invitationsContract,
  // Domain join (spec 0031, slice 6): /join's bootstrap reads, and a workspace's domains and requests.
  join: joinContract,
  joinRequests: joinRequestsContract,
  access: accessContract,
  roles: rolesContract,
  // Scheduling access (spec 0037): delegations of See or Manage over someone's scheduling.
  scheduling: schedulingContract,
  realtime: realtimeContract,
  automations: automationsContract,
  jobs: jobsContract,
  usage: usageContract,
  views: viewsContract,
  trash: trashContract,
  tasks: tasksContract,
  notes: notesContract,
  // Comments and the inbox (spec 0038).
  comments: commentsContract,
  notifications: notificationsContract,
  calendar: calendarContract,
  home: homeContract,
  forms: formsContract,
  submissions: submissionsContract,
  bookingPages: bookingPagesContract,
  bookings: bookingsContract,
  schedules: schedulesContract,
  // Time off (spec 0037, AC-1281 to AC-1288): whole days away, with a reason and a stand in.
  timeOff: timeOffContract,
  // Meeting limits (spec 0037, AC-1297 to AC-1299): at most N meetings a day and a week per person, across every page.
  limits: limitsContract,
  // The Team week (spec 0037, AC-1289 to AC-1296): the roster over everyone's default schedules.
  availability: availabilityContract,
  rotations: rotationsContract,
  search: searchContract,
  recents: recentsContract,
  // The sidebar (spec 0034): each member's own order, folds, hidden items, favourites and rail.
  nav: navContract,
  // Settings › Account › Preferences: the caller's own time zone, date format, week start and landing page.
  preferences: preferencesContract,
  // Lead routing (spec 0043): the per rule report.
  routing: routingContract,
  // Settings › History › Workspace changes (spec 0046): the audit log, `audit.read` only.
  audit: auditContract,
  imports: importsContract,
  exports: exportsContract,
};
