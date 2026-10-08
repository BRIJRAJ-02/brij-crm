// A server error reaches Sentry with the request it belongs to (spec 0010,
// AC-162): through the real app, a real session and the member door, on a real
// Postgres, with a fake transport in place of Sentry. Refusals never go.
import { randomUUID } from 'node:crypto';
import type { Database, IdentityStore } from '@crm/db';
import { os } from '@orpc/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memoryTransport } from '../../test/sentry.ts';
import { rpcPost, signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';
import { type RequestContext, requireMember, requireSession } from '../orpc.ts';
import { router } from '../router.ts';
import { flush, startSentry } from './sentry.ts';

const transport = memoryTransport();
const t = os.$context<RequestContext>();

/** The app's own router, plus a workspace procedure that fails the way a bug would. */
const withFault = {
  ...router,
  faults: {
    crash: t
      .use(requireSession)
      .use(requireMember)
      .handler(() => {
        // A different message each time: Sentry drops an event identical to the one before it.
        throw new Error(`A bug inside a workspace procedure (${randomUUID().slice(0, 8)})`);
      }),
  },
};

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  startSentry({
    dsn: 'https://public@o1.ingest.de.sentry.io/1',
    environment: 'preview',
    release: 'abc1234',
    service: 'api',
    deliver: transport.deliver,
  });
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { router: withFault }));
});
afterAll(async () => {
  await flush(2000);
  await Promise.all([identity.close(), db.close()]);
});
beforeEach(() => {
  transport.clear();
});

describe('an unexpected error in a procedure', () => {
  it('reaches Sentry with the request id the answer carried, the procedure, user, workspace, service and release', async () => {
    const member = await memberWithWorkspace(app);
    const answer = await rpcPost(app, member.cookie, 'faults/crash', JSON.stringify({ workspace: member.slug }));
    expect(answer.status).toBe(500);
    const requestId = answer.headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    await flush(2000);

    const events = transport.events();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      environment: 'preview',
      release: 'abc1234',
      tags: {
        service: 'api',
        request_id: requestId,
        procedure: 'faults.crash',
        workspace_id: member.workspace.id,
      },
    });
    expect(events[0]?.exception?.values?.[0]?.value).toMatch(/^A bug inside a workspace procedure/);
    // The user by id only: never the email they signed in with.
    expect(Object.keys(events[0]?.user ?? {})).toEqual(['id']);
    expect(transport.envelopes.join('\n')).not.toContain(member.email);
  });

  it('keeps each request to itself: a second failure names its own request id', async () => {
    const member = await memberWithWorkspace(app);
    const first = await rpcPost(app, member.cookie, 'faults/crash', JSON.stringify({ workspace: member.slug }));
    const second = await rpcPost(app, member.cookie, 'faults/crash', JSON.stringify({ workspace: member.slug }));
    await flush(2000);
    const ids = transport.events().map((event) => event.tags?.request_id);
    expect(ids.sort()).toEqual([first.headers.get('x-request-id'), second.headers.get('x-request-id')].sort());
  });
});

describe('expected refusals', () => {
  it('never reach Sentry: not signed in, not a member, bad input', async () => {
    const member = await memberWithWorkspace(app);
    const answers = await Promise.all([
      rpcPost(app, '', 'faults/crash', JSON.stringify({ workspace: member.slug })),
      rpcPost(app, member.cookie, 'faults/crash', JSON.stringify({ workspace: 'nobody-has-this-workspace' })),
      rpcPost(app, member.cookie, 'objects/list', JSON.stringify({ workspace: 42 })),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([401, 404, 400]);
    await flush(2000);
    expect(transport.events()).toEqual([]);
  });
});
