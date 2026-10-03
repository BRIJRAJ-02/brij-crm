// The data layer against a fake API (spec 0005): the real oRPC handler over
// the shared contract with stand in procedures, and Better Auth's routes
// answered by hand in the shapes the API sends. Checks the caching, the error
// shape every failure takes, and that a 401 signs out once.
import { contract, type Me, type ObjectSummary } from '@crm/contracts';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from './errors.ts';
import { createDataLayer, createIdMinter, isDataError, type DataError, type Notice } from './index.ts';

const ORIGIN = 'https://crm.test';

const ME: Me = {
  user: { id: '0199a6f2-0000-7000-8000-000000000001', name: 'Ada Lovelace', email: 'ada@example.com' },
  workspaces: [{ id: '0199a6f2-0000-7000-8000-000000000002', slug: 'acme', name: 'Acme' }],
};

const PEOPLE: ObjectSummary = {
  id: '0199a6f2-0000-7000-8000-000000000003',
  apiSlug: 'people',
  singularName: 'Person',
  pluralName: 'People',
  icon: 'user',
  hue: 'blue',
  standardKey: 'people',
  primaryAttributeId: '0199a6f2-0000-7000-8000-000000000004',
};

/** What each stand in procedure does; a test overrides the ones it needs. */
interface Behaviour {
  me: () => Me;
  objects: (workspace: string) => ObjectSummary[];
  create: () => { workspace: Me['workspaces'][number] };
}

const unauthenticated = () => new ORPCError('UNAUTHENTICATED', { status: 401, message: 'Sign in to continue.' });

/** A fake API behind `fetch`: oRPC on `/api/rpc`, Better Auth's routes on `/api/auth`, and a log of what was called. */
function fakeApi(overrides: Partial<Behaviour> = {}, auth: (path: string, body: unknown) => Response = okAuth) {
  const behaviour: Behaviour = {
    me: () => ME,
    objects: () => [PEOPLE],
    create: () => ({ workspace: { id: '0199a6f2-0000-7000-8000-000000000009', slug: 'new', name: 'New' } }),
    ...overrides,
  };
  const calls: string[] = [];
  const os = implement(contract);
  const router = os.router({
    system: {
      status: os.system.status.handler(() => ({
        environment: 'local' as const,
        database: { serverVersion: '18.0', latencyMs: 1 },
        providers: { google: false },
        checkedAt: '2026-10-03T09:00:00.000Z',
      })),
    },
    me: { get: os.me.get.handler(() => behaviour.me()) },
    workspaces: { create: os.workspaces.create.handler(() => behaviour.create()) },
    objects: { list: os.objects.list.handler(({ input }) => behaviour.objects(input.workspace)) },
  });
  const handler = new RPCHandler(router);
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    calls.push(pathname);
    if (pathname.startsWith('/api/rpc')) {
      const { response } = await handler.handle(request, { prefix: '/api/rpc', context: {} });
      return response ?? new Response('Not found', { status: 404 });
    }
    if (pathname.startsWith('/api/auth')) {
      const text = await request.text();
      return auth(pathname.slice('/api/auth'.length), text === '' ? undefined : JSON.parse(text));
    }
    return new Response('Not found', { status: 404 });
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okAuth(path: string): Response {
  if (path === '/get-session') return json(null);
  return json({ status: true });
}

/** A data layer on a fake API, with its notices and sign outs recorded. */
function layer(api: Pick<ReturnType<typeof fakeApi>, 'fetch'>, path = '/w/acme/objects/people?view=all') {
  const notices: Notice[] = [];
  const signedOut: string[] = [];
  // Sign outs and session changes, in the order they ran.
  const events: string[] = [];
  const data = createDataLayer({
    origin: ORIGIN,
    notify: (notice) => notices.push(notice),
    mintId: createIdMinter({ now: () => 1_759_482_000_000, fill: (bytes) => bytes.fill(171) }),
    onSignedOut: (redirectTo) => {
      signedOut.push(redirectTo);
      events.push('signed out');
    },
    onSessionChange: () => events.push('session changed'),
    currentPath: () => path,
    fetch: api.fetch,
  });
  return { data, notices, signedOut, events };
}

async function failure(promise: Promise<unknown>): Promise<DataError> {
  try {
    await promise;
  } catch (error) {
    if (isDataError(error)) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

const count = (calls: readonly string[], path: string) => calls.filter((call) => call === path).length;

describe('me.get', () => {
  it('asks once per app load and answers from the cache after that', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.me.get()).toEqual(ME);
    expect(await data.me.get()).toEqual(ME);
    expect(count(api.calls, '/api/rpc/me/get')).toBe(1);
  });

  it('answers undefined when nobody is signed in, without signing anyone out', async () => {
    const api = fakeApi({
      me: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, notices } = layer(api);
    expect(await data.me.get()).toBeUndefined();
    expect(signedOut).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('forgets a failed answer, so the next call asks again', async () => {
    let fail = true;
    const api = fakeApi({
      me: () => {
        if (fail) throw new ORPCError('INTERNAL', { status: 500, message: 'Database exploded at row 7' });
        return ME;
      },
    });
    const { data } = layer(api);
    expect(await failure(data.me.get())).toMatchObject({
      code: 'INTERNAL',
      message: 'Something went wrong. Try again in a moment.',
    });
    fail = false;
    expect(await data.me.get()).toEqual(ME);
  });
});

describe('objects.list', () => {
  it("answers the workspace's objects, cached per workspace", async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.objects.list('acme')).toEqual([PEOPLE]);
    await data.objects.list('acme');
    await data.objects.list('other');
    expect(count(api.calls, '/api/rpc/objects/list')).toBe(2);
  });

  it('rejects NOT_FOUND in the shared shape, and tries again on the next call', async () => {
    let missing = true;
    const api = fakeApi({
      objects: () => {
        if (missing) {
          throw new ORPCError('NOT_FOUND', {
            status: 404,
            message: "That workspace doesn't exist, or you're not a member of it.",
          });
        }
        return [PEOPLE];
      },
    });
    const { data, signedOut } = layer(api);
    const error = await failure(data.objects.list('acme'));
    expect(error).toMatchObject({
      name: 'DataError',
      code: 'NOT_FOUND',
      message: "That workspace doesn't exist, or you're not a member of it.",
    });
    expect(signedOut).toEqual([]);
    missing = false;
    expect(await data.objects.list('acme')).toEqual([PEOPLE]);
  });

  it('signs out once on a 401, back to the page the person was on, and forgets who was signed in', async () => {
    let session = true;
    const api = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, notices } = layer(api);
    await data.me.get();
    session = false;
    const [first, second] = await Promise.all([failure(data.objects.list('acme')), failure(data.objects.list('beta'))]);
    expect(first.code).toBe('UNAUTHENTICATED');
    expect(second.code).toBe('UNAUTHENTICATED');
    expect(signedOut).toEqual(['/w/acme/objects/people?view=all']);
    expect(notices).toEqual([{ tone: 'danger', message: 'You were signed out. Sign in again to carry on.' }]);
    expect(await data.me.get()).toBeUndefined();
  });

  it('goes to sign in first, then says the session changed, so the app drops the last person’s pages', async () => {
    const api = fakeApi({
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data, events } = layer(api);
    await failure(data.objects.list('acme'));
    expect(events).toEqual(['signed out', 'session changed']);
  });

  it('signs out again on a later 401 once someone is signed in again', async () => {
    let session = true;
    const api = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut } = layer(api);
    await failure(data.objects.list('acme'));
    // Signed in again (another tab): me.get answers a person, so the next 401 is a new ending.
    session = true;
    expect(await data.me.get()).toEqual(ME);
    await failure(data.objects.list('acme'));
    expect(signedOut).toHaveLength(2);
  });

  it('asks who is signed in again after a NOT_FOUND, since the person may have left the workspace', async () => {
    const api = fakeApi({
      objects: () => {
        throw new ORPCError('NOT_FOUND', { status: 404, message: 'Not here.' });
      },
    });
    const { data } = layer(api);
    await data.me.get();
    await failure(data.objects.list('gone'));
    await data.me.get();
    expect(count(api.calls, '/api/rpc/me/get')).toBe(2);
  });

  it('carries the answer’s Retry-After on a refusal', async () => {
    const api = fakeApi({
      objects: () => {
        throw new ORPCError('RATE_LIMITED', { status: 429, message: 'Too many tries.' });
      },
    });
    const { data } = layer({
      fetch: async (input, init) => {
        const response = await api.fetch(input, init);
        const headers = new Headers(response.headers);
        if (response.status === 429) headers.set('retry-after', '90');
        return new Response(response.body, { status: response.status, headers });
      },
    });
    expect(await failure(data.objects.list('acme'))).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 90 });
  });
});

describe('workspaces.create', () => {
  const input = { id: '0199a6f2-0000-7000-8000-000000000010', name: 'Acme', slug: 'acme', memberName: 'Ada' };

  it('carries a refusal on its field, in the shared shape', async () => {
    const api = fakeApi({
      create: () => {
        throw new ORPCError('SLUG_TAKEN', {
          status: 409,
          message: 'That workspace address is taken. Pick another.',
          data: {
            refusals: [
              { code: 'SLUG_TAKEN', message: 'That workspace address is taken. Pick another.', field: 'slug' },
            ],
          },
        });
      },
    });
    const { data } = layer(api);
    expect(await failure(data.workspaces.create(input))).toMatchObject({
      code: 'SLUG_TAKEN',
      message: 'That workspace address is taken. Pick another.',
      data: { refusals: [{ code: 'SLUG_TAKEN', field: 'slug' }] },
    });
  });

  it('asks who is signed in again after making one, so the new workspace is listed', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    await data.me.get();
    await data.workspaces.create(input);
    await data.me.get();
    expect(count(api.calls, '/api/rpc/me/get')).toBe(2);
  });

  it('mints UUID v7 ids from the clock and the random source', () => {
    const { data } = layer(fakeApi());
    const id = data.workspaces.newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(1_759_482_000_000);
  });
});

describe('failures that never reached the API', () => {
  it('answers API_UNAVAILABLE when the network fails', async () => {
    const { data } = layer({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await failure(data.system.status())).toMatchObject({
      code: 'API_UNAVAILABLE',
      message: "Can't reach the CRM. Check your connection, then try again.",
    });
  });

  it("answers API_UNAVAILABLE for a proxy's 503 page, in the layer's own words", async () => {
    const { data } = layer({
      fetch: () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 503 })),
    });
    expect(await failure(data.system.status())).toMatchObject({ code: 'API_UNAVAILABLE' });
  });
});

describe('auth', () => {
  it('sends a sign in code to the address, by Better Auth’s email code route', async () => {
    const bodies: unknown[] = [];
    const api = fakeApi({}, (path, body) => {
      bodies.push({ path, body });
      return json({ success: true });
    });
    const { data } = layer(api);
    await data.auth.sendCode('ada@example.com');
    expect(bodies).toEqual([
      { path: '/email-otp/send-verification-otp', body: { email: 'ada@example.com', type: 'sign-in' } },
    ]);
  });

  it('rejects a closed sign up and a wrong code with their codes and messages', async () => {
    const api = fakeApi({}, (path) =>
      path === '/sign-in/email-otp'
        ? json({ code: 'INVALID_OTP', message: "That code isn't right. Check it, or send a new one." }, 400)
        : json({ code: 'SIGNUP_CLOSED', message: "Sign up isn't open yet." }, 403),
    );
    const { data, signedOut } = layer(api);
    expect(await failure(data.auth.sendCode('new@example.com'))).toMatchObject({
      code: 'SIGNUP_CLOSED',
      message: "Sign up isn't open yet.",
    });
    expect(await failure(data.auth.verify('ada@example.com', '123456'))).toMatchObject({
      code: 'INVALID_OTP',
      message: "That code isn't right. Check it, or send a new one.",
    });
    expect(signedOut).toEqual([]);
  });

  it('forgets who was signed in after signing in and after signing out', async () => {
    const api = fakeApi({}, (path) =>
      path === '/sign-in/email-otp' ? json({ token: 't', user: ME.user }) : json({ success: true }),
    );
    const { data } = layer(api);
    await data.me.get();
    await data.auth.verify('ada@example.com', '123456');
    await data.me.get();
    await data.auth.signOut();
    await data.me.get();
    expect(count(api.calls, '/api/rpc/me/get')).toBe(3);
    expect(api.calls).toContain('/api/auth/sign-out');
  });

  it('says the session changed after signing in and after signing out, never on a refused code', async () => {
    let refuse = true;
    const api = fakeApi({}, (path) => {
      if (path !== '/sign-in/email-otp') return json({ success: true });
      return refuse
        ? json({ code: 'INVALID_OTP', message: "That code isn't right." }, 400)
        : json({ token: 't', user: ME.user });
    });
    const { data, events } = layer(api);
    await failure(data.auth.verify('ada@example.com', '000000'));
    expect(events).toEqual([]);
    refuse = false;
    await data.auth.verify('ada@example.com', '123456');
    await data.auth.signOut();
    expect(events).toEqual(['session changed', 'session changed']);
  });

  it('answers the session, or undefined when there is none', async () => {
    const signedIn = layer(
      fakeApi({}, () =>
        json({
          session: { id: 's', userId: ME.user.id, token: 't', expiresAt: '2026-11-02T00:00:00.000Z' },
          user: { ...ME.user, emailVerified: true },
        }),
      ),
    );
    expect(await signedIn.data.auth.session()).toEqual(ME.user);
    expect(await layer(fakeApi()).data.auth.session()).toBeUndefined();
  });

  it('turns a rate limit without a body into RATE_LIMITED', async () => {
    const { data } = layer(fakeApi({}, () => new Response('', { status: 429 })));
    const error = await failure(data.auth.sendCode('ada@example.com'));
    expect(error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('carries the wait from Retry-After on a rate limited code send', async () => {
    const { data } = layer(
      fakeApi(
        {},
        () =>
          new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'Too many codes were sent to this email.' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '600' },
          }),
      ),
    );
    expect(await failure(data.auth.sendCode('ada@example.com'))).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many codes were sent to this email.',
      retryAfterSeconds: 600,
    });
  });
});

describe('parseRetryAfter', () => {
  it('reads delay seconds and HTTP dates, and nothing else', () => {
    const now = Date.parse('2026-10-03T09:00:00.000Z');
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
    expect(parseRetryAfter('Sat, 03 Oct 2026 09:10:00 GMT', now)).toBe(600);
    expect(parseRetryAfter('Sat, 03 Oct 2026 08:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter('-5', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe('the layer has no state at module level', () => {
  it('keeps two layers apart', async () => {
    const one = fakeApi();
    const two = fakeApi();
    await layer(one).data.me.get();
    await layer(two).data.me.get();
    expect(count(one.calls, '/api/rpc/me/get')).toBe(1);
    expect(count(two.calls, '/api/rpc/me/get')).toBe(1);
  });
});
