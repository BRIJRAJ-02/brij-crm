// Runs once before this package's tests: fresh, migrated databases, dropped again on the way out.
import type { TestProject } from 'vitest/node';
import { dropTestDatabase, prepareTestDatabase, type TestDatabase } from '@crm/db/testing';

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const shared = await prepareTestDatabase('crm_test_core');
  const locking = await prepareTestDatabase('crm_test_core_locking');
  project.provide('testDatabase', shared);
  project.provide('lockingDatabase', locking);
  return async () => {
    await Promise.all([dropTestDatabase(shared), dropTestDatabase(locking)]);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The database every test file shares, files running at once. */
    testDatabase: TestDatabase;
    /**
     * A database for the one file that locks a whole table (query.test.ts locks
     * `records` so a read waits until it is cancelled, AC-15). In the shared
     * database that lock queued behind any other file's open transaction, and
     * while queued it stalled every other file's reads and writes of records,
     * so files timed out together on a slow runner.
     */
    lockingDatabase: TestDatabase;
  }
}
