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
   * Booking pages (spec 0025): `booking.manage` first (403 `FORBIDDEN`), then the reader's own pages, or anyone's
   * with `booking.admin`; another's page answers as absent.
   */
  | { readonly bookingPages: true };

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
  listMembers: { anyMember: true },
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
  getHistory: { data: 'read' },
  getValuesAsOf: { data: 'read' },
  getTimeInStages: { data: 'read' },
  getEntries: { data: 'read' },
  getRecordEntries: { data: 'read' },
  // The record page (spec 0017): its timeline and a record in the trash.
  getActivity: { data: 'read' },
  readTrashedRecord: { data: 'read' },
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
  createTask: { data: 'write' },
  updateTask: { data: 'write' },
  taskFacts: { system: true },
  // Booking pages (spec 0025).
  listBookingPages: { bookingPages: true },
  getBookingPage: { bookingPages: true },
  createBookingPage: { bookingPages: true },
  updateBookingPage: { bookingPages: true },
  deleteBookingPage: { bookingPages: true },
  listBookings: { bookingPages: true },
  getMemberHours: { bookingPages: true },
  setMemberHours: { bookingPages: true },
} as const satisfies Record<string, AccessEntry>;
