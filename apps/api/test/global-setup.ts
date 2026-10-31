// Runs once before this app's tests: fresh, migrated databases, dropped again on the way out.
import type { TestProject } from 'vitest/node';
import { dropTestDatabase, prepareTestDatabase, type TestDatabase } from '@crm/db/testing';

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const shared = await prepareTestDatabase('crm_test_api');
  const sleep = await prepareTestDatabase('crm_test_api_sleep');
  const drain = await prepareTestDatabase('crm_test_api_drain');
  const relay = await prepareTestDatabase('crm_test_api_relay');
  project.provide('testDatabase', shared);
  project.provide('sleepDatabase', sleep);
  project.provide('drainDatabase', drain);
  project.provide('relayDatabase', relay);
  return async () => {
    await Promise.all([dropTestDatabase(shared), dropTestDatabase(sleep), dropTestDatabase(drain), dropTestDatabase(relay)]);
  };
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
    /**
     * A database for the job drain test (spec 0045) alone: a drain runs every
     * due row of its tasks, so it must not meet what other files left queued.
     */
    drainDatabase: TestDatabase;
    /**
     * A database for the relay test alone: the relay reads every workspace's outbox, and other files leave
     * workspaces whose stored access rules (spec 0032) split them into more than one audience. Until the relay
     * publishes a channel per audience (spec 0007, milestone 4) it holds such a workspace's rows back, so in the
     * shared database those rows kept it awake, named them stuck and doubled its one warning.
     */
    relayDatabase: TestDatabase;
  }
}
