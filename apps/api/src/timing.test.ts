// The load harness's timing header (spec 0011, AC-202, AC-212): with the
// request timing on, every /api/rpc answer carries `Server-Timing` with the
// request's pool wait, its database time and the whole handler, and the pools
// report to the request that made each checkout; without it no answer carries
// the header at all.
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from './app.ts';
import { signInApp, rpcPost, testConnections } from '../test/sign-in.ts';
import { memberWithWorkspace } from '../test/workspace.ts';
import { testEnv, testServices } from './testing.ts';
import { createRequestTiming, serverTiming } from './timing.ts';

const TIMING = /^pool;dur=(\d+\.\d), db;dur=(\d+\.\d), app;dur=(\d+\.\d)$/;

/** The header's three durations, or undefined when it is absent or malformed. */
function durations(response: Response): { pool: number; db: number; app: number } | undefined {
  const match = TIMING.exec(response.headers.get('server-timing') ?? '');
  if (match === null) return undefined;
  return { pool: Number(match[1]), db: Number(match[2]), app: Number(match[3]) };
}

describe('serverTiming', () => {
  it('writes the three durations in milliseconds, one decimal each', () => {
    expect(serverTiming({ pool: 0.04, db: 12.345, app: 20 })).toBe('pool;dur=0.0, db;dur=12.3, app;dur=20.0');
  });
});

describe('the timing header', () => {
  const { appUrl, identityUrl } = inject('testDatabase');
  const timing = createRequestTiming();
  let timed: { db: Database; identity: IdentityStore };
  let plain: { db: Database; identity: IdentityStore };

  beforeAll(() => {
    timed = {
      db: createDatabase({ url: appUrl, applicationName: 'crm-api-timing-tests', timing: timing.current }),
      identity: createIdentityStore({
        url: identityUrl,
        applicationName: 'crm-api-timing-tests',
        timing: timing.current,
      }),
    };
    plain = testConnections();
  });
  afterAll(async () => {
    await Promise.all([timed.db.close(), timed.identity.close(), plain.db.close(), plain.identity.close()]);
  });

  /** The app as the load stack runs it, with LOAD_TIMING=on. */
  function timedApp() {
    const env = testEnv({ LOAD_TIMING: 'on' });
    return createApp({ services: { ...testServices(env, timed), timing }, env });
  }

  it('times every RPC answer: its pool wait, its database time and the whole handler', async () => {
    const member = await memberWithWorkspace(signInApp(plain).app);
    const app = timedApp();
    const people = JSON.stringify({ workspace: member.slug, objectId: member.people.id, limit: 50 });
    const answer = await rpcPost(app, member.cookie, 'records/query', people);
    expect(answer.status).toBe(200);
    const read = durations(answer);
    expect(read).toBeDefined();
    // The session check and the read each held a client; the handler took at least as long as both.
    expect(read?.db).toBeGreaterThan(0);
    expect(read?.app).toBeGreaterThanOrEqual((read?.db ?? 0) - 0.1);
    // A refusal is timed too.
    const refused = await rpcPost(app, member.cookie, 'records/query', JSON.stringify({ workspace: member.slug }));
    expect(refused.status).toBe(400);
    expect(durations(refused)).toBeDefined();
    // Even an answer that never reached the database names a zero pool wait.
    const signedOut = await rpcPost(app, '', 'me/get', '{}');
    expect(durations(signedOut)?.pool).toBeGreaterThanOrEqual(0);
  });

  it('is never sent without the request timing', async () => {
    const member = await memberWithWorkspace(signInApp(plain).app);
    const { app } = signInApp(plain);
    const people = JSON.stringify({ workspace: member.slug, objectId: member.people.id, limit: 50 });
    const answer = await rpcPost(app, member.cookie, 'records/query', people);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('server-timing')).toBeNull();
    const health = await app.fetch(new Request('https://app.test/api/health'));
    expect(health.headers.get('server-timing')).toBeNull();
  });
});
