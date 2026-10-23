// Vercel Cron's run of the jobs (spec 0045; the calendar sync lane, 23 October
// 2026), end to end against the job drain's own test database: the function
// built from a preview's environment with `CRON_SECRET` set takes Vercel
// Cron's `GET /api/internal/jobs/run` with `Authorization: Bearer
// <CRON_SECRET>` through the edge, runs the scheduled turn on the worker
// login (a due booking email included), answers its report, and logs it
// `by: cron`, never the secret.
import { testQuery } from '@crm/db/testing';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { BOOKING_MAIL_TASK } from '../jobs/booking-mail.ts';
import { EDGE_HEADER } from '../edge.ts';
import { captureLogs, TEST_EDGE_SECRET } from '../testing.ts';
import { createFunctionApi, JOBS_RUN_PATH, SCHEDULED_MINIMUM_MS } from './handler.ts';

const { appUrl, identityUrl, workerUrl, ownerUrl } = inject('drainDatabase');
const CRON_SECRET = 'a-vercel-cron-secret-of-at-least-32-characters';

/** A preview deployment's variables on Vercel, on the drain's test database, with Vercel Cron's secret set. */
const env: Record<string, string> = {
  VERCEL: '1',
  VERCEL_GIT_COMMIT_SHA: '5332cb46565e22105f3ebdc1e249337ba0ab4a7d',
  APP_ENV: 'preview',
  NODE_ENV: 'production',
  DATABASE_URL: appUrl,
  IDENTITY_DATABASE_URL: identityUrl,
  DATABASE_URL_DIRECT: workerUrl,
  APP_URL: 'https://app.test',
  BETTER_AUTH_URL: 'https://app.test',
  BETTER_AUTH_SECRET: 'a-preview-better-auth-secret-of-32-characters',
  EDGE_SECRET: TEST_EDGE_SECRET,
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Timefix <sign-in@app.test>',
  WORKER_WAKE_SECRET: 'a-worker-wake-secret-of-at-least-32-characters',
  FORMS_IP_SALT: 'a-forms-ip-salt-of-at-least-32-characters',
  JOBS_RUN_SECRET: 'a-jobs-run-secret-of-at-least-32-characters',
  CRON_SECRET,
};

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  await testQuery(ownerUrl, 'delete from graphile_worker._private_jobs');
  logs = captureLogs();
});
afterEach(() => {
  logs.restore();
});

describe('Vercel Cron’s run of the jobs', () => {
  it('runs the scheduled turn for a GET with the bearer, answers its report, and logs it by cron', async () => {
    const kept: Promise<unknown>[] = [];
    const api = createFunctionApi(env, { keepAlive: (work) => void kept.push(work) });
    // A booking email due now, of a booking that no longer exists: the task finds nothing to send and ends.
    await testQuery(
      ownerUrl,
      `select graphile_worker.add_job($1, json_build_object('workspaceId', gen_random_uuid(),
         'bookingId', gen_random_uuid(), 'kind', 'confirmed'), max_attempts => 1)`,
      [BOOKING_MAIL_TASK],
    );
    const response = await api.fetch(
      new Request(`https://app.test${JOBS_RUN_PATH}`, {
        headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    await Promise.all(kept);
    expect(response.status).toBe(200);
    const report = (await response.json()) as { status: string; outcome: string; ms: number };
    expect(report).toMatchObject({ status: 'ok', outcome: 'idle' });
    expect(report.ms).toBeGreaterThanOrEqual(SCHEDULED_MINIMUM_MS);
    // The due row ran and finished: it has left the queue.
    const left = await testQuery<{ count: number }>(
      ownerUrl,
      `select count(*)::int as count from graphile_worker._private_jobs j
       join graphile_worker._private_tasks t on t.id = j.task_id where t.identifier = $1`,
      [BOOKING_MAIL_TASK],
    );
    expect(left[0]?.count).toBe(0);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ message: 'jobs.drain', outcome: 'idle', by: 'cron' }),
    );
    expect(JSON.stringify(logs.lines())).not.toContain(CRON_SECRET);
  });
});
