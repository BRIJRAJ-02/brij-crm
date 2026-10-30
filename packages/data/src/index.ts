// The one client data layer (spec 0005, the thin start of #6). Screens and
// routes read and write through it and never call the network themselves.
// It holds who is signed in, the workspace's objects, members and attributes,
// creating a workspace, sign in, the status check, and the records: one
// store, a view per object, and optimistic creates and edits (loaded when a
// screen first asks for records), patched in place by live change events
// while a screen shows a workspace (the realtime client loads with the first).
import type {
  ActivityKind,
  RecordsExportView,
  StartExportInput,
  ImportLinks,
  ImportMatches,
  ImportRows,
  ImportSettings,
  ImportView,
  StagedRow,
  StageResult,
  AddToCrmResult,
  CalendarProvider,
  ExportView,
  SubmissionSelection,
  SyncPreview,
  SyncScope,
  SyncStarted,
  AttributeDefinition,
  AttributeImpact,
  BookAsHostInput,
  BookingAssignment,
  ReassignedBooking,
  RotationAdjustment,
  ReassignedUpcoming,
  RotationDistribution,
  RotationMemberInput,
  RotationSettings,
  RotationView,
  RoutingRules,
  TeamHosts,
  TaskMine,
  BulkAction,
  BulkEdit,
  BulkTarget,
  BookingAvailability,
  CreateTimeBlockInput,
  TimeBlockOccurrence,
  TimeBlockView,
  BookingsTab,
  BookingHosts,
  PublicSlots,
  BookingPageSettings,
  BookingPageView,
  BookingView,
  AttributeOption,
  PickerAttributeType,
  CreateFormInput,
  CreateWorkspaceInput,
  contract,
  FormDocument,
  FormStatus,
  FormSummary,
  FormTargetChoices,
  FormView,
  PublishFormInput,
  SaveFormDraftInput,
  InvitationView,
  InvitePeek,
  InviteResult,
  InviteLinkView,
  Joinable,
  JoinRequestView,
  JobView,
  Me,
  MemberView,
  MyAccess,
  ObjectSummary,
  SetRoleResult,
  RecordView,
  SessionLengthDays,
  WorkspaceSecurity,
  ActivityPage,
  RelationshipView,
  Role,
  ScheduleMember,
  RemovalPreview,
  RolesList,
  SubmissionState,
  Usage,
  ValidationRuleInput,
  View,
  ViewLayout,
  ViewVisibility,
  RecentItem,
  WorkspaceDomainsView,
  DeletedWorkspace,
  MyProfile,
  SocialLink,
  WorkspaceSettings,
} from '@crm/contracts';
import type { GlobalSearch } from './search/global.ts';
import type { RecordRefDisplay as LinkedRecordDisplay } from '@crm/contracts/values';
import type { InviteLinkDays } from '@crm/contracts/team-limits';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { ActivityFeed, ActivityFeeds } from './activity/feed.ts';
import type { LinkSection, LinkSections, SectionKey } from './links/sections.ts';
import type { AuditLog } from './audit/log.ts';
import { createAuth } from './auth/auth.ts';
import { createTrashedLookups, type TrashedSource } from './records/trashed.ts';
import { createRecordFactsStore, type RecordFacts } from './records/facts.ts';
import {
  type DataError,
  type DataFault,
  isUnseenFault,
  parseRetryAfter,
  toDataError,
  withRetryAfter,
} from './errors.ts';
import type { FetchLike } from './fetch.ts';
import { refusalFor, refusalSummary } from './refusals.ts';
import { delivered } from './delivered.ts';
import { stageChunks } from './imports/stage.ts';
import { createJobsStore, type JobsScope, type JobsView, type TestJobSettings } from './jobs/store.ts';
import { createBookingsStore, type BookingsCalendarHeld, type BookingsView } from './bookings/store.ts';
import {
  createHomeStore,
  type HomeHeld,
  type HomeMetricsState,
  type HomeRecentsState,
  type TeamTodayState,
} from './home/store.ts';
import {
  createRoutingReports,
  type RoutingReportDays,
  type RoutingReportHeld,
  type RoutingReportSurface,
} from './routing/reports.ts';
import { createPageRules, type PageRulesHeld } from './routing/page-rules.ts';
import {
  createAccountSecurityStore,
  isFresh as isSessionFresh,
  type AccountSecurityView,
  type StepUpResult,
} from './account/security.ts';
import { createAccountSessionsStore, type AccountSessionsView, type SignOutOthersResult } from './account/sessions.ts';
import type { EmailPreferencesStore, EmailUnsubscribeStore } from './email-preferences.ts';
import {
  connectUrl,
  createCalendarStore,
  type CalendarSettingsHeld,
  type CalendarView,
  type ConnectReturn,
} from './calendar/store.ts';
import { lazySchedules } from './schedules/lazy.ts';
import type { SchedulingAccessStore } from './scheduling/access.ts';
export type {
  DelegationGrant,
  DelegationsHeld,
  DelegationsScope,
  DelegationsState,
  DelegationTarget,
  DelegationView,
  SchedulingAccessStore,
  SchedulingLevel,
  VisibleMember,
} from './scheduling/access.ts';
export type {
  TimeOffBooking,
  TimeOffDraft,
  TimeOffEntry,
  TimeOffHeld,
  TimeOffList,
  TimeOffReason,
  TimeOffSaved,
  TimeOffState,
  TimeOffStore,
} from './scheduling/time-off.ts';
export type {
  DayHours,
  TeamWeek,
  TeamWeekDay,
  TeamWeekHeld,
  TeamWeekRow,
  TeamWeekSource,
  TeamWeekState,
  TeamWeekStore,
  TeamWeekTotal,
  WeeklyHours,
} from './scheduling/team-week.ts';
import {
  createPreferencesStore,
  type MemberPreferences,
  type PreferencesChange,
  type PreferencesHeld,
} from './preferences/store.ts';
export type {
  DateFormat,
  HomeHidden,
  HomeSectionKey,
  LandingPage,
  MemberPreferences,
  PreferencesChange,
  PreferencesHeld,
  PreferencesState,
  WeekStart,
} from './preferences/store.ts';
import type { SchedulesView } from './schedules/store.ts';
import { createPictureChoiceStore, type PictureChoiceHeld } from './profile/picture.ts';
import type { LinkPageStore } from './link-page/store.ts';
export type { BlockDraft, BlockProblems, LinkPageHeld, LinkPageState, LinkPageStore } from './link-page/store.ts';
export type { PictureChoiceHeld, PictureChoiceState } from './profile/picture.ts';
import type { SocialLinksAccess, SocialLinksStore } from './profile/socials.ts';
export type { SocialLinksAccess, SocialLinksHeld, SocialLinksState } from './profile/socials.ts';
import { createMeetingsStore, type MeetingsHeld, type MeetingsQuery } from './bookings/meetings.ts';
import { createOperatorStore } from './operator/store.ts';
import {
  createCalendarsStore,
  type CalendarChange,
  type CalendarListState,
  type CalendarsHeld,
  type PageDestinationState,
} from './calendar/calendars.ts';
import {
  createCaptureList,
  dropItem,
  patchItem,
  shownDrop,
  shownPatch,
  upsertFirst,
  type CaptureListView,
} from './captures/list.ts';
import type { NavOperation, NavUniverse } from '@crm/contracts/navigation';
import type { NavChangeOptions, NavSnapshot, NavSource, NavStore } from './navigation/store.ts';
import { draftParam, isSameQuery, readDraft, type DraftQuery } from './views/draft.ts';
import {
  createViewsStore,
  type KeptDraft,
  type NewView,
  type SavedViewSource,
  type SaveQueryInput,
  type ViewsListSource,
} from './views/store.ts';
import type { NewTask, TaskChange, TaskList, TasksStore, TaskSubscription } from './tasks/store.ts';
import { createDueTasks, type DueTasksSource } from './tasks/due.ts';
import type { NoteList, NoteSession, NotesStore } from './notes/store.ts';
import type { CommentEmoji, CommentVersion, NotificationKind, NotificationStatus } from '@crm/contracts';
import type { CommentsStore, NewComment, RecordComments } from './comments/store.ts';
import type {
  InboxFilter,
  InboxList,
  InboxMark,
  InboxSettings,
  InboxStore,
  NotificationSettingsChange,
} from './inbox/store.ts';
import { createUnreadCounts, type UnreadSource } from './inbox/unread.ts';
import type { createLive, Granted, Live, LiveStatus } from './live/live.ts';
import { createMutationLog } from './live/mutations.ts';
import { createLiveRouter } from './live/router.ts';
import type { Notice } from './notice.ts';
import { createPendingOptions } from './options.ts';
import { nextHue } from '@crm/contracts/picker';
import { MEMBERS_PAGE_MAX } from '@crm/contracts/team-limits';
import type { UndoKind } from './records/history.ts';
import type { RecordAttributes, RecordSubscription } from './records/one.ts';
import { createRecordSearch, type RecordSearch } from './records/search.ts';
import { createBookingLink } from './bookings/link.ts';
import type { BoardQuery, BoardStore } from './records/board.ts';
import { lazyAggregateSource, type AggregateQuestion, type AggregateSource } from './records/aggregate-source.ts';
import type { PurgeSummary, RestoreSummary, Trash, TrashView } from './trash/store.ts';
import type {
  BulkEditRequest,
  BulkEditResult,
  CellChange,
  DeleteResult,
  EditOutcome,
  LinkCell,
  LinkChange,
  LinkOutcome,
  ObjectShape,
  RecordsApi,
  RecordsLayer,
  RecordsView,
  ReplacedNotice,
  UndoOutcome,
  ViewQuery,
} from './records/layer.ts';

export type { GlobalSearch, GlobalSearchState } from './search/global.ts';
export type { NoteHit, RecentItem, RecordHit, SearchMatch, TaskHit, ViewHit } from '@crm/contracts';
// The operator console (spec 0047): the super admin's read only analytics.
export type {
  OperatorHeld,
  OperatorState,
  OperatorStore,
  OperatorUsersHeld,
  OperatorUsersState,
} from './operator/store.ts';
export type {
  OperatorFigure,
  OperatorOverview,
  OperatorOverviewDay,
  OperatorPageDay,
  OperatorPageDetail,
  OperatorPageRow,
  OperatorPages,
  OperatorPageTotals,
  OperatorPeriod,
  OperatorRank,
  OperatorSite,
  OperatorUserDetail,
  OperatorUserPage,
  OperatorUserRow,
  OperatorUserWorkspace,
} from '@crm/contracts';
export type {
  CreateTimeBlockInput,
  TimeBlockKind,
  TimeBlockOccurrence,
  TimeBlockRepeat,
  TimeBlockView,
} from '@crm/contracts';
export type {
  CalendarConnectionView,
  CalendarConnections,
  CalendarSharing,
  CalendarStatus,
  CalendarProvider,
  CalendarAccountView,
  CalendarList,
  CalendarView as CalendarItem,
  MeetingView,
  PageDestinationView,
} from '@crm/contracts';
export type {
  ActorDisplay,
  ApiRefusal,
  AttributeValidation,
  BookingAvailability,
  BookingAnswer,
  BookingListItem,
  PublicSlots,
  BookingLocation,
  BookingsCalendarView,
  BookingsTab,
  BookingHosts,
  HomeMetricsView,
  TeamTodayItem,
  TeamTodayMember,
  TeamTodayView,
  WeekCount,
  WeekMoney,
  CalendarEventItem,
  MeetingListItem,
  MeetingSource,
  BookingPageSettings,
  BookingPageView,
  BookingView,
  BookingAssignment,
  ReassignedBooking,
  RotationAdjustment,
  ReassignedUpcoming,
  RotationDistribution,
  RotationMemberInput,
  RotationMemberView,
  RotationSettings,
  RotationView,
  Route,
  RoutingReport,
  RoutingReportRow,
  RoutingRule,
  RoutingRules,
  ShowWhen,
  TeamHosts,
  DateOverride,
  TimeRange,
  Weekday,
  ValidationRuleInput,
  ValidationRuleView,
  AttributeDefinition,
  AttributeImpact,
  AttributeOption,
  AttributeRelationship,
  AttributeType,
  Cardinality,
  PickerAttributeType,
  CreatedWorkspace,
  CreateWorkspaceInput,
  OnboardingAnswers,
  OnboardingArea,
  OnboardingRole,
  OnboardingTeamSize,
  FormAttributeChoice,
  FormDocument,
  FormLook,
  FormQuestion,
  FormStatus,
  FormSummary,
  FormTargetChoices,
  FormView,
  PublicForm,
  AnswerType,
  InputIssue,
  JobStatus,
  InvitationView,
  InvitePeek,
  InviteResult,
  JobView,
  Me,
  MemberSummary,
  InviteLinkView,
  Joinable,
  JoinRequestView,
  MembersPage,
  MemberView,
  MyAccess,
  NotificationKind,
  NotificationSettings,
  NotificationStatus,
  NotificationView,
  ObjectSummary,
  Permission,
  SessionLengthDays,
  WorkspaceSecurity,
  ActivityPage,
  SecurityActivity,
  AuditChange,
  AuditEntryView,
  AuditKind,
  AuditPerson,
  AuditTarget,
  AuditValue,
  Role,
  RemovalPreview,
  RoleOption,
  RolesList,
  RecordRefDisplay,
  RecordView,
  RelationshipView,
  SearchResult,
  SignedInUser,
  AddToCrmResult,
  ExportView,
  SubmissionAnswer,
  SubmissionCrm,
  SubmissionPage,
  SubmissionSelection,
  SubmissionRecord,
  SubmissionState,
  SubmissionSummary,
  SubmissionView,
  TaskMine,
  SyncPreview,
  SyncScope,
  SyncStarted,
  TaskTotal,
  TaskView,
  Note,
  NoteSummary,
  SystemStatus,
  TrashedRecord,
  Usage,
  UsageCount,
  WorkspaceDomainsView,
  WorkspaceSummary,
  DeletedWorkspace,
  MyProfile,
  ProfileBlock,
  ProfileCounts,
  ProfileBlockKind,
  ProfileItem,
  ProfileLinkIcon,
  ProfileLinkImport,
  SkippedImportRow,
  PageTheme,
  ProfileFormChoice,
  ProfileFormFacts,
  ProfilePageChoice,
  ProfilePageFacts,
  PublicProfileItem,
  PublicSocialLink,
  SocialLink,
  SocialLinkNetwork,
  WorkspaceSettings,
} from '@crm/contracts';
export type { ActivityKind } from '@crm/contracts';
export type {
  ActivityEntryShape,
  ActivityFeed,
  ActivityState,
  ActivityStatus,
  ChangeEntryShape,
  EntrySource,
  LinkedRecordShape,
  MeetingAttendeeShape,
} from './activity/feed.ts';
export type { LinkSection, LinkSectionState, LinkSectionStatus, SectionKey } from './links/sections.ts';
/** How many related records an Overview card shows per side (spec 0017, AC-383). */
export { RELATED_PREVIEW } from '@crm/contracts/activity-keys';
// The link page's look (spec 0054): the default and the named starting points are values the editor presses, not
// only types, so they come through the one data layer like every other shape a screen uses.
export { DEFAULT_PAGE_THEME, PAGE_THEME_PRESETS, sameTheme } from '@crm/contracts';
export type { BookingsCalendarHeld, BookingsCalendarState, BookingsState, BookingsView } from './bookings/store.ts';
export type { HomeHeld, HomeMetricsState, HomeRecentsState, TeamTodayState } from './home/store.ts';
export type {
  RoutingReportDays,
  RoutingReportHeld,
  RoutingReportState,
  RoutingReportSurface,
} from './routing/reports.ts';
export type { AuditLog, AuditLogState, AuditLogStatus } from './audit/log.ts';
export type { PageRulesHeld } from './routing/page-rules.ts';
export type {
  EmailPreference,
  EmailPreferencesState,
  EmailPreferencesStore,
  EmailPreferencesView,
  EmailTopic,
  EmailUnsubscribed,
  EmailUnsubscribeState,
  EmailUnsubscribeStore,
} from './email-preferences.ts';
export type { ScheduleList, ScheduleMember, ScheduleUser, ScheduleView } from '@crm/contracts';
export type { SchedulesState, SchedulesView } from './schedules/store.ts';
export type { MeetingsHeld, MeetingsQuery, MeetingsState } from './bookings/meetings.ts';
export type { AccountSessionsState, AccountSessionsView, SignOutOthersResult } from './account/sessions.ts';
export {
  isFresh as isSessionFresh,
  type AccountSecurityState,
  type AccountSecurityView,
  type StepUpResult,
} from './account/security.ts';
export type { SecondFactorKind, SignInOutcome, TwoFactorSetup } from './auth/auth.ts';
export type { StepUpMethod } from '@crm/contracts';
export type { AccountSession, DeletionBlocker } from '@crm/contracts';
export { SESSION_LENGTH_DAYS, STEP_UP_MINUTES } from '@crm/contracts/account-limits';
export type { CalendarSettingsHeld, CalendarSettingsState, CalendarState, CalendarView } from './calendar/store.ts';
export type {
  CalendarChange,
  CalendarListState,
  CalendarsHeld,
  CalendarsHeldState,
  PageDestinationState,
} from './calendar/calendars.ts';
export type { CaptureListState, CaptureListView } from './captures/list.ts';
export { connectUrl, needsReconnect, type ConnectReturn } from './calendar/store.ts';
export type { Hue, ObjectIcon, RichTextDoc } from '@crm/contracts/values';
// The API name rule and the new object's defaults (spec 0012): plain modules with no Zod, so the dialogs share
// the server's own functions without loading the schema library.
export { isReservedSlug, RESERVED_SLUGS, toApiSlug } from '@crm/contracts/slugs';
export { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from '@crm/contracts/roles';
/** What each role lets someone do, area by area, derived from the permissions the server enforces (Members, Invite). */
export {
  EVERYONE_CAN,
  PERMISSION_AREAS,
  rolePowers,
  type AreaPowers,
  type AreaStanding,
  type PermissionArea,
} from '@crm/contracts/role-powers';
/** History's kinds of change (spec 0046), with no Zod: which kind each listed action is, for Workspace changes. */
export {
  AUDIT_KIND_NAMES,
  AUDIT_KINDS,
  AUDIT_NOT_LISTED,
  auditKindOf,
  type AuditKindName,
  type ListedAuditAction,
} from '@crm/contracts/audit-kinds';
// A schedule's week as words (spec 0035): plain, no Zod, the one summary the screens and the server's notices share.
export { clockLabel, weekSummary } from '@crm/contracts/hours';
export {
  INVITE_BATCH_MAX,
  INVITE_LINK_DAYS,
  INVITE_LINK_USES_MAX,
  MEMBER_SEARCH_MAX,
  MEMBERS_PAGE,
  namesMatch,
  WORKSPACE_PURGE_DAYS,
  type InviteLinkDays,
} from '@crm/contracts/team-limits';
export {
  freeHue,
  PICKER_TYPES,
  STARTER_STAGES,
  starterOptionsFor,
  typeFor,
  type GuessedType,
  type PickerType,
} from '@crm/contracts/picker';
/** Which attributes can name an object's records (late trap #15): the settings choice offers only these. */
export { canNameRecords } from '@crm/contracts/record-name';
export {
  MAX_PENDING_OPTIONS,
  withPendingOptions,
  type PendingOption,
  type PendingOptions,
  type PendingOptionsStore,
} from './options.ts';
export type { Auth, SessionUser } from './auth/auth.ts';
export {
  dataError,
  isDataError,
  isFetchFailure,
  SIGN_IN_CODES,
  type DataError,
  type DataErrorCode,
  type DataErrorDetails,
  type DataFault,
  type SignInCode,
} from './errors.ts';
export { refusalFor, refusalSummary };
export type { FetchLike } from './fetch.ts';
export type { NavFavourite, NavState } from '@crm/contracts';
export type { NavChangeOptions, NavSnapshot, NavSource } from './navigation/store.ts';
export type { DueTasksSnapshot, DueTasksSource } from './tasks/due.ts';
export type {
  NavEntry,
  NavItemKind,
  NavOperation,
  NavPage,
  NavPrefs,
  NavSectionKey,
  NavUniverse,
} from '@crm/contracts/navigation';
export type { JobsScope, JobsSnapshot, JobsView, TestJobSettings } from './jobs/store.ts';
export { purgeLeftOf, type PurgeLeftEntry } from './jobs/left.ts';
export type { View, ViewColumn, ViewConfig, ViewKind, ViewLayout, ViewSummary, ViewVisibility } from '@crm/contracts';
export {
  CREATED_AT_SLUG,
  effectiveColumns,
  effectiveQuery,
  isSortable,
  queryKey,
  type EffectiveColumn,
  type EffectiveQuery,
  type FarAttributes,
  type ViewAttribute,
  type ViewAction,
  type ViewRuleReason,
  viewRule,
} from '@crm/contracts/views';
export {
  BOARD_MAX_CARD_FIELDS,
  BOARD_MAX_COLUMNS,
  boardColumnIds,
  boardDefaults,
  CHECKBOX_COLUMNS,
  columnFilter,
  groupableAttributes,
  groupKindOf,
  groupValueOf,
  isGroupable,
  liveOptionCount,
  type BoardSettings,
  type GroupKind,
} from '@crm/contracts/board';
export { draftParam, DRAFT_LINK_MAX, FILTER_EDIT_MS, type DraftQuery } from './views/draft.ts';
export type {
  KeptDraft,
  NewView,
  SavedViewSnapshot,
  SavedViewSource,
  SaveQueryInput,
  ViewsListSnapshot,
  ViewsListSource,
} from './views/store.ts';
export type {
  NewTask,
  TaskChange,
  TaskList,
  TaskListState,
  TaskSubscription,
  TaskSubscriptionState,
} from './tasks/store.ts';
export { TASK_COUNT_CAP, TASK_RECORDS_MAX, TASK_TITLE_MAX } from '@crm/contracts/task-limits';
export { NOTE_TITLE_MAX, NOTE_TOO_LONG } from '@crm/contracts/note-limits';
export type {
  NoteList,
  NoteListState,
  NoteNotice,
  NoteSaveState,
  NoteSession,
  NoteSessionState,
} from './notes/store.ts';
export type { CommentsState, NewComment, RecordComments, ShownComment, ShownThread } from './comments/store.ts';
export {
  bodySegments,
  COMMENT_EMOJI,
  COMMENT_MAX,
  excerptOf,
  mentionToken,
  THREAD_COMMENTS_MAX,
  type BodySegment,
  type CommentEmoji,
} from '@crm/contracts/mentions';
export type {
  InboxFilter,
  InboxList,
  InboxListState,
  InboxMark,
  InboxSettings,
  InboxSettingsState,
  NotificationSettingsChange,
} from './inbox/store.ts';
export { UNREAD_PAST_CAP, type UnreadSource } from './inbox/unread.ts';
export {
  isEditableHere,
  isAskedOnCreate,
  searchMembers,
  toActorDisplays,
  toFieldAttribute,
  type FieldAttributeShape,
} from './fields.ts';
export { createIdMinter, type IdSources } from './ids.ts';
export type { LiveStatus } from './live/live.ts';
export type { Notice } from './notice.ts';
export type { UndoKind } from './records/history.ts';
export type {
  BulkEditRequest,
  BulkEditResult,
  CellChange,
  DeleteResult,
  EditOutcome,
  LinkCell,
  LinkChange,
  LinkOutcome,
  RecordsView,
  ViewQuery,
  ViewReader,
  ViewState,
  ViewStatus,
} from './records/layer.ts';
export type { RecordAttributes, RecordState, RecordStatus, RecordSubscription } from './records/one.ts';
export { SEARCH_DELAY_MS, type RecordSearch, type RecordSearchState } from './records/search.ts';
export type { BoardColumnState, BoardQuery, BoardState, BoardStatus, BoardStore } from './records/board.ts';
export type { TrashedSource, TrashedState } from './records/trashed.ts';
export type { NextMeeting, RecordFacts, RecordFactsState } from './records/facts.ts';
export type { RowNote } from './records/view.ts';
export type { PurgeSummary, RestoreSummary, TrashRow, TrashState, TrashStatus, TrashView } from './trash/store.ts';
export { TRASH_NAME_COLUMN } from './trash/columns.ts';
export type { BulkAction, BulkEdit, BulkTarget } from '@crm/contracts';
export type {
  ImportColumn,
  ImportCounts,
  ImportLinks,
  ImportOnMatch,
  ImportOnNoMatch,
  ImportRowRefusal,
  ImportRows,
  ImportSettings,
  ImportStatus,
  ImportTarget,
  ImportView,
  StagedRow,
  StageResult,
  RecordsExportView,
} from '@crm/contracts';
export {
  applyOp,
  bulkExclusion,
  bulkOpsFor,
  holdsList,
  opTakesValue,
  type BulkAttribute,
  type BulkExclusion,
  type BulkOp,
} from '@crm/contracts/bulk-ops';
export type { NameState, RecordRef } from './records/names.ts';
export type { WindowCount, WindowMode } from './records/windows.ts';
export type { FilterGroup, SortRule, SortRules } from '@crm/contracts/values';
export { aggregatesFor, type AggregateFn } from '@crm/contracts/views';
export type { RecordAggregate } from '@crm/contracts';
export {
  aggregateKey,
  NO_AGGREGATES,
  type AggregateAnswers,
  type AggregateAskSpec,
  type AggregateQuestion,
  type AggregateSource,
  type AggregateState,
} from './records/aggregate-source.ts';

/**
 * A value this tab saved was replaced by someone else's later save (spec
 * 0006, AC-46), with the names resolved for the screen's words: the record,
 * the first attribute replaced and how many more, and who replaced it (a
 * member by name, or an API key or an automation). "Use mine" saves this
 * tab's values again as a normal, undoable edit.
 */
export interface ReplacedValue {
  readonly workspace: string;
  readonly recordId: string;
  readonly recordName: string;
  readonly attributeTitle: string;
  /** How many more cells of the record the same save replaced ("and 2 more"). */
  readonly others: number;
  readonly by:
    | { readonly kind: 'member'; readonly name: string | undefined }
    | { readonly kind: 'api_key' }
    | { readonly kind: 'automation' }
    | { readonly kind: 'form' }
    | { readonly kind: 'booking' };
  readonly useMine: () => void;
}

/**
 * What an undo did (spec 0006, AC-48, AC-49), with the first cell's attribute
 * named for a one cell toast; a delete undone (spec 0022, AC-526) with its
 * object's names, for "Restored 46 people"; or a create undone (AC-541).
 */
export type UndoResult =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'stale' }
  | (Extract<UndoOutcome, { kind: 'undone' }> & { readonly attributeTitle: string })
  | (Extract<UndoOutcome, { kind: 'restored' }> & { readonly singularName: string; readonly pluralName: string })
  | Extract<UndoOutcome, { kind: 'uncreated' }>
  /** A delete past 500 undone as a restore job (spec 0022): its end raises the finish toast. */
  | (Extract<UndoOutcome, { kind: 'restoring' }> & { readonly singularName: string; readonly pluralName: string });

/** What each API call carries to the link: where to report the answer's `Retry-After`, and that an answer came. */
interface CallContext {
  readonly onRetryAfter?: (seconds: number) => void;
  /** The answer's request id (`x-request-id`) and the procedure it answered, for a fault report. */
  readonly onAnswer?: (answer: { readonly requestId?: string; readonly procedure: string }) => void;
}

type ApiClient = ContractRouterClient<typeof contract, CallContext>;

/** How a session ended under the person (`onSignedOut`): whether a change was lost with it. */
export interface SessionEnding {
  /** A write was still waiting for its answer, so it never landed and the screen dropped it. */
  readonly unsaved: boolean;
}

/** One API call's options: the context, and the signal that cancels it. */
interface CallOptions {
  readonly context: CallContext;
  readonly signal?: AbortSignal;
}

/** The background job kind a bulk delete runs as (spec 0022): its end puts its batch on this tab's undo stack. */
const DELETE_JOB = 'records.bulk_delete';

/** Waits `ms` before a write that never arrived goes again (`delivered`). */
const resendAfter = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** How long a read waits for the workspace's head before going ahead without it (spec 0007: the token call is usually beside `me.get`). */
const HEAD_WAIT_MS = 5_000;
/** How long one tab waits before it sends the same recent item again (spec 0039, AC-1088). */
const VISIT_EVERY_MS = 10_000;
/** The longest spread before a reread every tab of a workspace makes at once (a members or access event), in ms. */
const SPREAD_MS = 2_000;

/** How long the token read with the head may be handed to the live layer as its first token. */
const FIRST_TOKEN_MS = 60_000;

/** A new object, as settings sends it (spec 0012, AC-223): the id from `objects.newId`, minted once per dialog. */
export interface NewObject {
  readonly id: string;
  readonly singularName: string;
  readonly pluralName: string;
  /** Derived from the plural name on the server (`toApiSlug`) when absent. */
  readonly apiSlug?: string;
  readonly icon: ObjectSummary['icon'];
  readonly hue: ObjectSummary['hue'];
  /** First attributes beside Name, made in the same transaction as the object. */
  readonly attributes?: readonly {
    readonly title: string;
    readonly type: PickerAttributeType;
    /** A select's or status attribute's first options (a guessed Stage's stages, a Priority's levels). */
    readonly options?: readonly {
      readonly id: string;
      readonly label: string;
      readonly hue: ObjectSummary['hue'];
      readonly outcome?: 'open' | 'won' | 'lost';
    }[];
  }[];
}

/** What settings may change on an object (spec 0012, AC-224). Its API name never changes. */
export interface ObjectChanges {
  readonly singularName?: string;
  readonly pluralName?: string;
  readonly icon?: ObjectSummary['icon'];
  readonly hue?: ObjectSummary['hue'];
  /** The attribute that names its records (late trap #15): a custom object's, one `canNameRecords` takes. */
  readonly primaryAttributeId?: string;
}

/** An attribute's default (spec 0012, AC-234): a value, the member creating the record, or today plus days. */
export type AttributeDefaultValue = NonNullable<AttributeDefinition['defaultValue']>;

/**
 * A new attribute, as AttributeSettings sends it (spec 0012, AC-229): the id
 * from `attributes.newId`, minted once per dialog.
 */
export interface NewAttribute {
  readonly id: string;
  readonly objectId: string;
  readonly title: string;
  readonly type: PickerAttributeType;
  /** Derived from the title on the server (`toApiSlug`) when absent. */
  readonly apiSlug?: string;
  readonly description?: string;
  readonly isMulti?: boolean;
  readonly isRequired?: boolean;
  readonly isUnique?: boolean;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly defaultValue?: AttributeDefaultValue;
  /** A select's or status attribute's first options, in order (AC-230). */
  readonly options?: readonly NewOption[];
  /** Its validation rules, in order (spec 0013, AC-252); at most 20. */
  readonly rules?: readonly ValidationRuleInput[];
}

/** A status stage's outcome. */
export type OptionOutcome = 'open' | 'won' | 'lost';

/**
 * One option a new select or status attribute starts with, or a new option
 * (spec 0012, AC-230, AC-236): its id (from `attributes.newId`), label, hue,
 * and for a stage its outcome and target in whole days (1 to 365).
 */
export interface NewOption {
  readonly id: string;
  readonly label: string;
  readonly hue: AttributeOption['hue'];
  readonly outcome?: OptionOutcome;
  readonly targetDays?: number;
}

/** What may change on an option (spec 0012, AC-236); `targetDays: null` clears a stage's target. */
export interface OptionChanges {
  readonly label?: string;
  readonly hue?: AttributeOption['hue'];
  readonly outcome?: OptionOutcome;
  readonly targetDays?: number | null;
}

/** What a cell's Create says when its attribute changed under it (archived, or no longer a select). */
const OPTION_GONE = 'That attribute changed, so the option wasn’t created. Try again.';

/** A stage's target in whole days as the API takes it (`P7D`). */
const targetOf = (days: number): string => `P${String(days)}D`;

/** A stage's target time (`P7D`) as whole days, or undefined for none or another shape. */
export function targetDaysOf(targetTimeInStage: string | undefined): number | undefined {
  const days = targetTimeInStage === undefined ? undefined : /^P(\d+)D$/.exec(targetTimeInStage)?.[1];
  return days === undefined ? undefined : Number(days);
}

/** What settings may change on an attribute (spec 0012, AC-231); `null` clears the description or the default. */
export interface AttributeChanges {
  readonly title?: string;
  readonly description?: string | null;
  readonly isRequired?: boolean;
  readonly isUnique?: boolean;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly defaultValue?: AttributeDefaultValue | null;
  /** Its validation rules, in order (spec 0013, AC-252): the list replaces the attribute's rules. */
  readonly rules?: readonly ValidationRuleInput[];
}

/**
 * A new relationship, as RelationshipSettings sends it (spec 0014, AC-282):
 * the id from `relationships.newId`, minted once per dialog and sent again on
 * every retry, the cardinality read from `from`, and each side's object and
 * name (its API name comes from the name on the server).
 */
export interface NewRelationship {
  readonly id: string;
  readonly cardinality: RelationshipView['cardinality'];
  readonly from: { readonly objectId: string; readonly title: string };
  readonly to: { readonly objectId: string; readonly title: string };
}

/** New names for a relationship's sides (spec 0014, AC-307): only the ones that changed. */
export interface RelationshipNames {
  readonly from?: string;
  readonly to?: string;
}

/** The cache key of one object's attributes in one workspace. */
const objectKey = (workspace: string, objectId: string) => `${workspace}/${objectId}`;

/** What the data layer needs from the app. */
export interface DataLayerOptions {
  /** The app's own origin. The API sits under `/api` on it. */
  readonly origin: string;
  /** Raises a message on the app's toast queue. */
  readonly notify: (notice: Notice) => void;
  /** Mints a UUID v7 with the browser's crypto (`createIdMinter`). */
  readonly mintId: () => string;
  /**
   * The session ended while in use (a call answered 401): the app goes to
   * sign in, coming back to `redirectTo` (the path and query the person was
   * on) afterwards, and says so there. `ending.unsaved` is true when a write
   * was still waiting for its answer: that change is lost, and the sign in
   * page says it wasn't saved. The layer raises no toast of its own, so the
   * person hears it once, on the page that stays.
   */
  readonly onSignedOut: (redirectTo: string, ending: SessionEnding) => void;
  /** The path and query the person is on now, for `onSignedOut`. */
  readonly currentPath: () => string;
  /**
   * Who is signed in changed: a sign in, a sign out, or a session that ended
   * (a 401, after `onSignedOut`). The app drops whatever it cached for the
   * last person outside the layer, such as the router's loaded pages.
   */
  readonly onSessionChange?: () => void;
  /**
   * Whether anyone is signed in, each time the layer learns it for certain:
   * when `me.get` answers, and when a session ends under the person. The app
   * keeps it as a hint that survives a reload, so the next load knows which
   * screen to hold the place for (the app's or sign in's) before `me.get`
   * answers. It is a guess for painting only: the answer here always
   * overrules it, and nothing may be read or shown on the strength of it.
   */
  readonly onSessionKnown?: (isSignedIn: boolean) => void;
  /** The network. The browser's `fetch` by default; tests pass a fake API. */
  readonly fetch?: FetchLike;
  /**
   * Centrifugo's WebSocket address (`VITE_REALTIME_URL`). Unset (previews),
   * live updates are off and `live.status()` says so.
   */
  readonly realtimeUrl?: string | undefined;
  /**
   * An object's attributes changed elsewhere (a live `definitions` event) and
   * were dropped from the cache: the app loads its pages again, so a new
   * column shows.
   */
  readonly onDefinitionsChange?: () => void;
  /**
   * A value this tab saved was replaced by someone else's later save (spec
   * 0006, AC-46): the app raises the notice in its own words, with "Use mine".
   */
  readonly onReplaced?: (replaced: ReplacedValue) => void;
  /**
   * A background job this browser started has ended while the app is open
   * (spec 0008, AC-119): the app raises its toast ("Done", "Done, 6
   * refused", "Failed", "Cancelled") with a link to the job.
   */
  readonly onJobFinished?: (workspace: string, job: JobView) => void;
  /** Loads live updates. `./live/live.ts` by default; tests pass one on a fake transport. */
  readonly loadLive?: () => Promise<{ readonly createLive: typeof createLive }>;
  /**
   * Monitoring (spec 0010, AC-163): called only for a failure the server can't
   * have seen (an answer without one of our codes, or an error thrown inside
   * the layer), with the answer's request id when there was one. Never for
   * being offline, a cancelled call or a refusal. It must not throw.
   */
  readonly report?: (fault: DataFault) => void;
  /** A number from 0 to 1 that spreads rereads every tab makes at once. `Math.random` by default; tests pass 0. */
  readonly random?: () => number;
}

/** A form's list row from any form answer: the summary's fields only, so the list holds no drafts. */
function toFormSummary(form: FormView): FormSummary {
  return {
    id: form.id,
    name: form.name,
    status: form.status,
    ...(form.mainObjectId === undefined ? {} : { mainObjectId: form.mainObjectId }),
    publicKey: form.publicKey,
    ...(form.liveVersionNumber === undefined ? {} : { liveVersionNumber: form.liveVersionNumber }),
    submissionsThisMonth: form.submissionsThisMonth,
    spamCount: form.spamCount,
    ...(form.lastSubmissionAt === undefined ? {} : { lastSubmissionAt: form.lastSubmissionAt }),
    submissionCount: form.submissionCount,
    updatedAt: form.updatedAt,
  };
}

/**
 * The one client data layer. Screens read and write through it and never
 * call the network themselves. Every failure rejects with a DataError
 * (`{ code, message, data?, retryAfterSeconds? }`); a 401 from any call but
 * `me.get` also runs `onSignedOut` once, forgets what was cached for the
 * person and runs `onSessionChange`, except while nobody has been signed in
 * and `me.get` answers nobody (a visit before sign in, whose route goes to
 * sign in itself).
 */
export function createDataLayer({
  origin,
  notify,
  mintId,
  onSignedOut,
  currentPath,
  onSessionChange = () => undefined,
  onSessionKnown = () => undefined,
  fetch = (input, init) => globalThis.fetch(input, init),
  realtimeUrl,
  onDefinitionsChange = () => undefined,
  onReplaced = () => undefined,
  onJobFinished = () => undefined,
  loadLive = () => import('./live/live.ts'),
  report = () => undefined,
  random = Math.random,
}: DataLayerOptions) {
  const api: ApiClient = createORPCClient(
    new RPCLink<CallContext>({
      url: new URL('/api/rpc', origin).href,
      fetch: async (request, init, { context }, path) => {
        const response = await fetch(request, init);
        const requestId = response.headers.get('x-request-id') ?? undefined;
        context.onAnswer?.({ procedure: path.join('.'), ...(requestId === undefined ? {} : { requestId }) });
        const wait = response.ok ? undefined : parseRetryAfter(response.headers.get('retry-after'), Date.now());
        if (wait !== undefined) context.onRetryAfter?.(wait);
        return response;
      },
    }),
  );

  // Cached per app load: who is signed in, and each workspace's objects,
  // members and attributes. A failed load is dropped, so the next call tries
  // again.
  let me: Promise<Me | undefined> | undefined;
  // Every object, archived ones too (settings lists them; the sidebar filters them out), in the workspace's order.
  let objects = new Map<string, Promise<ObjectSummary[]>>();
  let usage = new Map<string, Promise<Usage>>();
  let members = new Map<string, Promise<MemberView[]>>();
  let access = new Map<string, Promise<MyAccess>>();
  // The audit log a History screen holds, per workspace (spec 0046): opening it again while held answers this one.
  const auditLogs = new Map<string, AuditLog>();
  // The roles every role picker offers (spec 0037, AC-1439), per workspace, for the app load.
  let roles = new Map<string, Promise<RolesList>>();
  let attributes = new Map<string, Promise<AttributeDefinition[]>>();
  // Each object's attributes with the archived ones too (settings, spec 0012), apart from the live lists the tables read.
  let allAttributes = new Map<string, Promise<AttributeDefinition[]>>();
  // The records layer, loaded with the first screen that shows records.
  let records: Promise<RecordsLayer> | undefined;
  /** The records layer once loaded, so a screen's calculations source comes back at once (and the same each time). */
  let recordsLoaded: RecordsLayer | undefined;
  // Options a cell made, shown by their label until the attribute's own list holds them (spec 0012, AC-238).
  const pendingOptions = createPendingOptions();
  // Records' timelines (spec 0017), loaded with the first record page.
  let activity: Promise<ActivityFeeds> | undefined;
  // A record page's related sections (spec 0014's section source, spec 0017 milestone 3), loaded with it.
  let sections: Promise<LinkSections> | undefined;
  // The trash (spec 0022), loaded with the first trash screen.
  let trash: Promise<Trash> | undefined;
  // Tasks (spec 0019), loaded with the first screen that shows one.
  let tasks: Promise<TasksStore> | undefined;
  // Notes (spec 0019), loaded with the first screen that shows one.
  let notes: Promise<NotesStore> | undefined;
  // Comments (spec 0038), loaded with the first Comments tab.
  let comments: Promise<CommentsStore> | undefined;
  // The inbox's lists and settings (spec 0038), loaded with the inbox or the notification settings.
  let inbox: Promise<InboxStore> | undefined;
  // The operator console's reads (spec 0047), held per question for the app load.
  const operatorStore = createOperatorStore({
    overview: (period) => call((options) => api.operator.overview({ period }, options)),
    users: (input) =>
      call((options) =>
        api.operator.users(
          {
            period: input.period,
            ...(input.q === undefined || input.q.trim() === '' ? {} : { q: input.q.trim() }),
            ...(input.after === undefined ? {} : { after: input.after }),
          },
          options,
        ),
      ),
    user: (userId, period) => call((options) => api.operator.user({ userId, period }, options)),
    pages: (period) => call((options) => api.operator.pages({ period }, options)),
    page: (workspaceId, pageId, period) =>
      call((options) => api.operator.page({ workspaceId, pageId, period }, options)),
    site: (period) => call((options) => api.operator.site({ period }, options)),
  });
  // Records looked up in the trash (spec 0017): a missing record's page.
  const trashedLookups = createTrashedLookups((workspace, recordId) =>
    call((options) => api.records.getTrashed({ workspace, recordId }, options)),
  );
  // A record's facts for its stat strip (13 Oct reference batch 4): its next meeting and its stage age.
  const recordFacts = createRecordFactsStore({
    api: {
      meetings: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.calendar.meetings.forRecord(input, options))),
      stageSince: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.records.stageSince(input, options))),
    },
    now: () => new Date().toISOString(),
  });
  // Set by the first 401, so a burst of failed calls signs out once.
  let ended = false;
  // Whether `me.get` has answered a person since the last sign in or out: a 401 then always ends their session.
  let seenPerson = false;
  // While this tab deletes its own account (spec 0033): the server ends the session before it answers, so another
  // call's 401 meanwhile (the live connection asking again) is that ending, which the deletion's own page explains.
  // Such a 401 is held back, not forgotten: if the deletion itself answers 401 or fails, the session ends as usual.
  let deletingAccount = false;
  let heldEnding = false;
  // Live updates: loaded with the first watched workspace, and this tab's writes waiting for their echo.
  let live: Promise<Live> | undefined;
  const mutations = createMutationLog();
  // The stores' live handlers (spec 0007): what each kind of change, and a resync, asks of them.
  const router = createLiveRouter();
  // Each workspace's subscription token read before its first read: its head is the first watermark.
  let heads = new Map<string, Promise<Granted | undefined>>();
  let firstTokens = new Map<string, { readonly granted: Granted; readonly at: number }>();
  // Workspaces read without a head (the token call failed or took too long): their first watermark comes from
  // the live client's own token, with a resync of everything held, so nothing read before it is missed.
  let uncovered = new Set<string>();
  let liveStatus: LiveStatus = realtimeUrl === undefined ? 'off' : 'live';
  const liveListeners = new Set<() => void>();
  const setLiveStatus = (next: LiveStatus) => {
    if (next === liveStatus) return;
    liveStatus = next;
    for (const listener of liveListeners) listener();
  };
  const forget = () => {
    me = undefined;
    objects = new Map();
    usage = new Map();
    members = new Map();
    access = new Map();
    auditLogs.clear();
    roles = new Map();
    attributes = new Map();
    allAttributes = new Map();
    heads = new Map();
    firstTokens = new Map();
    uncovered = new Set();
    // Signed out: no more changes for the last person, and none of their writes to wait for.
    const stopping = live;
    live = undefined;
    mutations.clear();
    void stopping?.then((running) => {
      running.stop();
    });
    void records?.then((layer) => {
      layer.clear();
    });
    jobs.clear();
    views.clear();
    navStore?.clear();
    dueTasks.clear();
    // The last person's meetings and calendars (names, attendees) never show to the next one in this tab.
    meetings.clear();
    calendars.clear();
    void activity?.then((feeds) => {
      feeds.clear();
    });
    void sections?.then((held) => {
      held.clear();
    });
    void tasks?.then((store) => {
      store.clear();
    });
    void notes?.then((store) => {
      store.clear();
    });
    void comments?.then((store) => {
      store.clear();
    });
    void inbox?.then((store) => {
      store.clear();
    });
    unreadCounts.clear();
    trashedLookups.clear();
    void trash?.then((held) => {
      held.clear();
    });
    pendingOptions.clear();
    bookingPageLists.clear();
    pageRules.clear();
    formLists.clear();
    schedules.clear();
    preferences.clear();
    accessLoaded?.clear();
    pictureChoice.clear();
    void linkPage?.then((made) => {
      made.clear();
    });
    socialLinks?.clear();
  };
  /** Sign in, sign out or an account deleted: the caches go, and the app hears who is signed in now. */
  const reset = (isSignedIn: boolean) => {
    forget();
    ended = false;
    seenPerson = false;
    sessionKnown(isSignedIn);
    onSessionChange();
  };

  /** Hands a fault to monitoring, which never gets to break the call it came from. */
  const reportSafely = (fault: DataFault) => {
    try {
      report(fault);
    } catch {
      // Monitoring failed; the call's own failure still goes to the caller.
    }
  };

  /**
   * Runs one API call with a fresh context, mapping its failure to a
   * DataError that carries the answer's `Retry-After`.
   */
  async function attempt<T>(run: (options: CallOptions) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let wait: number | undefined;
    let answer: { readonly requestId?: string; readonly procedure: string } | undefined;
    try {
      return await run({
        context: {
          onRetryAfter: (seconds) => {
            wait = seconds;
          },
          onAnswer: (answered) => {
            answer = answered;
          },
        },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (signal?.aborted !== true && isUnseenFault(error)) reportSafely({ error, ...answer });
      throw withRetryAfter(toDataError(error), wait);
    }
  }

  /** Whether the app's question of who is signed in answered nobody (a failed question counts as someone). */
  function nobodyAsked(asked: Promise<Me | undefined>): Promise<boolean> {
    return asked.then(
      (answer) => answer === undefined,
      () => false,
    );
  }

  /** Runs a call, mapping its failure to a DataError; a 401 ends the session here. */
  async function call<T>(run: (options: CallOptions) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await attempt(run, signal);
    } catch (error) {
      const failure = toDataError(error);
      // Someone must have been signed in for a session to end. Before anyone has been seen, once the app has asked
      // who is, a 401 while nobody is (a visit before sign in, whose route goes to sign in itself with the address
      // kept) ends nothing. Once a person has been seen, every 401 ends their session, as before.
      if (failure.code === 'UNAUTHENTICATED' && !ended && !seenPerson && me !== undefined && (await nobodyAsked(me))) {
        throw failure;
      }
      if (failure.code === 'UNAUTHENTICATED' && !ended) {
        if (deletingAccount) heldEnding = true;
        else endSession();
      }
      throw failure;
    }
  }

  /** Whether a 401 was held back while the account was being deleted, clearing it for the next deletion. */
  function takeHeldEnding(): boolean {
    const held = heldEnding;
    heldEnding = false;
    return held;
  }

  /** Hands the app what the layer now knows about the session; it never gets to break the call it came from. */
  function sessionKnown(isSignedIn: boolean) {
    try {
      onSessionKnown(isSignedIn);
    } catch {
      // Only a hint for the next load's first paint: a failure here changes nothing here.
    }
  }

  /** The session ended under the person (a 401): off to sign in once, saying whether a change was lost. */
  function endSession() {
    ended = true;
    sessionKnown(false);
    // A write still waiting for its answer is lost with the session (its layer leaves with the records), so
    // sign in says so; read before forget() clears the log.
    const unsaved = mutations.unanswered();
    forget();
    // Off to sign in first, then the app drops the last person's pages.
    onSignedOut(currentPath(), { unsaved });
    onSessionChange();
  }

  const auth = createAuth({ origin, fetch, reset, report: reportSafely });
  // Email preferences pages (the emails lane), one store per link's token for the app load, and the one click's.
  // Their module loads with the page (`import()`), never in the first load: only an email's link opens it.
  const emailPreferenceStores = new Map<string, Promise<EmailPreferencesStore>>();
  const emailUnsubscribeStores = new Map<string, Promise<EmailUnsubscribeStore>>();

  /** Reads a per workspace list once, dropping it from the cache when it fails, so the next call asks again. */
  function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const loading = load();
    cache.set(key, loading);
    loading.catch(() => {
      if (cache.get(key) === loading) cache.delete(key);
    });
    return loading;
  }

  /**
   * Reads an object's cached attributes again (all of a workspace's when no
   * object is named), and runs `onDefinitionsChange` once when any list came
   * back different, so the app reloads its pages only for a real change.
   */
  const refreshAttributes = (workspace: string, objectId?: string): Promise<boolean> => {
    const prefix = `${workspace}/`;
    const held = [...attributes.entries()].filter(([key]) =>
      objectId === undefined ? key.startsWith(prefix) : key === objectKey(workspace, objectId),
    );
    const compared = held.map(async ([key, before]) => {
      attributes.delete(key);
      const fresh = cached(attributes, key, () =>
        call((options) => api.attributes.list({ workspace, objectId: key.slice(prefix.length) }, options)),
      );
      const [old, next] = await Promise.all([before.catch(() => undefined), fresh]);
      return JSON.stringify(old) !== JSON.stringify(next);
    });
    // Each list on its own: one that can no longer be read (its object archived) is a change, dropped from the
    // cache so the next page load asks again, and never hides another list's change.
    return Promise.allSettled(compared).then((results) =>
      results.some((result) => result.status === 'rejected' || result.value),
    );
  };

  /** The ids of the workspace's archived objects in a held list, sorted, to tell when the set changed. */
  const archivedIds = (list: readonly ObjectSummary[] | undefined): string =>
    (list ?? [])
      .filter((object) => object.isArchived)
      .map((object) => object.id)
      .sort()
      .join(',');

  /**
   * Reads the workspace's objects again (when held) and, only when the set of
   * archived objects changed, every held attribute list too: a reference to
   * an archived object is archived itself (spec 0012), while a rename,
   * restyle or move changes no attribute. Answers whether anything changed.
   */
  const refreshObjects = async (workspace: string): Promise<boolean> => {
    const before = await objects.get(workspace)?.catch(() => undefined);
    const changed = await refreshHeld(objects, workspace, () => allObjects(workspace));
    if (!changed) return false;
    const after = await objects.get(workspace)?.catch(() => undefined);
    // A name attribute moved (late trap #15): which attribute is the primary changed too, and every record's name.
    const renamed = primaries(before) !== primaries(after);
    if (renamed || archivedIds(before) !== archivedIds(after)) await refreshAttributes(workspace);
    if (renamed) renameRecords(workspace, renamedObjects(before, after), false);
    return true;
  };

  /** Each object's name attribute in a held list, to tell when one moved (late trap #15). */
  const primaries = (list: readonly ObjectSummary[] | undefined): string =>
    (list ?? [])
      .map((object) => object.id + (object.primaryAttributeId ?? ''))
      .sort()
      .join();

  /** The objects whose name attribute differs between two held lists (late trap #15). */
  const renamedObjects = (
    before: readonly ObjectSummary[] | undefined,
    after: readonly ObjectSummary[] | undefined,
  ): string[] => {
    const was = new Map((before ?? []).map((object) => [object.id, object.primaryAttributeId]));
    return (after ?? [])
      .filter((object) => was.get(object.id) !== object.primaryAttributeId)
      .map((object) => object.id);
  };

  /**
   * Objects' records are named by another attribute: every held record and linked name is read again, and so are
   * the open timelines (their link entries name far records). The related sections listing those objects' records
   * read again for this tab's own write only: another tab's comes as a `definitions` event for the object, which
   * already reads them (`definitionsChanged`), so they are not read twice.
   */
  const renameRecords = (workspace: string, objectIds: readonly string[], isOwn: boolean): void => {
    void records?.then((layer) => {
      layer.renamed(workspace);
    });
    void activity?.then((feeds) => {
      feeds.ownWrite(workspace);
    });
    if (!isOwn) return;
    void sections?.then((held) => {
      held.renamed(workspace, objectIds);
    });
  };

  /**
   * Drops the held usage (when held) instead of reading it again: only the
   * settings pages show it, and their next load reads it once. Answers
   * whether one was held, so the pages reload and that read happens now.
   */
  const dropUsage = (workspace: string): boolean => usage.delete(workspace);

  /**
   * Drops the held settings lists (attributes with the archived ones) of one
   * object, or of every object of the workspace, instead of reading them
   * again: only the settings pages show them, and their next load reads them.
   * Answers whether one was held, so the pages reload and that read happens.
   */
  const dropAllAttributes = (workspace: string, objectId?: string): boolean => {
    const held = [...allAttributes.keys()].filter((key) =>
      objectId === undefined ? key.startsWith(`${workspace}/`) : key === objectKey(workspace, objectId),
    );
    for (const key of held) allAttributes.delete(key);
    return held.length > 0;
  };

  /** Runs `onDefinitionsChange` once when any of the comparisons found a list that came back different. */
  const reloadIfChanged = (comparisons: readonly Promise<boolean>[]): void => {
    void Promise.all(comparisons).then((changes) => {
      if (changes.includes(true)) onDefinitionsChange();
    });
  };

  /**
   * Reads the workspace's head (with a subscription token) once per app load,
   * when live updates are on: the first watermark, read before any of the
   * workspace's reads, so a write that commits while they are in flight is
   * caught up. Without a session or membership it answers nothing and ends no
   * session; a failure is forgotten, so the next read asks again.
   */
  const prepare = (workspace: string): Promise<Granted | undefined> => {
    if (realtimeUrl === undefined) return Promise.resolve(undefined);
    const hit = heads.get(workspace);
    if (hit !== undefined) return hit;
    const asking: Promise<Granted | undefined> = attempt((options) =>
      api.realtime.subscriptionToken({ workspace }, options),
    ).then(
      (granted) => {
        if (heads.get(workspace) === asking) firstTokens.set(workspace, { granted, at: Date.now() });
        return granted;
      },
      () => {
        if (heads.get(workspace) === asking) heads.delete(workspace);
        return undefined;
      },
    );
    heads.set(workspace, asking);
    return asking;
  };

  // When each recent item was last sent (spec 0039), so opening the same record again sends nothing for 10 seconds.
  const visited = new Map<string, number>();

  /**
   * Waits for the workspace's head before a read, at most 5 seconds; nothing
   * waits when live is off. A read that goes ahead without it (the call
   * failed, or the wait ran out) marks the workspace uncovered, and later
   * reads stop waiting: the live client resyncs it once it listens.
   */
  const beforeRead = async (workspace: string): Promise<void> => {
    if (realtimeUrl === undefined || uncovered.has(workspace)) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const covered = await Promise.race([
      prepare(workspace).then((granted) => granted !== undefined),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, HEAD_WAIT_MS);
      }),
    ]);
    clearTimeout(timeout);
    if (!covered) uncovered.add(workspace);
  };

  /** Live updates, loaded the first time a screen watches a workspace. */
  const loadedLive = (url: string): Promise<Live> => {
    live ??= loadLive().then(({ createLive }) =>
      createLive({
        url,
        connectionToken: async () => {
          try {
            return (await call((options) => api.realtime.connectionToken(undefined, options))).token;
          } catch (error) {
            // Signed out: stop asking (the layer already went to sign in). Anything else: try again later.
            if (toDataError(error).code === 'UNAUTHENTICATED') return undefined;
            throw error;
          }
        },
        subscriptionToken: async (workspace) => {
          // The token read with the head, once, while it is fresh.
          const first = firstTokens.get(workspace);
          firstTokens.delete(workspace);
          if (first !== undefined && Date.now() - first.at < FIRST_TOKEN_MS) return first.granted;
          try {
            return await call((options) => api.realtime.subscriptionToken({ workspace }, options));
          } catch (error) {
            const { code } = toDataError(error);
            if (code === 'UNAUTHENTICATED' || code === 'NOT_FOUND') return undefined;
            throw error;
          }
        },
        // No head when a read went ahead without one: the live client then starts from its token and resyncs.
        head: async (workspace) => {
          const granted = await prepare(workspace);
          return uncovered.has(workspace) ? undefined : granted?.head;
        },
        catchUp: async (workspace, after) => {
          try {
            return await call((options) => api.realtime.catchUp({ workspace, after }, options));
          } catch (error) {
            const { code } = toDataError(error);
            if (code === 'UNAUTHENTICATED' || code === 'NOT_FOUND') return undefined;
            throw error;
          }
        },
        mutations,
        onStatus: setLiveStatus,
        router,
      }),
    );
    return live;
  };

  /**
   * Reads a cached per workspace list again when one is held (nothing when
   * not: the next read loads it fresh), and runs `onDefinitionsChange` when
   * it came back different, so the app reloads its pages only for a real
   * change.
   */
  const refreshHeld = <T>(
    cache: Map<string, Promise<T>>,
    workspace: string,
    load: () => Promise<T>,
  ): Promise<boolean> => {
    const before = cache.get(workspace);
    if (before === undefined) return Promise.resolve(false);
    cache.delete(workspace);
    return Promise.all([before.catch(() => undefined), load()]).then(
      ([old, next]) => JSON.stringify(old) !== JSON.stringify(next),
      // Unreadable now: dropped from the cache, so the next read asks again.
      () => false,
    );
  };

  // Rereads waiting out their spread, by what they reread: a burst of events costs one read, and every tab of a
  // workspace doesn't ask at the same moment (a role change reaches every member at once).
  const spreading = new Set<string>();
  const spread = (key: string, work: () => void): void => {
    if (spreading.has(key)) return;
    spreading.add(key);
    setTimeout(
      () => {
        spreading.delete(key);
        work();
      },
      Math.round(random() * SPREAD_MS),
    );
  };
  // The sidebar's Tasks badge (spec 0034, AC-924): small and plain, so it sits in the first load with the sidebar.
  const dueTasks = createDueTasks({
    count: (workspace, today) =>
      beforeRead(workspace).then(() => call((options) => api.tasks.due({ workspace, today }, options))),
  });
  /** This tab's own task write landed (its echo never comes back): the badge reads again at once. */
  const taskLanded = <T>(workspace: string, answer: Promise<T>): Promise<T> =>
    answer.then((value) => {
      dueTasks.changed(workspace);
      return value;
    });
  /**
   * Every active member of a workspace, by name, read a full page at a time
   * (spec 0031: `members.list` answers pages): the pickers', the Owner
   * column's and the timeline's one list.
   */
  const allMembers = async (workspace: string): Promise<MemberView[]> => {
    const all: MemberView[] = [];
    let cursor: string | undefined;
    do {
      const page = await call((options) =>
        api.members.list({ workspace, limit: MEMBERS_PAGE_MAX, ...(cursor === undefined ? {} : { cursor }) }, options),
      );
      all.push(...page.members);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return all;
  };
  const readMembers = (workspace: string) => cached(members, workspace, () => allMembers(workspace));
  const readAccess = (workspace: string) =>
    cached(access, workspace, () => call((options) => api.access.mine({ workspace }, options)));
  /** Whether `memberIds` names the person, by the access this tab holds (unknown counts as named). */
  const namesMe = async (workspace: string, memberIds: readonly string[]): Promise<boolean> => {
    const mine = await access.get(workspace)?.catch(() => undefined);
    return mine === undefined || memberIds.includes(mine.memberId);
  };

  // The stores' handlers (spec 0007, milestone 2): records refetch the named rows (or everything held of the
  // object when coarse) and settle on the ones made, deleted or restored; definitions an object's attributes,
  // and the workspace's objects when the object itself changed or none is named; members the member list (and
  // the person's own access when it names them); access, naming the person, everything held; and a resync
  // everything held of the workspace. Entries have no store yet: no screen shows lists.
  router.on('records', (workspace, event) => {
    // The open trash (spec 0022) settles on deletes, restores, purges and coarse changes.
    void trash?.then((held) => {
      held.changed(workspace, event);
    });
    void records?.then((layer) => {
      if (event.coarse === true) layer.reload(workspace, event.objectId);
      else layer.changed(workspace, event.objectId, event.recordIds, event.attributeIds, event);
      // What the write replaced (spec 0006): a notice for the values this tab wrote.
      if (event.replaced !== undefined) layer.replaced(workspace, event);
    });
    // Records trashed or restored change which links their tasks show (spec 0019, AC-446).
    void tasks?.then((store) => {
      store.recordsChanged(workspace, event);
    });
    // A trashed record's notes go from every screen, and come back with it (spec 0019, AC-446).
    void notes?.then((store) => {
      store.recordsChanged(workspace, event);
    });
    // A trashed record's comments and the notifications about them go with it, and come back with it (spec 0038,
    // AC-1160, AC-1166): its held threads read again, and the inbox and its count.
    const moved = [...(event.deletedIds ?? []), ...(event.restoredIds ?? [])];
    if (moved.length > 0 || event.coarse === true) {
      void comments?.then((store) => {
        store.records(workspace, moved);
      });
      spread(`inbox ${workspace}`, () => {
        unreadCounts.refresh(workspace);
        void inbox?.then((store) => {
          store.resync(workspace);
        });
      });
    }
    // Open related sections (spec 0017) read again for a change naming their record and side, a far record they
    // hold, or the far object's trash; each coalesces a burst to two reads a second.
    if (sections !== undefined) {
      const open = sections;
      const tellSections = () => {
        void open.then((held) => {
          held.changed(workspace, event);
        });
      };
      // A coarse change, or records trashed or restored, may concern every section of the object in every tab: a
      // random moment first, once per object, so a whole team doesn't read in step.
      const moved = (event.deletedIds?.length ?? 0) + (event.restoredIds?.length ?? 0) > 0;
      if (event.coarse === true || moved) spread(`sections ${workspace} ${event.objectId}`, tellSections);
      else tellSections();
    }
    // Open timelines (spec 0017) read their first page again for a change naming their record; a coarse one,
    // for every record of the object, waits a random moment first so a whole team doesn't read in step.
    if (activity === undefined) return;
    const timelines = activity;
    const tell = () => {
      void timelines.then((feeds) => {
        feeds.changed(workspace, event);
      });
    };
    if (event.coarse === true) spread(`activity ${workspace} ${event.objectId}`, tell);
    else tell();
  });
  router.on('definitions', (workspace, event) => {
    // A list's own definitions: no screen holds lists yet.
    if (event.listId !== undefined) return;
    // A side archived, hidden or renamed: the object's open related sections read again (or go, when nobody shows
    // them), spread a random moment so a whole team doesn't read in step.
    if (sections !== undefined) {
      const open = sections;
      spread(`sections definitions ${workspace} ${event.objectId ?? ''}`, () => {
        void open.then((held) => {
          held.definitionsChanged(workspace, event.objectId);
        });
      });
    }
    // An attribute archived, hidden or renamed: the object's open timelines start again (spec 0017), spread a
    // random moment so a whole team doesn't read in step (each feed also coalesces a burst).
    if (activity !== undefined) {
      const timelines = activity;
      spread(`activity definitions ${workspace} ${event.objectId ?? ''}`, () => {
        void timelines.then((feeds) => {
          feeds.definitionsChanged(workspace, event.objectId);
        });
      });
    }
    // Any definition change may move a count the settings meters show (spec 0012, AC-243): a held usage is
    // dropped, and the pages reload once so a settings page reads it again.
    const counted = Promise.resolve(dropUsage(workspace));
    if (event.objectId !== undefined && event.attributeIds !== undefined) {
      // An attribute or option changed (spec 0012): that object's lists, the live one read again (the tables),
      // the one with archived attributes dropped (settings reads it on its next load).
      const settings = Promise.resolve(dropAllAttributes(workspace, event.objectId));
      reloadIfChanged([refreshAttributes(workspace, event.objectId), counted, settings]);
    } else if (event.objectId !== undefined) {
      // The object itself was made, renamed, restyled, moved, archived or restored (spec 0012), or a catch up
      // collapsed its attribute changes: its own attributes, the workspace's objects, and every other held
      // attribute list only when an object was archived or restored. One reload at most. Every settings list
      // is dropped, since an archive changes which references count as archived anywhere.
      const settings = Promise.resolve(dropAllAttributes(workspace));
      reloadIfChanged([refreshAttributes(workspace, event.objectId), refreshObjects(workspace), counted, settings]);
    } else {
      objects.delete(workspace);
      dropAllAttributes(workspace);
      void refreshAttributes(workspace);
      onDefinitionsChange();
    }
  });
  router.on('members', (workspace, event) => {
    // Whom the caller sees in the scheduling pickers changes with who is here (spec 0037).
    accessLoaded?.forgetReach(workspace);
    // Every member's tab hears a role change at once: spread, and one read for a burst.
    spread(`members ${workspace}`, () => {
      reloadIfChanged([refreshHeld(members, workspace, () => readMembers(workspace))]);
    });
    // A role changed may be the person's own: their access is read again (the server checks every call anyway).
    void namesMe(workspace, event.memberIds).then((named) => {
      if (!named) return;
      spread(`access ${workspace}`, () => {
        reloadIfChanged([refreshHeld(access, workspace, () => readAccess(workspace))]);
      });
    });
  });
  router.on('access', (workspace, event) => {
    // The person's access changed: everything held is read again under it (spec 0009, AC-146; milestone 4 adds
    // the new channel and the 4500 disconnect).
    void namesMe(workspace, event.memberIds).then((named) => {
      if (!named) return;
      spread(`resync ${workspace}`, () => {
        access.delete(workspace);
        router.resync(workspace);
        // Whose scheduling they reach may have changed too (spec 0037, AC-1274): Bookings' lists and weeks and Home's
        // Team today read again. Only here, for the one person named, never on every resync (a catch up reset).
        reloadBookings(workspace);
        homeReads.reloadAll(workspace);
        // Settings › Scheduling access and the members pickers read their delegations and reach again.
        accessLoaded?.reload(workspace);
      });
    });
  });
  // Schedules saved in another tab or by anyone else (spec 0035, AC-977): every held list of the workspace reads
  // again, once for a burst. The event names no member to most audiences, so every tab holding a list (Availability,
  // a page editor, an open New page dialog) hears every save: spread over 100 to 400 ms, inside AC-977's second, so
  // a team never reads in step.
  const schedulesDue = new Set<string>();
  router.on('schedules', (workspace) => {
    if (schedulesDue.has(workspace)) return;
    schedulesDue.add(workspace);
    setTimeout(
      () => {
        schedulesDue.delete(workspace);
        schedules.changed(workspace);
        // The Team week reads the same schedules (spec 0037, job J6).
        accessLoaded?.teamWeek.changed(workspace);
      },
      100 + Math.round(random() * 300),
    );
  });
  // Someone's time off changed (spec 0037): the Team week (Away), the held time off lists and Bookings' held reads
  // (Host away) read again, once for a burst, spread over 100 to 400 ms as schedules are. The event names nobody, so
  // every tab of the workspace hears it; only what a screen holds reads.
  const timeOffDue = new Set<string>();
  router.on('time_off', (workspace) => {
    if (timeOffDue.has(workspace)) return;
    timeOffDue.add(workspace);
    setTimeout(
      () => {
        timeOffDue.delete(workspace);
        accessLoaded?.teamWeek.changed(workspace);
        accessLoaded?.timeOff.changed(workspace);
        refreshBookings(workspace);
      },
      100 + Math.round(random() * 300),
    );
  });
  router.on('jobs', (workspace, event) => {
    jobs.changed(workspace, event);
  });
  router.on('views', (workspace, event) => {
    views.changed(workspace, event);
  });
  router.on('tasks', (workspace, event) => {
    void tasks?.then((store) => {
      store.changed(workspace, event);
    });
    // A tasks event names no assignee, so a held badge reads again, coalesced and spread (`changedLater`).
    dueTasks.changedLater(workspace);
  });
  router.on('notes', (workspace, event) => {
    void notes?.then((store) => {
      store.changed(workspace, event);
    });
  });
  // Comments (spec 0038, AC-1159): the held records' named threads read again.
  router.on('comments', (workspace, event) => {
    void comments?.then((store) => {
      store.changed(workspace, event);
    });
  });
  // A member's notifications or settings changed (spec 0038, AC-1172, AC-1174, AC-1180): only the person's own
  // count, lists and settings read again; every other member's tab drops the event.
  router.on('notifications', (workspace, event) => {
    void namesMe(workspace, event.memberIds).then((named) => {
      if (!named) return;
      unreadCounts.refresh(workspace);
      void inbox?.then((store) => {
        store.changed(workspace, event);
      });
    });
  });
  // Meetings synced, moved, cancelled or made private (spec 0024, AC-610): the open timelines of the records they
  // showed on read their first page again; a coarse one (a whole calendar's sync) waits a random moment first, so a
  // whole team doesn't read in step, and then every open timeline of the workspace reads again.
  router.on('meetings', (workspace, event) => {
    if (activity === undefined) return;
    const timelines = activity;
    if (event.coarse === true) {
      spread(`meetings ${workspace}`, () => {
        void timelines.then((feeds) => {
          feeds.ownWrite(workspace);
        });
      });
      return;
    }
    void timelines.then((feeds) => {
      feeds.changed(workspace, { objectId: '', recordIds: event.recordIds });
    });
  });
  router.onResync((workspace) => {
    schedules.changed(workspace);
    accessLoaded?.teamWeek.changed(workspace);
    accessLoaded?.timeOff.changed(workspace);
    jobs.resync(workspace);
    views.resync(workspace);
    navStore?.resync(workspace);
    dueTasks.changedLater(workspace);
    void trash?.then((held) => {
      held.reload(workspace);
    });
    void tasks?.then((store) => {
      store.resync(workspace);
    });
    void notes?.then((store) => {
      store.resync(workspace);
    });
    void comments?.then((store) => {
      store.resync(workspace);
    });
    void inbox?.then((store) => {
      store.resync(workspace);
    });
    unreadCounts.refresh(workspace);
    void records?.then((layer) => {
      layer.reload(workspace);
    });
    void activity?.then((feeds) => {
      feeds.resync(workspace);
    });
    void sections?.then((held) => {
      held.resync(workspace);
    });
    void refreshAttributes(workspace);
    // The workspace's objects, usage and members are read again on the next page load, which a resync asks for.
    objects.delete(workspace);
    usage.delete(workspace);
    members.delete(workspace);
    dropAllAttributes(workspace);
    onDefinitionsChange();
  });

  /** Listens to a workspace's changes while a view of it is open; the answer stops. Nothing when live is off. */
  const watch = (workspace: string): (() => void) => {
    if (realtimeUrl === undefined) return () => undefined;
    const url = realtimeUrl;
    let release: (() => void) | undefined;
    let isReleased = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = (failures: number) => {
      loadedLive(url).then(
        (running) => {
          if (isReleased) return;
          setLiveStatus(running.status());
          release = running.watch(workspace);
        },
        () => {
          // The live client didn't load (offline): paused, and tried again, later each time.
          live = undefined;
          setLiveStatus('paused');
          if (isReleased) return;
          retry = setTimeout(
            () => {
              attempt(failures + 1);
            },
            Math.min(30_000, 1000 * 2 ** failures),
          );
        },
      );
    };
    attempt(0);
    return () => {
      isReleased = true;
      clearTimeout(retry);
      release?.();
    };
  };

  // The inbox's unread count (spec 0038, AC-1174), in the first load: the person's access is read first, so the
  // `notifications` events that don't name them are dropped without a read.
  const unreadCounts = createUnreadCounts({
    read: (workspace) =>
      readAccess(workspace)
        .catch(() => undefined)
        .then(() => beforeRead(workspace))
        .then(() => call((options) => api.notifications.count({ workspace }, options))),
    watch,
  });

  // Background jobs (spec 0008): one store for the app, its views per workspace and scope.
  const jobs = createJobsStore({
    api: {
      list: (input) =>
        beforeRead(input.workspace).then(() =>
          call((options) =>
            api.jobs.list(
              {
                workspace: input.workspace,
                scope: input.scope,
                ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
              },
              options,
            ),
          ),
        ),
      get: (input) => call((options) => api.jobs.get(input, options)),
      cancel: (input) => call((options) => api.jobs.cancel(input, options)),
      confirm: (input) => call((options) => api.jobs.confirm(input, options)),
      startTest: (input) => call((options) => api.jobs.startTest(input, options)),
    },
    mintId,
    mutations,
    notify,
    watch,
    memberOf: (workspace) =>
      readAccess(workspace).then(
        (mine) => mine.memberId,
        () => undefined,
      ),
    spread,
    // While live updates are paused or off, the jobs this browser follows are read again on a timer (spec 0022).
    live: {
      status: () => liveStatus,
      subscribe: (listener) => {
        liveListeners.add(listener);
        return () => {
          liveListeners.delete(listener);
        };
      },
    },
    onFinished: (workspace, job) => {
      // A bulk change ended (spec 0022): the tables of its object and the open trash read again now, so they show
      // its final state even where live updates are paused (its own coarse events reach live tabs anyway).
      const objectId = job.subject?.type === 'object' ? job.subject.id : undefined;
      if (job.kind.startsWith('records.')) {
        void records?.then((layer) => {
          layer.reload(workspace, objectId);
        });
        trashMoved(workspace);
      }
      // A delete job this tab started goes on its undo stack as one delete of its batch (the job's id), so Cmd+Z
      // restores it as the finish toast's Undo does (AC-526); the toast is raised once it is there.
      if (job.kind === DELETE_JOB && job.done > 0 && objectId !== undefined) {
        void recordsLayer()
          .then((layer) => {
            layer.rememberDeleteJob(workspace, { objectId, batchId: job.id, count: job.done });
          })
          .catch(() => undefined)
          .finally(() => {
            onJobFinished(workspace, job);
          });
        return;
      }
      onJobFinished(workspace, job);
    },
  });

  // Bookings' held reads (owner ask A115): read again when the person comes back and, while live updates are paused
  // or off (no event says a meeting or booking arrived), every minute while the page shows (`bookings/fresh.ts`).
  const bookingsFresh = {
    live: {
      status: () => liveStatus,
      subscribe: (listener: () => void) => {
        liveListeners.add(listener);
        return () => {
          liveListeners.delete(listener);
        };
      },
    },
    random,
  };
  // Bookings (spec 0025): the workspace's upcoming and past lists and its weeks, kept current while held.
  const bookingsLists = createBookingsStore({
    api: {
      listAll: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.bookings.listAll(input, options))),
      calendar: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.bookings.calendar(input, options))),
    },
    ...bookingsFresh,
  });

  // Home (spec 0041): Team today and the metrics row, read again when the person comes back.
  const homeReads = createHomeStore({
    api: {
      teamToday: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.home.teamToday(input, options))),
      metrics: (input) => beforeRead(input.workspace).then(() => call((options) => api.home.metrics(input, options))),
      recents: (input) => beforeRead(input.workspace).then(() => call((options) => api.recents.list(input, options))),
    },
  });

  // Routing reports (spec 0043, AC-1612): held per workspace, surface and window, read again on return and after a
  // no show mark lands.
  const routingReports = createRoutingReports({
    report: (workspace, surface, days) =>
      beforeRead(workspace).then(() => call((options) => api.routing.report({ workspace, surface, days }, options))),
  });
  // A team page's rules as its Routing card reads them: filled by the page's answers, patched by its updates.
  const pageRules = createPageRules();

  // Availability schedules (spec 0035): a held list per workspace and member, patched by every write, read again on
  // a `schedules` event.
  const schedules = lazySchedules(() =>
    import('./schedules/store.ts').then(({ createSchedulesStore }) =>
      createSchedulesStore({
        api: {
          list: (input) =>
            beforeRead(input.workspace).then(() => call((options) => api.schedules.list(input, options))),
          create: (input) => call((options) => api.schedules.create({ ...input, mutationId: mintId() }, options)),
          update: (input) => call((options) => api.schedules.update({ ...input, mutationId: mintId() }, options)),
          setDefault: (input) =>
            call((options) => api.schedules.setDefault({ ...input, mutationId: mintId() }, options)),
          duplicate: (input) => call((options) => api.schedules.duplicate({ ...input, mutationId: mintId() }, options)),
          remove: (input) => call((options) => api.schedules.delete({ ...input, mutationId: mintId() }, options)),
        },
        mintId,
        watch: (workspace) => watch(workspace),
      }),
    ),
  );

  /**
   * A page made, deleted or moved to another schedule (spec 0035): the held schedules lists read again, since their
   * "Used by" counts the pages; booking pages have no live event of their own.
   */
  const usedBy =
    (workspace: string) =>
    <T>(answer: T): T => {
      schedules.changed(workspace);
      return answer;
    };
  // Bookings' list of every meeting, a page at a time (the owner's ask of 21 October 2026), kept current while held.
  const meetings = createMeetingsStore({
    api: {
      page: (input) => beforeRead(input.workspace).then(() => call((options) => api.bookings.meetings(input, options))),
    },
    ...bookingsFresh,
  });
  /**
   * Time off changed (spec 0037): what Bookings shows now reads again (Host away), each held read once, and so does
   * Home's Team today (Away).
   */
  const refreshBookings = (workspace: string) => {
    bookingsLists.refreshHeld(workspace);
    meetings.refreshHeld(workspace);
    homeReads.teamChanged(workspace);
  };
  /** A booking or a calendar changed: every held Bookings read of the workspace reads again. */
  const reloadBookings = (workspace: string) => {
    bookingsLists.reloadAll(workspace);
    meetings.reloadAll(workspace);
  };
  // A booking linked to a record by hand (polish F2): at once everywhere it shows, back on a refusal.
  const linkBooking = createBookingLink({
    lists: bookingsLists,
    meetings,
    send: (workspace, bookingId, recordId) =>
      call((options) => api.bookings.link({ workspace, bookingId, recordId, mutationId: mintId() }, options)),
  });

  // Scheduling access (spec 0037): delegations both ways and the caller's See reach, one copy per workspace. The
  // store loads with the first screen that asks (`import()`), never in the first load; until then nothing is held,
  // so a sign out or a live event has nothing of it to clear or read again.
  let accessStore: Promise<SchedulingAccessStore> | undefined;
  let accessLoaded: SchedulingAccessStore | undefined;
  const schedulingAccess = (): Promise<SchedulingAccessStore> =>
    (accessStore ??= import('./scheduling/access.ts').then(({ createSchedulingAccessStore, wireApi }) => {
      accessLoaded = createSchedulingAccessStore({
        api: wireApi({ client: api, call: (run) => call(run), beforeRead, mintId, mutations }),
        mintId,
        notify,
        watch,
        onTimeOffChanged: (workspace) => {
          refreshBookings(workspace);
        },
      });
      return accessLoaded;
    }));
  // Settings › Account › Preferences: the member's own, one copy per workspace.
  const preferences = createPreferencesStore({
    api: {
      get: (input) => beforeRead(input.workspace).then(() => call((options) => api.preferences.get(input, options))),
      update: (input) => call((options) => api.preferences.update(input, options)),
    },
    mintId,
    notify,
  });
  // Settings › Account › Link page (spec 0051): the person's own blocks, the same in every workspace. Its store and
  // rules load with the first screen that asks, never in the first load; the store builds its calls from the
  // profile procedures and the one call path, in its own chunk.
  let linkPage: Promise<LinkPageStore> | undefined;
  // Settings › Account › Profile: whether the person's picture shows on their public pages, read with the profile.
  const pictureChoice = createPictureChoiceStore({
    api: {
      get: (input) => call((options) => api.profile.get(input, options)),
      update: (input) => call((options) => api.profile.update(input, options)),
    },
    mintId,
    notify,
  });
  // The person's social links (booking socials, 25 Oct 2026), loaded on first use (out of the first load) by the one
  // screen that holds them, the booking page editor's card. It reads the profile itself (the picture store's read),
  // and a read sent before a change landed never puts its older answer over it; Settings › Profile's Save hands it
  // the set it saved.
  let socialLinks: SocialLinksStore | undefined;
  let socialLinksLoading: Promise<SocialLinksStore> | undefined;
  const loadSocialLinks = (): Promise<SocialLinksStore> =>
    (socialLinksLoading ??= import('./profile/socials.ts').then(({ createSocialLinksStore }) => {
      socialLinks = createSocialLinksStore({
        read: (workspace) => pictureChoice.read(workspace),
        update: (input) => call((options) => api.profile.update(input, options)),
        mintId,
        notify,
        refusals: { refusalSummary },
      });
      return socialLinks;
    }));
  /**
   * The member's time zone in a workspace: their Preferences once read (the workspace's pages read them first),
   * else the browser's. Relative dates in filters, rules, bulk targets and exports resolve in it.
   */
  const zoneOf = (workspace: string): string => {
    const held = preferences.of(workspace).getSnapshot();
    const chosen = held.status === 'ready' ? held.preferences.timeZone : undefined;
    return chosen ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  };

  // Account security (spec 0033): two factor's state and this session's freshness, one held value.
  const accountSecurity = createAccountSecurityStore({
    get: () => call((options) => api.account.security.get(undefined, options)),
    startStepUp: () => call((options) => api.account.stepUp.start({ method: 'email' }, options)),
    verifyStepUp: (input) => call((options) => api.account.stepUp.verify(input, options)),
  });

  // Account security (spec 0033): the person's own sessions, one list for the app load.
  const accountSessions = createAccountSessionsStore({
    api: {
      list: (input) => call((options) => api.account.sessions.list(input, options)),
      revoke: (input) => call((options) => api.account.sessions.revoke(input, options)),
      revokeOthers: () => call((options) => api.account.sessions.revokeOthers(undefined, options)),
    },
    notify,
  });

  // Calendar sync (spec 0024): the member's connections, Settings › Calendar's one list per workspace.
  const calendar = createCalendarStore({
    api: {
      list: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.calendar.connections.list(input, options))),
      update: (input) => call((options) => api.calendar.connections.update(input, options)),
      remove: (input) => call((options) => api.calendar.connections.remove(input, options)),
      syncNow: (input) => call((options) => api.calendar.connections.syncNow(input, options)),
      settings: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.calendar.settings.get(input, options))),
      updateSettings: (input) => call((options) => api.calendar.settings.update(input, options)),
      addAttendee: (input) => call((options) => api.calendar.meetings.addAttendee(input, options)),
    },
    mintId,
    notify,
    // Sync now ran (owner ask A115): what Bookings shows now is read again at once, keeping the pages More opened.
    onSynced: (workspace) => {
      bookingsLists.refreshHeld(workspace);
      meetings.refreshHeld(workspace);
    },
  });

  // Each calendar of the member's accounts (spec 0024 milestone 5): their switches, colours and destination, and a
  // booking page's own. Showing or hiding one on the week reads the held weeks again.
  const calendars = createCalendarsStore({
    api: {
      list: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.calendar.calendars.list(input, options))),
      update: (input) => call((options) => api.calendar.calendars.update(input, options)),
      setDestination: (input) => call((options) => api.calendar.destination.set(input, options)),
      dismissNotice: (input) => call((options) => api.calendar.destination.dismissNotice(input, options)),
      pageDestination: (input) =>
        beforeRead(input.workspace).then(() => call((options) => api.calendar.pageDestination.get(input, options))),
      setPageDestination: (input) => call((options) => api.calendar.pageDestination.set(input, options)),
    },
    mintId,
    notify,
    onShownChange: (workspace) => reloadBookings(workspace),
  });

  // A member's own calendar connections or calendars changed (the `calendars` live kind): only the person's own tabs
  // read their connections and calendars again; every other member's tab drops the event.
  router.on('calendars', (workspace, event) => {
    void namesMe(workspace, event.memberIds).then((named) => {
      if (!named) return;
      calendar.changed(workspace);
      calendars.changed(workspace);
    });
  });
  router.onResync((workspace) => {
    calendar.changed(workspace);
    calendars.changed(workspace);
  });

  // Captures › Links and Forms: one held list per workspace each, patched by every write below (the list's menu, the
  // New dialog, the editors), so the list never needs a refresh to show a change.
  const bookingPageLists = createCaptureList<BookingPageView>({
    read: (workspace) => call((options) => api.bookingPages.list({ workspace }, options)),
  });
  // Settings › Rotations (spec 0029): one held list per workspace, patched by every rotation write below.
  const rotationLists = createCaptureList<RotationView>({
    read: (workspace) => call((options) => api.rotations.list({ workspace }, options)),
  });
  const formLists = createCaptureList<FormSummary>({
    read: (workspace) =>
      call((options) => api.forms.list({ workspace, archived: false }, options)).then((page) => page.items),
  });
  /** A form write's answer as the list's row: the active list drops an archived form. */
  /** The three form writes Email signup makes, bound to this layer's client (`link-page/signup-form.ts`). */
  const signupWrites = {
    create: (input: CreateFormInput) => call((options) => api.forms.create(input, options)),
    saveDraft: (input: SaveFormDraftInput) => call((options) => api.forms.saveDraft(input, options)),
    publish: (input: PublishFormInput) => call((options) => api.forms.publish(input, options)),
  };

  const landForm =
    (formId: string) =>
    (items: readonly FormSummary[], form: FormView): readonly FormSummary[] =>
      form.status === 'archived' ? dropItem<FormSummary>(formId)(items) : upsertFirst(toFormSummary(form))(items);

  // Saved views (spec 0020): one store for the app, a list per object and a body per view.
  const views = createViewsStore({
    api: {
      list: (input) => beforeRead(input.workspace).then(() => call((options) => api.views.list(input, options))),
      get: (input) => beforeRead(input.workspace).then(() => call((options) => api.views.get(input, options))),
      saveQuery: (input) =>
        call((options) =>
          api.views.saveQuery(
            {
              workspace: input.workspace,
              viewId: input.viewId,
              ...(input.filter === undefined ? {} : { filter: input.filter }),
              sorts: [...input.sorts],
              baseQueryVersion: input.baseQueryVersion,
              ...(input.force === undefined ? {} : { force: input.force }),
              mutationId: input.mutationId,
            },
            options,
          ),
        ),
      create: (input) => call((options) => api.views.create({ ...input, config: input.config }, options)),
      update: (input) => call((options) => api.views.update(input, options)),
      setLayout: (input) => call((options) => api.views.setLayout(input, options)),
      move: (input) => call((options) => api.views.move(input, options)),
      setLocked: (input) => call((options) => api.views.setLocked(input, options)),
      setDefault: (input) => call((options) => api.views.setDefault(input, options)),
      remove: (input) => call((options) => api.views.delete(input, options)),
      markOpened: (input) => call((options) => api.views.markOpened(input, options)),
    },
    mintId,
    mutations,
    watch,
    random,
    // A refused column change was put back (spec 0020, AC-470): say why.
    onLayoutRefused: (error) => {
      notify({ tone: 'danger', message: error.message });
    },
  });

  // The member's own sidebar (spec 0034): one copy per workspace, changes shown at once and sent one at a time,
  // read again when another tab of theirs changes it (`nav`), and when a starred view or record may have changed.
  // Loaded with a dynamic import on first use (the workspace route's loader asks for it beside the objects), so it
  // stays out of the first load.
  let navStore: NavStore | undefined;
  let navLoading: Promise<NavStore> | undefined;
  // The store's code didn't load (offline, or a deploy moved it): the sidebar reads as failed, so screens draw the
  // defaults rather than loading for ever, and the next use loads it again.
  let navUnloaded: NavSnapshot | undefined;
  const navWaiting = new Set<() => void>();
  const loadNav = (): Promise<NavStore> => {
    navLoading ??= import('./navigation/store.ts').then(({ createNavStore, NAV_WORDS }) => {
      navStore = createNavStore({
        api: {
          get: (workspace) => beforeRead(workspace).then(() => call((options) => api.nav.get({ workspace }, options))),
          change: (workspace, op, mutationId) =>
            call((options) => api.nav.change({ workspace, op, mutationId }, options)),
        },
        mintId,
        mutations,
        watch,
        namesMe: (workspace, memberIds) => namesMe(workspace, memberIds),
        // What was put back, then why ("Your sidebar wasn’t changed. You have 50 favourites. Remove one first.").
        onRefused: (error, retry) => {
          notify({
            tone: 'danger',
            message: `${NAV_WORDS.notChanged} ${error.message}`,
            ...(retry === undefined ? {} : { action: { label: NAV_WORDS.retry, onAction: retry } }),
          });
        },
        onUnavailable: (_error, retry) => {
          notify({
            tone: 'danger',
            message: NAV_WORDS.unavailable,
            action: { label: NAV_WORDS.retry, onAction: retry },
          });
        },
      });
      navUnloaded = undefined;
      // Screens that subscribed before the store arrived hear it now.
      for (const listener of navWaiting) listener();
      navWaiting.clear();
      return navStore;
    });
    navLoading.catch((error: unknown) => {
      navLoading = undefined;
      navUnloaded = { status: 'error', error: toDataError(error) };
      for (const listener of navWaiting) listener();
    });
    return navLoading;
  };
  /** One workspace's sidebar as `useNav` holds it: the same object each time, so React keeps one subscription. */
  const navSources = new Map<string, NavSource>();
  const loadingNav: NavSnapshot = { status: 'loading' };
  const navSource = (workspace: string): NavSource => {
    const found = navSources.get(workspace);
    if (found !== undefined) return found;
    const made: NavSource = {
      retain: () => {
        let release: (() => void) | undefined;
        let isReleased = false;
        loadNav().then(
          (store) => {
            if (!isReleased) release = store.retain(workspace);
          },
          () => undefined,
        );
        return () => {
          isReleased = true;
          release?.();
        };
      },
      subscribe: (listener) => {
        if (navStore !== undefined) return navStore.subscribe(workspace, listener);
        let stop: (() => void) | undefined;
        const arrived = () => {
          listener();
          stop = navStore?.subscribe(workspace, listener);
        };
        navWaiting.add(arrived);
        return () => {
          navWaiting.delete(arrived);
          stop?.();
        };
      },
      getSnapshot: () => navStore?.snapshot(workspace) ?? navUnloaded ?? loadingNav,
    };
    navSources.set(workspace, made);
    return made;
  };
  // Live events reach the sidebar only once a screen loaded it: before that there is nothing held to change.
  router.on('nav', (workspace, event) => {
    navStore?.navChanged(workspace, event);
  });
  // What other people change reaches the sidebar spread over a moment, as members do, so a whole team doesn't read
  // in step; the member's own changes (above) read at once.
  const refreshNav = (workspace: string) => {
    spread(`nav ${workspace}`, () => {
      navStore?.refresh(workspace);
    });
  };
  router.on('views', (workspace, event) => {
    const change = {
      kind: 'view' as const,
      ids: event.viewIds,
      objectId: event.objectId,
      coarse: event.coarse === true,
    };
    if (navStore?.touchesFavourites(workspace, change) === true) refreshNav(workspace);
  });
  // An object made, archived or restored (not an attribute's change): the sidebar reads again, so one coming back
  // takes the place the member gave it, and stays hidden if they hid it (AC-926, AC-939).
  router.on('definitions', (workspace, event) => {
    if (event.listId !== undefined || (event.attributeIds !== undefined && event.attributeIds.length > 0)) return;
    if (navStore !== undefined) refreshNav(workspace);
  });
  router.on('records', (workspace, event) => {
    // A favourite record's name, trash state or access may have moved: deleted, restored, edited, or coarse.
    const change = {
      kind: 'record' as const,
      ids: [...(event.deletedIds ?? []), ...(event.restoredIds ?? []), ...event.recordIds],
      objectId: event.objectId,
      coarse: event.coarse === true,
    };
    if (navStore?.touchesFavourites(workspace, change) === true) refreshNav(workspace);
  });

  /**
   * A write of this tab landed (spec 0017): its echo never comes back live, so
   * the open timelines read their first page again (a link written here
   * changes the far records' timelines too). Undo writes come this way as well.
   */
  const landed = <T>(workspace: string, answer: Promise<T>): Promise<T> =>
    answer.then((value) => {
      void activity?.then((feeds) => {
        feeds.ownWrite(workspace);
      });
      return value;
    });

  /**
   * A link written here landed, from a cell, a section or an undo (its echo
   * never comes back): the workspace's open related sections read again, since
   * it may change either side of any of them.
   */
  const linksLanded = <T>(workspace: string, answer: Promise<T>): Promise<T> =>
    answer.then((value) => {
      void sections?.then((held) => {
        held.ownWrite(workspace);
      });
      return value;
    });

  const recordsApi: RecordsApi = {
    query: (input, signal) =>
      call((options) => api.records.query({ ...input, attributeIds: [...input.attributeIds] }, options), signal),
    count: (input, signal) => call((options) => api.records.count(input, options), signal),
    groups: (input, signal) =>
      call(
        (options) =>
          api.records.groups(
            {
              ...input,
              groupIds: [...input.groupIds],
              attributeIds: [...input.attributeIds],
              ...(input.sorts === undefined ? {} : { sorts: [...input.sorts] }),
            },
            options,
          ),
        signal,
      ),
    aggregate: (input, signal) =>
      call((options) => api.records.aggregate({ ...input, asks: [...input.asks] }, options), signal),
    aggregateGroups: (input, signal) =>
      call(
        (options) =>
          api.records.aggregateGroups({ ...input, groupIds: [...input.groupIds], asks: [...input.asks] }, options),
        signal,
      ),
    get: (input) =>
      call((options) =>
        api.records.get(
          {
            workspace: input.workspace,
            ids: [...input.ids],
            ...(input.attributeIds === undefined ? {} : { attributeIds: [...input.attributeIds] }),
          },
          options,
        ),
      ),
    create: (input) =>
      landed(
        input.workspace,
        call((options) => api.records.create(input, options)),
      ),
    setValues: (input) =>
      landed(
        input.workspace,
        call((options) => api.records.setValues(input, options)),
      ),
    setValuesBatch: (input) =>
      landed(
        input.workspace,
        call((options) => api.records.setValuesBatch(input, options)),
      ),
    deleteMany: (input) =>
      landed(
        input.workspace,
        call((options) => api.records.deleteMany({ ...input, recordIds: [...input.recordIds] }, options)),
      ),
    restoreBatch: (input) =>
      landed(
        input.workspace,
        call((options) => api.records.restoreBatch(input, options)),
      ),
    updateMany: (input) =>
      landed(
        input.workspace,
        call((options) => api.records.updateMany({ ...input, recordIds: [...input.recordIds] }, options)),
      ),
    linksAdd: (input) =>
      linksLanded(
        input.workspace,
        landed(
          input.workspace,
          call((options) => api.links.add({ ...input, targets: [...input.targets] }, options)),
        ),
      ),
    linksRemove: (input) =>
      linksLanded(
        input.workspace,
        landed(
          input.workspace,
          call((options) => api.links.remove({ ...input, targetRecordIds: [...input.targetRecordIds] }, options)),
        ),
      ),
  };

  /** An attribute's title, from the cached list of its object (empty when it can't be read). */
  const attributeTitle = async (workspace: string, objectId: string, attributeId: string): Promise<string> => {
    const list = await cached(attributes, objectKey(workspace, objectId), () =>
      call((options) => api.attributes.list({ workspace, objectId }, options)),
    ).catch(() => []);
    return list.find((attribute) => attribute.id === attributeId)?.title ?? '';
  };

  /**
   * A member's name from the cached member list; one the list doesn't hold
   * (someone who joined after it was read) reads the list once more.
   */
  const memberName = async (workspace: string, memberId: string | null): Promise<string | undefined> => {
    const read = () => cached(members, workspace, () => allMembers(workspace)).catch(() => []);
    const found = (await read()).find((member) => member.id === memberId);
    if (found !== undefined || memberId === null) return found?.name;
    members.delete(workspace);
    return (await read()).find((member) => member.id === memberId)?.name;
  };

  /** A replaced notice from the records layer, with its names read from the cached definitions. */
  const tellReplaced = async (notice: ReplacedNotice): Promise<void> => {
    const [first = '', ...rest] = notice.attributeIds;
    const title = await attributeTitle(notice.workspace, notice.objectId, first);
    const by = notice.by;
    const who: ReplacedValue['by'] =
      by.type === 'member' ? { kind: 'member', name: await memberName(notice.workspace, by.id) } : { kind: by.type };
    onReplaced({
      workspace: notice.workspace,
      recordId: notice.recordId,
      recordName: notice.recordName,
      attributeTitle: title,
      others: rest.length,
      by: who,
      useMine: notice.useMine,
    });
  };

  /**
   * Every object of the workspace, archived ones too, in its order (spec
   * 0012), cached for the app load. A non member gets the same `NOT_FOUND`
   * as an unknown address, which also drops the cached `me`: the person may
   * have just left it, so `/` asks again.
   */
  function allObjects(workspace: string): Promise<ObjectSummary[]> {
    const cached = objects.get(workspace);
    if (cached !== undefined) return cached;
    const loading = beforeRead(workspace).then(() =>
      call((options) => api.objects.list({ workspace, includeArchived: true }, options)),
    );
    objects.set(workspace, loading);
    loading.catch((error: unknown) => {
      if (objects.get(workspace) === loading) objects.delete(workspace);
      if (toDataError(error).code === 'NOT_FOUND') me = undefined;
    });
    return loading;
  }

  /** The workspace's live objects in its order (the sidebar's), from the same cached list. */
  function listObjects(workspace: string): Promise<ObjectSummary[]> {
    return allObjects(workspace).then((all) => all.filter((object) => !object.isArchived));
  }

  /** The workspace's usage of its limits (spec 0012, AC-243), cached until a definition changes. */
  function readUsage(workspace: string): Promise<Usage> {
    return cached(usage, workspace, () =>
      beforeRead(workspace).then(() => call((options) => api.usage.get({ workspace }, options))),
    );
  }

  /**
   * Runs one object write (spec 0012): server confirmed, never optimistic.
   * Its echo is skipped (one definitions event), and once it lands the
   * workspace's objects, usage and held attributes are read again and the
   * app reloads its pages, so this tab shows the change as every other tab
   * does.
   */
  async function writeObject<T>(
    workspace: string,
    write: (mutationId: string, options: CallOptions) => Promise<T>,
    effects: {
      /** An archive or restore: references to the object change, so every held attribute list is read again. */
      readonly archives?: boolean;
      /** The workspace's objects as the answer already holds them (a move answers the whole new order). */
      readonly objectsOf?: (answer: T) => ObjectSummary[];
      /**
       * The object given a new name attribute (late trap #15): the held attribute lists are read again (which one
       * is the primary moved), and so is every record this tab holds and every section listing its records, since
       * each one's name changed.
       */
      readonly renames?: string;
    } = {},
  ) {
    const mutationId = mintId();
    mutations.sent(mutationId);
    try {
      const answer = await call((options) => write(mutationId, options));
      mutations.answered(mutationId, 1);
      const known = effects.objectsOf?.(answer);
      if (known === undefined) objects.delete(workspace);
      else objects.set(workspace, Promise.resolve(known));
      usage.delete(workspace);
      if (effects.archives === true || effects.renames !== undefined) {
        dropAllAttributes(workspace);
        await refreshAttributes(workspace);
      }
      if (effects.renames !== undefined) renameRecords(workspace, [effects.renames], true);
      onDefinitionsChange();
      return answer;
    } catch (error) {
      mutations.forget(mutationId);
      throw error;
    }
  }

  /** Which import each import job this tab started belongs to (spec 0040), for the finish toast's link. */
  const importJobs = new Map<string, string>();

  /** One import write: a write whose answer was lost goes again with the same ids, and the server answers the same. */
  async function sendImport<T>(make: (mutationId: string) => (options: CallOptions) => Promise<T>): Promise<T> {
    const write = make(mintId());
    try {
      return await delivered(() => call(write), resendAfter);
    } catch (error) {
      throw toDataError(error);
    }
  }

  /** Which records export each export job this tab started belongs to (spec 0040), for the finish toast's Download. */
  const exportJobs = new Map<string, RecordsExportView>();

  /** Follows an import's job (its run, or its undo) like any job this tab started. */
  async function followImportJob(workspace: string, importId: string, jobId: string | undefined): Promise<void> {
    if (jobId === undefined) return;
    importJobs.set(jobId, importId);
    await followJob(workspace, jobId);
  }

  /** Follows a job like any this tab started: live until it ends, then `onJobFinished`. */
  async function followJob(workspace: string, jobId: string): Promise<void> {
    // One held already (a jobs list or a live event read it first) is followed from that copy, with no second read.
    const held = jobs.get(workspace, jobId);
    if (held !== undefined) {
      jobs.track(workspace, held, true);
      return;
    }
    const job = await call((options) => api.jobs.get({ workspace, jobId }, options)).catch(() => undefined);
    // It may have ended before this read (a small export): the app still hears the end, once.
    if (job !== undefined) jobs.track(workspace, job, true);
  }

  /**
   * Runs one attribute write (spec 0012, milestone 2): server confirmed, never
   * optimistic. Its echoes are skipped (one definitions event per object the
   * answer names), and once it lands each named object's lists are read
   * again (the live one) or dropped (the settings one), the usage is
   * dropped, and the app reloads its pages, so this tab shows the change as
   * every other tab does.
   */
  async function writeAttribute<T>(
    workspace: string,
    write: (mutationId: string, options: CallOptions) => Promise<T>,
    objectsOf: (answer: T) => readonly string[],
    /** Runs with the answer before the pages reload (a move keeps its answer as the settings list). */
    keep: (answer: T) => void = () => undefined,
  ): Promise<T> {
    const mutationId = mintId();
    mutations.sent(mutationId);
    try {
      const answer = await call((options) => write(mutationId, options));
      const touched = [...new Set(objectsOf(answer))];
      mutations.answered(mutationId, Math.max(1, touched.length));
      usage.delete(workspace);
      for (const objectId of touched) {
        attributes.delete(objectKey(workspace, objectId));
        dropAllAttributes(workspace, objectId);
      }
      keep(answer);
      onDefinitionsChange();
      return answer;
    } catch (error) {
      mutations.forget(mutationId);
      throw error;
    }
  }

  /** An option's write (spec 0012, AC-236): an attribute write of the object the option's attribute is on. */
  const writeOption = <T>(
    workspace: string,
    objectId: string,
    write: (mutationId: string, options: CallOptions) => Promise<T>,
  ): Promise<T> => writeAttribute(workspace, write, () => [objectId]);

  /** An option for the API: its target as `P<N>D`. */
  const optionInput = (option: NewOption) => ({
    id: option.id,
    label: option.label,
    hue: option.hue,
    ...(option.outcome === undefined ? {} : { outcome: option.outcome }),
    ...(option.targetDays === undefined ? {} : { targetTimeInStage: targetOf(option.targetDays) }),
  });

  /** An option's changes for the API: a target as `P<N>D`, or `null` to clear it. */
  const optionChanges = (changes: OptionChanges) => ({
    ...(changes.label === undefined ? {} : { label: changes.label }),
    ...(changes.hue === undefined ? {} : { hue: changes.hue }),
    ...(changes.outcome === undefined ? {} : { outcome: changes.outcome }),
    ...(changes.targetDays === undefined
      ? {}
      : { targetTimeInStage: changes.targetDays === null ? null : targetOf(changes.targetDays) }),
  });

  /**
   * Makes an option from a cell and sets it (spec 0012, AC-238): the label
   * shows at once (a pending option, and its minted id in the cell), one
   * `records.setValues` sends `{ newOption }`, and the server makes and sets
   * it together or neither. Landed, the object's attributes are read again
   * (the write's own definitions echo is skipped like every echo of this
   * tab's) and the pages reload, which hold the option from then on. Refused,
   * the cell rolls back, marked with why (the 500 limit, `FORBIDDEN`), and
   * the pending option goes. Answers the edit's outcome.
   */
  const createOption = async (
    workspace: string,
    change: {
      readonly objectId: string;
      readonly recordId: string;
      readonly attributeId: string;
      readonly label: string;
    },
  ): Promise<EditOutcome> => {
    const label = change.label.trim();
    const [layer, list] = await Promise.all([
      recordsLayer(),
      cached(attributes, objectKey(workspace, change.objectId), () =>
        beforeRead(workspace).then(() =>
          call((options) => api.attributes.list({ workspace, objectId: change.objectId }, options)),
        ),
      ),
    ]);
    const definition = list.find((attribute) => attribute.id === change.attributeId);
    if (definition === undefined || label === '' || (definition.type !== 'select' && definition.type !== 'status')) {
      // Archived or changed meanwhile: said, rather than doing nothing.
      notify({ tone: 'danger', message: OPTION_GONE });
      return { kind: 'done', cells: 1, landed: 0 };
    }
    // The next hue after every option it holds or is making now, as the server will pick it.
    const waiting = pendingOptions.getSnapshot().get(`${workspace}/${definition.id}`) ?? [];
    return layer.createOption(workspace, {
      objectId: change.objectId,
      recordId: change.recordId,
      attributeId: definition.id,
      optionId: mintId(),
      label,
      hue: nextHue([...(definition.options ?? []), ...waiting]),
      isMulti: definition.isMulti,
    });
  };

  /** One object's live attributes, from the cache, read when it holds none. */
  const objectAttributes = (workspace: string, objectId: string): Promise<AttributeDefinition[]> =>
    cached(attributes, objectKey(workspace, objectId), () =>
      beforeRead(workspace).then(() => call((options) => api.attributes.list({ workspace, objectId }, options))),
    );

  // Each cached attribute list once it settled, so a write's rule check (spec 0013) runs at once when it is held.
  const settledLists = new WeakMap<Promise<AttributeDefinition[]>, readonly AttributeDefinition[]>();

  /** An object's attributes with their rules inline: at once when the cache holds them settled, else once read. */
  const definitionsOf = (
    workspace: string,
    objectId: string,
  ): readonly AttributeDefinition[] | Promise<readonly AttributeDefinition[]> => {
    const held = objectAttributes(workspace, objectId);
    const settled = settledLists.get(held);
    if (settled !== undefined) return settled;
    return held.then((list) => {
      settledLists.set(held, list);
      return list;
    });
  };

  /** An object's primary attribute and its attributes' kinds, for a window's mode (spec 0006, from the cached lists). */
  const describeObject = async (workspace: string, objectId: string): Promise<ObjectShape> => {
    const [list, defined] = await Promise.all([listObjects(workspace), definitionsOf(workspace, objectId)]);
    const primary = list.find((object) => object.id === objectId)?.primaryAttributeId ?? undefined;
    return {
      ...(primary === undefined ? {} : { primaryAttributeId: primary }),
      attributes: defined.map(({ id, type, isSystem, apiSlug, title }) => ({ id, type, isSystem, apiSlug, title })),
    };
  };

  const activityFeeds = (): Promise<ActivityFeeds> => {
    activity ??= import('./activity/feed.ts').then(({ createActivityFeeds }) => {
      // A hidden tab's timelines read nothing; what changed meanwhile is read when it is shown again.
      const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const feeds = createActivityFeeds({
        page: (workspace, recordId, cursor, kinds) =>
          beforeRead(workspace).then(() =>
            call((options) =>
              api.records.activity(
                {
                  workspace,
                  recordId,
                  ...(cursor === undefined ? {} : { cursor }),
                  ...(kinds === undefined ? {} : { kinds: [...kinds] }),
                },
                options,
              ),
            ),
          ),
        members: (workspace, fresh) => {
          if (fresh) members.delete(workspace);
          return readMembers(workspace);
        },
        watch,
        isHidden,
        // The same cached list the tables and the record page read, options inline.
        attributes: (workspace, objectId) =>
          cached(attributes, objectKey(workspace, objectId), () =>
            beforeRead(workspace).then(() => call((options) => api.attributes.list({ workspace, objectId }, options))),
          ),
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!isHidden()) feeds.shown();
        });
      }
      return feeds;
    });
    return activity;
  };

  const linkSections = (): Promise<LinkSections> => {
    sections ??= import('./links/sections.ts').then(({ createLinkSections }) => {
      // A hidden tab's sections read nothing; what changed meanwhile is read when it is shown again.
      const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const held = createLinkSections({
        page: (workspace, input) =>
          beforeRead(workspace).then(() => call((options) => api.links.page({ workspace, ...input }, options))),
        watch,
        isHidden,
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!isHidden()) held.shown();
        });
      }
      return held;
    });
    return sections;
  };

  /**
   * One link delta from a related section (spec 0017, AC-375): the section
   * shows it at once (a Remove's row leaves, an Add's joins), and the near
   * record's cell with it, through the records layer's `changeLink` (its
   * undo entry, rollback and toast on a refusal); the section keeps showing
   * it until a read after the write lands, or drops it on a refusal.
   */
  const sectionLink = async (workspace: string, change: LinkChange): Promise<LinkOutcome> => {
    const held = await linkSections();
    const shown =
      change.kind === 'remove'
        ? held.hide(workspace, change.recordId, change.attributeId, change.target.recordId)
        : change.display === undefined
          ? undefined
          : held.show(workspace, change.recordId, change.attributeId, change.display);
    try {
      const outcome = await (await recordsLayer()).changeLink(workspace, change);
      shown?.settle(outcome.kind === 'done');
      return outcome;
    } catch (error) {
      // The records layer failed to load (offline): the row comes back as it was.
      shown?.settle(false);
      throw error;
    }
  };

  const trashStore = (): Promise<Trash> => {
    trash ??= import('./trash/store.ts').then(({ createTrash }) =>
      createTrash({
        api: {
          query: (input, signal) => call((options) => api.trash.query(input, options), signal),
          count: (input, signal) => call((options) => api.trash.count(input, options), signal),
          restore: (input) =>
            landed(
              input.workspace,
              call((options) => api.trash.restore({ ...input, recordIds: [...input.recordIds] }, options)),
            ).then((answer) => {
              favouritesMoved(input.workspace);
              return answer;
            }),
          deleteForever: (input) =>
            landed(
              input.workspace,
              call((options) => api.trash.deleteForever({ ...input, recordIds: [...input.recordIds] }, options)),
            ),
        },
        mintId,
        watch,
        beforeRead,
        mutations,
      }),
    );
    return trash;
  };

  /**
   * This tab deleted or restored records: its own echoes never come back, so the sidebar reads again (coarsely, at
   * most once a second, at once rather than spread) and a favourite trashed or restored here follows (AC-939). A
   * delete of named records reads only when one is a favourite; a restore, or a change whose records aren't named
   * (a job, an undo), always reads: a favourite in the trash is out of every read, so after a reload this tab can't
   * know it is waiting.
   */
  const favouritesMoved = (workspace: string, deleted?: readonly string[]): void => {
    if (navStore === undefined) return;
    if (deleted === undefined || navStore.touchedHere(workspace, deleted)) navStore.refresh(workspace);
  };

  /** This tab deleted or restored records: its own echoes never come back, so an open trash settles now. */
  const trashMoved = (workspace: string, deleted?: readonly string[]): void => {
    void trash?.then((held) => {
      held.reload(workspace);
    });
    favouritesMoved(workspace, deleted);
  };

  const tasksStore = (): Promise<TasksStore> => {
    tasks ??= import('./tasks/store.ts').then(({ createTasksStore }) =>
      createTasksStore({
        refusals: { refusalFor, refusalSummary },
        api: {
          list: (input) =>
            beforeRead(input.workspace).then(() =>
              call((options) =>
                api.tasks.list(
                  {
                    workspace: input.workspace,
                    scope: 'recordId' in input.scope ? { recordId: input.scope.recordId } : { mine: input.scope.mine },
                    status: input.status,
                    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
                    ...(input.limit === undefined ? {} : { limit: input.limit }),
                  },
                  options,
                ),
              ),
            ),
          get: (input) =>
            call((options) => api.tasks.get({ workspace: input.workspace, ids: [...input.ids] }, options)),
          create: ({ recordIds, ...input }) =>
            taskLanded(
              input.workspace,
              call((options) =>
                api.tasks.create(
                  { ...input, ...(recordIds === undefined ? {} : { recordIds: [...recordIds] }) },
                  options,
                ),
              ),
            ),
          delete: (input) =>
            taskLanded(
              input.workspace,
              call((options) => api.tasks.delete({ ...input }, options)),
            ),
          restore: (input) =>
            taskLanded(
              input.workspace,
              call((options) => api.tasks.restore({ ...input }, options)),
            ),
          update: ({ addRecordIds, removeRecordIds, ...input }) =>
            taskLanded(
              input.workspace,
              call((options) =>
                api.tasks.update(
                  {
                    ...input,
                    ...(addRecordIds === undefined ? {} : { addRecordIds: [...addRecordIds] }),
                    ...(removeRecordIds === undefined ? {} : { removeRecordIds: [...removeRecordIds] }),
                  },
                  options,
                ),
              ),
            ),
        },
        mintId,
        mutations,
        notify,
        watch,
        spread,
        // A task changed on these records: their open timelines read their first page again (spec 0019, AC-438).
        timelines: (workspace, recordIds) => {
          void activity?.then((feeds) => {
            if (recordIds === 'all') feeds.ownWrite(workspace);
            else feeds.changed(workspace, { objectId: '', recordIds });
          });
        },
        memberOf: (workspace) =>
          readAccess(workspace).then(
            (mine) => mine.memberId,
            () => undefined,
          ),
        // From the cached objects list: a records event rereads tasks only when it renames their records.
        primaryOf: (workspace, objectId) =>
          listObjects(workspace).then(
            (list) => list.find((object) => object.id === objectId)?.primaryAttributeId ?? undefined,
            () => undefined,
          ),
      }),
    );
    return tasks;
  };

  // While any note has changes not yet saved, leaving the page asks first (spec 0019, AC-440).
  const leaveGuard = (event: BeforeUnloadEvent) => {
    event.preventDefault();
  };
  const notesStore = (): Promise<NotesStore> => {
    notes ??= import('./notes/store.ts').then(({ createNotesStore }) =>
      createNotesStore({
        api: {
          list: (input) =>
            beforeRead(input.workspace).then(() => call((options) => api.notes.list({ ...input }, options))),
          get: (input) => call((options) => api.notes.get({ ...input }, options)),
          save: ({ content, ...input }) =>
            call((options) =>
              api.notes.save({ ...input, ...(content === undefined ? {} : { content: content }) }, options),
            ),
          delete: (input) => call((options) => api.notes.delete({ ...input }, options)),
          restore: (input) => call((options) => api.notes.restore({ ...input }, options)),
        },
        mintId,
        mutations,
        notify,
        watch,
        timelines: (workspace, recordIds) => {
          void activity?.then((feeds) => {
            if (recordIds === 'all') feeds.ownWrite(workspace);
            else feeds.changed(workspace, { objectId: '', recordIds });
          });
        },
        onUnsaved: (hasUnsaved) => {
          if (typeof window === 'undefined') return;
          if (hasUnsaved) window.addEventListener('beforeunload', leaveGuard);
          else window.removeEventListener('beforeunload', leaveGuard);
        },
      }),
    );
    return notes;
  };

  const commentsStore = (): Promise<CommentsStore> => {
    comments ??= import('./comments/store.ts').then(({ createCommentsStore }) =>
      createCommentsStore({
        api: {
          list: (input) =>
            beforeRead(input.workspace).then(() => call((options) => api.comments.list({ ...input }, options))),
          get: (input) => call((options) => api.comments.get({ ...input, threadIds: [...input.threadIds] }, options)),
          create: (input) => call((options) => api.comments.create({ ...input }, options)),
          update: (input) => call((options) => api.comments.update({ ...input }, options)),
          delete: (input) => call((options) => api.comments.delete({ ...input }, options)),
          resolve: (input) => call((options) => api.comments.resolve({ ...input }, options)),
          react: (input) => call((options) => api.comments.react({ ...input }, options)),
          versions: (input) => call((options) => api.comments.versions({ ...input }, options)),
        },
        mintId,
        mutations,
        notify,
        watch,
      }),
    );
    return comments;
  };

  const inboxStore = (): Promise<InboxStore> => {
    inbox ??= import('./inbox/store.ts').then(({ createInboxStore }) =>
      createInboxStore({
        api: {
          list: (input) =>
            beforeRead(input.workspace).then(() => call((options) => api.notifications.list({ ...input }, options))),
          mark: (input) => call((options) => api.notifications.mark({ ...input, ids: [...input.ids] }, options)),
          markAllRead: (input) => call((options) => api.notifications.markAllRead({ ...input }, options)),
          settings: (input) => call((options) => api.notifications.settings({ ...input }, options)),
          setSettings: (input) => call((options) => api.notifications.setSettings({ ...input }, options)),
        },
        mintId,
        mutations,
        notify,
        watch,
        unread: unreadCounts,
      }),
    );
    return inbox;
  };

  const recordsLayer = (): Promise<RecordsLayer> => {
    records ??= import('./records/layer.ts')
      .then(({ createRecordsLayer }) =>
        createRecordsLayer({
          api: recordsApi,
          notify,
          mintId,
          refusals: { refusalFor, refusalSummary },
          watch,
          mutations,
          beforeRead,
          // The person's member id in the workspace (cached with their role), so their own saves raise no notice.
          memberOf: (workspace) =>
            cached(access, workspace, () => call((options) => api.access.mine({ workspace }, options))).then(
              (mine) => mine.memberId,
              () => undefined,
            ),
          onReplaced: (notice) => {
            void tellReplaced(notice);
          },
          describe: describeObject,
          definitionsOf,
          // Relative dates ("today", "this week") and rules resolve in the member's Preferences time zone.
          timeZone: zoneOf,
          // A cell's new option (spec 0012, AC-238): its label shows while it is made, on every try. Landed, the
          // object's attributes are read again (its own definitions echo is skipped) and the pages reload.
          cellOptions: {
            asked: (workspace, option) => {
              pendingOptions.add(workspace, option);
            },
            refused: (workspace, attributeId, id) => {
              pendingOptions.remove(workspace, attributeId, id);
            },
            made: (workspace, objectId, made) => {
              pendingOptions.resolve(workspace, made.attributeId, made.id, made.resolvedId);
              usage.delete(workspace);
              dropAllAttributes(workspace, objectId);
              reloadIfChanged([refreshAttributes(workspace, objectId)]);
            },
          },
        }),
      )
      .then((layer) => {
        recordsLoaded = layer;
        return layer;
      });
    return records;
  };

  const readMe = (): Promise<Me | undefined> => {
    me ??= attempt((options) => api.me.get(undefined, options)).then(
      (answer) => {
        // Someone is signed in again (in another tab, say): the next 401 ends their session too.
        ended = false;
        seenPerson = true;
        // Now known for certain: the app keeps it as the next load's hint for which screen to hold a place for.
        sessionKnown(true);
        return answer;
      },
      (error: unknown) => {
        const failure = toDataError(error);
        // A 401 here is an answer, not a failure: nobody is signed in, and the app may keep that as its hint.
        if (failure.code === 'UNAUTHENTICATED') {
          sessionKnown(false);
          return undefined;
        }
        me = undefined;
        throw failure;
      },
    );
    return me;
  };

  return {
    me: {
      /**
       * Who is signed in and their workspaces (oldest first), or undefined
       * when nobody is. Asked once per app load, then cached until sign in,
       * sign out or a new workspace changes it. A 401 here is an answer
       * ("nobody"), so it never runs `onSignedOut`.
       */
      get: readMe,
      /**
       * Remembers `workspace` (its address) as the one the person last opened
       * (spec 0031, AC-802), so `/` and sign in bring them back to it on any
       * device. Sends nothing when the cached answer already names it, and
       * never fails: a refusal only means `/` falls back to the oldest.
       */
      async rememberWorkspace(workspace: string): Promise<void> {
        const held = await (me ?? Promise.resolve(undefined)).catch(() => undefined);
        const opened = held?.workspaces.find((each) => each.slug === workspace);
        if (held === undefined || opened === undefined || held.lastWorkspaceId === opened.id) return;
        try {
          await call((options) => api.me.setLastWorkspace({ workspace }, options));
          // Only while the cache still holds the same answer: a sign out or a new workspace replaced it.
          if (me !== undefined && (await me.catch(() => undefined)) === held) {
            me = Promise.resolve({ ...held, lastWorkspaceId: opened.id });
          }
        } catch {
          // Best effort: the next workspace opened tries again.
        }
      },
    },
    workspaces: {
      /** A new workspace's id: mint it once per form, and send the same one again on a retry, so nothing is made twice. */
      newId: () => mintId(),
      /** Creates the signed in person's workspace. Refusals: `SLUG_TAKEN` (field `slug`), `ID_TAKEN`, `INPUT_INVALID` (with issues). */
      async create(input: CreateWorkspaceInput) {
        const created = await call((options) => api.workspaces.create(input, options));
        me = undefined;
        return created;
      },
      /**
       * Whether no workspace has ever used the address (first run checks it as
       * it is typed, spec 0036). Never cached: someone may take it at any
       * moment, and `create` has the last word. Rejects with a DataError
       * (`RATE_LIMITED` past 60 checks a minute, offline).
       */
      async slugAvailable(slug: string): Promise<boolean> {
        const { available } = await call((options) => api.workspaces.slugAvailable({ slug }, options));
        return available;
      },
    },
    /**
     * Availability schedules (spec 0035): a member's named hours, one of them
     * their default, held per workspace and member and read again live.
     * Writes show at once and put back what they changed on a refusal:
     * `NAME_TAKEN` on `name`, `SCHEDULE_LIMIT`, `STALE` (changed in another
     * tab), `DEFAULT_SCHEDULE` (the default can't be deleted).
     */
    schedules: {
      /** A new schedule's id: mint it once per save, and send the same one again on a retry. */
      newId: () => mintId(),
      /**
       * Whose schedules the reader may view (AC-971): themselves, and with `booking.admin` every active member, by
       * name. The Viewing Select's choices, read when Availability opens.
       */
      members: (workspace: string): Promise<readonly ScheduleMember[]> =>
        beforeRead(workspace)
          .then(() => call((options) => api.schedules.members({ workspace }, options)))
          .then((answer) => answer.members),
      /** The caller's own schedules (`memberId` undefined), or a colleague's with `booking.admin`. */
      view: (workspace: string, memberId: string | undefined, timeZone: string): SchedulesView =>
        schedules.view(workspace, memberId, timeZone),
      create: schedules.create,
      update: schedules.update,
      setDefault: schedules.setDefault,
      duplicate: schedules.duplicate,
      /** Deletes one; the pages it moved to the default read again, so Links drops the schedule's name from them. */
      remove: (...args: Parameters<typeof schedules.remove>) =>
        schedules.remove(...args).then((moved) => {
          if (moved.pages > 0) bookingPageLists.view(args[0]).reload();
          return moved;
        }),
    },
    /**
     * Scheduling access (spec 0037): who may see or manage whose scheduling, a store loaded on first use
     * (`scheduling/access.ts`). Its `delegations` holds the member's own both ways (`mine`) or the workspace's
     * (`everyone`, `members.manage` only); `grant` and `revoke` show at once in every held list they belong to and are
     * put back with a toast if refused; `visible` answers the members in the caller's See reach. An `access` change
     * naming the member reads them all again.
     */
    scheduling: {
      /** Loads the store (its own chunk, never the first load): a route's loader awaits it before its screen draws. */
      open: (): Promise<SchedulingAccessStore> => schedulingAccess(),
      /** The store once a loader opened it, for a screen to read in render; undefined before. */
      loaded: (): SchedulingAccessStore | undefined => accessLoaded,
    },
    /**
     * Booking pages (spec 0025): settings, not CRM data, with no live event.
     * Captures › Links reads the held list (`view`), the one copy every write
     * here patches: `update` (a pause from the list, the builder saving as you
     * go), `remove` and `duplicate` show at once and put it back on a refusal,
     * which they reject with for the caller to say; `create` waits for the
     * server (its dialog checks the address), then the page is first in the list.
     */
    bookingPages: {
      /** A new page's id: mint it once per New page, and send the same one again on a retry. */
      newId: () => mintId(),
      /** The reader's pages (their own; everyone's with `booking.admin`), newest first, read once. */
      list: (workspace: string): Promise<BookingPageView[]> =>
        call((options) => api.bookingPages.list({ workspace }, options)),
      /** The reader's pages as the held list Captures › Links shows; `useCaptureList` reads it. */
      view: (workspace: string): CaptureListView<BookingPageView> => bookingPageLists.view(workspace),
      /**
       * The pages from that same held list, for a loader beside other work (Bookings' Link filter, Availability):
       * at once when it holds them (read again behind), else after its first read, rejecting as it did. One read
       * serves every tab, so moving between them asks again only when the list is no longer fresh.
       */
      held: async (workspace: string): Promise<readonly BookingPageView[]> => {
        await bookingPageLists.view(workspace).ready();
        return bookingPageLists.items(workspace) ?? [];
      },
      /**
       * Where a page's answers may be filed (spec 0057, AC-5706): People and the attributes a question may go onto,
       * with whether the reader may write each. `NOT_FOUND` for a page the reader may not change.
       */
      attributes: (workspace: string, pageId: string): Promise<FormTargetChoices> =>
        call((options) => api.bookingPages.attributes({ workspace, pageId }, options)),
      /** One page. `NOT_FOUND` for one the reader may not change. */
      get: (workspace: string, pageId: string): Promise<BookingPageView> =>
        call((options) => api.bookingPages.get({ workspace, pageId }, options)).then((page) => {
          pageRules.receive(workspace, page);
          return page;
        }),
      /** A new page with defaults. Refusals: `ID_TAKEN`, `SLUG_TAKEN` (field `slug`). */
      create: (
        workspace: string,
        input: {
          id: string;
          title: string;
          timeZone: string;
          settings?: Partial<BookingPageSettings>;
          /** `round_robin` (spec 0029) needs `booking.admin` and its hosts. */
          kind?: 'personal' | 'round_robin';
          /** `workspace`: the workspace's own link (`booking.admin`), booking everyone on the roster unless `hosts` says. */
          scope?: 'workspace';
          hosts?: TeamHosts;
        },
      ): Promise<BookingPageView> =>
        bookingPageLists.write(workspace, {
          send: () =>
            call((options) => api.bookingPages.create({ workspace, ...input, mutationId: mintId() }, options)).then(
              usedBy(workspace),
            ),
          land: (items, page) => upsertFirst(page)(items),
        }),
      /**
       * Changes only the settings given (and a round robin page's hosts, `booking.admin`), in the list at once.
       * Refusals: `SLUG_TAKEN` (field `slug`), `HOSTS_INVALID` and `NOT_FOUND` (field `hosts`), `INPUT_INVALID` (with issues).
       */
      update: (
        workspace: string,
        pageId: string,
        settings: Partial<BookingPageSettings>,
        extra: { hosts?: TeamHosts; routing?: RoutingRules } = {},
      ): Promise<BookingPageView> => {
        // A team page's rules show at once on its Routing card too, and go back there on a refusal.
        const putBack =
          extra.routing === undefined ? undefined : pageRules.show(workspace, pageId, extra.routing.rules);
        return bookingPageLists
          .write(workspace, {
            send: () =>
              call((options) =>
                api.bookingPages.update(
                  {
                    workspace,
                    pageId,
                    settings,
                    ...(extra.hosts === undefined ? {} : { hosts: extra.hosts }),
                    ...(extra.routing === undefined ? {} : { routing: extra.routing }),
                    mutationId: mintId(),
                  },
                  options,
                ),
              ).then(settings.scheduleId === undefined ? (page: BookingPageView) => page : usedBy(workspace)),
            ...shownPatch(bookingPageLists.items(workspace), pageId, (page) => ({
              ...page,
              ...settings,
              ...(extra.hosts === undefined ? {} : { hosts: extra.hosts }),
              ...(extra.routing === undefined ? {} : { routing: extra.routing }),
            })),
            land: (items, page) => patchItem<BookingPageView>(pageId, () => page)(items),
          })
          .then(
            (page) => {
              pageRules.receive(workspace, page);
              return page;
            },
            (error: unknown) => {
              putBack?.();
              throw error;
            },
          );
      },
      /**
       * A copy of a page the list holds, titled `title`: first in the list at
       * once (pending until the server made it), gone again on a refusal. The
       * copy is the reader's own, so it keeps the schedule only when the page
       * was theirs too; an admin's copy of a colleague's page follows the
       * admin's default (spec 0035, AC-966).
       */
      duplicate: (workspace: string, page: BookingPageView, title: string): Promise<BookingPageView> => {
        const id = mintId();
        const {
          id: _id,
          publicKey: _key,
          kind: _kind,
          hosts: _hosts,
          ownerMemberId: _owner,
          bookingsThisMonth: _count,
          canChange: _can,
          createdAt: _created,
          updatedAt: _updated,
          slug: _slug,
          handle: _handle,
          // Read only: the hours and name of the schedule the page books by now (spec 0035).
          availability: _hours,
          scheduleName: _scheduleName,
          ...settings
        } = page;
        const at = new Date().toISOString();
        const draft: BookingPageView = {
          ...page,
          id,
          title,
          // The address the server will make from the title, until its answer says.
          slug: title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, ''),
          publicKey: '',
          bookingsThisMonth: 0,
          createdAt: at,
          updatedAt: at,
        };
        return bookingPageLists.write(workspace, {
          send: () =>
            readAccess(workspace)
              .then(
                (mine) => mine.memberId,
                () => undefined,
              )
              .then((me) =>
                call((options) =>
                  api.bookingPages.create(
                    {
                      workspace,
                      id,
                      title,
                      timeZone: page.availability.timeZone,
                      settings: {
                        ...settings,
                        title,
                        scheduleId: page.ownerMemberId === me ? page.scheduleId : null,
                      },
                      // A round robin page’s copy books from the same hosts; a workspace link's copy is the workspace's.
                      ...(page.kind === 'round_robin' && page.hosts !== undefined
                        ? { kind: 'round_robin' as const, hosts: page.hosts }
                        : {}),
                      scope: page.scope,
                      mutationId: mintId(),
                    },
                    options,
                  ),
                ),
              )
              .then(usedBy(workspace)),
          show: upsertFirst(draft),
          pendingId: id,
          undo: dropItem<BookingPageView>(id),
          land: (items, copy) => upsertFirst(copy)(items),
        });
      },
      /** Deletes a page, gone from the list at once and back on a refusal: its link stops working, its bookings stay. */
      remove: (workspace: string, pageId: string): Promise<{ pageId: string }> =>
        bookingPageLists.write(workspace, {
          send: () =>
            call((options) => api.bookingPages.delete({ workspace, pageId, mutationId: mintId() }, options)).then(
              usedBy(workspace),
            ),
          ...shownDrop(bookingPageLists.items(workspace), pageId),
        }),
    },
    /**
     * Rotations (spec 0029): the pools round robin pages book from. Settings
     * › Rotations reads the held list (`view`); `update` and `remove` show at
     * once and put it back on a refusal, which they reject with for the
     * caller to say; `create` waits for the server (its dialog checks the
     * members), then the rotation is in the list.
     */
    rotations: {
      /** A new rotation's id: mint it once per dialog, and send the same one again on a retry. */
      newId: () => mintId(),
      /** The rotations the reader may see as the held list Settings › Rotations shows; `useCaptureList` reads it. */
      view: (workspace: string): CaptureListView<RotationView> => rotationLists.view(workspace),
      /** The same list for a loader beside other work (the page builder's rotation picker). */
      held: async (workspace: string): Promise<readonly RotationView[]> => {
        await rotationLists.view(workspace).ready();
        return rotationLists.items(workspace) ?? [];
      },
      /** A new rotation. Refusals: `ID_TAKEN`, `CONFIG_INVALID` (on `members.<n>`), `FORBIDDEN`. */
      create: (
        workspace: string,
        input: { id: string; settings: RotationSettings; members: RotationMemberInput[] },
      ): Promise<RotationView> =>
        rotationLists.write(workspace, {
          send: () => call((options) => api.rotations.create({ workspace, ...input, mutationId: mintId() }, options)),
          land: (items, rotation) => upsertFirst(rotation)(items),
        }),
      /**
       * Changes the settings given, and the members when given (replacing
       * the list), in the list at once. Refusals: `CONFIG_INVALID` (on its
       * field), `NOT_FOUND`, `FORBIDDEN`.
       */
      update: (
        workspace: string,
        rotationId: string,
        change: { settings: Partial<RotationSettings>; members?: RotationMemberInput[] },
      ): Promise<RotationView> =>
        rotationLists.write(workspace, {
          send: () =>
            call((options) =>
              api.rotations.update(
                {
                  workspace,
                  rotationId,
                  settings: change.settings,
                  ...(change.members === undefined ? {} : { members: change.members }),
                  mutationId: mintId(),
                },
                options,
              ),
            ),
          ...shownPatch(rotationLists.items(workspace), rotationId, (rotation) => ({
            ...rotation,
            ...change.settings,
            ...(change.members === undefined
              ? {}
              : {
                  members: change.members.map((member) => {
                    const before = rotation.members.find((each) => each.memberId === member.memberId);
                    return { ...member, name: before?.name ?? '', hasCalendar: before?.hasCalendar ?? false };
                  }),
                }),
          })),
          land: (items, rotation) => patchItem<RotationView>(rotationId, () => rotation)(items),
        }),
      /** A rotation's Distribution tab (spec 0037, AC-1330): read when the tab opens and again after an adjustment. */
      distribution: (workspace: string, rotationId: string): Promise<RotationDistribution> =>
        call((options) => api.rotations.distribution({ workspace, rotationId }, options)),
      /**
       * Adjusts a member's count with a note (AC-1329), waiting for the server; the rotations read again, so every
       * share shows the new count.
       */
      adjust: (
        workspace: string,
        rotationId: string,
        change: { readonly memberId: string; readonly units: number; readonly note: string },
      ): Promise<RotationAdjustment> =>
        call((options) =>
          api.rotations.adjust({ workspace, rotationId, ...change, mutationId: mintId() }, options),
        ).then((made) => {
          rotationLists.view(workspace).reload();
          return made;
        }),
      /**
       * Hands a member's upcoming bookings in the rotation to the others (AC-750), waiting for the server; Bookings and
       * the rotations read again.
       */
      reassignUpcoming: (workspace: string, rotationId: string, memberId: string): Promise<ReassignedUpcoming> =>
        call((options) =>
          api.rotations.reassignUpcoming({ workspace, rotationId, memberId, mutationId: mintId() }, options),
        ).then((done) => {
          rotationLists.view(workspace).reload();
          bookingsLists.reloadAll(workspace);
          return done;
        }),
      /** Undoes an adjustment (AC-1329); the rotations read again. */
      undoAdjustment: (workspace: string, rotationId: string, adjustmentId: string): Promise<RotationAdjustment> =>
        call((options) =>
          api.rotations.undoAdjustment({ workspace, rotationId, adjustmentId, mutationId: mintId() }, options),
        ).then((undone) => {
          rotationLists.view(workspace).reload();
          return undone;
        }),
      /** Deletes a rotation no page books from, gone at once and back on a refusal (`IN_USE`, "Used by 2 pages"). */
      remove: (workspace: string, rotationId: string): Promise<{ rotationId: string }> =>
        rotationLists.write(workspace, {
          send: () => call((options) => api.rotations.delete({ workspace, rotationId, mutationId: mintId() }, options)),
          ...shownDrop(rotationLists.items(workspace), rotationId),
        }),
    },
    audit: {
      /**
       * Settings › History › Workspace changes (spec 0046): one paged read of the workspace's audit log, its first
       * page started at once (the route's loader opens it). Loaded with `import()`, never live, never in the record
       * store: each visit opens it afresh, and the screen retains it while shown (let go, it aborts and stops).
       * While a screen holds a workspace's log, opening it again answers that same log.
       */
      openLog: async (workspace: string): Promise<AuditLog> => {
        // A log a screen holds is handed back as it is, so the page reloading its data while it shows (a live
        // attribute change invalidates the router) keeps the rows read so far and Show more's place.
        const held = auditLogs.get(workspace);
        if (held !== undefined) return held;
        const { openAuditLog } = await import('./audit/log.ts');
        const log: AuditLog = openAuditLog(
          {
            list: (input, signal) =>
              call((options) => api.audit.list(input, options), signal).catch((error: unknown) => {
                // The reader lost `audit.read`: their held access is stale, so History's next visit opens their
                // sign ins (AC-4618).
                if (toDataError(error).code === 'FORBIDDEN') access.delete(workspace);
                throw error;
              }),
            onHeld: () => auditLogs.set(workspace, log),
            onDisposed: () => {
              if (auditLogs.get(workspace) === log) auditLogs.delete(workspace);
            },
          },
          workspace,
        );
        return log;
      },
    },
    routing: {
      /**
       * A form's or a team page's per rule report (spec 0043, AC-1612), held while its card shows it
       * (`useRoutingReport`): read when first held, again when the person comes back to the page, and again after
       * this tab marks a booking no show.
       */
      report: (workspace: string, surface: RoutingReportSurface, days: RoutingReportDays): RoutingReportHeld =>
        routingReports.view(workspace, surface, days),
      /**
       * A team page's routing rules as the layer holds them (spec 0043, AC-1608), for its Routing card: filled by
       * the page's answers (the editor's `bookingPages.get`, an update's), and patched by `bookingPages.update` at
       * once and put back on a refusal, so a rule added, moved or removed shows before the server answers. Read with
       * `usePageRules`; undefined until an answer carrying the page arrives.
       */
      pageRules: (workspace: string, pageId: string): PageRulesHeld => pageRules.view(workspace, pageId),
    },
    home: {
      /**
       * Team today (spec 0041): every member's meetings in [from, to), the
       * reader's day, titles only where the reader may see them; held while a
       * screen shows it (`useTeamToday`) and read again when the person comes back.
       */
      teamToday: (workspace: string, from: string, to: string): HomeHeld<TeamTodayState> =>
        homeReads.teamToday(workspace, from, to),
      /**
       * The metrics row (spec 0041): this week so far against last week, from
       * `weekStart` (the reader's Monday's midnight, UTC); a tile the reader
       * may not see is absent. `useHomeMetrics` reads it.
       */
      metrics: (workspace: string, weekStart: string): HomeHeld<HomeMetricsState> =>
        homeReads.metrics(workspace, weekStart),
      /**
       * Recently viewed (spec 0041): the member's recent records and views
       * they may still see, newest first, the command menu's own list; held
       * while Home shows it (`useHomeRecents`), read each time it is first held.
       */
      recents: (workspace: string): HomeHeld<HomeRecentsState> => homeReads.recents(workspace),
    },
    bookings: {
      /** Why a round robin booking went to its host (spec 0029, AC-742): for its host and admins. */
      assignments: (workspace: string, bookingId: string): Promise<BookingAssignment[]> =>
        call((options) => api.bookings.assignments({ workspace, bookingId }, options)),
      /**
       * Gives one seat of a round robin booking to someone else (spec 0029, AC-748): the named member, or the next in
       * its rotation. Bookings read again after it, so every list shows the new host.
       */
      reassign: async (
        workspace: string,
        bookingId: string,
        to: { readonly rotationId?: string; readonly memberId?: string; readonly memberName?: string },
      ): Promise<ReassignedBooking> => {
        // A named host shows at once, by name; "next in rotation" waits for the server to say who.
        const { memberId, memberName } = to;
        const restore =
          memberId === undefined
            ? () => undefined
            : bookingsLists.patchBooking(workspace, bookingId, (booking) => ({
                ...booking,
                hostMemberId: memberId,
                hostName: memberName ?? booking.hostName,
                needsHost: false,
              }));
        try {
          const done = await call((options) =>
            api.bookings.reassign(
              {
                workspace,
                bookingId,
                ...(to.rotationId === undefined ? {} : { rotationId: to.rotationId }),
                ...(memberId === undefined ? {} : { memberId }),
                mutationId: mintId(),
              },
              options,
            ),
          );
          bookingsLists.reloadAll(workspace);
          return done;
        } catch (error) {
          restore();
          bookingsLists.reloadAll(workspace);
          throw error;
        }
      },
      /**
       * Marks a past booking as a no show, or takes the mark back (spec 0043, AC-1613): in every list at once,
       * put back with the refusal when the server says no.
       */
      markNoShow: async (workspace: string, bookingId: string, noShow: boolean): Promise<void> => {
        const restore = bookingsLists.patchBooking(workspace, bookingId, (booking) => {
          const { noShow: _was, ...rest } = booking;
          return noShow ? { ...rest, noShow: true } : rest;
        });
        try {
          await call((options) =>
            api.bookings.markNoShow({ workspace, bookingId, noShow, mutationId: mintId() }, options),
          );
          // The routing report counts no shows per rule, and no change event names a booking yet.
          routingReports.reloadWorkspace(workspace);
        } catch (error) {
          restore();
          throw error;
        }
      },
      /** A page's bookings: upcoming soonest first, or past latest first, at most 100. */
      list: (workspace: string, pageId: string, when: 'upcoming' | 'past'): Promise<BookingView[]> =>
        call((options) => api.bookings.list({ workspace, pageId, when }, options)),
      /**
       * Bookings, the workspace's list: every booking the reader may see,
       * upcoming or past, held while a screen shows it (`useBookings`) and
       * read again whenever the person comes back to the page, and every
       * minute while the page shows and live updates are paused or off.
       */
      view: (workspace: string, when: BookingsTab): BookingsView => bookingsLists.view(workspace, when),
      /**
       * Bookings' week: a range's bookings (cancelled too) and the reader's own
       * calendar events, held while a screen shows it (`useBookingsCalendar`)
       * and read again whenever the person comes back to the page, and every
       * minute while the page shows and live updates are paused or off. `hosts` is whose bookings: the reader's own
       * (the default), or everyone's for an admin (`booking.admin`; the same as Mine for anyone else).
       */
      calendar: (workspace: string, from: string, to: string, hosts?: BookingHosts): BookingsCalendarHeld =>
        bookingsLists.calendar(workspace, from, to, hosts),
      /**
       * Bookings' list: every meeting on a tab (bookings and the member's own calendar events), narrowed to a source
       * and the calendars panel's pick, a page at a time (`useMeetings`; More reads the next). While held, what it
       * shows is read again on the person's return, and every minute while the page shows and live updates are
       * paused or off, keeping the pages More opened.
       */
      meetings: (workspace: string, query: MeetingsQuery): MeetingsHeld => meetings.list(workspace, query),
      /** Reads every bookings list and range a screen holds again. */
      reloadAll: (workspace: string): void => {
        reloadBookings(workspace);
      },
      /** The member's default schedule's hours; never saved, weekdays 09:00 to 17:00 in `timeZone`. */
      hours: (workspace: string, timeZone: string): Promise<{ availability: BookingAvailability }> =>
        call((options) => api.bookings.hours({ workspace, timeZone }, options)),
      /** Replaces the member's default schedule's hours; their pages that follow the default book by them at once. */
      setHours: (
        workspace: string,
        availability: BookingAvailability,
      ): Promise<{ availability: BookingAvailability }> =>
        call((options) => api.bookings.setHours({ workspace, availability, mutationId: mintId() }, options)),
      /**
       * Book someone in, in the member's own time (spec 0027): settles once the
       * booking is made, and every bookings list and range is read again.
       * Refusals: `SLOT_TAKEN` (another booking is in that time),
       * `CONFIG_INVALID` on `start` or `minutes`, `NOT_FOUND` on `pageId`.
       * `idempotencyKey` is minted once per dialog, so a retry is the same booking.
       */
      bookAsHost: async (
        workspace: string,
        input: Omit<BookAsHostInput, 'workspace' | 'mutationId'>,
      ): Promise<{ bookingId: string; notInCrm?: string }> => {
        const booked = await call((options) =>
          api.bookings.bookAsHost({ ...input, workspace, mutationId: mintId() }, options),
        );
        reloadBookings(workspace);
        return booked;
      },
      /** A new booking's idempotency key: mint it once per dialog. */
      newKey: () => mintId(),
      /**
       * Links a booking to a record by hand, or takes the link off with `null` (polish F2): the chip shows at once
       * in every list, range and page of meetings, and goes back on a refusal (`NOT_FOUND` on `recordId` for a
       * record the member can't see, `FORBIDDEN` for one they may not change, `CONFIG_INVALID` for a person or
       * company), which it throws on.
       */
      link: (workspace: string, bookingId: string, record: LinkedRecordDisplay | null): Promise<void> =>
        linkBooking(workspace, bookingId, record),
      /**
       * Cancels a booking (AC-640): shown cancelled at once, back on a
       * refusal; the guest is emailed, with the reason when there is one.
       * Every list and range is read again once the server has it.
       */
      cancel: async (workspace: string, bookingId: string, reason: string): Promise<void> => {
        const restore = bookingsLists.patchBooking(workspace, bookingId, (booking) => ({
          ...booking,
          status: 'cancelled',
          cancelledBy: 'host',
          ...(reason === '' ? {} : { cancelReason: reason }),
        }));
        try {
          await call((options) =>
            api.bookings.cancel(
              { workspace, bookingId, ...(reason === '' ? {} : { reason }), mutationId: mintId() },
              options,
            ),
          );
        } catch (error) {
          restore();
          // A refusal after the server may have changed it (an email queue that failed): read what it holds.
          reloadBookings(workspace);
          throw error;
        }
        reloadBookings(workspace);
      },
      /**
       * Moves a booking to a time its page offers (AC-640): at its new time at
       * once, back on a refusal (`SLOT_TAKEN` when the time just went,
       * `LIMIT_REACHED` after 5 moves). The guest is emailed.
       */
      move: async (workspace: string, bookingId: string, start: string): Promise<void> => {
        const restore = bookingsLists.patchBooking(workspace, bookingId, (booking) => {
          const length = Date.parse(booking.endsAt) - Date.parse(booking.startsAt);
          return {
            ...booking,
            startsAt: start,
            endsAt: new Date(Date.parse(start) + length).toISOString(),
            reschedules: booking.reschedules + 1,
          };
        });
        try {
          await call((options) => api.bookings.move({ workspace, bookingId, start, mutationId: mintId() }, options));
        } catch (error) {
          restore();
          reloadBookings(workspace);
          throw error;
        }
        reloadBookings(workspace);
      },
      /** Where a booking could move in a range: its page's times of its length, its own time free. */
      moveSlots: (workspace: string, bookingId: string, from: string, to: string): Promise<PublicSlots> =>
        call((options) => api.bookings.moveSlots({ workspace, bookingId, from, to }, options)),
      /** The guest page's path for a booking (`/b/<key>/manage?t=…`), read only when asked: it is the guest's key. */
      guestLink: (workspace: string, bookingId: string): Promise<{ path: string }> =>
        call((options) => api.bookings.guestLink({ workspace, bookingId }, options)),
      /** Time the member closes on their own calendar (spec 0027): blocks, and holds for private pages. */
      blocks: {
        /**
         * Closes a span: `preview` (its turns in the ranges shown) shows at
         * once, every range is read again once the server has it, and a
         * refusal (`CONFIG_INVALID` on its field, `NOT_FOUND` on `pageId`)
         * takes the preview back off.
         */
        create: async (
          workspace: string,
          draft: Omit<CreateTimeBlockInput, 'workspace' | 'mutationId' | 'id'>,
          preview: readonly Omit<TimeBlockOccurrence, 'key' | 'blockId'>[],
        ): Promise<TimeBlockView> => {
          // One id for the preview and the block, so the preview can be opened (and removed) as the real thing.
          const id = mintId();
          const restore = bookingsLists.patchRanges(workspace, (shown) => ({
            ...shown,
            blocks: [
              ...shown.blocks,
              ...preview.map((turn) => ({ ...turn, blockId: id, key: `${id}:${turn.startsAt}` })),
            ],
          }));
          try {
            const made = await call((options) =>
              api.bookings.blocks.create({ ...draft, id, workspace, mutationId: mintId() }, options),
            );
            reloadBookings(workspace);
            return made;
          } catch (error) {
            restore();
            throw error;
          }
        },
        /** Reopens a block's time (a weekly one every week): gone at once, back on a refusal. */
        remove: async (workspace: string, blockId: string): Promise<void> => {
          const restore = bookingsLists.patchRanges(workspace, (shown) => ({
            ...shown,
            blocks: shown.blocks.filter((turn) => turn.blockId !== blockId),
          }));
          try {
            await call((options) =>
              api.bookings.blocks.remove({ workspace, id: blockId, mutationId: mintId() }, options),
            );
            reloadBookings(workspace);
          } catch (error) {
            restore();
            throw error;
          }
        },
      },
    },
    objects: {
      /**
       * The workspace's live objects in its order (the sidebar's), cached for
       * the app load. A non member gets the same `NOT_FOUND` as an unknown
       * address, which also drops the cached `me`: the person may have just
       * left it, so `/` asks again.
       */
      list: listObjects,
      /** Every object, archived ones too, in the workspace's order (settings, an archived object's page). */
      all: allObjects,
      /** A new object's id: mint it once per dialog, and send the same one again on a retry. */
      newId: () => mintId(),
      /**
       * Creates a custom object and waits for the server (spec 0012, AC-223).
       * Refusals: `SLUG_TAKEN` (field `apiSlug`), `NAME_TAKEN` (on the name it
       * names), `CONFIG_INVALID` (on its field), `LIMIT_REACHED`, `FORBIDDEN`.
       */
      create: (workspace: string, input: NewObject): Promise<ObjectSummary> =>
        writeObject(workspace, (mutationId, options) =>
          api.objects.create(
            {
              workspace,
              id: input.id,
              singularName: input.singularName,
              pluralName: input.pluralName,
              ...(input.apiSlug === undefined ? {} : { apiSlug: input.apiSlug }),
              icon: input.icon,
              hue: input.hue,
              ...(input.attributes === undefined
                ? {}
                : {
                    attributes: input.attributes.map((a) => ({
                      title: a.title,
                      type: a.type,
                      ...(a.options === undefined ? {} : { options: a.options.map((option) => ({ ...option })) }),
                    })),
                  }),
              mutationId,
            },
            options,
          ),
        ),
      /**
       * Renames or restyles an object (AC-224), or names its records by another attribute (late trap #15), waiting
       * for the server; a new name attribute reads the records this tab holds again. Refusals: `NAME_TAKEN`,
       * `CONFIG_INVALID` (on its field, `primaryAttributeId` included).
       */
      update: (workspace: string, objectId: string, changes: ObjectChanges): Promise<ObjectSummary> =>
        writeObject(
          workspace,
          (mutationId, options) => api.objects.update({ workspace, objectId, ...changes, mutationId }, options),
          changes.primaryAttributeId === undefined ? {} : { renames: objectId },
        ),
      /** Moves an object to `position` in the workspace's order (AC-225), archived objects counted. */
      reorder: (workspace: string, objectId: string, position: number): Promise<ObjectSummary[]> =>
        writeObject(
          workspace,
          (mutationId, options) => api.objects.reorder({ workspace, objectId, position, mutationId }, options),
          { objectsOf: (order) => order },
        ),
      /** Archives an object (AC-226): it leaves the sidebar; its records stay. */
      archive: (workspace: string, objectId: string): Promise<ObjectSummary> =>
        writeObject(
          workspace,
          (mutationId, options) => api.objects.archive({ workspace, objectId, mutationId }, options),
          { archives: true },
        ),
      /** Restores an archived object (AC-226), at its old place. */
      restore: (workspace: string, objectId: string): Promise<ObjectSummary> =>
        writeObject(
          workspace,
          (mutationId, options) => api.objects.restore({ workspace, objectId, mutationId }, options),
          { archives: true },
        ),
    },
    usage: {
      /**
       * The workspace's usage of its limits (spec 0012, AC-243): the custom
       * object meter for owners and admins, each object's attribute count.
       * Cached until a definition changes.
       */
      get: readUsage,
    },
    members: {
      /**
       * The workspace's active members, by name, with their roles and when
       * they joined (spec 0031): the Owner column's names and the Members
       * page. Cached for the app load; a live `members` event reads it again.
       */
      list: (workspace: string): Promise<MemberView[]> =>
        cached(members, workspace, () => beforeRead(workspace).then(() => allMembers(workspace))),
      /**
       * One page of the workspace's active members for the Members page
       * (spec 0031, AC-810): by name, after `cursor`, only those whose name
       * or email holds `search`. Read fresh each time: the page reloads on a
       * live `members` event.
       */
      page: (workspace: string, query: { readonly search?: string; readonly cursor?: string } = {}) =>
        beforeRead(workspace).then(() =>
          call((options) =>
            api.members.list(
              {
                workspace,
                ...(query.search === undefined || query.search.trim() === '' ? {} : { search: query.search.trim() }),
                ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
              },
              options,
            ),
          ),
        ),
      /**
       * Hears the workspace's changes while the Members page is open, so
       * another admin's change reads the list again; the answer stops.
       */
      watch: (workspace: string): (() => void) => watch(workspace),
      /**
       * Changes a member's role (spec 0031, AC-811), waiting for the server:
       * the owner rules live there. Refusals: `FORBIDDEN`, `LAST_OWNER`,
       * `NOT_FOUND`. The list, and the person's own access, are read again after. Answers how many open invitations
       * they sent the change cancelled, when any (their new role can't send them).
       */
      async setRole(workspace: string, memberId: string, role: Role): Promise<SetRoleResult> {
        const changed = await call((options) =>
          api.members.setRole({ workspace, memberId, role, mutationId: mintId() }, options),
        );
        members.delete(workspace);
        access.delete(workspace);
        return changed;
      },
      /**
       * What removing a member will do (spec 0031, AC-816), for the remove
       * dialog: pages that pause, calendars disconnected, open tasks and
       * records naming them. Read fresh each time. Refusals: `FORBIDDEN`,
       * `NOT_FOUND`.
       */
      removalPreview: (workspace: string, memberId: string): Promise<RemovalPreview> =>
        beforeRead(workspace).then(() =>
          call((options) => api.members.removalPreview({ workspace, memberId }, options)),
        ),
      /**
       * Removes a member (spec 0031, AC-811, AC-816), handing their records
       * and open tasks to `reassignTo` as a background job when one is given
       * (its id answers). Refusals: `FORBIDDEN`, `LAST_OWNER`, `NOT_FOUND`.
       */
      async remove(workspace: string, memberId: string, reassignTo?: string): Promise<{ readonly jobId?: string }> {
        const removed = await call((options) =>
          api.members.remove(
            { workspace, memberId, ...(reassignTo === undefined ? {} : { reassignTo }), mutationId: mintId() },
            options,
          ),
        );
        members.delete(workspace);
        return removed;
      },
      /**
       * The person leaves the workspace (spec 0031, AC-812). Refuses
       * `LAST_OWNER` for its only owner. Their workspaces are read again after.
       */
      async leave(workspace: string): Promise<void> {
        await call((options) => api.members.leave({ workspace, mutationId: mintId() }, options));
        members.delete(workspace);
        access.delete(workspace);
        me = undefined;
      },
      /**
       * Hands the workspace to another member (spec 0031, AC-813): they become
       * an owner, the person an admin. The list and the person's own access
       * are read again after.
       */
      async transferOwnership(workspace: string, memberId: string): Promise<void> {
        await call((options) => api.members.transferOwnership({ workspace, memberId, mutationId: mintId() }, options));
        members.delete(workspace);
        access.delete(workspace);
      },
    },
    /**
     * A workspace's sign in rules (spec 0033, milestone 4): settings, not CRM
     * data, so no cache and no live event; the screen reads them when it
     * opens and takes each answer as the new state. Owners only (`FORBIDDEN`
     * otherwise). Refusals throw a DataError: `OWNER_NEEDS_TWO_FACTOR` when
     * requiring two factor without it, `STEP_UP_REQUIRED` for signing
     * everyone out on a session not verified lately.
     */
    workspaceSecurity: {
      get: (workspace: string): Promise<WorkspaceSecurity> =>
        call((options) => api.workspaceSecurity.get({ workspace }, options)).catch((error: unknown) => {
          // The reader lost `security.manage`: their held access is stale, so the nav and Security's next visit match
          // the server.
          if (toDataError(error).code === 'FORBIDDEN') access.delete(workspace);
          throw error;
        }),
      set: (
        workspace: string,
        change: { readonly requireTwoFactor?: boolean; readonly sessionLengthDays?: SessionLengthDays | null },
      ): Promise<WorkspaceSecurity> => call((options) => api.workspaceSecurity.set({ workspace, ...change }, options)),
      signOutEveryone: (workspace: string): Promise<WorkspaceSecurity> =>
        call((options) => api.workspaceSecurity.signOutEveryone({ workspace }, options)),
    },
    /**
     * Invitations (spec 0031): settings, not CRM data, so no live event. The
     * Members page reads the open list and every write waits for the server
     * (an invite's answer names what was sent and refused), then the page
     * reads the list again.
     */
    invitations: {
      /** The open email invitations, newest first: holders of `members.invite` only (`FORBIDDEN` otherwise). */
      list: (workspace: string): Promise<InvitationView[]> =>
        call((options) => api.invitations.list({ workspace }, options)),
      /** Invites 1 to 20 addresses with one role. Refusals: `FORBIDDEN`, `INVITES_LIMIT`, `SEAT_LIMIT`, `RATE_LIMITED`. */
      create: (workspace: string, emails: readonly string[], role: Role): Promise<InviteResult> =>
        call((options) =>
          api.invitations.create({ workspace, emails: [...emails], role, mutationId: mintId() }, options),
        ),
      /** Sends an open invitation again: a new link, the old one dead. `sent` is false when its email failed. */
      resend: (workspace: string, invitationId: string) =>
        call((options) => api.invitations.resend({ workspace, invitationId, mutationId: mintId() }, options)),
      /** Revokes an open invitation: its link stops working at once. */
      revoke: (workspace: string, invitationId: string): Promise<void> =>
        call((options) => api.invitations.revoke({ workspace, invitationId, mutationId: mintId() }, options)),
      /** The workspace's invite link (spec 0031, AC-818): holders of `members.invite` only. Read fresh each time. */
      link: (workspace: string): Promise<InviteLinkView> =>
        call((options) => api.invitations.link({ workspace }, options)),
      /**
       * Turns the invite link on or off, changes it, or resets it (a new
       * token, the old link dead), waiting for the server. A field left out
       * keeps its value; `null` takes a limit away. Answers the link as it now
       * is. Refusals: `FORBIDDEN`, `INVITES_LIMIT`.
       */
      setLink: (
        workspace: string,
        change: {
          readonly enabled: boolean;
          readonly expiresInDays?: InviteLinkDays | null;
          readonly maxUses?: number | null;
          readonly reset?: boolean;
        },
      ): Promise<InviteLinkView> =>
        call((options) => api.invitations.setLink({ workspace, ...change, mutationId: mintId() }, options)),
      /** What an invitation link shows before accepting, with no session needed; `INVITE_INVALID` for any bad link. */
      peek: (token: string): Promise<InvitePeek> => attempt((options) => api.invitations.peek({ token }, options)),
      /**
       * Accepts an invitation as the signed in person, with the name they typed on the invite card (may be empty):
       * answers the workspace's address. The person's workspaces are read again after.
       */
      async accept(token: string, memberName?: string): Promise<{ slug: string }> {
        const accepted = await call((options) =>
          api.invitations.accept({ token, ...(memberName === undefined ? {} : { memberName }) }, options),
        );
        me = undefined;
        return accepted;
      },
    },
    /**
     * Domain join from the person's side (spec 0031, AC-819): the workspaces
     * whose email domain is theirs, and asking to join one. Read fresh.
     */
    join: {
      /** The workspaces the signed in person may ask to join, with whether they already asked. */
      list: (): Promise<Joinable[]> => call((options) => api.join.list(undefined, options)),
      /** Asks to join one: answers it as pending. Refusals: `NOT_FOUND`, `RATE_LIMITED`. */
      request: (workspaceId: string): Promise<Joinable> =>
        call((options) => api.join.request({ workspaceId }, options)),
    },
    /**
     * Domain join inside a workspace (spec 0031, AC-819, AC-820): its email
     * domains (`workspace.manage`) and its open requests (`members.invite`).
     * Settings, not CRM data: read fresh, and every write waits for the server.
     */
    joinRequests: {
      domains: (workspace: string): Promise<WorkspaceDomainsView> =>
        call((options) => api.joinRequests.domains({ workspace }, options)),
      /** Sets the domains. Refusals: `FORBIDDEN`, `DOMAIN_NOT_YOURS`, `DOMAIN_PUBLIC`. */
      setDomains: (workspace: string, domains: readonly string[]): Promise<WorkspaceDomainsView> =>
        call((options) =>
          api.joinRequests.setDomains({ workspace, domains: [...domains], mutationId: mintId() }, options),
        ),
      list: (workspace: string): Promise<JoinRequestView[]> =>
        call((options) => api.joinRequests.list({ workspace }, options)),
      /**
       * Approves (they join as a member) or declines a request. The member
       * list is read again after an approval. Refusals: `FORBIDDEN`,
       * `NOT_FOUND`, `SEAT_LIMIT`.
       */
      async decide(workspace: string, requestId: string, approve: boolean): Promise<void> {
        await call((options) =>
          api.joinRequests.decide({ workspace, requestId, approve, mutationId: mintId() }, options),
        );
        if (approve) members.delete(workspace);
      },
    },
    /**
     * Settings › Workspace › General (spec 0031, slice 7): the workspace's
     * name, time zone and address, and the owner's delete. Settings, not CRM
     * data: read fresh, and every write waits for the server. A rename or a
     * delete reads the person's workspaces again.
     */
    workspace: {
      get: (workspace: string): Promise<WorkspaceSettings> =>
        call((options) => api.workspace.get({ workspace }, options)),
      /**
       * Renames it, changes its time zone, or moves it to a new address (the
       * answer's `slug`). Refusals: `FORBIDDEN`, `INPUT_INVALID`, `SLUG_TAKEN`
       * (field `slug`). A new address drops what was cached under the old one
       * and reads the person's workspaces again, so the switcher and every
       * page take the new one; the old address still finds the workspace.
       */
      async update(
        workspace: string,
        change: { readonly name?: string; readonly timeZone?: string; readonly slug?: string },
      ): Promise<WorkspaceSettings> {
        const updated = await call((options) =>
          api.workspace.update({ workspace, ...change, mutationId: mintId() }, options),
        );
        if (updated.slug !== workspace) {
          objects.delete(workspace);
          access.delete(workspace);
          members.delete(workspace);
        }
        if (change.name !== undefined || updated.slug !== workspace) me = undefined;
        return updated;
      },
      /** Deletes it, softly, for 30 days. Refusals: `FORBIDDEN`, `CONFIRM_MISMATCH`. */
      async delete(workspace: string, confirmName: string): Promise<DeletedWorkspace> {
        const deleted = await call((options) =>
          api.workspace.delete({ workspace, confirmName, mutationId: mintId() }, options),
        );
        // Nothing of it stays cached: its address now answers the restore page, or not found.
        objects.delete(workspace);
        access.delete(workspace);
        members.delete(workspace);
        me = undefined;
        return deleted;
      },
      /** A deleted workspace as its owner sees it within the window; `NOT_FOUND` for anyone else. */
      deleted: (workspace: string): Promise<DeletedWorkspace> =>
        call((options) => api.deletedWorkspace.deleted({ workspace }, options)),
      /** Restores a deleted workspace within its window (an owner). Refusals: `NOT_FOUND`. */
      async restore(workspace: string): Promise<WorkspaceSettings> {
        const restored = await call((options) =>
          api.deletedWorkspace.restore({ workspace, mutationId: mintId() }, options),
        );
        me = undefined;
        return restored;
      },
    },
    /**
     * Settings › Account › Link page (spec 0051): the person's own blocks at `/<handle>`, the same in every
     * workspace. `load()` answers its store (loaded on first use): every change shows at once and is sent after the
     * ones before it; refused, it is put back and a toast says why, with Try again.
     */
    linkPage: {
      load: (): Promise<LinkPageStore> =>
        (linkPage ??= import('./link-page/store.ts').then(({ openLinkPage }) =>
          openLinkPage({
            profile: api.profile,
            call,
            mintId,
            notify,
            summary: refusalSummary,
            signup: {
              /** The workspaces an Email signup form may be made in: the person's own, oldest first (AC-5217). */
              workspaces: () => readMe().then((who) => who?.workspaces ?? []),
              // Loaded with the editor that uses it, so its three writes never ride in the first load.
              make: async (workspace, input) =>
                (await import('./link-page/signup-form.ts')).makeSignupForm(
                  { forms: signupWrites, lists: formLists, landForm, mintId, readMe },
                  workspace,
                  input,
                ),
            },
          }),
        )),
    },
    /** Settings › Account › Profile (spec 0031, AC-821): the caller's own name and time zone in a workspace. */
    profile: {
      /**
       * Uploads their own picture (27 Oct 2026): the bytes as the request body, already squared and drawn again by
       * the screen, which leaves a photo's location behind. It replaces any picture they had, Google's included, in
       * every workspace. Answers its path (`/api/me/picture?v=`). Rejects with a DataError: `INPUT_INVALID` (not a
       * JPEG, PNG or WebP), `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `API_UNAVAILABLE` (no store, or offline).
       */
      async uploadPicture(file: Blob): Promise<string | undefined> {
        const response = await fetch(new URL('/api/me/picture', origin).href, {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file,
          credentials: 'include',
        }).catch((error: unknown) => {
          throw toDataError(error);
        });
        const body: unknown = await response.json().catch(() => undefined);
        const answer = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        if (!response.ok) throw toDataError({ ...answer, status: response.status });
        // Who they are now carries the new picture; the members' lists name it too.
        me = undefined;
        members.clear();
        return typeof answer.image === 'string' ? answer.image : undefined;
      },
      /** Reads the profile now (the route's loader); whether their picture shows comes with it, held below. */
      get: (workspace: string): Promise<MyProfile> => pictureChoice.read(workspace),
      /** Whether their picture shows on their booking pages and profile (owner ask A124), as the screen holds it. */
      picture: (workspace: string): PictureChoiceHeld => pictureChoice.of(workspace),
      /**
       * Keeps their picture off their public pages (`true`) or shows it again, the same in every workspace: shown
       * at once, put back with a toast and Try again if refused. Answers whether it landed.
       */
      setPictureHidden: (workspace: string, isHidden: boolean): Promise<boolean> =>
        pictureChoice.change(workspace, isHidden),
      /**
       * Their social links (booking socials, 25 Oct 2026), the same in every workspace: the store, loaded on first use
       * (the screens that edit them load lazily too). Its `of` holds the set as screens show it; `change` replaces the
       * whole set at once, put back with a toast and Try again if refused.
       */
      loadSocials: (): Promise<SocialLinksAccess> => loadSocialLinks(),
      /**
       * Changes their name or time zone (null follows the workspace's), or their handle and bio (the person's, in
       * every workspace). The member list is read again; a new handle changes every page's address, so the
       * booking pages are read again too.
       */
      async update(
        workspace: string,
        change: {
          readonly name?: string;
          readonly timeZone?: string | null;
          readonly handle?: string;
          readonly bio?: string;
          /** Their whole set of social links, in order. */
          readonly socials?: readonly SocialLink[];
        },
      ): Promise<MyProfile> {
        const { socials, ...rest } = change;
        const updated = await call((options) =>
          api.profile.update(
            { workspace, ...rest, ...(socials === undefined ? {} : { socials: [...socials] }), mutationId: mintId() },
            options,
          ),
        );
        // The answer holds the set as saved, for the booking editor's card and anything else holding it.
        socialLinks?.landed(workspace, updated);
        members.delete(workspace);
        if (change.handle !== undefined) bookingPageLists.view(workspace).reload();
        return updated;
      },
    },
    roles: {
      /**
       * The roles every role picker offers (spec 0037, AC-1439): the built in
       * ones now, custom ones once they exist, and the default for new
       * people. Cached for the app load.
       */
      list: (workspace: string): Promise<RolesList> =>
        cached(roles, workspace, () =>
          beforeRead(workspace).then(() => call((options) => api.roles.list({ workspace }, options))),
        ),
    },
    access: {
      /**
       * The person's own role, its label and their permissions in a workspace
       * (spec 0009, AC-136), cached for the app load. Screens use it only to
       * hide controls the person can't use; the server checks every call.
       */
      mine: (workspace: string): Promise<MyAccess> =>
        cached(access, workspace, () =>
          beforeRead(workspace).then(() => call((options) => api.access.mine({ workspace }, options))),
        ),
    },
    attributes: {
      /** An object's live attributes in position order, system ones marked. Cached until a definition changes. */
      list: (workspace: string, objectId: string): Promise<AttributeDefinition[]> =>
        cached(attributes, objectKey(workspace, objectId), () =>
          beforeRead(workspace).then(() => call((options) => api.attributes.list({ workspace, objectId }, options))),
        ),
      /**
       * An object's attributes with the archived ones too (settings, spec 0012,
       * AC-227), in position order. Cached until a definition of that object
       * changes.
       */
      all: (workspace: string, objectId: string): Promise<AttributeDefinition[]> =>
        cached(allAttributes, objectKey(workspace, objectId), () =>
          beforeRead(workspace).then(() =>
            call((options) => api.attributes.list({ workspace, objectId, includeArchived: true }, options)),
          ),
        ),
      /**
       * What changing or archiving an attribute touches (flow pass, 30 October 2026): the views, forms and rules
       * using it, and for a reader who sees every record the empty, per option and shared value counts. Read each
       * time its settings or archive confirm open, never cached: the counts move with every edit.
       */
      impact: (workspace: string, attributeId: string): Promise<AttributeImpact> =>
        beforeRead(workspace).then(() => call((options) => api.attributes.impact({ workspace, attributeId }, options))),
      /** A new attribute's id: mint it once per dialog, and send the same one again on a retry. */
      newId: () => mintId(),
      /**
       * Creates an attribute and waits for the server (spec 0012, AC-229; no
       * optimistic step: it is often refused, and it reshapes every table).
       * Refusals: `SLUG_TAKEN` (on `apiSlug`), `CONFIG_INVALID` (on its field),
       * `LIMIT_REACHED`, `FORBIDDEN`. A retry with the same id after a lost
       * answer gets the attribute the first try made.
       */
      create: (workspace: string, input: NewAttribute): Promise<AttributeDefinition> =>
        writeAttribute(
          workspace,
          (mutationId, options) =>
            api.attributes.create(
              {
                workspace,
                id: input.id,
                objectId: input.objectId,
                title: input.title,
                type: input.type,
                ...(input.apiSlug === undefined ? {} : { apiSlug: input.apiSlug }),
                ...(input.description === undefined ? {} : { description: input.description }),
                ...(input.isMulti === undefined ? {} : { isMulti: input.isMulti }),
                ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
                ...(input.isUnique === undefined ? {} : { isUnique: input.isUnique }),
                ...(input.config === undefined ? {} : { config: { ...input.config } }),
                ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
                ...(input.options === undefined ? {} : { options: input.options.map(optionInput) }),
                ...(input.rules === undefined ? {} : { rules: [...input.rules] }),
                mutationId,
              },
              options,
            ),
          (made) => [made.objectId],
        ),
      /**
       * Changes an attribute's settings (spec 0012, AC-231), waiting for the
       * server. Refusals: `UNIQUE_HAS_DUPLICATES`, `CONFIG_INVALID` (on its
       * field), `ATTRIBUTE_READ_ONLY`, `FORBIDDEN`.
       */
      update: (workspace: string, attributeId: string, changes: AttributeChanges): Promise<AttributeDefinition> =>
        writeAttribute(
          workspace,
          (mutationId, options) =>
            api.attributes.update(
              {
                workspace,
                attributeId,
                ...changes,
                ...(changes.config === undefined ? {} : { config: { ...changes.config } }),
                rules: changes.rules === undefined ? undefined : [...changes.rules],
                mutationId,
              },
              options,
            ),
          // A relationship side's new title is its pair's too (the relationship block): that object changes as well.
          (edited) => [
            edited.objectId,
            ...(changes.title !== undefined && edited.relationship?.pairedAttributeId !== undefined
              ? edited.relationship.targetObjectIds
              : []),
          ],
        ),
      /**
       * Moves an attribute to `position` among its object's own attributes,
       * archived ones counted (spec 0012, AC-232). Answers the object's
       * attributes in their new order, which the settings list keeps.
       */
      reorder: async (workspace: string, attributeId: string, position: number): Promise<AttributeDefinition[]> => {
        return writeAttribute(
          workspace,
          (mutationId, options) => api.attributes.reorder({ workspace, attributeId, position, mutationId }, options),
          (answer) => answer.map((each) => each.objectId),
          (order) => {
            const objectId = order[0]?.objectId;
            if (objectId !== undefined) allAttributes.set(objectKey(workspace, objectId), Promise.resolve(order));
          },
        );
      },
      /**
       * Archives an attribute (spec 0012, AC-233), both ends of a
       * relationship together; answers every definition it changed.
       */
      archive: (workspace: string, attributeId: string): Promise<AttributeDefinition[]> =>
        writeAttribute(
          workspace,
          (mutationId, options) => api.attributes.archive({ workspace, attributeId, mutationId }, options),
          (ends) => ends.map((end) => end.objectId),
        ),
      /**
       * Restores an archived attribute at its old place (spec 0012, AC-233),
       * both ends of a relationship together. Refusals: `NOT_FOUND` ("Restore
       * <Plural> first."), `UNIQUE_HAS_DUPLICATES`.
       */
      restore: (workspace: string, attributeId: string): Promise<AttributeDefinition[]> =>
        writeAttribute(
          workspace,
          (mutationId, options) => api.attributes.restore({ workspace, attributeId, mutationId }, options),
          (ends) => ends.map((end) => end.objectId),
        ),
    },
    relationships: {
      /** A new relationship's id: mint it once when the dialog opens, and send the same one again on a retry. */
      newId: () => mintId(),
      /**
       * Creates a relationship, both sides at once, and waits for the server
       * (spec 0014, AC-282; never optimistic: it is often refused, and it
       * reshapes two tables). Both objects' lists are read again. Refusals:
       * `SLUG_TAKEN` and `CONFIG_INVALID` on the side's name (`from.title`,
       * `to.title`), `LIMIT_REACHED`, `NOT_FOUND`, `ID_TAKEN`, `FORBIDDEN`. A
       * retry with the same id after a lost answer gets the relationship the
       * first try made.
       */
      create: (workspace: string, input: NewRelationship): Promise<RelationshipView> =>
        writeAttribute(
          workspace,
          (mutationId, options) =>
            api.relationships.create(
              {
                workspace,
                id: input.id,
                cardinality: input.cardinality,
                from: { objectId: input.from.objectId, title: input.from.title },
                to: { objectId: input.to.objectId, title: input.to.title },
                mutationId,
              },
              options,
            ),
          (made) => [made.from.objectId, made.to.objectId],
        ),
      /**
       * Renames one or both sides of a relationship in one write (spec 0014,
       * AC-307), waiting for the server. Both objects change (each side
       * carries its pair's name), so both count as echoes. Refusals:
       * `CONFIG_INVALID` on the side's name, `NOT_FOUND`, `FORBIDDEN`.
       */
      update: (workspace: string, relationshipId: string, names: RelationshipNames): Promise<RelationshipView> =>
        writeAttribute(
          workspace,
          (mutationId, options) =>
            api.relationships.update(
              {
                workspace,
                relationshipId,
                ...(names.from === undefined ? {} : { from: { title: names.from } }),
                ...(names.to === undefined ? {} : { to: { title: names.to } }),
                mutationId,
              },
              options,
            ),
          // Both objects change: each side carries its pair's name.
          (renamed) => [renamed.from.objectId, renamed.to.objectId],
        ),
    },
    options: {
      /**
       * Adds an option at the end of a select or status attribute's options
       * (spec 0012, AC-236), waiting for the server; `id` from
       * `attributes.newId`, the hue the next one when left out. Refusals:
       * `CONFIG_INVALID` (a live option holds the label, on `label`),
       * `LIMIT_REACHED`, `FORBIDDEN`. Its object's lists are read again.
       */
      create: (
        workspace: string,
        objectId: string,
        attributeId: string,
        option: Omit<NewOption, 'hue'> & { readonly hue?: NewOption['hue'] },
      ): Promise<AttributeOption> =>
        writeOption(workspace, objectId, (mutationId, options) =>
          api.options.create(
            {
              workspace,
              attributeId,
              id: option.id,
              label: option.label,
              ...(option.hue === undefined ? {} : { hue: option.hue }),
              ...(option.outcome === undefined ? {} : { outcome: option.outcome }),
              ...(option.targetDays === undefined ? {} : { targetTimeInStage: targetOf(option.targetDays) }),
              mutationId,
            },
            options,
          ),
        ),
      /** Renames or recolours an option, or a stage's outcome or target (AC-236). Refusals: `CONFIG_INVALID` on `label`. */
      update: (
        workspace: string,
        objectId: string,
        optionId: string,
        changes: OptionChanges,
      ): Promise<AttributeOption> =>
        writeOption(workspace, objectId, (mutationId, options) =>
          api.options.update({ workspace, optionId, ...optionChanges(changes), mutationId }, options),
        ),
      /** Moves an option to `position` in its attribute's order, archived ones counted (AC-236). */
      reorder: (workspace: string, objectId: string, optionId: string, position: number): Promise<AttributeOption[]> =>
        writeOption(workspace, objectId, (mutationId, options) =>
          api.options.reorder({ workspace, optionId, position, mutationId }, options),
        ),
      /** Archives an option (AC-236): it stays on the values that hold it, and new values can't take it. */
      archive: (workspace: string, objectId: string, optionId: string): Promise<AttributeOption> =>
        writeOption(workspace, objectId, (mutationId, options) =>
          api.options.archive({ workspace, optionId, mutationId }, options),
        ),
      /** Restores an archived option (AC-236). Refusals: `LIMIT_REACHED` at 500 live, `CONFIG_INVALID` on `label`. */
      restore: (workspace: string, objectId: string, optionId: string): Promise<AttributeOption> =>
        writeOption(workspace, objectId, (mutationId, options) =>
          api.options.restore({ workspace, optionId, mutationId }, options),
        ),
      /**
       * Options a cell made that their attribute's list doesn't hold yet
       * (AC-238), by `workspace/attributeId`; merge them into a column with
       * `withPendingOptions`. Read it through `usePendingOptions`.
       */
      pending: {
        getSnapshot: pendingOptions.getSnapshot,
        subscribe: pendingOptions.subscribe,
      },
    },
    records: {
      /**
       * An object's records for one screen (the same view for every screen
       * that asks), settled once its count and first block are in or failed.
       * The router loader awaits it; the screen reads it through `useView`.
       */
      async view(
        workspace: string,
        objectId: string,
        query: ViewQuery = {},
        attributeIds: readonly string[] = [],
      ): Promise<RecordsView> {
        const view = (await recordsLayer()).view(workspace, objectId, query, attributeIds);
        await view.ready();
        return view;
      },
      /**
       * The same view, answered as soon as it exists, settled or not, after
       * waiting at most `graceMs` for it to settle: a quick load arrives with
       * its rows, and a slow one hands the screen a loading view at once, so
       * the table draws its header and loading rows in place rather than a
       * page sized placeholder that jumps when the rows come.
       */
      async open(
        workspace: string,
        objectId: string,
        query: ViewQuery = {},
        attributeIds: readonly string[] = [],
        graceMs = 0,
      ): Promise<RecordsView> {
        const view = (await recordsLayer()).view(workspace, objectId, query, attributeIds);
        if (graceMs > 0) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            view.ready(),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, graceMs);
            }),
          ]);
          clearTimeout(timer);
        }
        return view;
      },
      /**
       * A board on an object (spec 0021): a window per column, each the view's
       * filter and one option of the grouping attribute, first loaded through
       * `records.groups`. The screen reads it through `useBoard`.
       */
      async board(
        workspace: string,
        objectId: string,
        query: BoardQuery,
        attributeIds: readonly string[] = [],
      ): Promise<BoardStore<RecordsView>> {
        return (await recordsLayer()).board(workspace, objectId, query, attributeIds);
      },
      /** A new record's id: mint it once per form, and send the same one on every try, so nothing is made twice. */
      newId: () => mintId(),
      /**
       * How many live records an object holds (spec 0012: the archive
       * confirm says so), with `atLeast` when the server capped it (a record
       * rule, spec 0009). One count, never cached: it is asked for once per
       * confirm.
       */
      count: (workspace: string, objectId: string): Promise<{ readonly count: number; readonly atLeast: boolean }> =>
        beforeRead(workspace).then(() => call((options) => api.records.count({ workspace, objectId }, options))),
      /**
       * How many live records each object holds, by object id, in one read (Settings › Objects' Records column).
       * An object under a record rule is absent (its own `count` answers it). Never cached: asked once per visit.
       */
      objectCounts: (workspace: string): Promise<Readonly<Record<string, number>>> =>
        beforeRead(workspace)
          .then(() => call((options) => api.records.objectCounts({ workspace }, options)))
          .then((answer) => answer.counts),
      /**
       * A view's calculations across every record it matches (the CRM flow
       * pass): a table's footer, every ask in one `records.aggregate`, or a
       * board's column totals (`groupBy` and `groupIds`) in one
       * `records.aggregateGroups`; counts of the filled or the empty, or for a
       * number or currency the sum, average, least or most (one per
       * currency). One store in the records layer, shared by every screen
       * asking the same question in any ask order, read again after the
       * changes that may move it (see the records layer). `useAggregates`
       * reads it; answers sit under `aggregateKey`.
       */
      aggregates: (workspace: string, question: AggregateQuestion): AggregateSource =>
        recordsLoaded?.aggregates(workspace, question) ??
        lazyAggregateSource(recordsLayer().then((layer) => layer.aggregates(workspace, question))),
      /**
       * Makes a record at once (see the records layer) with `id` (from
       * `newId`); rejects with the refusals when the server says no. Sending the
       * same id again after a lost answer gets the record already made.
       */
      create: async (
        workspace: string,
        objectId: string,
        id: string,
        values: Readonly<Record<string, unknown>>,
      ): Promise<RecordView> => (await recordsLayer()).create(workspace, objectId, values, id),
      /**
       * Makes an option from a select, multi select or status cell and sets
       * it, as one optimistic write (spec 0012, AC-238; see `createOption`).
       * For someone who may shape the schema only: anyone else is refused
       * `FORBIDDEN`, on the cell.
       */
      createOption,
      /**
       * One link delta (spec 0014): adds or removes one record on a side of
       * one record. It shows at once on that record (a side of many appends
       * the chip, or raises its "+N"); the far records and a moved link's old
       * holder read again when it lands; a refusal rolls it back, marks the
       * cell and raises a toast with Retry. What landed can be undone.
       */
      changeLink: async (workspace: string, change: LinkChange): Promise<LinkOutcome> =>
        (await recordsLayer()).changeLink(workspace, change),
      /**
       * A reference cell's new value from its editor (a table cell, a record
       * page row), sent as link deltas against what the cell holds: a pick
       * adds one, a removed chip removes one, a side of one replaces. Never a
       * whole list (a side of many changes only by delta, spec 0014).
       */
      editLinks: async (workspace: string, cell: LinkCell): Promise<readonly LinkOutcome[]> =>
        (await recordsLayer()).editLinks(workspace, cell),
      /**
       * The record picker's search over one object (spec 0014): `ask` as the
       * person types (150 ms after the last key, the previous request
       * aborted), answers kept for the picker's life. With the side being
       * edited (`forAttributeId`, `forRecordId`) each result says whether it
       * is linked there already and who holds it ("At Acme"). Results are
       * displays, never record bodies. Read it through `useRecordSearch`, and
       * `dispose` it when the picker closes.
       */
      search: (
        workspace: string,
        input: {
          readonly objectId: string;
          readonly forAttributeId?: string;
          readonly forRecordId?: string;
          readonly limit?: number;
        },
      ): RecordSearch =>
        createRecordSearch({
          run: (query, signal) =>
            beforeRead(workspace).then(() =>
              call((options) => api.records.search({ workspace, ...input, query }, options), signal).then(
                (answer) => answer.results,
              ),
            ),
        }),
      /** Edits one cell at once; a refusal rolls it back with a cell message and a toast with Retry. */
      setValue: (workspace: string, change: CellChange): void => {
        void recordsLayer().then((layer) => layer.setValues(workspace, [change], 'cell'));
      },
      /**
       * Edits cells as one action (spec 0006): a cell, a paste or a range
       * clear, as one write (one batch for up to 500 records; more is refused
       * before anything shows, `too-many`). Each record's cells show at once
       * and land or roll back on their own; what lands can be undone. The
       * answer says how many cells landed, for the "Pasted into 40 cells" toast.
       */
      setValues: async (workspace: string, changes: readonly CellChange[], kind?: UndoKind): Promise<EditOutcome> =>
        (await recordsLayer()).setValues(workspace, changes, kind),
      /**
       * Moves up to 500 records of one object to the trash as one action
       * (spec 0022): their rows leave every view at once and the counts drop;
       * one `records.deleteMany` follows. A refused record comes back with
       * its reason on its name cell; the whole action can be undone (Cmd+Z,
       * or `undo.run` with the answer's `undoId`), restoring exactly its batch.
       */
      deleteMany: async (workspace: string, objectId: string, recordIds: readonly string[]): Promise<DeleteResult> => {
        const result = await (await recordsLayer()).deleteMany(workspace, objectId, recordIds);
        if (result.kind === 'done' && result.deleted > 0) trashMoved(workspace, recordIds);
        return result;
      },
      /**
       * Edits one attribute of up to 500 records of one object as one action
       * (spec 0022, AC-530): the rows this tab holds show the new value at
       * once; one `records.updateMany` computes each record's value under its
       * lock. A refused record rolls back with its cell marked; what changed
       * can be undone (Cmd+Z, or `undo.run` with the answer's `undoId`).
       */
      bulkEdit: async (
        workspace: string,
        objectId: string,
        recordIds: readonly string[],
        request: BulkEditRequest,
      ): Promise<BulkEditResult> => (await recordsLayer()).bulkEdit(workspace, objectId, recordIds, request),
      /**
       * Starts a bulk change as a background job (spec 0022, AC-528, AC-531):
       * past 500 records, or every record a view matches. Mint `id` once
       * (`jobs.newId`) and send the same one on a retry. The job counts what it
       * will touch, then waits in `ready` for `jobs.confirm`; this browser
       * follows it (`jobs.get`, `jobs.follow`) and hears its end
       * (`onJobFinished`). Rejects with a `DataError` (limits, access, 20
       * unfinished jobs), raising no toast: the bar says why.
       */
      startBulk: async (
        workspace: string,
        input: {
          readonly id: string;
          readonly action: BulkAction;
          readonly target: BulkTarget;
          readonly edit?: BulkEdit;
        },
      ): Promise<JobView> => {
        const mutationId = mintId();
        mutations.sent(mutationId);
        try {
          // A start whose answer was lost goes again with the same ids: the server answers the job it made.
          const job = await delivered(
            () =>
              call((options) =>
                api.records.startBulk(
                  {
                    workspace,
                    mutationId,
                    id: input.id,
                    action: input.action,
                    target: input.target,
                    ...(input.edit === undefined ? {} : { edit: input.edit }),
                    timeZone: zoneOf(workspace),
                  },
                  options,
                ),
              ),
            resendAfter,
          );
          mutations.answered(mutationId, 1);
          jobs.track(workspace, job);
          return job;
        } catch (error) {
          mutations.forget(mutationId);
          throw toDataError(error);
        }
      },
      /**
       * Undoes a delete job from its finish toast (spec 0022, AC-528): its
       * batch is the job's id. Up to 500 come back at once; more start a
       * restore job this browser follows. Answers as `undo.run` does.
       */
      restoreDeleted: async (
        workspace: string,
        objectId: string,
        jobId: string,
        count: number,
      ): Promise<UndoResult> => {
        const outcome = await (await recordsLayer()).restoreDeleted(workspace, objectId, jobId, count);
        // Restored inline: the open trash settles now (a restore job's own events settle it as it runs).
        if (outcome.kind === 'restored') trashMoved(workspace);
        if (outcome.kind === 'restoring') jobs.track(workspace, outcome.job);
        const object = (await allObjects(workspace).catch(() => [])).find((each) => each.id === objectId);
        const names = { singularName: object?.singularName ?? 'record', pluralName: object?.pluralName ?? 'records' };
        if (outcome.kind === 'restored' || outcome.kind === 'restoring') return { ...outcome, ...names };
        return { kind: 'nothing' };
      },
      /**
       * One record with the attributes a screen shows (spec 0006, `records.one`;
       * the record page, spec 0017): served from the store every table reads
       * (one body), held while subscribed, reading only what it lacks, patched
       * live, and `deleted` when it goes away (`isLost` once it was shown).
       * Answered once the records layer is loaded; `ready()` settles with the
       * first read. Read it through `useRecord`.
       */
      one: async (workspace: string, recordId: string, attributeIds: RecordAttributes): Promise<RecordSubscription> =>
        (await recordsLayer()).one(workspace, recordId, attributeIds),
      /**
       * A record `one` found missing (spec 0017): in the trash and visible to
       * the reader, or unavailable (missing or hidden, one answer), asked on
       * its first subscriber and kept for the session. The trashed body is
       * never put in the store, so no table shows it. Read it through
       * `useTrashed`.
       */
      trashed: (workspace: string, recordId: string): TrashedSource => trashedLookups.lookup(workspace, recordId),
      /**
       * A record's facts for the stat strip under its header (13 Oct
       * reference batch 4): its next meeting, and with `stageAttributeId`
       * (a status) when it entered its current stage. Read each time a
       * screen holds it, and afresh for a new `stageKey` (the stage shown
       * now, so a moved deal's age restarts); `useRecordFacts` reads it.
       */
      facts: (workspace: string, recordId: string, stageAttributeId?: string, stageKey?: string): RecordFacts =>
        recordFacts.forRecord(workspace, recordId, stageAttributeId, stageKey),
    },
    activity: {
      /**
       * A record's timeline, newest first (spec 0017): pages of `records.activity`
       * mapped to the feed's entries, who did it named from the members and
       * each attribute from `objectId`'s definitions; the next page as the
       * feed scrolls, and kept live (a change naming the record, this tab's own
       * writes). One per record, shared with `recent`. Read it through `useActivity`.
       */
      forRecord: async (
        workspace: string,
        recordId: string,
        objectId?: string,
        kinds?: readonly ActivityKind[],
      ): Promise<ActivityFeed> => (await activityFeeds()).forRecord(workspace, recordId, objectId, kinds),
      /** The same timeline cut to its newest five entries (Overview's "Recent activity"), sharing the first page. */
      recent: async (workspace: string, recordId: string, objectId?: string): Promise<ActivityFeed> =>
        (await activityFeeds()).recent(workspace, recordId, objectId),
    },
    links: {
      /**
       * One record's side that holds many, as a record page's related
       * section and Overview card show it (spec 0014's section source, spec
       * 0017 milestone 3): pages of `links.page` in the side's order, 20 at
       * first and 20 more with each `showMore`, the exact total, displays
       * only (never record bodies). Shared by every screen asking for the
       * same record and side; live while shown (a change naming the record
       * and side, a far record it holds, the far object's trash, this tab's
       * own writes). Read it through `useLinkSection`.
       */
      section: async (workspace: string, side: SectionKey): Promise<LinkSection> =>
        (await linkSections()).section(workspace, side),
      /**
       * Adds or removes one related record from a section (spec 0017, AC-375):
       * shown at once in the section and on the record, sent as one link
       * delta, rolled back with a toast and Retry on a refusal. A landed
       * change answers its undo entry (`undoId`) for the toast's Undo.
       */
      change: (workspace: string, change: LinkChange): Promise<LinkOutcome> => sectionLink(workspace, change),
    },
    tasks: {
      /**
       * The sidebar's Tasks badge (spec 0034, AC-924): how many of my open
       * tasks are due on or before `today` (my local date, `YYYY-MM-DD`),
       * live while a screen holds it. Read it through `useDueTasks`.
       */
      due: (workspace: string, today: string): DueTasksSource => dueTasks.source(workspace, today),
      /**
       * A record's open tasks (by due date) or done ones (newest done first),
       * the same list for every screen that asks (spec 0019): 50 at a time as
       * it scrolls, with the open count, live, and settling 1.5 seconds after
       * the last change in it. Read it through `useTaskList`. Give the
       * record's `objectId`, so a background job on another object's records
       * leaves it alone (spec 0022).
       */
      forRecord: async (
        workspace: string,
        recordId: string,
        status: 'open' | 'done',
        objectId?: string,
      ): Promise<TaskList> => (await tasksStore()).forRecord(workspace, recordId, status, objectId),
      /**
       * My tasks (spec 0019, AC-436): the open or done tasks assigned to me
       * (`assigned`), created by me (`created`) or every task I may see
       * (`all`), 50 at a time as it scrolls, live, settling 1.5 seconds after
       * the last change to any task. Read it through `useTaskList`.
       */
      mine: async (workspace: string, filter: TaskMine, status: 'open' | 'done'): Promise<TaskList> =>
        (await tasksStore()).mine(workspace, filter, status),
      /** One task (the task dialog), from the store's one copy. Read it through `useTask`. */
      one: async (workspace: string, taskId: string): Promise<TaskSubscription> =>
        (await tasksStore()).one(workspace, taskId),
      /** A new task id: mint it once when the dialog or quick add opens, and send the same one on a retry. */
      newId: (): string => mintId(),
      /**
       * Creates a task at once on screen (first, marked new, in the open lists
       * of its records); a refusal takes it away with a toast and Retry.
       * Answers whether it landed.
       */
      create: async (workspace: string, task: NewTask): Promise<boolean> =>
        (await tasksStore()).create(workspace, task),
      /** Changes a task at once on screen; a refusal puts it back and is answered, for the field to show. */
      update: async (workspace: string, taskId: string, change: TaskChange): Promise<DataError | undefined> =>
        (await tasksStore()).update(workspace, taskId, change),
      /** Ticks or unticks a task at once; a refusal rolls the checkbox back with a toast and Retry. */
      setDone: async (workspace: string, taskId: string, isDone: boolean): Promise<boolean> =>
        (await tasksStore()).setDone(workspace, taskId, isDone),
      /**
       * Deletes a task (AC-445): gone from every list and its dialog at once;
       * a refusal puts it back, answered for the screen's toast.
       */
      remove: async (workspace: string, taskId: string): Promise<DataError | undefined> =>
        (await tasksStore()).remove(workspace, taskId),
      /** Brings a deleted task back exactly as it was (the toast's Undo). */
      restore: async (workspace: string, taskId: string): Promise<DataError | undefined> =>
        (await tasksStore()).restore(workspace, taskId),
    },
    notes: {
      /**
       * A record's notes, last edited first (spec 0019, AC-442): 20 at a time
       * as it scrolls, with the count, live. Read it through `useNoteList`.
       * Give the record's `objectId`, so a background job on another object's
       * records leaves it and its windows alone (spec 0022).
       */
      forRecord: async (workspace: string, recordId: string, objectId?: string): Promise<NoteList> =>
        (await notesStore()).forRecord(workspace, recordId, objectId),
      /** The workspace's Notes page: every note the person may see, last edited first, with its record. Live. */
      forWorkspace: async (workspace: string): Promise<NoteList> => (await notesStore()).forWorkspace(workspace),
      /**
       * The note window's session (AC-439 to AC-443): an existing note, or a
       * new one with the id the window minted, which stores nothing until it
       * holds text, then saves itself as it is typed. Read it through
       * `useNoteSession`.
       */
      open: async (
        workspace: string,
        input: {
          readonly noteId: string;
          readonly recordId: string;
          readonly objectId: string;
          readonly isNew: boolean;
          readonly canChange: boolean;
        },
      ): Promise<NoteSession> => (await notesStore()).open(workspace, input),
      /** A new note's id: mint it once when the window opens on a new note. */
      newId: (): string => mintId(),
      /** The app's way to open a note window again, for a failed save's toast ("Open note"). */
      setOpener: async (
        open: (workspace: string, objectId: string, recordId: string, noteId: string) => void,
      ): Promise<void> => {
        (await notesStore()).setOpener(open);
      },
      /** Deletes a note at once on screen; a refusal puts it back, answered for the screen's toast. */
      remove: async (workspace: string, recordId: string, noteId: string): Promise<DataError | undefined> =>
        (await notesStore()).remove(workspace, recordId, noteId),
      /** Brings a deleted note back exactly as it was (the toast's Undo). */
      restore: async (workspace: string, recordId: string, noteId: string): Promise<DataError | undefined> =>
        (await notesStore()).restore(workspace, recordId, noteId),
    },
    comments: {
      /**
       * A record's threads (spec 0038, AC-1151): the open ones oldest first,
       * the newest 20 at first and 20 more on asking, the resolved ones once
       * the disclosure opens, with the counts for the tab's label; live, and
       * the same for every screen that asks. Read it through `useComments`.
       */
      forRecord: async (workspace: string, recordId: string): Promise<RecordComments> =>
        (await commentsStore()).forRecord(workspace, recordId),
      /** Sends a comment or a reply, shown at once as sending; a refusal comes back for the composer. */
      create: async (workspace: string, recordId: string, comment: NewComment): Promise<DataError | undefined> =>
        (await commentsStore()).create(workspace, recordId, comment),
      /** Edits the member's own comment at once; a refusal puts it back with a toast. */
      edit: async (
        workspace: string,
        recordId: string,
        commentId: string,
        body: string,
      ): Promise<DataError | undefined> => (await commentsStore()).edit(workspace, recordId, commentId, body),
      /** Deletes a comment at once (a placeholder while its thread has other live comments). */
      remove: async (workspace: string, recordId: string, commentId: string): Promise<DataError | undefined> =>
        (await commentsStore()).remove(workspace, recordId, commentId),
      /** Resolves or reopens a thread at once. */
      resolve: async (
        workspace: string,
        recordId: string,
        threadId: string,
        resolved: boolean,
      ): Promise<DataError | undefined> => (await commentsStore()).resolve(workspace, recordId, threadId, resolved),
      /** Adds or takes back the member's reaction at once. */
      react: async (
        workspace: string,
        recordId: string,
        commentId: string,
        emoji: CommentEmoji,
        on: boolean,
        memberId: string,
      ): Promise<DataError | undefined> =>
        (await commentsStore()).react(workspace, recordId, commentId, emoji, on, memberId),
      /** A comment's earlier texts, newest first (the "edited" popover). */
      versions: async (workspace: string, commentId: string): Promise<readonly CommentVersion[]> =>
        (await commentsStore()).versions(workspace, commentId),
    },
    inbox: {
      /**
       * The member's unread count in the workspace (spec 0038, AC-1174), in the
       * first load: what the sidebar's Inbox badge shows through
       * `useInboxUnread`. Live while held, on every page.
       */
      unread: (workspace: string): UnreadSource => unreadCounts.unread(workspace),
      /** One tab and filter of the member's inbox (AC-1169, AC-1170), 50 at a time, live. Read it through `useInboxList`. */
      list: async (workspace: string, filter: InboxFilter): Promise<InboxList> =>
        (await inboxStore()).list(workspace, filter),
      /** Marks notifications read or unread, done or back in the inbox, at once (AC-1171). */
      mark: async (workspace: string, ids: readonly string[], mark: InboxMark): Promise<DataError | undefined> =>
        (await inboxStore()).mark(workspace, ids, mark),
      /** Marks every unread notification of a tab (and kind) read; with `done`, every one of the inbox done (Mark all done). */
      markAllRead: async (
        workspace: string,
        status: NotificationStatus,
        kind?: NotificationKind,
        done?: boolean,
      ): Promise<DataError | undefined> => (await inboxStore()).markAllRead(workspace, status, kind, done),
      /** The member's email settings for the workspace (AC-1179). Read it through `useNotificationSettings`. */
      settings: async (workspace: string): Promise<InboxSettings> => (await inboxStore()).settings(workspace),
      /** Saves some switches at once; a refusal puts them back with a toast. */
      setSettings: async (workspace: string, change: NotificationSettingsChange): Promise<DataError | undefined> =>
        (await inboxStore()).setSettings(workspace, change),
    },
    undo: {
      /**
       * Undoes this tab's last confirmed change in the workspace (spec 0006,
       * AC-48, AC-49): one cell, or every cell of one paste or range clear, up
       * to 50 back. Each cell goes back only if nobody changed it since
       * (checked on the server); the answer says how many went back and how
       * many were kept, for the screen's toast.
       */
      run: async (workspace: string, only?: string): Promise<UndoResult> => {
        const outcome = await (await recordsLayer()).undo.run(workspace, only);
        if (outcome.kind === 'restored' || outcome.kind === 'uncreated') trashMoved(workspace);
        if (outcome.kind === 'restoring') {
          jobs.track(workspace, outcome.job);
          const object = (await allObjects(workspace).catch(() => [])).find((each) => each.id === outcome.objectId);
          return {
            ...outcome,
            singularName: object?.singularName ?? 'record',
            pluralName: object?.pluralName ?? 'records',
          };
        }
        if (outcome.kind === 'restored') {
          const object = (await allObjects(workspace).catch(() => [])).find((each) => each.id === outcome.objectId);
          return {
            ...outcome,
            singularName: object?.singularName ?? 'record',
            pluralName: object?.pluralName ?? 'records',
          };
        }
        if (outcome.kind !== 'undone') return outcome;
        return {
          ...outcome,
          attributeTitle: await attributeTitle(workspace, outcome.objectId, outcome.first.attributeId),
        };
      },
    },
    trash: {
      /**
       * The trash of one object or of every object the member may see (spec
       * 0022), the same view for every screen that asks: newest first, in
       * windows by cursor, with its count, live. Read it through `useTrash`.
       */
      view: async (workspace: string, objectId?: string): Promise<TrashView> =>
        (await trashStore()).view(workspace, objectId),
      /**
       * Restores up to 500 records from the trash (spec 0022, AC-534): their
       * rows leave at once; a refused record comes back with its reason on
       * its name cell. The tables of the objects restored into read again.
       */
      restore: async (workspace: string, recordIds: readonly string[]): Promise<RestoreSummary> => {
        const summary = await (await trashStore()).restore(workspace, recordIds);
        if (summary.kind === 'done' && summary.restored > 0) {
          void records?.then((layer) => {
            for (const objectId of summary.objectIds) layer.reload(workspace, objectId);
          });
        }
        return summary;
      },
      /**
       * Deletes up to 500 trashed records forever (spec 0022, AC-535; owners
       * and admins): their rows leave at once and never come back. Empty
       * trash and bigger selections run as a job (`records.startBulk` with
       * `purge`).
       */
      deleteForever: async (workspace: string, recordIds: readonly string[]): Promise<PurgeSummary> =>
        (await trashStore()).deleteForever(workspace, recordIds),
    },
    /**
     * The member's own preferences in a workspace (Settings › Account › Preferences): time zone, date format, week
     * start and landing page. `of` is held by screens (`usePreferences`), `load` by route loaders; `change` shows at
     * once and is put back with a toast if refused, answering whether it landed.
     */
    preferences: {
      of: (workspace: string): PreferencesHeld => preferences.of(workspace),
      load: (workspace: string): Promise<MemberPreferences> => preferences.load(workspace),
      change: (workspace: string, change: PreferencesChange): Promise<boolean> => preferences.change(workspace, change),
    },
    /**
     * The operator console (spec 0047): the super admin's read only analytics
     * across every workspace, held per question (`operator/store.ts`): a
     * screen holds one through `useOperator`, so a new period or search loads
     * in place. Anyone the api doesn't count a super admin is refused
     * NOT_FOUND; a super admin without two factor TWO_FACTOR_REQUIRED, or
     * whose session wasn't proven with the app in 12 hours SIGN_IN_AGAIN, in
     * the held state, never thrown.
     */
    operator: operatorStore,
    account: {
      /**
       * The signed in person's own sessions (spec 0033), newest activity
       * first, a page at a time: device, rough place and last use, by id only.
       */
      sessions: (): AccountSessionsView => accountSessions.view(),
      /** Signs one of the person's devices out: gone at once, back with a toast if refused. Answers whether it landed. */
      signOut: (sessionId: string): Promise<boolean> => accountSessions.signOut(sessionId),
      /**
       * Signs out every other device: only this one shows at once. Answers
       * STEP_UP_REQUIRED (no toast) when the server wants a recent sign in first.
       */
      signOutOthers: (): Promise<SignOutOthersResult> => accountSessions.signOutOthers(),
      /** Two factor on or off, backup codes left, and whether this session is fresh (spec 0033). */
      security: (): AccountSecurityView => accountSecurity.view(),
      /**
       * Recent activity (AC-898): the person's last 90 days of security
       * events, newest first, a page at a time. Read fresh each time: no
       * cache, no live event. Refusals throw a DataError.
       */
      activity: (cursor?: string): Promise<ActivityPage> =>
        call((options) => api.account.activity.list(cursor === undefined ? {} : { cursor }, options)),
      /** Whether a security state says this session may make a sensitive change now. */
      isFresh: isSessionFresh,
      /**
       * A step up (AC-896): `sendCode` emails a code while two factor is off;
       * `verify` checks an email, app or backup code and makes this session
       * fresh for 10 minutes. Each answers how it went, never throwing.
       */
      stepUp: {
        sendCode: (): Promise<StepUpResult> => accountSecurity.sendCode(),
        verify: (method: 'email' | 'totp' | 'backup', code: string): Promise<StepUpResult> =>
          accountSecurity.verify(method, code),
      },
      /**
       * Two factor's setup and changes, each after a step up: start (the
       * app's address and the backup codes, shown once), confirm with a
       * first code (on), turn off, and new backup codes. The state and the
       * device list are read again after each. Refusals throw a DataError.
       */
      /**
       * Deleting the account (AC-902 to AC-907): `check` names the workspaces
       * it is the last owner of; `confirm` deletes it (after a step up and the
       * email typed in full), then forgets everything cached for the person.
       * A 401 from another call while it runs, or after, signs nobody out: the
       * deleting screen goes to sign in itself and says why. Its own 401, or a
       * failure after one was held back, ends the session as any 401 does.
       * Refusals throw a DataError.
       */
      deletion: {
        check: () => call((options) => api.account.deletion.check(undefined, options)),
        confirm: async (email: string): Promise<void> => {
          deletingAccount = true;
          try {
            await call((options) => api.account.deletion.confirm({ email }, options));
          } catch (error) {
            deletingAccount = false;
            // Its own 401 (the session had already ended elsewhere), or a failure after another call's 401 was held
            // back: the session ended under the person, and sign in says so as for any 401.
            if (takeHeldEnding() && !ended) endSession();
            throw error;
          }
          deletingAccount = false;
          takeHeldEnding();
          reset(false);
          // The session is gone and sign in says the account was deleted: a call still out that answers 401 now
          // ends nothing more (sign in again starts afresh).
          ended = true;
        },
      },
      twoFactor: {
        start: () => auth.twoFactor.start(),
        confirm: async (code: string): Promise<void> => {
          await auth.twoFactor.confirm(code);
          // The change renewed this session in place: the device list reads its new id.
          accountSessions.view().reload();
          await accountSecurity.view().reload();
        },
        turnOff: async (): Promise<void> => {
          await auth.twoFactor.turnOff();
          // The change renewed this session in place: the device list reads its new id.
          accountSessions.view().reload();
          await accountSecurity.view().reload();
        },
        newBackupCodes: async (): Promise<readonly string[]> => {
          const codes = await auth.twoFactor.newBackupCodes();
          await accountSecurity.view().reload();
          return codes;
        },
      },
    },
    calendar: {
      /**
       * The member's calendar connections in a workspace (spec 0024): whether
       * calendar sync is set up here, each connection's status, sharing and
       * last sync. The same list for every screen; while a screen retains it
       * (`useCalendar`) and a connection is still syncing, it is read again.
       */
      view: (workspace: string): CalendarView => calendar.view(workspace),
      /** Who sees a connection's meetings: shown at once, put back with a toast if refused. Answers whether it landed. */
      setSharing: (workspace: string, connectionId: string, sharing: 'shared' | 'private'): Promise<boolean> =>
        calendar.setSharing(workspace, connectionId, sharing),
      /** Makes a connection the member's default: shown at once, put back with a toast if refused. */
      makeDefault: (workspace: string, connectionId: string): Promise<boolean> =>
        // The default moves to its main calendar: the calendars list (Default) reads again.
        calendar.makeDefault(workspace, connectionId).finally(() => calendars.list(workspace).reload()),
      /**
       * Disconnects a connection: gone at once, back with a toast if refused. Answers whether it landed. From a
       * confirm (`asksFirst`), the row stays until the server answers and a refusal throws its DataError instead.
       * Its calendars go, and the default may move with a notice: the calendars list reads again.
       */
      remove: (workspace: string, connectionId: string, options?: { readonly asksFirst?: boolean }): Promise<boolean> =>
        calendar.remove(workspace, connectionId, options).finally(() => calendars.list(workspace).reload()),
      /**
       * Where the browser goes to connect a calendar, Google's or Outlook's (`microsoft`), as the API sends it on to
       * the provider's consent, and where it comes back to: Settings › Calendars, or first run's calendar step
       * (`welcome`, spec 0036).
       */
      connectUrl: (workspace: string, then?: ConnectReturn, provider?: CalendarProvider): string =>
        connectUrl(workspace, then, provider),
      /** Sync now: brings a connection's next sync forward; the list reads again shortly after. */
      syncNow: (workspace: string, connectionId: string): Promise<boolean> => calendar.syncNow(workspace, connectionId),
      /** The workspace's calendar settings (spec 0024, AC-609), read when a screen first holds them. */
      settings: (workspace: string): CalendarSettingsHeld => calendar.settings(workspace),
      /** Makes people for unknown attendees, or stops (owners and admins): at once, put back with a toast if refused. */
      setCreateUnknownPeople: (workspace: string, on: boolean): Promise<boolean> =>
        calendar.setCreateUnknownPeople(workspace, on),
      /**
       * Adds a meeting's unknown attendee as a person (AC-609): answers the
       * new person's id, or undefined after a toast saying why not. Timelines
       * update through the `meetings` event.
       */
      addAttendee: (
        workspace: string,
        input: { readonly recordId: string; readonly meetingId: string; readonly email: string },
      ): Promise<string | undefined> => calendar.addAttendee(workspace, input),
      /**
       * The member's accounts with each of their calendars (spec 0024 milestone 5, AC-993): three switches, a hue
       * and whether new bookings go there; read when a screen first holds it (`useCalendarList`).
       */
      calendars: (workspace: string): CalendarsHeld<CalendarListState> => calendars.list(workspace),
      /**
       * Changes one calendar's switches or colour: at once, put back with a toast if refused. Showing or hiding it on
       * the week reads the held weeks again once it lands. Answers whether it landed.
       */
      updateCalendar: (workspace: string, calendarId: string, change: CalendarChange): Promise<boolean> =>
        calendars.update(workspace, calendarId, change),
      /** Where the member's new bookings go (AC-996): at once, put back with a toast if refused. */
      setDestination: (workspace: string, calendarId: string): Promise<boolean> =>
        calendars.setDestination(workspace, calendarId),
      /** Puts away the notice that new bookings moved to another calendar (AC-1005): at once, back if refused. */
      dismissCalendarNotice: (workspace: string): Promise<boolean> => calendars.dismissNotice(workspace),
      /** A booking page's own "Add events to" (AC-997), read when a screen first holds it (`usePageDestination`). */
      pageDestination: (workspace: string, pageId: string): CalendarsHeld<PageDestinationState> =>
        calendars.pageDestination(workspace, pageId),
      /** Sets a booking page's own "Add events to" (`null`: the owner's default): at once, put back if refused. */
      setPageDestination: (workspace: string, pageId: string, calendarId: string | null): Promise<boolean> =>
        calendars.setPageDestination(workspace, pageId, calendarId),
    },
    forms: {
      /**
       * The workspace's forms on objects the member can see (spec 0023), newest
       * first: the active ones, or the archived ones, with this month's
       * counts, read once.
       */
      list: (workspace: string, archived = false) =>
        call((options) => api.forms.list({ workspace, archived }, options)).then((page) => page.items),
      /**
       * The active forms as the held list Captures › Forms shows
       * (`useCaptureList`): every form write here patches it, so a create, a
       * rename in the builder, a publish, a pause, a copy or a delete shows in
       * the list without reading it again.
       */
      view: (workspace: string): CaptureListView<FormSummary> => formLists.view(workspace),
      /** One form with its draft and live documents and its settings. */
      get: (workspace: string, formId: string) => call((options) => api.forms.get({ workspace, formId }, options)),
      /** The target object and the attributes a question may be filed on (AC-658). */
      attributes: (workspace: string, formId: string) =>
        call((options) => api.forms.attributes({ workspace, formId }, options)),
      /** The draft as visitors would see it (AC-657); sends nothing. */
      preview: (workspace: string, formId: string) =>
        call((options) => api.forms.preview({ workspace, formId }, options)),
      /** Whether an address is free for this form. */
      slugAvailable: (workspace: string, formId: string, slug: string) =>
        call((options) => api.forms.slugAvailable({ workspace, formId, slug }, options)).then(
          (answer) => answer.available,
        ),
      /** A new form id: mint it once, and send the same one on a retry. */
      newId: (): string => mintId(),
      /** Creates an untitled form at once (AC-649), waiting for the server (`forms.manage`). */
      create: (
        workspace: string,
        // `mainObjectId: null` keeps its submissions only, adding nothing to the CRM.
        form: { readonly id: string; readonly name?: string; readonly mainObjectId?: string | null },
      ) =>
        formLists.write(workspace, {
          send: () => call((options) => api.forms.create({ workspace, ...form, mutationId: mintId() }, options)),
          land: (items, made) => landForm(made.id)(items, made),
        }),
      /** Saves the draft quietly. Rejects `FORM_CHANGED` when someone saved since `expectedRevision`. */
      saveDraft: (workspace: string, formId: string, document: FormDocument, expectedRevision: number) =>
        formLists.write(workspace, {
          send: () =>
            call((options) =>
              api.forms.saveDraft({ workspace, formId, document, expectedRevision, mutationId: mintId() }, options),
            ),
          land: landForm(formId),
        }),
      /** Publishes the draft as the next live version; the first publish names the form and its address. */
      publish: (
        workspace: string,
        formId: string,
        input: { readonly expectedRevision: number; readonly name?: string; readonly slug?: string },
      ) =>
        formLists.write(workspace, {
          send: () =>
            call((options) => api.forms.publish({ workspace, formId, ...input, mutationId: mintId() }, options)),
          land: landForm(formId),
        }),
      /**
       * The settings that apply at once: name, address, owner (a member or a rotation), who hears of each submission,
       * the sites that may post, signatures.
       */
      updateSettings: (
        workspace: string,
        formId: string,
        settings: {
          readonly name?: string;
          readonly slug?: string;
          readonly ownerMemberId?: string | null;
          readonly ownerRotationId?: string | null;
          readonly allowedOrigins?: readonly string[];
          readonly requireSignature?: boolean;
          readonly notifyMemberIds?: readonly string[];
        },
      ) =>
        formLists.write(workspace, {
          send: () =>
            call((options) =>
              api.forms.updateSettings(
                {
                  workspace,
                  formId,
                  ...settings,
                  allowedOrigins: settings.allowedOrigins === undefined ? undefined : [...settings.allowedOrigins],
                  notifyMemberIds: settings.notifyMemberIds === undefined ? undefined : [...settings.notifyMemberIds],
                  mutationId: mintId(),
                },
                options,
              ),
            ),
          ...(settings.name === undefined
            ? {}
            : shownPatch(formLists.items(workspace), formId, (form) => ({
                ...form,
                name: settings.name ?? form.name,
              }))),
          land: landForm(formId),
        }),
      /** Gives the form a new signing secret (the old one stops working at once); answers the form with it. */
      rotateSecret: (workspace: string, formId: string) =>
        formLists.write(workspace, {
          send: () => call((options) => api.forms.rotateSecret({ workspace, formId, mutationId: mintId() }, options)),
          land: landForm(formId),
        }),
      /** Pauses or resumes (Accepting), archives or restores a form (AC-549): in the list at once, put back on a refusal. */
      setStatus: (workspace: string, formId: string, status: FormStatus) =>
        formLists.write(workspace, {
          send: () =>
            call((options) => api.forms.setStatus({ workspace, formId, status, mutationId: mintId() }, options)),
          ...shownPatch(formLists.items(workspace), formId, (form) => ({ ...form, status })),
          land: landForm(formId),
        }),
      /**
       * Points a form's draft at another object, or at none (`null`: keep its submissions only); on a published
       * form it goes live with the next publish.
       */
      setTarget: (workspace: string, formId: string, mainObjectId: string | null, expectedRevision: number) =>
        formLists.write(workspace, {
          send: () =>
            call((options) =>
              api.forms.setTarget({ workspace, formId, mainObjectId, expectedRevision, mutationId: mintId() }, options),
            ),
          land: landForm(formId),
        }),
      /**
       * Copies a form's draft as a new, never published form ("<name> copy",
       * as the server names it): first in the list at once, pending until the
       * server made it, gone again on a refusal.
       */
      duplicate: (workspace: string, formId: string) => {
        const id = mintId();
        const source = formLists.items(workspace)?.find((form) => form.id === formId);
        const draft: FormSummary | undefined =
          source === undefined
            ? undefined
            : {
                id,
                name: `${source.name} copy`.slice(0, 80),
                status: 'draft',
                ...(source.mainObjectId === undefined ? {} : { mainObjectId: source.mainObjectId }),
                publicKey: '',
                submissionsThisMonth: 0,
                spamCount: 0,
                submissionCount: 0,
                updatedAt: new Date().toISOString(),
              };
        return formLists.write(workspace, {
          send: () => call((options) => api.forms.duplicate({ workspace, formId, id, mutationId: mintId() }, options)),
          ...(draft === undefined ? {} : { show: upsertFirst(draft), pendingId: id }),
          undo: dropItem<FormSummary>(id),
          land: landForm(id),
        });
      },
      /** What Sync old records would do to earlier submissions (`all`, or `unfiled` only), counted on the newest 2,000. */
      syncPreview: (workspace: string, formId: string, scope: SyncScope): Promise<SyncPreview> =>
        call((options) => api.forms.syncPreview({ workspace, formId, scope }, options)),
      /** Starts Sync old records as a `forms.sync` job (`jobId` minted once, so a retry starts one job). */
      syncStart: (workspace: string, formId: string, scope: SyncScope, jobId: string): Promise<SyncStarted> =>
        call((options) => api.forms.syncStart({ workspace, formId, scope, jobId, mutationId: mintId() }, options)),
      /** Deletes a form and its submissions, gone from the list at once and back on a refusal; the records they made stay. */
      delete: (workspace: string, formId: string) =>
        formLists.write(workspace, {
          send: () => call((options) => api.forms.delete({ workspace, formId, mutationId: mintId() }, options)),
          ...shownDrop(formLists.items(workspace), formId),
        }),
      /** The hosted page's address for a form's address, on this origin. */
      hostedUrl: (publicKey: string): string => `${origin}/f/${encodeURIComponent(publicKey)}`,
      /** The embed script's address, on this origin. */
      embedUrl: (): string => `${origin}/embed/v1.js`,
      /** The public submit endpoint, for a site's own form or server. */
      submitUrl: (publicKey: string): string =>
        `${origin}/api/public/forms/${encodeURIComponent(publicKey)}/submissions`,
    },
    submissions: {
      /** A page of a form's submissions, newest first, optionally one state (AC-572). */
      list: (
        workspace: string,
        formId: string,
        query: { readonly state?: SubmissionState; readonly cursor?: string } = {},
      ) => call((options) => api.submissions.list({ workspace, formId, ...query }, options)),
      /** One submission in full: answers the member may see, the records it touched (AC-561, AC-573). */
      get: (workspace: string, submissionId: string) =>
        call((options) => api.submissions.get({ workspace, submissionId }, options)),
      /** Releases a spam submission: it is processed (AC-574). */
      release: (workspace: string, submissionId: string) =>
        call((options) => api.submissions.release({ workspace, submissionId, mutationId: mintId() }, options)),
      /** Marks a submission as spam (AC-574). */
      markSpam: (workspace: string, submissionId: string) =>
        call((options) => api.submissions.markSpam({ workspace, submissionId, mutationId: mintId() }, options)),
      /**
       * Settles a submission the content checks held in Needs review: Not
       * spam sends it to processing, Spam moves it to spam. Only a held one
       * qualifies, so the panel routes a spam row to `release` instead.
       */
      resolve: (workspace: string, submissionId: string, resolution: 'not_spam' | 'spam') =>
        call((options) =>
          api.submissions.resolve(
            { workspace, submissionId, resolution: { kind: resolution }, mutationId: mintId() },
            options,
          ),
        ),
      /** Processes a failed submission again (AC-566). */
      retry: (workspace: string, submissionId: string) =>
        call((options) => api.submissions.retry({ workspace, submissionId, mutationId: mintId() }, options)),
      /** Deletes a submission; the records it made stay (AC-575). */
      delete: (workspace: string, submissionId: string) =>
        call((options) => api.submissions.delete({ workspace, submissionId, mutationId: mintId() }, options)),
      /**
       * Add to CRM: files submissions that aren't in the CRM with the form's
       * published mapping, in one `forms.file` job (follow it with `jobs`).
       * Answers how many it queued and how many it left out.
       */
      addToCrm: (workspace: string, formId: string, submissionIds: readonly string[]): Promise<AddToCrmResult> =>
        call((options) =>
          api.submissions.addToCrm(
            { workspace, formId, submissionIds: [...submissionIds], mutationId: mintId() },
            options,
          ),
        ),
      /**
       * Starts a CSV export of a form's submissions (a filter, or named ones)
       * as a `forms.export` job. `id` is minted once per press (`newId`), so a
       * retry makes one export.
       */
      export: (workspace: string, id: string, formId: string, select: SubmissionSelection): Promise<ExportView> =>
        call((options) => api.submissions.export({ workspace, id, formId, select, mutationId: mintId() }, options)),
      /** One export again: its row count once written, and where it downloads from. */
      getExport: (workspace: string, exportId: string): Promise<ExportView> =>
        call((options) => api.submissions.getExport({ workspace, exportId }, options)),
      /** A new id for an export or a sync's job. */
      newId: () => mintId(),
    },
    imports: {
      /**
       * Makes an import (spec 0040, AC-1120): `id` is minted once per file
       * (`newId`), so a retry answers the same import. Rejects with a
       * `DataError` (`LIMIT_REACHED` past three unfinished, access, settings).
       */
      create: (
        workspace: string,
        input: {
          readonly id: string;
          readonly objectId: string;
          readonly fileName: string;
          readonly rowCount: number;
          readonly errorRows: number;
          readonly settings: ImportSettings;
        },
      ): Promise<ImportView> =>
        sendImport((mutationId) => (options) => api.imports.create({ workspace, ...input, mutationId }, options)),
      /**
       * Sends an import's ready rows in file order, in chunks of at most
       * 1,000 rows and `TRANSFER_LIMITS.stageBytes` of JSON; a chunk whose
       * answer was lost goes again (sending one twice changes nothing).
       * `onChunk` hears the rows sent so far. Answers the totals.
       */
      stage: async (
        workspace: string,
        importId: string,
        rows: readonly StagedRow[],
        onChunk: (sent: number) => void = () => undefined,
      ): Promise<StageResult> => {
        let staged = 0;
        let matched = 0;
        let sent = 0;
        for (const chunk of stageChunks(rows)) {
          const answer = await sendImport(
            (mutationId) => (options) =>
              api.imports.stage({ workspace, importId, rows: [...chunk], mutationId }, options),
          );
          staged += answer.staged;
          matched += answer.matched;
          sent += chunk.length;
          onChunk(sent);
        }
        return { staged, matched };
      },
      /**
       * Starts the import's job once its rows are staged, and follows it
       * (`jobs.get`, `jobs.follow`, `onJobFinished`); `forJob` names the
       * import a finished job belongs to.
       */
      start: async (workspace: string, importId: string): Promise<ImportView> => {
        const view = await sendImport(
          (mutationId) => (options) => api.imports.start({ workspace, importId, mutationId }, options),
        );
        await followImportJob(workspace, importId, view.jobId);
        return view;
      },
      /** Starts an import's undo (AC-1128) and follows its job; rejects with `IMPORT_RUNNING` or `IMPORT_UNDO_CLOSED`. */
      undo: async (workspace: string, importId: string): Promise<ImportView> => {
        const view = await sendImport(
          (mutationId) => (options) => api.imports.undo({ workspace, importId, mutationId }, options),
        );
        await followImportJob(workspace, importId, view.undoJobId);
        return view;
      },
      /**
       * One import as its summary shows it: counts by outcome, its jobs, and
       * whether undo is open. Its jobs are followed from here on, so the
       * summary shows their progress live (`jobs.get`, `useJob`).
       */
      get: async (workspace: string, importId: string): Promise<ImportView> => {
        const view = await call((options) => api.imports.get({ workspace, importId }, options));
        await Promise.all([
          followImportJob(workspace, importId, view.jobId),
          followImportJob(workspace, importId, view.undoJobId),
        ]);
        return view;
      },
      /** A page of an import's refused and noted rows, after the row number `cursor`. */
      rows: (workspace: string, importId: string, cursor?: number): Promise<ImportRows> =>
        call((options) =>
          api.imports.rows({ workspace, importId, ...(cursor === undefined ? {} : { cursor }) }, options),
        ),
      /**
       * Which of a relation column's names link to no record the member can
       * read, and which name several, before the import starts (spec 0040,
       * decision 7). Asks 1,000 distinct names a call, in turn; a read, so a
       * lost answer is asked again by the caller.
       */
      links: async (
        workspace: string,
        objectId: string,
        attributeId: string,
        names: readonly string[],
      ): Promise<ImportLinks> => {
        const distinct = [...new Set(names.map((name) => name.trim().slice(0, 500)).filter((name) => name !== ''))];
        const missing: string[] = [];
        const ambiguous: string[] = [];
        for (let start = 0; start < distinct.length; start += 1_000) {
          const part = distinct.slice(start, start + 1_000);
          const answer = await call((options) =>
            api.imports.links({ workspace, objectId, attributeId, names: part }, options),
          );
          missing.push(...answer.missing);
          ambiguous.push(...answer.ambiguous);
        }
        return { missing, ambiguous };
      },
      /**
       * Each value of a file's match column, in order: its keys as the import
       * finds records by them, and whether one names a record the member can
       * read (the preview's new and update counts). Asks 1,000 a call, in
       * turn; a read, so a lost answer is asked again by the caller.
       */
      matches: async (
        workspace: string,
        objectId: string,
        attributeId: string,
        values: readonly unknown[],
      ): Promise<ImportMatches['rows']> => {
        const rows: ImportMatches['rows'][number][] = [];
        for (let start = 0; start < values.length; start += 1_000) {
          const part = values.slice(start, start + 1_000);
          const answer = await call((options) =>
            api.imports.matches({ workspace, objectId, attributeId, values: part }, options),
          );
          rows.push(...answer.rows);
        }
        return rows;
      },
      /** The import a job this tab started belongs to (its import or its undo job), for the finish toast. */
      forJob: (jobId: string): string | undefined => importJobs.get(jobId),
      /** A new import id (UUID v7): mint it once per file, and send the same on a retry. */
      newId: () => mintId(),
    },
    exports: {
      /**
       * Starts a CSV export of a view as it stands (spec 0040, AC-1130): its
       * filter and sorts (saved or unsaved), its visible columns. `id` is
       * minted once per press (`newId`), so a retry makes one export. The job
       * is followed like any this tab started; `forJob` gives the export a
       * finished job wrote, for the toast's Download. Rejects with a
       * `DataError` (`EXPORT_TOO_LARGE` with the count, `LIMIT_REACHED`).
       * `recordIds` exports exactly those records (a table's ticked rows,
       * at most 10,000) instead of the filter; ones the member can't read are
       * absent from the file.
       */
      start: async (
        workspace: string,
        input: {
          readonly id: string;
          readonly objectId: string;
          readonly viewId?: string;
          readonly filter?: StartExportInput['filter'];
          readonly sorts?: StartExportInput['sorts'];
          readonly attributeIds: readonly string[];
          readonly recordIds?: readonly string[];
        },
      ): Promise<RecordsExportView> => {
        const { recordIds, ...rest } = input;
        const view = await sendImport(
          (mutationId) => (options) =>
            api.exports.start(
              {
                workspace,
                ...rest,
                attributeIds: [...input.attributeIds],
                ...(recordIds === undefined ? {} : { recordIds: [...recordIds] }),
                timeZone: zoneOf(workspace),
                mutationId,
              },
              options,
            ),
        );
        exportJobs.set(view.jobId, view);
        await followJob(workspace, view.jobId);
        return view;
      },
      /** One records export again: its row count once written, and where it downloads from. */
      get: (workspace: string, exportId: string): Promise<RecordsExportView> =>
        call((options) => api.exports.get({ workspace, exportId }, options)),
      /** The export a job this tab started wrote, for the finish toast's Download. */
      forJob: (jobId: string): RecordsExportView | undefined => exportJobs.get(jobId),
      /** Where a finished export downloads from (the same route serves every export). */
      downloadPath: (workspace: string, exportId: string): string =>
        `/api/exports/${encodeURIComponent(exportId)}/download?workspace=${encodeURIComponent(workspace)}`,
      /** A new export id (UUID v7). */
      newId: () => mintId(),
    },
    files: {
      /** Where a stored file (a form's file answer) downloads from: the api checks the member and the file on each. */
      downloadPath: (workspace: string, fileId: string): string =>
        `/api/files/${encodeURIComponent(fileId)}?workspace=${encodeURIComponent(workspace)}`,
    },
    jobs: {
      /**
       * A workspace's background jobs for `scope` (`mine`, or `all` for
       * holders of `jobs.manage`), the same view for every screen that asks:
       * unfinished first, then the newest, 50 at a time, live while a screen
       * retains it (`useJobs`).
       */
      view: (workspace: string, scope: JobsScope): JobsView => jobs.view(workspace, scope),
      /** A new job id: mint it once per form, and send the same one on a retry. */
      newId: () => jobs.newId(),
      /**
       * Starts a test job (local and previews only; production answers
       * NOT_FOUND). Its end raises `onJobFinished` while the app is open.
       */
      startTest: (workspace: string, id: string, settings: TestJobSettings): Promise<JobView> =>
        jobs.startTest(workspace, id, settings),
      /** Cancels a job at once on screen; a refusal puts it back with a toast. Answers whether it landed. */
      cancel: (workspace: string, jobId: string): Promise<boolean> => jobs.cancel(workspace, jobId),
      /**
       * A job as held now (one this browser started or a view shows), or
       * undefined (spec 0022's bar). One this browser started stays current:
       * live, or read again on a timer while live updates are paused or off.
       */
      get: (workspace: string, jobId: string): JobView | undefined => jobs.get(workspace, jobId),
      /** Calls `listener` whenever a held job changes; the answer stops. Read it through `useJob`. */
      follow: (listener: () => void): (() => void) => jobs.follow(listener),
      /**
       * Confirms a job waiting in `ready`: it shows queued at once; a refusal
       * (it expired, or finished) puts it back with a toast and reads it again.
       * Answers whether it landed.
       */
      confirm: (workspace: string, jobId: string): Promise<boolean> => jobs.confirm(workspace, jobId),
    },
    search: {
      /**
       * The command menu's search (spec 0039): every readable object's
       * records and the views the person sees, as they type (150 ms after the
       * last key, the request before aborted, answers kept for the menu's
       * life). Its code loads on first use, never in the first load. Read it
       * through `useGlobalSearch`, and `dispose` it when the menu closes.
       */
      /** Loads the search's code ahead of use (the menu's idle prefetch), so the first search waits on no chunk. */
      preload: (): Promise<void> => import('./search/global.ts').then(() => undefined),
      open: async (workspace: string): Promise<GlobalSearch> =>
        (await import('./search/global.ts')).createGlobalSearch({
          run: (query, signal) =>
            beforeRead(workspace).then(() =>
              call((options) => api.search.query({ workspace, query }, options), signal),
            ),
        }),
      /** The person's recent records and views they may still see, newest first (read fresh each time the menu opens). */
      recents: (workspace: string): Promise<readonly RecentItem[]> =>
        beforeRead(workspace)
          .then(() => call((options) => api.recents.list({ workspace }, options)))
          .then((answer) => answer.items),
      /**
       * Keeps a record or view the person just opened as recent (AC-1088):
       * fire and forget, once per item per 10 seconds per tab, silent on failure.
       */
      visit: (workspace: string, kind: 'record' | 'view', id: string): void => {
        const key = `${workspace}:${kind}:${id}`;
        const now = Date.now();
        if ((visited.get(key) ?? 0) > now - VISIT_EVERY_MS) return;
        // Delete first, so the map's order is the order of last sends and the oldest goes past 200.
        visited.delete(key);
        visited.set(key, now);
        if (visited.size > 200) visited.delete(visited.keys().next().value ?? key);
        void call((options) => api.recents.visit({ workspace, kind, id }, options)).catch(() => undefined);
      },
    },
    /**
     * The member's own sidebar (spec 0034): `load` for the workspace route's
     * loader (the first paint has their order, AC-936), `source` for
     * `useNav`, and `change` to apply one operation at once and send it
     * (rolled back with a toast and Retry on a refusal, AC-937).
     */
    nav: {
      load: (workspace: string) => loadNav().then((store) => store.load(workspace)),
      source: (workspace: string): NavSource => navSource(workspace),
      /**
       * Answers a promise that settles when the change lands, or rejects with its refusal, already rolled back; a
       * screen that waits on it may say the refusal itself (`isSaidHere`), and no toast is raised.
       */
      change: (
        workspace: string,
        op: NavOperation,
        universe: NavUniverse,
        options: NavChangeOptions = {},
      ): Promise<void> => {
        const made = loadNav().then(
          (store) => store.change(workspace, op, universe, options),
          // The store's code didn't load: nothing changed. Say so (unless the screen does), with the layer's words.
          (error: unknown) => {
            const failure = toDataError(error);
            if (options.isSaidHere !== true) notify({ tone: 'danger', message: failure.message });
            throw failure;
          },
        );
        // Most screens don't wait on a change: its refusal is said by the toast, never left unhandled.
        made.catch(() => undefined);
        return made;
      },
      reload: (workspace: string) => loadNav().then((store) => store.reload(workspace)),
    },
    views: {
      /**
       * An object's saved views in switcher order (spec 0020), the same
       * source for every screen, live while a screen retains it
       * (`useViewsList`).
       */
      list: (workspace: string, objectId: string): ViewsListSource => views.list(workspace, objectId),
      /** One view whole, the same source for every screen, live while retained (`useSavedView`). */
      get: (workspace: string, viewId: string): SavedViewSource => views.get(workspace, viewId),
      /**
       * Saves a draft as the view's filter and sorts for everyone (AC-468),
       * waiting for the server. Rejects with a `DataError`: `VIEW_CHANGED`
       * when someone saved since `baseQueryVersion` (send again with `force`
       * to replace theirs), `FORBIDDEN` on a locked view, `FILTER_INVALID`.
       */
      saveQuery: (workspace: string, viewId: string, input: SaveQueryInput) =>
        views.saveQuery(workspace, viewId, input),
      /**
       * Makes a view (AC-472), waiting for the server; rejects with a
       * `DataError` (`NAME_TAKEN` on `name`, `LIMIT_REACHED`, `ID_TAKEN`).
       * `newId` mints the id once per dialog, so a retry sends the same.
       */
      create: (workspace: string, input: NewView): Promise<View> => views.create(workspace, input),
      /** A fresh UUID v7 for a view the create dialog will make. */
      newId: (): string => mintId(),
      /** Renames a view, or shares it or makes it private, waiting for the server. */
      update: (
        workspace: string,
        viewId: string,
        changes: { readonly name?: string; readonly visibility?: ViewVisibility },
      ): Promise<View> => views.update(workspace, viewId, changes),
      /**
       * A column change (AC-470), shown at once and saved at most once per
       * 500 ms; a refusal is rolled back with a toast. `isLocal` keeps it in
       * this tab only (a locked view, AC-476) until `dropLocalLayout`.
       */
      setLayout: (workspace: string, viewId: string, layout: ViewLayout, options?: { readonly isLocal?: boolean }) => {
        views.setLayout(workspace, viewId, layout, options);
      },
      /** Drops a locked view's layout kept in this tab (the screen left it). */
      dropLocalLayout: (workspace: string, viewId: string) => {
        views.dropLocalLayout(workspace, viewId);
      },
      /** Swaps a view with its neighbour in its group, waiting for the server. */
      move: (workspace: string, objectId: string, viewId: string, direction: 'up' | 'down'): Promise<void> =>
        views.move(workspace, objectId, viewId, direction),
      /** Locks or unlocks a shared view (`views.manage`), waiting for the server. */
      setLocked: (workspace: string, viewId: string, locked: boolean): Promise<View> =>
        views.setLocked(workspace, viewId, locked),
      /** Makes a shared view the object's default (`views.manage`), waiting for the server. */
      setDefault: (workspace: string, objectId: string, viewId: string): Promise<void> =>
        views.setDefault(workspace, objectId, viewId),
      /** Deletes a view for good, waiting for the server (`VIEW_IS_DEFAULT` for the default). */
      remove: (workspace: string, objectId: string, viewId: string): Promise<void> =>
        views.remove(workspace, objectId, viewId),
      /** Keeps a view as the person's last opened one for its object: fire and forget, once per 10 seconds. */
      markOpened: (workspace: string, viewId: string) => {
        views.markOpened(workspace, viewId);
      },
      /**
       * Keeps a view's unsaved filter and sorts for this tab, by view id
       * (undefined forgets them): leaving the view keeps its draft, and opening
       * it again brings it back.
       */
      keepDraft: (workspace: string, viewId: string, draft: KeptDraft | undefined) => {
        views.keepDraft(workspace, viewId, draft);
      },
      /** The draft this tab kept for a view, if any. */
      keptDraft: (workspace: string, viewId: string): KeptDraft | undefined => views.keptDraft(workspace, viewId),
      /** A draft's URL text (base64url of its canonical JSON), or undefined past `DRAFT_LINK_MAX`. */
      draftParam: (query: DraftQuery): string | undefined => draftParam(query),
      /** A link's draft, checked (loads the schemas on first use), or undefined when it can't be read. */
      readDraft: (text: string): Promise<DraftQuery | undefined> => readDraft(text),
      /** Whether two queries ask the same thing. */
      isSameQuery: (a: DraftQuery, b: DraftQuery): boolean => isSameQuery(a, b),
    },
    live: {
      /**
       * Whether other people's changes are arriving: `live`, `paused` while the
       * connection or a subscription is down (screens say so quietly), or
       * `off` where live updates aren't configured (previews, which show
       * nothing about it).
       */
      status: (): LiveStatus => liveStatus,
      /**
       * Reads the workspace's head before its screens read anything (spec
       * 0007): the route loader calls it beside `me.get`, so the first reads
       * rarely wait. Nothing when live is off; never throws.
       */
      prepare: (workspace: string): void => {
        void prepare(workspace);
      },
      /** Calls `listener` whenever `status()` changes; the answer stops. */
      subscribe: (listener: () => void): (() => void) => {
        liveListeners.add(listener);
        return () => {
          liveListeners.delete(listener);
        };
      },
    },
    system: {
      /** Whether the API and the database answer, and which sign in methods are on. Never cached. */
      status: () => call((options) => api.system.status(undefined, options)),
    },
    auth,
    /**
     * A member's email preferences, opened by an email's link with no session
     * (the emails lane): one store per link's token, the page's one copy, its
     * changes shown at once and put back on a refusal. Its module loads on
     * first use, so the store comes as a promise for the route's loader.
     */
    emailPreferences: (token: string): Promise<EmailPreferencesStore> =>
      cached(emailPreferenceStores, token, () =>
        import('./email-preferences.ts').then(({ createEmailPreferences }) =>
          createEmailPreferences({ origin, fetch }, token),
        ),
      ),
    /**
     * An optional email's one click unsubscribe opened in a browser (the
     * emails lane): one store per link's token, which asks before it posts.
     */
    emailUnsubscribe: (token: string): Promise<EmailUnsubscribeStore> =>
      cached(emailUnsubscribeStores, token, () =>
        import('./email-preferences.ts').then(({ createEmailUnsubscribe }) =>
          createEmailUnsubscribe({ origin, fetch }, token),
        ),
      ),
  };
}

/** The data layer, as routes see it in their context. */
export type DataLayer = ReturnType<typeof createDataLayer>;
