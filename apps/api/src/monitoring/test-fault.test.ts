// `system.testFault` (spec 0010, AC-168): off by default and then
// indistinguishable from a procedure that doesn't exist; switched on, it needs
// a session and fails with an unexpected error that reaches Sentry (AC-162).
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryTransport } from '../../test/sentry.ts';
import { rpcPost, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { TEST_FAULT_MESSAGE } from '../modules/system/router.ts';
import { flush, startSentry } from './sentry.ts';

const transport = memoryTransport();
let db: Database;
let identity: IdentityStore;
let off: ReturnType<typeof signInApp>['app'];
let on: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  startSentry({
    dsn: 'https://public@o1.ingest.de.sentry.io/1',
    environment: 'production',
    release: 'abc1234',
    service: 'api',
    deliver: transport.deliver,
  });
  ({ db, identity } = testConnections());
  ({ app: off } = signInApp({ db, identity }));
  ({ app: on } = signInApp({ db, identity }, { MONITORING_TEST_FAULT: 'on' }));
});
afterAll(async () => {
  await flush(2000);
  await Promise.all([identity.close(), db.close()]);
});

/** Status and body, without the request id every answer has its own of. */
async function answerOf(response: Response) {
  return { status: response.status, body: await response.text() };
}

describe('switched off (unset, the default)', () => {
  it('answers exactly like a procedure that does not exist, signed in or not', async () => {
    const { cookie } = await signIn(off);
    const missing = await answerOf(await rpcPost(off, cookie, 'system/noSuchThing', '{}'));
    expect(missing.status).toBe(404);
    expect(await answerOf(await rpcPost(off, cookie, 'system/testFault', '{}'))).toEqual(missing);
    expect(await answerOf(await rpcPost(off, '', 'system/testFault', '{}'))).toEqual(missing);
  });

  it('never reaches the fault by another spelling of its address', async () => {
    const { cookie } = await signIn(off);
    const answer = await rpcPost(off, cookie, 'system/test%46ault', '{}');
    expect(answer.status).toBe(404);
    await flush(2000);
    expect(transport.events()).toEqual([]);
  });
});

describe('switched on (MONITORING_TEST_FAULT=on)', () => {
  it('needs a session', async () => {
    const answer = await rpcPost(on, '', 'system/testFault', '{}');
    expect(answer.status).toBe(401);
    await flush(2000);
    expect(transport.events()).toEqual([]);
  });

  it('fails as INTERNAL, and Sentry gets it with the request id the answer carried', async () => {
    const { cookie } = await signIn(on);
    const answer = await rpcPost(on, cookie, 'system/testFault', '{}');
    expect(answer.status).toBe(500);
    expect(await answer.text()).toContain('INTERNAL');
    await flush(2000);
    const [event] = transport.events();
    expect(event).toMatchObject({
      environment: 'production',
      tags: { request_id: answer.headers.get('x-request-id'), procedure: 'system.testFault', service: 'api' },
    });
    expect(event?.exception?.values?.[0]?.value).toBe(TEST_FAULT_MESSAGE);
    expect(Object.keys(event?.user ?? {})).toEqual(['id']);
  });
});
