// Domain services, shared by the api and the worker. No HTTP in here.
// One folder per feature; the access door (spec 0005, thin #9) is `access/`.
export { getSystemStatus, type SystemDeps } from './system/status.ts';
export * from './engine/index.ts';
// A company's logo from our own origin (spec 0059): the address a record's picture names, and which domains may have one.
export { companyLogoPath, isLogoDomain, LOGO_PATH } from './engine/logos.ts';
export {
  enterDeletedWorkspace,
  enterPublicForm,
  enterWithKey,
  enterWorkspace,
  type DeletedEntry,
  NO_RULE_SOURCE,
  type DoorDeps,
  type DoorInput,
  type DoorLog,
  type DoorSession,
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
// Account security (spec 0033): the signed in person's own sessions, and what device a session is on.
export {
  isFresh,
  listMySessions,
  revokeMyOtherSessions,
  revokeMySession,
  SESSION_CURSOR_MESSAGE,
  STEP_UP_MESSAGE,
  UNKNOWN_SESSION,
  type SessionCaller,
  type SessionsDeps,
} from './account/sessions.ts';
export { deviceLabel, deviceParts, type DeviceParts } from './account/device.ts';
export {
  accountSecurity,
  CODE_INVALID_MESSAGE,
  EMAIL_CODE_EXPIRED_MESSAGE,
  EMAIL_CODE_INVALID_MESSAGE,
  FRESH_MESSAGE,
  NO_SECOND_FACTOR,
  requireFresh,
  SECOND_FACTOR_MESSAGE,
  sessionFreshness,
  startStepUp,
  USE_SECOND_FACTOR,
  verifyStepUp,
  type FreshnessDeps,
  type StepUpDeps,
} from './account/step-up.ts';
// Deleting your own account (spec 0033, AC-902 to AC-907).
export {
  accountDeletionCheck,
  deletedEmail,
  deleteMyAccount,
  DELETED_USER_NAME,
  EMAIL_MISMATCH,
  type AccountDeletionDeps,
  type CalendarGrant,
  type DeletingCaller,
} from './account/deletion.ts';
export {
  getWorkspaceSecurity,
  OWNER_NEEDS_TWO_FACTOR_MESSAGE,
  setWorkspaceSecurity,
  signOutEveryone,
  twoFactorRequiredBy,
  type RequiredByDeps,
  type SecondFactorUsers,
  type WorkspaceSecurityChange,
  type WorkspaceSecurityDeps,
} from './account/workspace-security.ts';
export { closeJoinRequestsOf } from './account/join-requests.ts';
export {
  ACTIVITY_PAGE,
  alertNewDevice,
  deviceKey,
  listMyActivity,
  sweepAccountHistory,
  type SignInAlert,
  type SignInAlertDeps,
} from './account/activity.ts';
export { milestoneHook, type ReachedMilestone } from './milestones/milestones.ts';
export { type AuditSource } from './members/audit.ts';
// Settings › Workspace › General, the owner's delete and restore, and Account › Profile (spec 0031, slice 7).
export {
  deleteWorkspace,
  getWorkspaceSettings,
  restoreWorkspace,
  updateWorkspace,
  type UpdatedWorkspace,
  type WorkspaceDeletion,
  type WorkspaceRestoration,
} from './workspace/settings.ts';
export { getMyProfile, showMyLinkPage, updateMyMemberProfile, type ProfileExtras } from './members/profile.ts';
// The link page's blocks (spec 0051): the caller's own, in schema auth, through crm_handle's definers.
export {
  archiveProfileItem,
  deleteProfileItem,
  listProfileFormChoices,
  saveProfileTheme,
  saveProfileShareImage,
  setProfileIndexable,
  listProfilePageChoices,
  orderProfileItems,
  readProfileCounts,
  readProfileItems,
  importProfileLinks,
  saveProfileItem,
} from './profile/items.ts';
// A person's own account picture from our origin (23 Oct 2026): only Google's account pictures, with their version.
export {
  personPicture,
  servedPicture,
  storedPictureImage,
  storedPictureOf,
  storedPicturePath,
  type AccountPicture,
  type PersonPicture,
} from './booking/picture.ts';
export {
  acceptInvite,
  getInviteLink,
  inviteMembers,
  listInvitations,
  peekInvite,
  resendInvite,
  revokeInvite,
  setInviteLink,
  typedMemberName,
  type AcceptedInvite,
  type AcceptingUser,
  type InviteOutcome,
  type InviteSender,
  type SentInvitation,
} from './members/invitations.ts';
export {
  decideJoinRequest,
  getWorkspaceDomains,
  listJoinable,
  listJoinRequests,
  requestToJoin,
  setWorkspaceDomains,
  type JoinDecision,
  type RequestNotice,
  type SessionPerson,
} from './members/domain-join.ts';
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
export { countRecordsByObject, getUsage } from './objects/usage.ts';
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
export { attributeImpact } from './attributes/impact.ts';
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
  CELL_NOT_WRITABLE,
  copyFiledFile,
  prepareRecordFile,
  readRecordFile,
  RECORD_FILES_PER_RECORD,
  recordFilePath,
  registerRecordFile,
  TOO_MANY_RECORD_FILES,
  UNKNOWN_RECORD_FILE,
  type CopyFiledFile,
  type ReadableRecordFile,
  type RecordFileStore,
  type RegisterRecordFile,
} from './records/files.ts';
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
// The sidebar (spec 0034): each member's own row, read through the door and changed one operation at a time.
export { changeNav, readNav } from './navigation/navigation.ts';
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
  commentVersions,
  createComment,
  deleteComment,
  getThreads,
  listThreads,
  NOT_YOUR_COMMENT,
  setThreadResolved,
  THREAD_FULL,
  toggleReaction,
  UNKNOWN_COMMENT,
  updateComment,
  type CreateCommentInput,
} from './comments/comments.ts';
export {
  countUnread,
  DEFAULT_NOTIFICATION_SETTINGS,
  getNotificationSettings,
  listNotifications,
  markAllRead,
  markNotifications,
  setNotificationSettings,
  UNKNOWN_NOTIFICATION,
  type ListNotificationsInput,
  type MarkNotificationsInput,
  type SetNotificationSettingsInput,
} from './notifications/inbox.ts';
export {
  countDueTasks,
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
// Calendars (spec 0024 milestone 5): every calendar of each account, its switches, and where bookings go.
export {
  dismissCalendarNotice,
  listMemberCalendars,
  refreshCalendarConnection,
  setCalendarDestination,
  updateMemberCalendar,
  type MemberCalendars,
  type UpdateCalendarInput,
  type UpdatedCalendar,
} from './calendar/calendars.ts';
export { readPageDestination, setPageDestination, type PageDestination } from './calendar/page-destination.ts';
// Calendar health for a team (spec 0037, AC-1307): statuses only.
export { readCalendarHealth } from './calendar/health.ts';
// Ask to reconnect (spec 0037, AC-1309): a colleague in See reach, once per member per 24 hours.
export { askToReconnect, CALENDAR_HEALTH, type ReconnectAskOutcome } from './calendar/health-notices.ts';
export { nearestHue } from './calendar/hues.ts';
export { listMeetingsForRecord, type ListMeetingsInput } from './calendar/meetings.ts';
export {
  addMeetingAttendee,
  readCalendarSettings,
  updateCalendarSettings,
  type AddMeetingAttendeeInput,
} from './calendar/people.ts';
export {
  takeCalendarNotice,
  type CalendarNotice,
  type ChannelReport,
  type NoticeOutcome,
  type NoticeResult,
} from './calendar/push.ts';
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
  failureOf,
  isProviderError,
  normaliseEmail,
  PRIMARY_CALENDAR,
  providerError,
  type ProviderAnswer,
  type ProviderFailure,
  type BusyInterval,
  type CalendarAccessRole,
  type CalendarBusy,
  type CalendarChannel,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarProviderError,
  type CalendarTokens,
  type CreatedProviderEvent,
  type ExchangedTokens,
  type NewEvent,
  type ProviderCalendar,
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
  bookingPageAttributes,
  createBookingPage,
  deleteBookingPage,
  getBookingPage,
  listBookingPages,
  listBookings,
  reorderProfilePages,
  updateBookingPage,
} from './booking/pages.ts';
// Availability schedules (spec 0035): a member's named hours, the one the slot engine resolves for a page, and the
// default schedule's hours behind `bookings.hours` and `bookings.setHours`.
export {
  createSchedule,
  deleteSchedule,
  duplicateSchedule,
  getSchedule,
  listScheduleMembers,
  listSchedules,
  readDefaultHours,
  saveDefaultHours,
  setDefaultSchedule,
  updateSchedule,
} from './availability/schedules.ts';
export { defaultSchedule, scheduleFor, type ResolvedSchedule } from './availability/resolve.ts';
export { createTimeBlock, removeTimeBlock, type TimeBlockDraft } from './booking/blocks.ts';
export { bookAsHost, HOST_BOOKING_MINUTES, type HostBookingDeps, type HostBookingInput } from './booking/host.ts';
export { listMeetings, listWorkspaceBookings, readBookingsCalendar } from './booking/list.ts';
export { readTeamToday } from './home/team-today.ts';
export {
  createHomeMetricsCache,
  readHomeMetrics,
  type HomeMetricsCache,
  type WorkspaceFigures,
} from './home/metrics.ts';
// Changing a booking from Bookings (spec 0025, AC-640): its host moves or cancels it, or copies the guest's link,
// and links it to a record by hand (polish F2).
export {
  bookingGuestPath,
  cancelBooking,
  linkBookingRecord,
  markNoShow,
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
export {
  getMyAccess,
  leaveWorkspace,
  listMembers,
  listRoles,
  previewRemoval,
  removeMember,
  setMemberRole,
  transferOwnership,
  type MemberWithRole,
  type MemberWriteOptions,
  type RemovedMember,
} from './members/members.ts';
export {
  grantDelegation,
  listDelegations,
  revokeDelegation,
  type DelegationWriteOptions,
} from './scheduling/delegations.ts';
export { listVisibleMembers } from './scheduling/visible.ts';
export { copyWeek, readTeamWeek, setDayHours, setUsualHours } from './availability/team-week.ts';
export { createTimeOff, deleteTimeOff, listTimeOff, updateTimeOff } from './scheduling/time-off.ts';
export { getLimits, limitsAt, setLimits } from './scheduling/limits.ts';
export { PREFERENCES_MEMBERS_ONLY, readMyPreferences, updateMyPreferences } from './members/preferences.ts';
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
  isOverdue,
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
  type SucceededJob,
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
  rotateFormSecret,
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
export { workspacePublicKey } from './forms/shared.ts';
export {
  FORM_CLOSED_MESSAGE,
  getPublicForm,
  postingRules,
  submitForm,
  visitorOf,
  type BookingHandoff,
  type PostingRules,
  type SignHandoff,
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
  attachUploads,
  claimUploads,
  discardUpload,
  prepareUpload,
  readUpload,
  registerUpload,
  UNKNOWN_FILE,
  UPLOADS_OPEN_PER_FORM,
  type ReadableUpload,
  type RegisterUpload,
  type UploadStore,
} from './forms/uploads.ts';
export {
  chooseOwner,
  FORMS_PROCESS,
  formsProcess,
  processSubmission,
  PROCESS_GAVE_UP,
  type Assignment,
} from './forms/process.ts';
// A new membership's link page (26 Oct 2026): the editor's path its approval email links to.
export { linkPageEditPath } from './members/welcome.ts';
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
// Round robin (spec 0029): rotations, and why a booking went to its host.
export { createRotation, deleteRotation, listRotations, updateRotation } from './rotation/rotations.ts';
export { bookingAssignments } from './rotation/assignments.ts';
export { reassignBooking, reassignUpcoming, type Reseated } from './rotation/reassign.ts';
export { adjustCount, rotationDistribution, undoAdjustment } from './rotation/distribution.ts';
// Lead routing (spec 0043): deciding a route, a surface's report.
export { decideRoute, recordFactKeys, type RouteDecision } from './routing/decide.ts';
export { routingReport } from './routing/report.ts';
export { searchWorkspace, type GlobalSearchInput } from './search/search.ts';
export { listRecents, visitRecent, RECENTS_KEPT, type RecentVisit } from './search/recents.ts';
export {
  checkImportLinks,
  checkImportMatches,
  createImport,
  getImport,
  listImportRefusals,
  RECORDS_IMPORT,
  RECORDS_IMPORT_UNDO,
  stageImportRows,
  startImport,
  undoImport,
} from './imports/service.ts';
export { recordsImport } from './imports/kind.ts';
/** The import's undo kind (spec 0040): created records to the trash, changed values back unless edited since. */
export { recordsImportUndo } from './imports/undo.ts';
/** Records exports (spec 0040): a view's records as CSV, on the submissions export's rows, chunks and download. */
export { getRecordsExport, recordsExport, startRecordsExport, type RecordsExportRecord } from './exports/records.ts';
// The operator console (spec 0047): the super admin's read only analytics, behind the api's operator gate.
export {
  operatorOverview,
  operatorPage,
  operatorPages,
  operatorSite,
  operatorUser,
  operatorUsers,
  periodDays,
  type OperatorDeps,
  type PeriodDays,
} from './operator/reads.ts';
/**
 * Settings › History › Workspace changes (spec 0046): `listAuditEvents` pages the audit log for `audit.read`, and
 * `toEntryView` is its pure row mapping (only known keys, never a linked record, AC-4610).
 */
export { listAuditEvents, AUDIT_CURSOR_MESSAGE } from './audit/audit.ts';
export { toEntryView, type AuditNames, type AuditRow } from './audit/view.ts';
/**
 * Bringing somebody's link in bio page across (spec 0055, AC-5524, AC-5525): the hosts we will read, and the
 * parser that turns one of their pages into rows. Both are pure — no network and no database — and they are
 * exported here as well as from `@crm/core/public` because the import is a signed in person's own write, not a
 * public page's read, so the api reaches them from a module router rather than from `src/public/`.
 */
export { isImportableHost, readImportedPage, LINK_IMPORT_HOSTS, LINK_IMPORT_MAX } from './booking/link-import.ts';
export type { ImportedPage, ImportedRow, ImportSkip, SkippedRow } from './booking/link-import.ts';
