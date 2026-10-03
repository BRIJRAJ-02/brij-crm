// Domain services, shared by the api and the worker. No HTTP in here.
// One folder per feature; the access door (spec 0005, thin #9) is `access/`.
export { getSystemStatus, type SystemDeps } from './system/status.ts';
export * from './engine/index.ts';
export { enterWorkspace, type DoorDeps, type DoorInput } from './access/door.ts';
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
export { listMembers } from './members/members.ts';
