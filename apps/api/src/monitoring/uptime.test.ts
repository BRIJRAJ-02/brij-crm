// The uptime monitor's target (spec 0010, AC-171): Sentry calls
// `/api/health` through Vercel every 5 minutes, so it must answer from the
// process alone. A probe that touched Postgres would keep Neon's free compute
// awake around the clock; this one never reaches the database, and is never
// traced (AC-170).
import type { Database } from '@crm/db';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER } from '../edge.ts';
import { TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { requestSampleRate } from './tracing.ts';

/** A database that records every use of it, and answers none. */
function watchedDatabase(): { db: Database; touched: string[] } {
  const touched: string[] = [];
  const db = new Proxy({} as Database, {
    get: (_target, property) => {
      touched.push(String(property));
      return () => Promise.reject(new Error('The uptime probe reached the database.'));
    },
  });
  return { db, touched };
}

describe('GET /api/health, the uptime target (AC-171)', () => {
  it('answers ok in production, through the edge, without touching the database', async () => {
    const env = testEnv({ APP_ENV: 'production', RAILWAY_GIT_COMMIT_SHA: 'abc1234' });
    const { db, touched } = watchedDatabase();
    const app = createApp({ services: testServices(env, { db }), env });
    for (let probe = 0; probe < 3; probe += 1) {
      const answer = await app.fetch(
        new Request('https://brij-crm-phi.vercel.app/api/health', { headers: { [EDGE_HEADER]: TEST_EDGE_SECRET } }),
      );
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ status: 'ok', release: 'abc1234' });
    }
    expect(touched).toEqual([]);
  });

  it('is never traced, so the probe costs no trace quota', () => {
    const probe = { attributes: { 'sentry.op': 'http.server', 'url.path': '/api/health' } };
    expect(requestSampleRate('production', probe)).toBe(0);
  });
});
