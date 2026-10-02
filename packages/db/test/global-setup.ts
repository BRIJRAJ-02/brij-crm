// Runs once before this package's tests: a fresh, migrated database.
import type { TestProject } from 'vitest/node';
import { prepareTestDatabase, type TestDatabase } from '../src/testing.ts';

export async function setup(project: TestProject): Promise<void> {
  project.provide('testDatabase', await prepareTestDatabase('crm_test_db'));
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: TestDatabase;
  }
}
