// Drizzle tables live here, one file per area, re-exported from this index.
// Every tenant table carries workspace_id, forces row level security (the
// policies are hand written in migrations/), and has a primary key and indexes
// that lead with workspace_id (spec 0004).
export { actorType, attributeType, systemColumn } from './common.ts';
export { memberStatus, members, workspaceCounters, workspaces } from './workspaces.ts';
export { attributes, lists, objects, relationshipCardinality, relationships } from './definitions.ts';
export { attributeOptions, optionOutcome } from './options.ts';
export { listEntries, recordLinks, records, sortKeys, values } from './records.ts';
