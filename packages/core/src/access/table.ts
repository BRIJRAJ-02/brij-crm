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
 * workspace (the member list, your own access), or the system only.
 */
export type AccessEntry =
  | { readonly permission: Permission }
  | { readonly data: 'read' | 'write' }
  | { readonly ownerRules: true }
  | { readonly anyMember: true }
  | { readonly system: true };

/** Every exported service that takes a scope, and what it checks. */
export const ACCESS_TABLE = {
  // Definitions: schema.manage (AC-135).
  defineObject: { permission: 'schema.manage' },
  updateObject: { permission: 'schema.manage' },
  setObjectArchived: { permission: 'schema.manage' },
  defineAttribute: { permission: 'schema.manage' },
  addAttribute: { permission: 'schema.manage' },
  updateAttribute: { permission: 'schema.manage' },
  archiveAttribute: { permission: 'schema.manage' },
  restoreAttribute: { permission: 'schema.manage' },
  defineOption: { permission: 'schema.manage' },
  updateOption: { permission: 'schema.manage' },
  defineRelationship: { permission: 'schema.manage' },
  defineList: { permission: 'schema.manage' },
  // Removing records for good.
  eraseRecord: { permission: 'records.purge' },
  purgeDeleted: { permission: 'records.purge' },
  // Members.
  setMemberRole: { ownerRules: true },
  removeMember: { ownerRules: true },
  listMembers: { anyMember: true },
  getMyAccess: { anyMember: true },
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
  // Record and entry writes.
  createRecord: { data: 'write' },
  addRecord: { data: 'write' },
  setValues: { data: 'write' },
  setRecordValues: { data: 'write' },
  setValuesBatch: { data: 'write' },
  editRecord: { data: 'write' },
  deleteRecord: { data: 'write' },
  restoreRecord: { data: 'write' },
  addEntry: { data: 'write' },
  removeEntry: { data: 'write' },
  restoreEntry: { data: 'write' },
  // The relay's read (`@crm/core/system`).
  audiences: { system: true },
} as const satisfies Record<string, AccessEntry>;
