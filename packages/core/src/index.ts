// Domain services, shared by the api and the worker. No HTTP in here.
// One folder per feature; the access door (spec 0005, thin #9) is `access/`.
export { getSystemStatus, type SystemDeps } from './system/status.ts';
export * from './engine/index.ts';
export {
  enterWithKey,
  enterWorkspace,
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
export { getMe, startWorkspace, type AccountUser, type StartWorkspaceDeps } from './account/account.ts';
export { listObjects } from './objects/objects.ts';
export { addAttribute, listObjectAttributes, type AddAttributeInput } from './attributes/attributes.ts';
export {
  addRecord,
  editRecord,
  queryRecords,
  readRecordsById,
  type AddRecordInput,
  type EditRecordInput,
  type RecordWindow,
} from './records/records.ts';
export { getMyAccess, listMembers, removeMember, setMemberRole, type MemberWithRole } from './members/members.ts';
