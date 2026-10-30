import { accessRouter } from './modules/access/router.ts';
import { attributesRouter } from './modules/attributes/router.ts';
import { auditRouter } from './modules/audit/router.ts';
import { calendarRouter } from './modules/calendar/router.ts';
import { formsRouter } from './modules/forms/router.ts';
import { homeRouter } from './modules/home/router.ts';
import {
  bookingPagesRouter,
  bookingsRouter,
  rotationsRouter,
  routingRouter,
  schedulesRouter,
} from './modules/booking/router.ts';
import { exportsRouter } from './modules/exports/router.ts';
import { importsRouter } from './modules/imports/router.ts';
import { jobsRouter } from './modules/jobs/router.ts';
import { linksRouter } from './modules/links/router.ts';
import { invitationsRouter } from './modules/invitations/router.ts';
import { meRouter } from './modules/me/router.ts';
import { operatorRouter } from './modules/operator/router.ts';
import { membersRouter } from './modules/members/router.ts';
import { navRouter } from './modules/nav/router.ts';
import { joinRequestsRouter, joinRouter } from './modules/join/router.ts';
import { profileRouter } from './modules/profile/router.ts';
import { deletedWorkspaceRouter } from './modules/workspace/deleted.ts';
import { workspaceRouter } from './modules/workspace/router.ts';
import { rolesRouter } from './modules/roles/router.ts';
import { availabilityRouter, schedulingRouter, timeOffRouter } from './modules/scheduling/router.ts';
import { workspaceSecurityRouter } from './modules/security/router.ts';
import { objectsRouter } from './modules/objects/router.ts';
import { optionsRouter } from './modules/options/router.ts';
import { preferencesRouter } from './modules/preferences/router.ts';
import { realtimeRouter } from './modules/realtime/router.ts';
import { recordsRouter } from './modules/records/router.ts';
import { relationshipsRouter } from './modules/relationships/router.ts';
import { recentsRouter, searchRouter } from './modules/search/router.ts';
import { submissionsRouter } from './modules/submissions/router.ts';
import { systemRouter } from './modules/system/router.ts';
import { trashRouter } from './modules/trash/router.ts';
import { commentsRouter } from './modules/comments/router.ts';
import { notesRouter } from './modules/notes/router.ts';
import { notificationsRouter } from './modules/notifications/router.ts';
import { tasksRouter } from './modules/tasks/router.ts';
import { usageRouter } from './modules/usage/router.ts';
import { viewsRouter } from './modules/views/router.ts';
import { workspacesRouter } from './modules/workspaces/router.ts';
import { accountRouter } from './modules/account/router.ts';
import { base } from './orpc.ts';

// One module per feature under ./modules, each implementing its contract namespace.
export const router = base.router({
  system: systemRouter,
  me: meRouter,
  operator: operatorRouter,
  account: accountRouter,
  workspaces: workspacesRouter,
  objects: objectsRouter,
  attributes: attributesRouter,
  options: optionsRouter,
  records: recordsRouter,
  relationships: relationshipsRouter,
  links: linksRouter,
  members: membersRouter,
  workspaceSecurity: workspaceSecurityRouter,
  invitations: invitationsRouter,
  join: joinRouter,
  joinRequests: joinRequestsRouter,
  workspace: workspaceRouter,
  deletedWorkspace: deletedWorkspaceRouter,
  profile: profileRouter,
  access: accessRouter,
  roles: rolesRouter,
  scheduling: schedulingRouter,
  realtime: realtimeRouter,
  jobs: jobsRouter,
  usage: usageRouter,
  views: viewsRouter,
  trash: trashRouter,
  tasks: tasksRouter,
  notes: notesRouter,
  comments: commentsRouter,
  notifications: notificationsRouter,
  calendar: calendarRouter,
  home: homeRouter,
  forms: formsRouter,
  submissions: submissionsRouter,
  bookingPages: bookingPagesRouter,
  bookings: bookingsRouter,
  schedules: schedulesRouter,
  timeOff: timeOffRouter,
  availability: availabilityRouter,
  rotations: rotationsRouter,
  routing: routingRouter,
  audit: auditRouter,
  search: searchRouter,
  recents: recentsRouter,
  nav: navRouter,
  preferences: preferencesRouter,
  imports: importsRouter,
  exports: exportsRouter,
});
