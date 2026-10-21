import { accessRouter } from './modules/access/router.ts';
import { attributesRouter } from './modules/attributes/router.ts';
import { calendarRouter } from './modules/calendar/router.ts';
import { formsRouter } from './modules/forms/router.ts';
import { bookingPagesRouter, bookingsRouter } from './modules/booking/router.ts';
import { jobsRouter } from './modules/jobs/router.ts';
import { linksRouter } from './modules/links/router.ts';
import { invitationsRouter } from './modules/invitations/router.ts';
import { meRouter } from './modules/me/router.ts';
import { membersRouter } from './modules/members/router.ts';
import { rolesRouter } from './modules/roles/router.ts';
import { objectsRouter } from './modules/objects/router.ts';
import { optionsRouter } from './modules/options/router.ts';
import { realtimeRouter } from './modules/realtime/router.ts';
import { recordsRouter } from './modules/records/router.ts';
import { relationshipsRouter } from './modules/relationships/router.ts';
import { submissionsRouter } from './modules/submissions/router.ts';
import { systemRouter } from './modules/system/router.ts';
import { trashRouter } from './modules/trash/router.ts';
import { notesRouter } from './modules/notes/router.ts';
import { tasksRouter } from './modules/tasks/router.ts';
import { usageRouter } from './modules/usage/router.ts';
import { viewsRouter } from './modules/views/router.ts';
import { workspacesRouter } from './modules/workspaces/router.ts';
import { base } from './orpc.ts';

// One module per feature under ./modules, each implementing its contract namespace.
export const router = base.router({
  system: systemRouter,
  me: meRouter,
  workspaces: workspacesRouter,
  objects: objectsRouter,
  attributes: attributesRouter,
  options: optionsRouter,
  records: recordsRouter,
  relationships: relationshipsRouter,
  links: linksRouter,
  members: membersRouter,
  invitations: invitationsRouter,
  access: accessRouter,
  roles: rolesRouter,
  realtime: realtimeRouter,
  jobs: jobsRouter,
  usage: usageRouter,
  views: viewsRouter,
  trash: trashRouter,
  tasks: tasksRouter,
  notes: notesRouter,
  calendar: calendarRouter,
  forms: formsRouter,
  submissions: submissionsRouter,
  bookingPages: bookingPagesRouter,
  bookings: bookingsRouter,
});
