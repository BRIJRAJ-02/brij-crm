// Runs once before this app's tests: fresh, migrated databases.
import type { TestProject } from 'vitest/node';
import { prepareTestDatabase, type TestDatabase } from '@crm/db/testing';

export async function setup(project: TestProject): Promise<void> {
  project.provide('testDatabase', await prepareTestDatabase('crm_test_api'));
  project.provide('sleepDatabase', await prepareTestDatabase('crm_test_api_sleep'));
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: TestDatabase;
    /**
     * A database for the worker sleep test (spec 0008, milestone 3) alone: the
     * worker sleeps only when no queue row is due and no outbox row waits, and
     * the shared database keeps what every other file left behind.
     */
    sleepDatabase: TestDatabase;
  }
}
