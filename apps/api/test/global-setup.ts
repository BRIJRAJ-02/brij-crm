// Runs once before this app's tests: a fresh, migrated database.
import type { TestProject } from 'vitest/node';
import { prepareTestDatabase, type TestDatabase } from '@crm/db/testing';

export async function setup(project: TestProject): Promise<void> {
  project.provide('testDatabase', await prepareTestDatabase('crm_test_api'));
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: TestDatabase;
  }
}
