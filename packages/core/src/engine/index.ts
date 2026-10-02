// The data engine (spec 0004): one storage path for every object, typed
// values with history, and the query engine. Services take an EngineScope;
// the access door (#9) puts itself in front of them.
export { defineAttribute, defineObject, type AttributeInput, type ObjectInput } from './definitions.ts';
export { isUuidV7, newId } from './ids.ts';
export { decodeCursor, encodeCursor, MAX_PAGE, queryPage, type Page, type PageQuery } from './query/page.ts';
export {
  createRecord,
  getRecords,
  setValues,
  type AttributeResult,
  type RecordInput,
  type RecordView,
  type ValueInput,
} from './records.ts';
export { isRefusal, type RefusalError } from './refusals.ts';
export { SYSTEM_ACTOR, type Actor, type EngineScope } from './scope.ts';
export { createWorkspace, type CreatedWorkspace, type WorkspaceInput } from './workspaces.ts';
export { runWrite, type AfterWrite, type Change, type ValueChange, type WriteContext } from './write.ts';
