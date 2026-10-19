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
export {
  getMe,
  startWorkspace,
  type AccountUser,
  type StartedWorkspace,
  type StartWorkspaceDeps,
} from './account/account.ts';
export { milestoneHook, type ReachedMilestone } from './milestones/milestones.ts';
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
  createTask,
  getTasks,
  listTasks,
  updateTask,
  type CreateTaskInput,
  type ListTasksInput,
  type UpdateTaskInput,
} from './tasks/tasks.ts';
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
