// The one way the engine writes (spec 0004, AC-13, AC-17): one transaction
// inside withWorkspace(), the changes it made collected as it goes, then every
// afterWrite hook in the same transaction. #7 adds the outbox hook and #36 the
// audit hook; a hook that throws rolls the whole write back.
import type { WorkspaceTx } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import { isRefusal, postgresError } from './refusals.ts';
import type { Actor, EngineScope } from './scope.ts';

/** One attribute's value that changed on a record or a list entry. */
export interface ValueChange {
  readonly ownerId: string;
  readonly ownerKind: 'record' | 'entry';
  readonly attributeId: string;
  /** The new version, shared by every item row this write made for the attribute. */
  readonly versionId: string;
  /** When the edit started from an older version: the version and actor it replaced (AC-12). */
  readonly replaced?: { readonly versionId: string; readonly setBy: Actor };
}

/** Everything one write landed, as the hooks see it. */
export interface Change {
  readonly kind: 'write' | 'erasure';
  readonly workspaceId: string;
  readonly actor: Actor;
  readonly createdRecords: readonly string[];
  readonly deletedRecords: readonly string[];
  readonly restoredRecords: readonly string[];
  readonly createdEntries: readonly string[];
  readonly removedEntries: readonly string[];
  readonly restoredEntries: readonly string[];
  readonly values: readonly ValueChange[];
}

/** The lists of a change that a write step adds to. */
type ChangeLists = Omit<Change, 'kind' | 'workspaceId' | 'actor'>;
const LIST_KEYS = [
  'createdRecords',
  'deletedRecords',
  'restoredRecords',
  'createdEntries',
  'removedEntries',
  'restoredEntries',
  'values',
] as const satisfies readonly (keyof ChangeLists)[];

/** A step that runs after the write, inside its transaction (the outbox, the audit log). */
export type AfterWrite = (change: Change, tx: WorkspaceTx) => Promise<void>;

/** What a write step gets: the transaction, the scope, and a place to record what it changed. */
export interface WriteContext {
  readonly tx: WorkspaceTx;
  readonly scope: EngineScope;
  /** Notes a change, for the hooks. */
  record(part: Partial<ChangeLists>): void;
  /**
   * Runs one record's part of a batch under its own savepoint. A refusal rolls
   * back only that part, and its changes are left out of what the hooks see.
   */
  perRecord<T>(
    work: (tx: WorkspaceTx) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; refusals: readonly EngineRefusal[] }>;
}

/** The deadlock and serialisation failures a fresh attempt can get past. */
const RETRYABLE = new Set(['40P01', '40001']);
const ATTEMPTS = 3;

/**
 * Runs `work` as one transaction in the scope's workspace, then the hooks.
 * Retries the whole transaction up to 3 times on a deadlock or a
 * serialisation failure. A refusal or any other error rolls it all back.
 */
export async function runWrite<T>(
  scope: EngineScope,
  work: (context: WriteContext) => Promise<T>,
  hooks: readonly AfterWrite[] = [],
  kind: Change['kind'] = 'write',
): Promise<{ result: T; change: Change }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await scope.db.withWorkspace(scope.workspaceId, async (tx) => {
        // Collected as the write goes; local to this attempt, so nothing outlives it.
        const collected = {
          createdRecords: [] as string[],
          deletedRecords: [] as string[],
          restoredRecords: [] as string[],
          createdEntries: [] as string[],
          removedEntries: [] as string[],
          restoredEntries: [] as string[],
          values: [] as ValueChange[],
        };
        const context: WriteContext = {
          tx,
          scope,
          record(part) {
            collected.createdRecords.push(...(part.createdRecords ?? []));
            collected.deletedRecords.push(...(part.deletedRecords ?? []));
            collected.restoredRecords.push(...(part.restoredRecords ?? []));
            collected.createdEntries.push(...(part.createdEntries ?? []));
            collected.removedEntries.push(...(part.removedEntries ?? []));
            collected.restoredEntries.push(...(part.restoredEntries ?? []));
            collected.values.push(...(part.values ?? []));
          },
          async perRecord(step) {
            const marks = LIST_KEYS.map((key) => collected[key].length);
            try {
              const value = await tx.transaction((savepoint) => step(savepoint));
              return { ok: true, value };
            } catch (error) {
              if (!isRefusal(error)) throw error;
              LIST_KEYS.forEach((key, index) => {
                collected[key].length = marks[index] ?? 0;
              });
              return { ok: false, refusals: error.refusals };
            }
          },
        };
        const result = await work(context);
        const change: Change = {
          kind,
          workspaceId: scope.workspaceId,
          actor: scope.actor,
          createdRecords: [...collected.createdRecords],
          deletedRecords: [...collected.deletedRecords],
          restoredRecords: [...collected.restoredRecords],
          createdEntries: [...collected.createdEntries],
          removedEntries: [...collected.removedEntries],
          restoredEntries: [...collected.restoredEntries],
          values: [...collected.values],
        };
        for (const hook of hooks) await hook(change, tx);
        return { result, change };
      });
    } catch (error) {
      const code = postgresError(error)?.code;
      if (attempt < ATTEMPTS && code !== undefined && RETRYABLE.has(code)) continue;
      throw error;
    }
  }
}
