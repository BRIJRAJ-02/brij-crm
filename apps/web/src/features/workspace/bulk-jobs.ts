// Which background jobs are bulk changes (spec 0022, milestone 3). main.tsx
// reads it when a job of this browser ends, to load the bulk finish toast
// (bulk-finished.ts) only then; bulk.ts names each kind's action.

/** The bulk job kinds by what they do (spec 0022, milestone 3). */
export const BULK_JOB_ACTIONS = {
  'records.bulk_edit': 'edit',
  'records.bulk_delete': 'delete',
  'records.bulk_restore': 'restore',
  'records.purge': 'purge',
  // A list's bulk changes (spec 0048): adding many records, removing many entries, and bringing them back.
  'entries.bulk_add': 'listAdd',
  'entries.bulk_remove': 'listRemove',
  'entries.bulk_restore': 'listRestore',
} as const;

/** What a bulk job does: one of the record actions, or a list's. */
export type BulkJobAction = (typeof BULK_JOB_ACTIONS)[keyof typeof BULK_JOB_ACTIONS];

/** What a bulk job does, or undefined for any other kind. */
export function bulkActionOf(kind: string): BulkJobAction | undefined {
  return Object.hasOwn(BULK_JOB_ACTIONS, kind) ? BULK_JOB_ACTIONS[kind as keyof typeof BULK_JOB_ACTIONS] : undefined;
}
