// Runs once before this package's tests: a fresh, migrated database, dropped again on the way out.
import type { TestProject } from 'vitest/node';
import { dropTestDatabase, prepareTestDatabase, type TestDatabase } from '../src/testing.ts';

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await prepareTestDatabase('crm_test_db');
  project.provide('testDatabase', database);
  return async () => {
    await dropTestDatabase(database);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: TestDatabase;
  }
}
