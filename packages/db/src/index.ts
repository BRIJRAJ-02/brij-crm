export {
  createDatabase,
  type Database,
  type DatabaseHealth,
  type DatabaseOptions,
  VACUUM_TABLES,
  type VacuumTable,
  type WorkspaceTx,
} from './client.ts';
export { assertDirectUrl, openDirectConnection } from './direct.ts';
export { createOutboxReader, OUTBOX_CHANNEL, type OutboxReader, type OutboxRow } from './outbox.ts';
export { OUTBOX_RETENTION } from './schema/outbox.ts';
export { addWorkspaceToDirectory, DIRECTORY_SLUG_CONSTRAINT, type DirectoryEntry } from './identity/directory.ts';
export {
  createIdentityStore,
  type AuthDatabase,
  type DirectoryWorkspace,
  type IdentityStore,
  type IdentityUser,
  type RateLimitDecision,
  type RateLimitRule,
} from './identity/store.ts';
export * as schema from './schema/index.ts';
