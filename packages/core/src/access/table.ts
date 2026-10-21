// The access table (spec 0009, AC-139): one entry per service `@crm/core`
// exports that takes a scope, saying what it checks. A table driven test
// (`table.test.ts`) calls each with a principal that lacks the access and
// expects the refusal, and fails when an exported function is neither here
// nor named as taking no scope.
import type { Permission } from '@crm/contracts';

/**
 * What a service checks: a workspace permission (403 `FORBIDDEN`), the data
 * level on the object it reads or writes (hidden answers as absent; enforced
 * at the engine's choke points from milestone 2), the owner rules
 * (`members.manage` plus who may touch the owner role), any member of the
 * workspace (the member list, your own access), the system only, or (a
 * background job) its starter or a holder of `jobs.manage`.
 */
export type AccessEntry =
  | { readonly permission: Permission }
  | { readonly data: 'read' | 'write' }
  | { readonly ownerRules: true }
  | { readonly anyMember: true }
  | { readonly system: true }
  /** A job's starter or a holder of `jobs.manage` (spec 0008, AC-114); anyone else finds no such job. */
  | { readonly jobStarter: true }
  /**
   * A member's own calendar connection (spec 0024): anyone else's is
   * `NOT_FOUND`, and a principal that isn't a member is `FORBIDDEN`.
   */
  | { readonly ownConnection: true }
  /** Only the scope a form's public key made (`enterPublicForm`, spec 0023), for that form. */
  | { readonly publicForm: true }
  /**
   * Booking pages (spec 0025): `booking.manage` first (403 `FORBIDDEN`), then the reader's own pages, or anyone's
   * with `booking.admin`; another's page answers as absent.
   */
  | { readonly bookingPages: true }
  /**
   * Availability schedules (spec 0035, AC-971): `booking.manage` first (403 `FORBIDDEN`), then the reader's own
   * schedules, or anyone's with `booking.admin`; another member's schedule answers as absent, and naming another
   * member without `booking.admin` is `FORBIDDEN`.
   */
  | { readonly schedules: true }
  /**
   * The caller's own sidebar (spec 0034): a member reads and changes only their own row (no member id is ever
   * taken), and a principal that isn't a member gets the defaults on a read and `FORBIDDEN` on a change.
   */
  | { readonly ownNav: true };

/** Every exported service that takes a scope, and what it checks. */
export const ACCESS_TABLE = {
  // Definitions: schema.manage (AC-135).
  defineObject: { permission: 'schema.manage' },
  updateObject: { permission: 'schema.manage' },
  setObjectArchived: { permission: 'schema.manage' },
  reorderObject: { permission: 'schema.manage' },
  // Settings' object writes (spec 0012).
  createObject: { permission: 'schema.manage' },
  editObject: { permission: 'schema.manage' },
  moveObject: { permission: 'schema.manage' },
  archiveObject: { permission: 'schema.manage' },
  restoreObject: { permission: 'schema.manage' },
  defineAttribute: { permission: 'schema.manage' },
  updateAttribute: { permission: 'schema.manage' },
  archiveAttribute: { permission: 'schema.manage' },
  restoreAttribute: { permission: 'schema.manage' },
  reorderAttribute: { permission: 'schema.manage' },
  // Settings' attribute writes (spec 0012, milestone 2).
  createAttribute: { permission: 'schema.manage' },
  editAttribute: { permission: 'schema.manage' },
  moveAttribute: { permission: 'schema.manage' },
  archiveAttributes: { permission: 'schema.manage' },
  restoreAttributes: { permission: 'schema.manage' },
  defineOption: { permission: 'schema.manage' },
  updateOption: { permission: 'schema.manage' },
  // Settings' option writes (spec 0012, milestone 3).
  createOption: { permission: 'schema.manage' },
  editOption: { permission: 'schema.manage' },
  moveOption: { permission: 'schema.manage' },
  archiveOption: { permission: 'schema.manage' },
  restoreOption: { permission: 'schema.manage' },
  defineRelationship: { permission: 'schema.manage' },
  // Relationships (spec 0014): create and rename, both sides in one write.
  updateRelationship: { permission: 'schema.manage' },
  createRelationship: { permission: 'schema.manage' },
  renameRelationship: { permission: 'schema.manage' },
  defineList: { permission: 'schema.manage' },
  // Removing records for good.
  eraseRecord: { permission: 'records.purge' },
  purgeDeleted: { permission: 'records.purge' },
  // Members.
  setMemberRole: { ownerRules: true },
  removeMember: { ownerRules: true },
  // Spec 0031, AC-816: the remove dialog's counts, for `members.manage` or about oneself.
  previewRemoval: { ownerRules: true },
  // Spec 0031: leaving is the removal on oneself, open to any member; the only owner is refused LAST_OWNER.
  leaveWorkspace: { anyMember: true },
  // Spec 0031, AC-813: an owner hands the workspace on; anyone else is refused.
  transferOwnership: { ownerRules: true },
  listMembers: { anyMember: true },
  // Spec 0037, AC-1439: the roles every role picker offers.
  listRoles: { anyMember: true },
  // Invitations (spec 0031, slice 2).
  inviteMembers: { permission: 'members.invite' },
  listInvitations: { permission: 'members.invite' },
  resendInvite: { permission: 'members.invite' },
  revokeInvite: { permission: 'members.invite' },
  // The sidebar (spec 0034): the caller's own row only.
  readNav: { ownNav: true },
  changeNav: { ownNav: true },
  // Slice 6, AC-818: the invite link.
  getInviteLink: { permission: 'members.invite' },
  // Slice 6, AC-819, AC-820: email domains (workspace settings) and requests to join (inviting).
  getWorkspaceDomains: { permission: 'workspace.manage' },
  // A member's own profile (spec 0031, slice 7): themself only, so any member.
  getMyProfile: { anyMember: true },
  updateMyMemberProfile: { anyMember: true },
  // Workspace › General (spec 0031, slice 7): every member reads it; changing it and deleting it are permissions.
  getWorkspaceSettings: { anyMember: true },
  updateWorkspace: { permission: 'workspace.manage' },
  deleteWorkspace: { permission: 'workspace.delete' },
  restoreWorkspace: { permission: 'workspace.delete' },
  setWorkspaceDomains: { permission: 'workspace.manage' },
  listJoinRequests: { permission: 'members.invite' },
  decideJoinRequest: { permission: 'members.invite' },
  setInviteLink: { permission: 'members.invite' },
  getMyAccess: { anyMember: true },
  // The limits' usage (spec 0012, AC-243): any member, filtered by their access inside.
  getUsage: { anyMember: true },
  // Change events (spec 0007): the head, and catch up through the caller's own audience.
  workspaceHead: { anyMember: true },
  catchUp: { anyMember: true },
  // Reads.
  listObjects: { data: 'read' },
  listObjectAttributes: { data: 'read' },
  listAttributes: { data: 'read' },
  listOptions: { data: 'read' },
  getRecords: { data: 'read' },
  readRecordsById: { data: 'read' },
  queryRecords: { data: 'read' },
  queryPage: { data: 'read' },
  countMatches: { data: 'read' },
  // A board's first load (spec 0021): object read, and the filter's field checks through the compiler.
  queryGroups: { data: 'read' },
  getHistory: { data: 'read' },
  getValuesAsOf: { data: 'read' },
  getTimeInStages: { data: 'read' },
  getEntries: { data: 'read' },
  getRecordEntries: { data: 'read' },
  // The record page (spec 0017): its timeline and a record in the trash.
  getActivity: { data: 'read' },
  readTrashedRecord: { data: 'read' },
  // The record picker's search (spec 0014): only records the reader may see.
  searchRecords: { data: 'read' },
  // The command menu (spec 0039): it searches, lists and keeps only what the reader may read; the rest is absent.
  searchWorkspace: { data: 'read' },
  listRecents: { data: 'read' },
  visitRecent: { data: 'read' },
  // The trash (spec 0022): what it holds, by the principal's object levels and record rules.
  queryTrash: { data: 'read' },
  countTrash: { data: 'read' },
  // Record and entry writes.
  createRecord: { data: 'write' },
  addRecord: { data: 'write' },
  setValues: { data: 'write' },
  setRecordValues: { data: 'write' },
  setValuesBatch: { data: 'write' },
  editRecord: { data: 'write' },
  editRecords: { data: 'write' },
  deleteRecord: { data: 'write' },
  restoreRecord: { data: 'write' },
  // Bulk deletes and restores (spec 0022): object write, checked once for a delete, per record for a restore.
  deleteRecords: { data: 'write' },
  restoreRecords: { data: 'write' },
  restoreBatch: { data: 'write' },
  // Bulk edits (spec 0022, milestone 2): object and field write, checked once for the call.
  updateMany: { data: 'write' },
  bulkEditRecords: { data: 'write' },
  // Bulk jobs (spec 0022, milestone 3): the action's check at start (records.purge for a purge), then the runner's.
  startBulk: { data: 'write' },
  undoDelete: { data: 'write' },
  // Delete forever (spec 0022, milestone 4): owners and admins.
  deleteForever: { permission: 'records.purge' },
  // Links from the table (spec 0014, milestone 2): write on the near side, every far record visible.
  changeLinks: { data: 'write' },
  addRecordLinks: { data: 'write' },
  removeRecordLinks: { data: 'write' },
  addEntry: { data: 'write' },
  removeEntry: { data: 'write' },
  restoreEntry: { data: 'write' },
  // Background jobs (spec 0008): the starter or jobs.manage; the test job needs jobs.manage.
  getJob: { jobStarter: true },
  listJobs: { jobStarter: true },
  cancelJob: { jobStarter: true },
  confirmJob: { jobStarter: true },
  startTestJob: { permission: 'jobs.manage' },
  // Saved views (spec 0020): any member who may read the object; a locked view's query needs views.manage inside.
  listViews: { data: 'read' },
  getView: { data: 'read' },
  saveViewQuery: { data: 'read' },
  createView: { data: 'read' },
  updateView: { data: 'read' },
  setViewLayout: { data: 'read' },
  moveView: { data: 'read' },
  deleteView: { data: 'read' },
  markViewOpened: { data: 'read' },
  // Locking a view and choosing the default (AC-475).
  setViewLocked: { permission: 'views.manage' },
  setDefaultView: { permission: 'views.manage' },
  // The relay's reads (`@crm/core/system`).
  audiences: { system: true },
  viewFacts: { system: true },
  // Tasks (spec 0019): reads answer only tasks the reader may see; writes check the change rule and `write` on
  // each linked record's object.
  getTasks: { data: 'read' },
  listTasks: { data: 'read' },
  // The sidebar's Tasks badge (spec 0034): the caller's own assigned tasks only; an API key counts none.
  countDueTasks: { data: 'read' },
  createTask: { data: 'write' },
  updateTask: { data: 'write' },
  deleteTask: { data: 'write' },
  restoreTask: { data: 'write' },
  taskFacts: { system: true },
  // Notes (spec 0019): a note follows its record: visible when the record is, changed with `write` on its object.
  getNote: { data: 'read' },
  listNotes: { data: 'read' },
  saveNote: { data: 'write' },
  deleteNote: { data: 'write' },
  restoreNote: { data: 'write' },
  // Calendar sync (spec 0024): a member's own connections only; a record's meetings through the record's door.
  listCalendarConnections: { anyMember: true },
  connectCalendar: { ownConnection: true },
  updateCalendarConnection: { ownConnection: true },
  removeCalendarConnection: { ownConnection: true },
  syncCalendarNow: { ownConnection: true },
  listMeetingsForRecord: { data: 'read' },
  meetingFacts: { system: true },
  // Spec 0031, AC-817: the relay's read of whom a removal cuts off.
  removedUserIds: { system: true },
  // Milestone 2: Add as person creates a person through the door (write on People, the record's own read first);
  // the workspace's calendar settings are read by any member and changed by owners and admins.
  addMeetingAttendee: { data: 'write' },
  readCalendarSettings: { anyMember: true },
  // Settings › Account › Preferences: a member's own, never another's; any other principal is FORBIDDEN.
  readMyPreferences: { anyMember: true },
  updateMyPreferences: { anyMember: true },
  updateCalendarSettings: { permission: 'workspace.manage' },
  // Forms (spec 0023): any member reads the forms on objects they can see; changing one, or acting on a
  // submission, needs forms.manage. A submission reads through its main record. The public form and submit take
  // only the scope the form's own public key made.
  listForms: { data: 'read' },
  getForm: { data: 'read' },
  formAttributes: { data: 'read' },
  previewForm: { data: 'read' },
  createForm: { permission: 'forms.manage' },
  saveFormDraft: { permission: 'forms.manage' },
  publishForm: { permission: 'forms.manage' },
  setFormStatus: { permission: 'forms.manage' },
  updateFormSettings: { permission: 'forms.manage' },
  rotateFormSecret: { permission: 'forms.manage' },
  setFormTarget: { permission: 'forms.manage' },
  duplicateForm: { permission: 'forms.manage' },
  deleteForm: { permission: 'forms.manage' },
  isSlugAvailable: { data: 'read' },
  listSubmissions: { data: 'read' },
  getSubmission: { data: 'read' },
  retrySubmission: { permission: 'forms.manage' },
  releaseSubmission: { permission: 'forms.manage' },
  markSubmissionSpam: { permission: 'forms.manage' },
  resolveSubmission: { permission: 'forms.manage' },
  // Add to CRM and Sync old records need forms.manage; their jobs write as the member, through the door.
  addToCrm: { permission: 'forms.manage' },
  previewSync: { permission: 'forms.manage' },
  startSync: { permission: 'forms.manage' },
  // An export: any member who can read the form, rows and answers filtered as they read; only its starter
  // reads it back.
  startSubmissionsExport: { data: 'read' },
  getExport: { data: 'read' },
  exportFile: { data: 'read' },
  exportPart: { data: 'read' },
  deleteSubmission: { permission: 'forms.manage' },
  getPublicForm: { publicForm: true },
  submitForm: { publicForm: true },
  postingRules: { publicForm: true },
  // Booking pages (spec 0025).
  listBookingPages: { bookingPages: true },
  getBookingPage: { bookingPages: true },
  createBookingPage: { bookingPages: true },
  updateBookingPage: { bookingPages: true },
  deleteBookingPage: { bookingPages: true },
  listBookings: { bookingPages: true },
  listWorkspaceBookings: { bookingPages: true },
  readBookingsCalendar: { bookingPages: true },
  readDefaultHours: { schedules: true },
  saveDefaultHours: { schedules: true },
  listScheduleMembers: { schedules: true },
  listSchedules: { schedules: true },
  getSchedule: { schedules: true },
  createSchedule: { schedules: true },
  updateSchedule: { schedules: true },
  setDefaultSchedule: { schedules: true },
  duplicateSchedule: { schedules: true },
  deleteSchedule: { schedules: true },
  createTimeBlock: { bookingPages: true },
  removeTimeBlock: { bookingPages: true },
  bookAsHost: { bookingPages: true },
  // Changing a booking from Bookings (spec 0025, milestone 2): booking.manage first, then the booking's row.
  hostTarget: { bookingPages: true },
  bookingGuestPath: { bookingPages: true },
} as const satisfies Record<string, AccessEntry>;
