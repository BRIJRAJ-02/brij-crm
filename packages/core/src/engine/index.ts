// The data engine (spec 0004): one storage path for every object, typed
// values with history, and the query engine. Services take an EngineScope;
// the access door (#9) puts itself in front of them.
export {
  archiveAttribute,
  defineAttribute,
  defineObject,
  listAttributes,
  restoreAttribute,
  setObjectArchived,
  updateAttribute,
  updateObject,
  type AttributeInput,
  type AttributeUpdate,
  type ObjectInput,
  type ObjectUpdate,
} from './definitions.ts';
export {
  deleteRecord,
  eraseRecord,
  purgeDeleted,
  restoreRecord,
  type RecordState,
  type RemovedCounts,
} from './deletion.ts';
export { getHistory, getTimeInStages, getValuesAsOf, type HistoryOwner, type StageVisit } from './history.ts';
export { isUuidV7, newId } from './ids.ts';
export { LIMITS, RESTORE_WINDOW, type Limits } from './limits.ts';
export {
  addEntry,
  defineList,
  getEntries,
  getRecordEntries,
  removeEntry,
  restoreEntry,
  type EntryInput,
  type EntryView,
  type ListInput,
} from './lists.ts';
export {
  defineOption,
  listOptions,
  updateOption,
  type OptionInput,
  type OptionOutcome,
  type OptionUpdate,
} from './options.ts';
export { type QueryClock, type WeekStart } from './query/compile.ts';
export {
  COUNT_CAP,
  countMatches,
  decodeCursor,
  encodeCursor,
  MAX_PAGE,
  queryPage,
  type MatchCount,
  type Page,
  type PageQuery,
  type ViewSource,
} from './query/page.ts';
export {
  createRecord,
  getRecords,
  MAX_BATCH,
  setValues,
  setValuesBatch,
  type AttributeResult,
  type BatchResult,
  type EntryValues,
  type RecordInput,
  type RecordValues,
  type RecordView,
  type ValueInput,
} from './records.ts';
export {
  inputInvalid,
  isInputError,
  isRefusal,
  type InputError,
  type InputProblem,
  type RefusalError,
} from './refusals.ts';
export {
  defineRelationship,
  LINK_CELL_CAP,
  type Cardinality,
  type RelationshipEnd,
  type RelationshipInput,
} from './relationships.ts';
export { SYSTEM_ACTOR, type Actor, type EngineScope } from './scope.ts';
export {
  createUserWorkspace,
  createWorkspace,
  type CreatedWorkspace,
  type UserWorkspace,
  type UserWorkspaceInput,
  type WorkspaceInput,
} from './workspaces.ts';
export {
  CHANGE_CAP,
  capChange,
  cappedHook,
  runWrite,
  type AfterWrite,
  type CappedChange,
  type CappedStep,
  type Change,
  type RecordRef,
  type ReferenceChange,
  type ValueChange,
  type WriteContext,
} from './write.ts';
