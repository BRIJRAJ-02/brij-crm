// Drizzle tables live here, one file per area, re-exported from this index.
// Every tenant table carries workspace_id, forces row level security (the
// policies are hand written in migrations/), and has a primary key and indexes
// that lead with workspace_id (spec 0004).
export { actorType, attributeType, systemColumn } from './common.ts';
export { memberRole, memberStatus, members, workspaceCounters, workspaces } from './workspaces.ts';
export { attributes, lists, objects, relationshipCardinality, relationships } from './definitions.ts';
export { attributeOptions, optionOutcome } from './options.ts';
export { outbox, outboxKind } from './outbox.ts';
export { listEntries, recordLinks, records, sortKeys, values } from './records.ts';
export { jobItems, jobItemState, jobLane, jobs, jobStatus } from './jobs.ts';
export { workspaceMilestones } from './milestones.ts';
export { validationRuleKind, validationRules } from './validation.ts';
export { memberViewState, viewKind, views, viewVisibility } from './views.ts';
export { notes } from './notes.ts';
export { taskRecords, tasks } from './tasks.ts';
export { memberRecents } from './search.ts';
export {
  attendeeMatch,
  attendeeResponse,
  calendarBusyTimes,
  calendarConnections,
  calendarProvider,
  calendarSettings,
  calendarSharing,
  calendarStatus,
  meetingAttendees,
  meetingLinkVia,
  meetingRecords,
  meetings,
  meetingSources,
  meetingStatus,
} from './calendar.ts';
export { formSubmissionRecords, formSubmissions, formVersions, forms } from './forms.ts';
export {
  availabilitySchedules,
  bookingMemberHours,
  bookingPageMembers,
  bookingPages,
  bookings,
  bookingTimeBlocks,
} from './booking.ts';
export { exportChunks, exports } from './exports.ts';
export { auditEvents, invitations } from './team.ts';
export { emailPreferences, emails, emailStatus } from './emails.ts';
