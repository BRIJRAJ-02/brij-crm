// Runs once before this package's tests: fresh, migrated databases.
import type { TestProject } from 'vitest/node';
import { prepareTestDatabase, type TestDatabase } from '@crm/db/testing';

export async function setup(project: TestProject): Promise<void> {
  project.provide('testDatabase', await prepareTestDatabase('crm_test_core'));
  project.provide('lockingDatabase', await prepareTestDatabase('crm_test_core_locking'));
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
