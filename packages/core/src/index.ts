// Domain services, shared by the api and the worker. No HTTP in here.
// One folder per feature; the access door (spec 0005, thin #9) is `access/`.
export { getSystemStatus, type SystemDeps } from './system/status.ts';
export * from './engine/index.ts';
export {
  enterPublicForm,
  enterWithKey,
  enterWorkspace,
  NO_RULE_SOURCE,
  type DoorDeps,
  type DoorInput,
  type DoorLog,
  type RuleSource,
} from './access/door.ts';
export {
  EVENT_KINDS,
  eventFacts,
  filterEvent,
  type Audience,
  type AudienceEvent,
  type AudienceMember,
  type EventFacts,
  type EventRow,
  type MeetingFact,
  type TaskFact,
} from './access/events.ts';
export {
  can,
  fieldLevel,
  filterRecordView,
  keyAccess,
  NO_RULES,
  objectLevel,
  OPEN_KEY,
  policyKey,
  readOnlyReason,
  recordRule,
  visibleAttributes,
  type Access,
  type AccessRules,
  type DataPolicy,
  type FieldLevel,
  type ObjectLevel,
  type Principal,
  type RecordRule,
} from './access/policy.ts';
export { isInvitedEmail } from './access/door.ts';
export {
  getMe,
  setLastWorkspace,
  startWorkspace,
  workspaceSlugAvailable,
  type AccountUser,
  type LastWorkspaceDeps,
  type SlugCheckDeps,
  type StartedWorkspace,
  type StartWorkspaceDeps,
} from './account/account.ts';
export { milestoneHook, type ReachedMilestone } from './milestones/milestones.ts';
export { type AuditSource } from './members/audit.ts';
export {
  acceptInvite,
  inviteMembers,
  listInvitations,
  peekInvite,
  resendInvite,
  revokeInvite,
  type AcceptedInvite,
  type AcceptingUser,
  type InviteOutcome,
  type InviteSender,
  type SentInvitation,
} from './members/invitations.ts';
export {
  archiveObject,
  createObject,
  editObject,
  listObjects,
  moveObject,
  restoreObject,
  type CreateObjectInput,
  type EditObjectInput,
} from './objects/objects.ts';
export { getUsage } from './objects/usage.ts';
export {
  archiveAttributes,
  createAttribute,
  editAttribute,
  listObjectAttributes,
  moveAttribute,
  restoreAttributes,
  type CreateAttributeInput,
  type EditAttributeInput,
  type NewAttributeOption,
} from './attributes/attributes.ts';
export {
  archiveOption,
  createOption,
  editOption,
  moveOption,
  restoreOption,
  type CreateOptionInput,
  type EditOptionInput,
} from './attributes/options.ts';
export {
  createRelationship,
  renameRelationship,
  type CreateRelationshipInput,
  type NewSide,
  type RelationshipAnswer,
  type RenameRelationshipInput,
} from './relationships/relationships.ts';
export {
  addRecord,
  bulkEditRecords,
  editRecord,
  editRecords,
  queryRecords,
  readRecordsById,
  readTrashedRecord,
  type AddRecordInput,
  type EditRecordInput,
  type RecordWindow,
} from './records/records.ts';
export {
  BULK_START_WORDS,
  deleteForever,
  startBulk,
  undoDelete,
  type StartBulkInput,
  type UndoDeleteAnswer,
} from './bulk/start.ts';
export { PURGE_DEPENDENTS, type PurgeDependent } from './engine/purge-dependents.ts';
export { BULK_KINDS, RECORD_LIVE } from './bulk/kinds.ts';
export {
  addRecordLinks,
  removeRecordLinks,
  type AddLinksInput,
  type LinksAnswer,
  type RemoveLinksInput,
} from './records/links.ts';
export {
  getView,
  listViews,
  saveViewQuery,
  VIEW_LOCKED,
  VIEW_NOT_FOUND,
  type SaveViewQueryInput,
} from './views/views.ts';
export {
  createView,
  deleteView,
  markViewOpened,
  moveView,
  setDefaultView,
  setViewLayout,
  setViewLocked,
  updateView,
  type CreateViewInput,
  type UpdateViewInput,
} from './views/manage.ts';
export {
  deleteNote,
  getNote,
  listNotes,
  NOTE_READ_ONLY,
  restoreNote,
  saveNote,
  UNKNOWN_NOTE,
  type SaveNoteInput,
} from './notes/notes.ts';
export {
  createTask,
  deleteTask,
  getTasks,
  listTasks,
  restoreTask,
  updateTask,
  type CreateTaskInput,
  type ListTasksInput,
  type UpdateTaskInput,
} from './tasks/tasks.ts';
export {
  connectCalendar,
  listCalendarConnections,
  removeCalendarConnection,
  syncCalendarNow,
  updateCalendarConnection,
  type ConnectCalendarInput,
  type UpdateCalendarConnectionInput,
} from './calendar/connections.ts';
export { listMeetingsForRecord, type ListMeetingsInput } from './calendar/meetings.ts';
export {
  addMeetingAttendee,
  readCalendarSettings,
  updateCalendarSettings,
  type AddMeetingAttendeeInput,
} from './calendar/people.ts';
export { takeCalendarNotice, type CalendarNotice, type NoticeOutcome } from './calendar/push.ts';
export {
  calendarEventsScope,
  createCalendarEvents,
  FREE_BUSY_MAX_DAYS,
  type CalendarEvents,
  type CalendarEventsDeps,
  type CreatedEvent,
  type CreateEventInput,
  type FreeBusyInput,
  type MemberBusy,
  type MoveEventInput,
  type SkippedCalendar,
} from './calendar/events.ts';
export {
  isProviderError,
  normaliseEmail,
  providerError,
  type BusyInterval,
  type CalendarChannel,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarProviderError,
  type CalendarTokens,
  type ExchangedTokens,
  type NewEvent,
  type ProviderAttendee,
  type ProviderChanges,
  type ProviderEvent,
  type ProviderResponse,
  type ProviderTime,
  type SyncWindow,
} from './calendar/provider.ts';
export { deriveKey, signValue, verifyValue } from './calendar/signing.ts';
export { decodeTokenKey, openTokens, sealTokens, type TokenBinding, type TokenKey } from './calendar/tokens.ts';
// Booking pages (spec 0025): members' pages and bookings, and the calendar calls the api passes in.
export {
  createBookingPage,
  deleteBookingPage,
  getBookingPage,
  getMemberHours,
  listBookingPages,
  listBookings,
  setMemberHours,
  updateBookingPage,
} from './booking/pages.ts';
export { createTimeBlock, removeTimeBlock, type TimeBlockDraft } from './booking/blocks.ts';
export { bookAsHost, HOST_BOOKING_MINUTES, type HostBookingDeps, type HostBookingInput } from './booking/host.ts';
export { listWorkspaceBookings, readBookingsCalendar } from './booking/list.ts';
// Changing a booking from Bookings (spec 0025, AC-640): its host moves or cancels it, or copies the guest's link.
export {
  bookingGuestPath,
  cancelBooking,
  hostTarget,
  MAX_GUESTS,
  MAX_RESCHEDULES,
  moveBooking,
  readMoveSlots,
  type ChangeDeps,
} from './booking/change.ts';
export { type ManageLinkKey } from './booking/tokens.ts';
export {
  createBusyCache,
  NO_CALENDAR,
  type BookingCalendar,
  type BookingEvent,
  type BusyAnswer,
  type BusyReader,
  type EventAttendee,
  type EventChange,
  type EventChanger,
  type EventRef,
  type EventWriter,
  type WrittenEvent,
} from './booking/calendar.ts';
export { connectedCalendar, type ConnectedCalendarDeps } from './booking/connected.ts';
export { BEST_CLEAR_MS, BEST_MAX, overlay, type Overlay, type OverlaySlot } from './booking/overlay.ts';
export { getMyAccess, listMembers, removeMember, setMemberRole, type MemberWithRole } from './members/members.ts';
export { outboxEvent, stubEvent, wireEvent } from './realtime/events.ts';
export {
  AUDIENCES_NEED_CHANNELS,
  isAudiencesNeedChannels,
  planDelivery,
  workspaceEvent,
  type Delivery,
} from './realtime/plan.ts';
export { audienceOf, catchUp, CATCH_UP_MAX_ROWS, createCollapse, workspaceHead } from './realtime/catch-up.ts';
export {
  cancelJob,
  confirmJob,
  getJob,
  listJobs,
  startJob,
  OVERDUE_MS,
  startTestJob,
  toJobView,
  type JobReadOptions,
  type StartJobInput,
  type TestJobInput,
} from './jobs/service.ts';
export {
  createRegistry,
  defineKind,
  kindContractProblems,
  MAX_ATTEMPTS,
  MAX_BATCH_SIZE,
  type AnyKind,
  type FailedJob,
  type ItemOutcome,
  type JobRegistry,
  type KindDefinition,
  type StepInput,
  type StepOutcome,
} from './jobs/registry.ts';
export { jobKinds, type JobKindsOptions } from './jobs/kinds/index.ts';
export { MAINTENANCE_DAILY, type QueueRows } from './jobs/kinds/maintenance-daily.ts';
export { SIMULATED_REFUSAL } from './jobs/kinds/dev-simulate.ts';
export {
  createRunner,
  retryDelayMs,
  SNAPSHOT_PAGE,
  type Runner,
  type RunnerDeps,
  type RunnerLog,
  type SliceOutcome,
} from './jobs/runner.ts';
// Forms (spec 0023): building and publishing forms, their submissions, the public form and submit, and processing a
// submission into records (the `forms.process` kind, registered in `jobKinds`).
export {
  createForm,
  deleteForm,
  duplicateForm,
  formAttributes,
  getForm,
  isSlugAvailable,
  listForms,
  newPublicKey,
  previewForm,
  publishForm,
  saveFormDraft,
  setFormStatus,
  setFormTarget,
  SLUG_TAKEN_MESSAGE,
  UNKNOWN_FORM,
  UNTITLED_FORM,
  updateFormSettings,
  type CreateFormInput,
  type FormSettingsInput,
  type PublishInput,
  type SaveDraftInput,
} from './forms/forms.ts';
export {
  FORM_CLOSED_MESSAGE,
  getPublicForm,
  postingRules,
  submitForm,
  type PostingRules,
  type SubmitInput,
  type SubmitOutcome,
} from './forms/public.ts';
export type { CaptchaVerdict, SpamJudgement, TicketVerdict } from './forms/spam.ts';
export { addToCrm, FORMS_FILE, FORMS_SYNC, previewSync, startSync } from './forms/filing.ts';
export {
  exportFile,
  exportPart,
  FORMS_EXPORT,
  getExport,
  startSubmissionsExport,
  UNKNOWN_EXPORT,
  type ExportRecord,
} from './forms/export.ts';
export {
  deleteSubmission,
  getSubmission,
  listSubmissions,
  markSubmissionSpam,
  releaseSubmission,
  resolveSubmission,
  retrySubmission,
  UNKNOWN_SUBMISSION,
} from './forms/submissions.ts';
export {
  chooseOwner,
  FORMS_PROCESS,
  formsProcess,
  processSubmission,
  PROCESS_GAVE_UP,
  type Assignment,
} from './forms/process.ts';
// Queued email (the emails lane): one `emails` row and its queue row in the caller's transaction, ids only on the queue.
export {
  emailKey,
  queueBookingCalendarRemoved,
  queueCalendarDisconnected,
  queueEmail,
  queueEmails,
  queueFormConfirmation,
  queueFormSubmissionNotice,
  queueImportFinished,
  queueMention,
  type EmailReader,
  type QueuedEmail,
  type QueueEmailInput,
} from './emails/queue.ts';
export {
  EMAIL_LINK_DAYS,
  emailLinkToken,
  readEmailLinkToken,
  type EmailLink,
  type EmailLinkKey,
  type EmailLinkPurpose,
} from './emails/preferences.ts';
