// A worker process for the restart tests (`src/jobs/restart.test.ts`, spec
// 0008, AC-103): the real Graphile runners and the core runner with the
// worker's own wiring, plus the effects kinds, on the test database. It stops
// as the worker does on SIGTERM (the slices in hand finish their batch and
// hand their jobs back), and a test may SIGKILL it instead. No Vitest here:
// it runs on Node, logging JSON lines as the worker does.
//
// Env: JOBS_TEST_DATABASE_URL (the app login), JOBS_TEST_DIRECT_URL (the
// worker login), and the shortened timings JOBS_TEST_SLICE_MS,
// JOBS_TEST_LEASE_MS, JOBS_TEST_STALE_SECONDS, JOBS_TEST_HOUSEKEEPING_MS.
import { createDatabase, openQueueConnection } from '@crm/db';
import * as z from 'zod';
import { startJobRunners } from '../src/jobs/graphile.ts';
import { createJobRunner } from '../src/jobs/runner.ts';
import { log } from '../src/log.ts';
import { APP_RULES } from '../src/rules.ts';
import { onShutdown } from '../src/shutdown.ts';
import { restartRegistry } from './jobs-kinds.ts';

const Env = z.object({
  JOBS_TEST_DATABASE_URL: z.url(),
  JOBS_TEST_DIRECT_URL: z.url(),
  JOBS_TEST_SLICE_MS: z.coerce.number().int().min(0).default(20_000),
  JOBS_TEST_LEASE_MS: z.coerce.number().int().min(1).default(60_000),
  JOBS_TEST_STALE_SECONDS: z.coerce.number().int().min(1).default(120),
  JOBS_TEST_HOUSEKEEPING_MS: z.coerce.number().int().min(100).default(60_000),
});
const env = Env.parse(process.env);

const db = createDatabase({
  url: env.JOBS_TEST_DATABASE_URL,
  applicationName: 'crm-jobs-test-worker',
  maxConnections: 8,
});
const queue = openQueueConnection({ url: env.JOBS_TEST_DIRECT_URL, applicationName: 'crm-jobs-test-queue', max: 4 });
const runners = await startJobRunners({
  queue,
  runner: createJobRunner({
    db,
    registry: restartRegistry(),
    rules: APP_RULES,
    log,
    timings: { sliceMs: env.JOBS_TEST_SLICE_MS, leaseMs: env.JOBS_TEST_LEASE_MS },
  }),
  log,
  pollInterval: 200,
  staleLockSeconds: env.JOBS_TEST_STALE_SECONDS,
  housekeepingMs: env.JOBS_TEST_HOUSEKEEPING_MS,
});

onShutdown(async () => {
  await runners.stop();
  await queue.close();
  await db.close();
});
