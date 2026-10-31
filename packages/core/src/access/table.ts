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
   * with `booking.admin`; another's page answers as absent (a workspace link is `booking.admin`'s alone, and its maker
   * owns nothing of it). A booking: its host, a co-host, its page's owner (never a workspace link's maker), or
   * `booking.admin` (`booking/seen.ts`, the one rule); the Bookings reads take `hosts: 'mine'` unless asked for all.
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
  | { readonly ownNav: true }
  /**
   * The signed in person's own link page (spec 0051): their account's blocks, the same from every workspace, and no
   * user id is ever taken. A principal that isn't a signed in member (a key, a form, the system) is `FORBIDDEN`, and
   * another person's block answers as absent (`NOT_FOUND`).
   */
  | { readonly ownLinkPage: true }
  /**
   * Someone else's scheduling (spec 0037, AC-1258, AC-1422): the actor's own permission from the services table,
   * then `canActFor` over the one member it names. Outside See reach that member answers NOT_FOUND, as an unknown
   * one; Seen but not Managed, a Manage service is 403 FORBIDDEN. Job J4 moves the schedules, blocks, time off and
   * booking actions onto it.
   */
  | { readonly scheduling: 'view' | 'manage' }
  /**
   * Any member may call it; rows are filtered inside the service by the named rule, so a principal with no reach
   * gets an empty answer (or themself alone), never a refusal (spec 0037, AC-1422). `schedulingReach`: See reach.
   */
  | { readonly filtered: 'schedulingReach' }
  /**
   * Delegations (spec 0037, AC-1255): over yourself with `booking.manage`, otherwise `members.manage` (never over an
   * owner; over an admin only by an owner); the delegate may remove their own; someone else's answer as absent.
   * `listDelegations` with `everyone: true` is `members.manage` alone (403 FORBIDDEN; the Members page's column).
   */
  | { readonly delegation: true }
  /**
   * Lists (spec 0048, decision 1, AC-4834): making one needs `lists.manage` (403 `FORBIDDEN`, "Your role can't make
   * lists.") and write on its object; changing one is `schema.manage`'s, or its maker's with `lists.manage`.
   */
  | { readonly listManager: true }
  /**
   * A change to one existing list (spec 0048, AC-4834): its managers only, `schema.manage` or its maker with
   * `lists.manage` while they are still a member. A list the caller can't read answers `NOT_FOUND`, as an unknown one;
   * anyone else who can read it gets 403 `FORBIDDEN` naming who may ("Only <maker>, owners and admins can change
   * this list.").
   */
  | { readonly listMaker: true };

/** Every exported service that takes a scope, and what it checks. */
export const ACCESS_TABLE = {
  // Definitions: schema.manage (AC-135).
  defineObject: { permission: 'schema.manage' },
  // What an attribute's change would touch (the flow pass), shown in its settings before the change.
  attributeImpact: { permission: 'schema.manage' },
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
  // Changing an attribute's type in place, and what it would do (the field types lane).
  changeAttributeType: { permission: 'schema.manage' },
  checkTypeChange: { permission: 'schema.manage' },
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
  // Lists (spec 0048): lists.manage and write on the object (decision 1).
  defineList: { listManager: true },
  createList: { listManager: true },
  updateList: { listMaker: true },
  archiveList: { listMaker: true },
  restoreList: { listMaker: true },
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
  // Teams (spec 0031, slice 8, AC-824, AC-827): every member reads them; owners and admins change them.
  listTeams: { anyMember: true },
  createTeam: { permission: 'teams.manage' },
  renameTeam: { permission: 'teams.manage' },
  deleteTeam: { permission: 'teams.manage' },
  changeTeamMembers: { permission: 'teams.manage' },
  // Access rules by role and team (spec 0032, AC-851): owners and admins read and set them.
  getObjectAccess: { permission: 'access.manage' },
  setObjectAccess: { permission: 'access.manage' },
  previewAccess: { permission: 'access.manage' },
  // Spec 0037, AC-1439: the roles every role picker offers.
  listRoles: { anyMember: true },
  // A workspace's sign in rules (spec 0033, milestone 4): owners only.
  getWorkspaceSecurity: { permission: 'security.manage' },
  setWorkspaceSecurity: { permission: 'security.manage' },
  signOutEveryone: { permission: 'security.manage' },
  // Settings › History › Workspace changes (spec 0046, AC-4622): owners and admins read the audit log.
  listAuditEvents: { permission: 'audit.read' },
  // Settings › Webhooks (spec 0064, AC-6419 to AC-6425): owners and admins.
  listWebhooks: { permission: 'webhooks.manage' },
  checkWebhooksAccess: { permission: 'webhooks.manage' },
  createWebhook: { permission: 'webhooks.manage' },
  updateWebhook: { permission: 'webhooks.manage' },
  rotateWebhookSecret: { permission: 'webhooks.manage' },
  deleteWebhook: { permission: 'webhooks.manage' },
  listWebhookDeliveries: { permission: 'webhooks.manage' },
  prepareWebhookTest: { permission: 'webhooks.manage' },
  prepareWebhookResend: { permission: 'webhooks.manage' },
  recordWebhookSend: { permission: 'webhooks.manage' },
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
  // Sharing their own link page makes it public (27 Oct 2026): themself only, and nothing for a member with no page.
  showMyLinkPage: { anyMember: true },
  // The person's own link page (spec 0051): their account's blocks only.
  readProfileItems: { ownLinkPage: true },
  readProfileCounts: { ownLinkPage: true },
  listProfilePageChoices: { ownLinkPage: true },
  // The forms they may place (spec 0052) and the look of the page (spec 0054): their own account, as the rest.
  listProfileFormChoices: { ownLinkPage: true },
  saveProfileTheme: { ownLinkPage: true },
  // The picture their page shares with (spec 0055): their own account, like every other page setting.
  saveProfileShareImage: { ownLinkPage: true },
  setProfileIndexable: { ownLinkPage: true },
  importProfileLinks: { ownLinkPage: true },
  saveProfileItem: { ownLinkPage: true },
  orderProfileItems: { ownLinkPage: true },
  archiveProfileItem: { ownLinkPage: true },
  deleteProfileItem: { ownLinkPage: true },
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
  countRecordsByObject: { anyMember: true },
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
  // A view's footer calculations and a board's column totals (the CRM flow pass): object read, and the filter's
  // field checks through the compiler.
  aggregateMatches: { data: 'read' },
  aggregateGroups: { data: 'read' },
  getHistory: { data: 'read' },
  getValuesAsOf: { data: 'read' },
  getTimeInStages: { data: 'read' },
  getEntries: { data: 'read' },
  getRecordEntries: { data: 'read' },
  // Lists and their entries (spec 0048): a list follows its object (decision 2); hidden is absent.
  listLists: { data: 'read' },
  getList: { data: 'read' },
  listListAttributes: { data: 'read' },
  queryEntries: { data: 'read' },
  countEntries: { data: 'read' },
  readEntryPage: { data: 'read' },
  entryMembership: { data: 'read' },
  entriesForRecord: { data: 'read' },
  // A list's bulk jobs (AC-4817, AC-4825): the list's own write checks run inside.
  startAddMatching: { data: 'write' },
  startRemoveMatching: { data: 'write' },
  undoEntriesJob: { data: 'write' },
  // The record page (spec 0017): its timeline and a record in the trash.
  getActivity: { data: 'read' },
  // 13 Oct reference batch 4: a record's stage age, read as its timeline is.
  getStageSince: { data: 'read' },
  readTrashedRecord: { data: 'read' },
  // A record's own files (27 Oct 2026): keyed on the record, never on the submission a file came from, so a filed
  // file outlives its submission. The read refuses a record the member can't see and a field hidden from them; the
  // two writes are the member's upload onto a cell they may write.
  readRecordFile: { data: 'read' },
  prepareRecordFile: { data: 'write' },
  registerRecordFile: { data: 'write' },
  // The record picker's search (spec 0014): only records the reader may see.
  searchRecords: { data: 'read' },
  // A record page's related sections (spec 0014, milestone 3): only linked records the reader may see, on a side they may see.
  pageLinks: { data: 'read' },
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
  addListEntry: { data: 'write' },
  addListEntries: { data: 'write' },
  editEntry: { data: 'write' },
  removeEntries: { data: 'write' },
  restoreEntries: { data: 'write' },
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
  // Saved reports (the reports lane): shared with the workspace, shown to whoever may read the object and every
  // field the report names; changed by its maker or a holder of views.manage.
  listReports: { data: 'read' },
  createReport: { data: 'read' },
  updateReport: { data: 'read' },
  deleteReport: { data: 'read' },
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
  linkNote: { data: 'write' },
  // Comments (spec 0038): a thread follows its record; reading the record is enough to read and to comment (AC-1152).
  listThreads: { data: 'read' },
  getThreads: { data: 'read' },
  commentVersions: { data: 'read' },
  createComment: { data: 'read' },
  updateComment: { data: 'read' },
  deleteComment: { data: 'read' },
  setThreadResolved: { data: 'read' },
  toggleReaction: { data: 'read' },
  // The inbox (spec 0038): each member's own notifications and email settings, read and changed by any member.
  listNotifications: { anyMember: true },
  countUnread: { anyMember: true },
  markNotifications: { anyMember: true },
  markAllRead: { anyMember: true },
  getNotificationSettings: { anyMember: true },
  setNotificationSettings: { anyMember: true },
  // Calendar sync (spec 0024): a member's own connections only; a record's meetings through the record's door.
  listCalendarConnections: { anyMember: true },
  connectCalendar: { ownConnection: true },
  updateCalendarConnection: { ownConnection: true },
  removeCalendarConnection: { ownConnection: true },
  syncCalendarNow: { ownConnection: true },
  // Milestone 5: a member's own calendars only (spec 0037, AC-1306); a page's own destination through the page.
  listMemberCalendars: { anyMember: true },
  updateMemberCalendar: { ownConnection: true },
  setCalendarDestination: { ownConnection: true },
  dismissCalendarNotice: { anyMember: true },
  refreshCalendarConnection: { ownConnection: true },
  readPageDestination: { bookingPages: true },
  setPageDestination: { bookingPages: true },
  // Spec 0037 (AC-1307): any member, for the members in their reach; everyone else is left out, never refused.
  // Spec 0037, AC-1307: statuses for the members in See reach, everyone else left out.
  readCalendarHealth: { filtered: 'schedulingReach' },
  // Spec 0037, AC-1309: See over the member (owners and admins see everyone); the 24 hour limit inside.
  askToReconnect: { scheduling: 'view' },
  // Spec 0037, AC-1310: one episode's first email or reminder, the worker's task.
  runCalendarHealthEmail: { system: true },
  // A meeting a booking made shows its details only to who may see that booking (`booking/seen.ts`), else Busy.
  listMeetingsForRecord: { data: 'read' },
  meetingFacts: { system: true },
  // The member told of someone else's change to their scheduling (spec 0037, AC-1264): the worker's task.
  runSchedulingNotice: { system: true },
  // A queued webhook delivery, read and recorded by the worker's task (spec 0064, AC-6423).
  loadWebhookDelivery: { system: true },
  finishWebhookDelivery: { system: true },
  // Spec 0031, AC-817: the relay's read of whom a removal cuts off.
  removedUserIds: { system: true },
  // Spec 0007, AC-84: the relay's read of whom an `access` row disconnects with 4500.
  memberUserIds: { system: true },
  // Milestone 2: Add as person creates a person through the door (write on People, the record's own read first);
  // the workspace's calendar settings are read by any member and changed by owners and admins.
  addMeetingAttendee: { data: 'write' },
  readCalendarSettings: { anyMember: true },
  // Settings › Account › Preferences: a member's own, never another's; any other principal is FORBIDDEN.
  readMyPreferences: { anyMember: true },
  updateMyPreferences: { anyMember: true },
  updateCalendarSettings: { permission: 'workspace.manage' },
  // Automations (parity #53): all of it needs automations.manage; a run executes as the member the automation
  // runs as (`enterAsAutomation`), so the worker's part is the system's.
  listAutomations: { permission: 'automations.manage' },
  createAutomation: { permission: 'automations.manage' },
  updateAutomation: { permission: 'automations.manage' },
  setAutomationEnabled: { permission: 'automations.manage' },
  deleteAutomation: { permission: 'automations.manage' },
  restoreAutomation: { permission: 'automations.manage' },
  listAutomationRuns: { permission: 'automations.manage' },
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
  // Imports (spec 0040): write on the object to create, stage, start and undo (only the starter stages and starts;
  // the starter or jobs.manage undoes); the starter or jobs.manage reads one back. The job writes as the member.
  createImport: { data: 'write' },
  stageImportRows: { data: 'write' },
  startImport: { data: 'write' },
  undoImport: { data: 'write' },
  getImport: { data: 'read' },
  listImportRefusals: { data: 'read' },
  // The preview's unmatched names: write on the object, as only an importer asks; finds only readable records.
  checkImportLinks: { data: 'write' },
  // The preview's new and update counts: the same, finding only readable records.
  checkImportMatches: { data: 'write' },
  // Records exports (spec 0040): read on the object (and the view) to start; only the starter reads one back.
  startRecordsExport: { data: 'read' },
  getRecordsExport: { data: 'read' },
  getPublicForm: { publicForm: true },
  submitForm: { publicForm: true },
  postingRules: { publicForm: true },
  // A visitor's file for a form question (spec 0023's uploads): the same public form scope as the submission it
  // belongs to, and each one refuses outright unless the scope is that very form's (`ownForm`).
  prepareUpload: { publicForm: true },
  registerUpload: { publicForm: true },
  discardUpload: { publicForm: true },
  // The member's download of one. Its own read decides, by the submission the file is attached to: the form's
  // objects, its main record, or `forms.manage` where a submission made no record.
  readUpload: { data: 'read' },
  // Booking pages (spec 0025).
  listBookingPages: { bookingPages: true },
  // Where a page's answers may be filed (spec 0057): a page the reader may change, and People's attributes as
  // they may write them, so it is the booking pages check and the reader's own data reach together.
  bookingPageAttributes: { bookingPages: true },
  getBookingPage: { bookingPages: true },
  createBookingPage: { bookingPages: true },
  updateBookingPage: { bookingPages: true },
  deleteBookingPage: { bookingPages: true },
  // The owner's profile order (owner ask A102): their own pages alone, whoever else may change them.
  reorderProfilePages: { bookingPages: true },
  listBookings: { bookingPages: true },
  listWorkspaceBookings: { bookingPages: true },
  listMeetings: { bookingPages: true },
  readBookingsCalendar: { bookingPages: true },
  // Home (spec 0041): Team today is scheduling (Bookings' gate), only the members `canActFor` views (a member: themself),
  // a booking's title only to who may see it (`booking/seen.ts`); the metrics any member, each figure by its own rule.
  readTeamToday: { bookingPages: true },
  readHomeMetrics: { anyMember: true },
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
  createTimeBlock: { scheduling: 'manage' },
  removeTimeBlock: { scheduling: 'manage' },
  // Time off (spec 0037, AC-1282, AC-1286): read with See (reason and note with Manage), changed with Manage; the
  // caller's own `booking.manage` first.
  listTimeOff: { scheduling: 'view' },
  createTimeOff: { scheduling: 'manage' },
  updateTimeOff: { scheduling: 'manage' },
  deleteTimeOff: { scheduling: 'manage' },
  // Meeting limits (spec 0037, AC-1297, AC-1299): read with See, set with Manage over the member's hours (their own
  // with `availability.own`).
  getLimits: { scheduling: 'view' },
  setLimits: { scheduling: 'manage' },
  // New meeting's warning (job J7's follow up): Manage, the reach booking in for someone takes.
  limitsAt: { scheduling: 'manage' },
  // The Team week (spec 0037, AC-1289 to AC-1293): rows from the reader's See reach (themself at least); a cell, a
  // copied week and usual hours need Manage over each member's hours (their own with `availability.own`).
  readTeamWeek: { filtered: 'schedulingReach' },
  setDayHours: { scheduling: 'manage' },
  copyWeek: { scheduling: 'manage' },
  setUsualHours: { scheduling: 'manage' },
  bookAsHost: { scheduling: 'manage' },
  // Changing a booking from Bookings (spec 0025, milestone 2): booking.manage first, then the booking's row.
  hostTarget: { bookingPages: true },
  bookingGuestPath: { bookingPages: true },
  // A no show (spec 0043) and a hand link to a record (polish F2): through the booking's target too.
  markNoShow: { bookingPages: true },
  linkBookingRecord: { bookingPages: true },
  // Round robin (spec 0029): anyone with booking.manage lists the rotations they're in (their own count only);
  // making, changing and deleting them is booking.admin's (AC-751). A booking's assignments: its host or an admin.
  listRotations: { bookingPages: true },
  createRotation: { permission: 'booking.admin' },
  updateRotation: { permission: 'booking.admin' },
  deleteRotation: { permission: 'booking.admin' },
  bookingAssignments: { bookingPages: true },
  // Reassigning a seat (AC-748, AC-1337): booking.manage, then Manage over the current and the new host.
  reassignBooking: { bookingPages: true },
  // The Distribution tab (spec 0037, AC-1330): a member of the rotation sees their own row, an admin every row.
  rotationDistribution: { bookingPages: true },
  // A member's upcoming bookings in a rotation handed on (AC-750): Manage over them and every member it could hand to.
  reassignUpcoming: { scheduling: 'manage' },
  // Count adjustments (AC-1329): booking.admin's until rotation editors arrive (J14).
  adjustCount: { permission: 'booking.admin' },
  undoAdjustment: { permission: 'booking.admin' },
  // Scheduling access (spec 0037, J1): delegations, and the members in See reach (`members.visible`, AC-1261).
  listDelegations: { delegation: true },
  grantDelegation: { delegation: true },
  revokeDelegation: { delegation: true },
  listVisibleMembers: { filtered: 'schedulingReach' },
} as const satisfies Record<string, AccessEntry>;
