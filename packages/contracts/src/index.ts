import { accessContract } from './access.ts';
import { attributesContract } from './attributes.ts';
import { bookingPagesContract, bookingsContract } from './booking/pages.ts';
import { schedulesContract } from './booking/schedules.ts';
import { rotationsContract } from './booking/rotations.ts';
import { bulkRecordsContract } from './bulk.ts';
import { calendarContract } from './calendar.ts';
import { commentsContract } from './comments.ts';
import { formsContract, submissionsContract } from './forms/forms.ts';
import { routingContract } from './forms/routing.ts';
import { jobsContract } from './jobs.ts';
import { meContract } from './me.ts';
import { navContract } from './navigation.ts';
import { notificationsContract } from './notifications.ts';
import { membersContract } from './members.ts';
import { objectsContract } from './objects.ts';
import { optionsContract } from './options.ts';
import { realtimeContract } from './realtime.ts';
import { recordsContract } from './records.ts';
import { linksContract, relationshipsContract } from './relations.ts';
import { recentsContract, searchContract } from './search.ts';
import { systemContract } from './system.ts';
import { invitationsContract } from './team.ts';
import { trashContract } from './trash.ts';
import { notesContract } from './notes.ts';
import { tasksContract } from './tasks.ts';
import { usageContract } from './usage.ts';
import { viewsContract } from './views.ts';
import { workspacesContract } from './workspaces.ts';

export * from './access.ts';
export * from './activity.ts';
export * from './attributes.ts';
export * from './board-model.ts';
export * from './booking/index.ts';
export * from './booking/blocks.ts';
export * from './booking/pages.ts';
export * from './booking/schedules.ts';
export * from './booking/rotations.ts';
export * from './bulk.ts';
export * from './bulk-ops.ts';
export * from './calendar.ts';
export * from './change-event.ts';
export * from './comments.ts';
export * from './errors.ts';
export * from './forms/index.ts';
export * from './jobs.ts';
export * from './csv.ts';
export * from './me.ts';
export * from './members.ts';
export * from './nav-model.ts';
export * from './navigation.ts';
export * from './notifications.ts';
export * from './objects.ts';
export * from './options.ts';
export * from './realtime.ts';
export * from './records.ts';
export * from './relations.ts';
export * from './search.ts';
export * from './system.ts';
export * from './trash.ts';
export * from './notes.ts';
export * from './tasks.ts';
export * from './team.ts';
export * from './usage.ts';
export * from './view-model.ts';
export * from './views.ts';
export * from './values/index.ts';
export * from './workspaces.ts';

/**
 * The one contract the web app, the API and the worker share. Each feature
 * adds its own namespace here. Every procedure outside the bootstrap list
 * (`system.*`, `me.get`, `workspaces.create`, `realtime.connectionToken`)
 * takes `WorkspaceScoped` input and is served behind the API's member door.
 */
export const contract = {
  system: systemContract,
  me: meContract,
  workspaces: workspacesContract,
  objects: objectsContract,
  attributes: attributesContract,
  options: optionsContract,
  // Bulk actions (spec 0022) join the records namespace from their own file.
  records: { ...recordsContract, ...bulkRecordsContract },
  relationships: relationshipsContract,
  links: linksContract,
  members: membersContract,
  invitations: invitationsContract,
  access: accessContract,
  realtime: realtimeContract,
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
  forms: formsContract,
  submissions: submissionsContract,
  bookingPages: bookingPagesContract,
  bookings: bookingsContract,
  schedules: schedulesContract,
  rotations: rotationsContract,
  search: searchContract,
  recents: recentsContract,
  // The sidebar (spec 0034): each member's own order, folds, hidden items, favourites and rail.
  nav: navContract,
  // Lead routing (spec 0043): the per rule report.
  routing: routingContract,
};
