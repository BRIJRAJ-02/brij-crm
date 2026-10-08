// The data layer against a fake API (spec 0005): the real oRPC handler over
// the shared contract with stand in procedures, and Better Auth's routes
// answered by hand in the shapes the API sends. Checks the caching, the error
// shape every failure takes, and that a 401 signs out once.
import {
  contract,
  type AttributeDefinition,
  type ChangeEvent,
  type Me,
  type MemberSummary,
  type MyAccess,
  type ObjectSummary,
  type RecordView,
} from '@crm/contracts';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { describe, expect, it } from 'vitest';
import { dataError, isUnseenFault, parseRetryAfter, refusalFor, refusalSummary } from './errors.ts';
import {
  createDataLayer,
  createIdMinter,
  isDataError,
  isEditableHere,
  toFieldAttribute,
  type DataError,
  type DataFault,
  type Notice,
  type ReplacedValue,
} from './index.ts';
import { createLive, type LiveChannel, type LiveTransport } from './live/live.ts';

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
  access: 'write',
};

const TITLE: AttributeDefinition = {
  id: '0199a6f2-0000-7000-8000-000000000005',
  apiSlug: 'job_title',
  title: 'Job title',
  type: 'text',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  config: {},
  position: 3,
};

const ADA_MEMBER: MemberSummary = { id: '0199a6f2-0000-7000-8000-000000000006', name: 'Ada', email: 'ada@example.com' };

/** A person as the API answers one. */
const personRow = (index: number, title = 'Engineer'): RecordView => {
  const id = `0199a6f2-0000-7000-8000-${(100 + index).toString(16).padStart(12, '0')}`;
  const actor = { type: 'member' as const, id: ADA_MEMBER.id };
  return {
    id,
    objectId: PEOPLE.id,
    createdAt: '2026-10-08T09:00:00.000Z',
    createdBy: actor,
    updatedAt: '2026-10-08T09:00:00.000Z',
    updatedBy: actor,
    display: { objectId: PEOPLE.id, recordId: id, name: `P${String(index)}`, kind: 'person' },
    revision: 0,
    values: { [TITLE.id]: title },
    versions: { [TITLE.id]: '0199a6f2-0001-7000-8000-000000000000' },
    linkTotals: {},
  };
};

/** What each stand in procedure does; a test overrides the ones it needs. */
interface Behaviour {
  me: () => Me;
  objects: (workspace: string) => ObjectSummary[];
  create: () => { workspace: Me['workspaces'][number] };
  members: () => MemberSummary[];
  access: () => MyAccess;
  attributes: () => AttributeDefinition[];
  addAttribute: () => AttributeDefinition;
  count: () => number;
  query: (position: number, limit: number) => RecordView[];
  setValues: () => RecordView;
  get: (ids: readonly string[]) => RecordView[];
  /** The workspace's head, as the subscription token carries it. */
  head: () => number;
  /** What `realtime.catchUp` answers from `after`. */
  catchUp: (after: number) => { head: number; reset: boolean; events: ChangeEvent[] };
}

const unauthenticated = () => new ORPCError('UNAUTHENTICATED', { status: 401, message: 'Sign in to continue.' });

/** A stand in for a procedure these tests never call. */
const notServed = (): never => {
  throw new ORPCError('NOT_FOUND', { status: 404, message: 'Not served by this fake.' });
};

/** A fake API behind `fetch`: oRPC on `/api/rpc`, Better Auth's routes on `/api/auth`, and a log of what was called. */
function fakeApi(overrides: Partial<Behaviour> = {}, auth: (path: string, body: unknown) => Response = okAuth) {
  const behaviour: Behaviour = {
    me: () => ME,
    objects: () => [PEOPLE],
    create: () => ({ workspace: { id: '0199a6f2-0000-7000-8000-000000000009', slug: 'new', name: 'New' } }),
    members: () => [ADA_MEMBER],
    access: () => ({ memberId: ADA_MEMBER.id, role: 'member', roleLabel: 'Member', permissions: ['records.export'] }),
    attributes: () => [TITLE],
    addAttribute: notServed,
    count: () => 3,
    query: (position, limit) =>
      Array.from({ length: Math.max(0, Math.min(limit, 3 - position)) }, (_, at) => personRow(position + at)),
    setValues: notServed,
    get: () => [],
    head: () => 0,
    catchUp: () => ({ head: behaviour.head(), reset: false, events: [] }),
    ...overrides,
  };
  const calls: string[] = [];
  // Each write's mutation id, as sent.
  const mutationIds: string[] = [];
  const os = implement(contract);
  const router = os.router({
    system: {
      status: os.system.status.handler(() => ({
        environment: 'local' as const,
        database: { serverVersion: '18.0', latencyMs: 1 },
        providers: { google: false },
        checkedAt: '2026-10-03T09:00:00.000Z',
      })),
      testFault: os.system.testFault.handler(notServed),
    },
    me: { get: os.me.get.handler(() => behaviour.me()) },
    workspaces: { create: os.workspaces.create.handler(() => behaviour.create()) },
    objects: { list: os.objects.list.handler(({ input }) => behaviour.objects(input.workspace)) },
    attributes: {
      list: os.attributes.list.handler(() => behaviour.attributes()),
      create: os.attributes.create.handler(() => behaviour.addAttribute()),
    },
    records: {
      query: os.records.query.handler(({ input }) => ({
        records: behaviour.query(input.position ?? 0, input.limit ?? 50),
      })),
      count: os.records.count.handler(() => ({ count: behaviour.count(), atLeast: false })),
      get: os.records.get.handler(({ input }) => behaviour.get(input.ids)),
      create: os.records.create.handler(notServed),
      setValues: os.records.setValues.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        const row = behaviour.setValues();
        const written = Object.fromEntries(
          Object.keys(input.values).flatMap((id) => (row.versions[id] === undefined ? [] : [[id, row.versions[id]]])),
        );
        return { ...row, echoes: 1, written };
      }),
      setValuesBatch: os.records.setValuesBatch.handler(notServed),
    },
    members: { list: os.members.list.handler(() => behaviour.members()) },
    access: { mine: os.access.mine.handler(() => behaviour.access()) },
    realtime: {
      connectionToken: os.realtime.connectionToken.handler(() => ({ token: 'connection-token' })),
      subscriptionToken: os.realtime.subscriptionToken.handler(({ input }) => ({
        channel: `workspace:${input.workspace}`,
        token: 'subscription-token',
        head: behaviour.head(),
      })),
      catchUp: os.realtime.catchUp.handler(({ input }) => behaviour.catchUp(input.after)),
    },
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
  return { fetch, calls, mutationIds };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okAuth(path: string): Response {
  if (path === '/get-session') return json(null);
  return json({ status: true });
}

/** A data layer on a fake API, with its notices and sign outs recorded. */
function layer(
  api: Pick<ReturnType<typeof fakeApi>, 'fetch'>,
  path = '/w/acme/objects/people?view=all',
  more: Partial<Parameters<typeof createDataLayer>[0]> = {},
) {
  const notices: Notice[] = [];
  const signedOut: string[] = [];
  // Sign outs and session changes, in the order they ran.
  const events: string[] = [];
  // What the layer handed monitoring.
  const faults: DataFault[] = [];
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
    report: (fault) => faults.push(fault),
    ...more,
  });
  return { data, notices, signedOut, events, faults };
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

describe('access', () => {
  it('reads the person’s own role and permissions once per workspace', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.access.mine('acme')).toEqual({
      memberId: ADA_MEMBER.id,
      role: 'member',
      roleLabel: 'Member',
      permissions: ['records.export'],
    });
    await data.access.mine('acme');
    expect(count(api.calls, '/api/rpc/access/mine')).toBe(1);
    await data.access.mine('other');
    expect(count(api.calls, '/api/rpc/access/mine')).toBe(2);
  });
});

describe('members and attributes', () => {
  it('reads a workspace’s members once', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.members.list('acme')).toEqual([ADA_MEMBER]);
    await data.members.list('acme');
    expect(count(api.calls, '/api/rpc/members/list')).toBe(1);
  });

  it('reads an object’s attributes once, and again after one is added', async () => {
    const added = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000007', apiSlug: 'nickname', title: 'Nickname' };
    const api = fakeApi({ addAttribute: () => added });
    const { data } = layer(api);
    await data.attributes.list('acme', PEOPLE.id);
    await data.attributes.list('acme', PEOPLE.id);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(1);
    expect(await data.attributes.create('acme', { objectId: PEOPLE.id, title: 'Nickname', type: 'text' })).toEqual(
      added,
    );
    await data.attributes.list('acme', PEOPLE.id);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(2);
  });

  it('refuses a taken name on the title field', async () => {
    const api = fakeApi({
      addAttribute: () => {
        throw new ORPCError('SLUG_TAKEN', {
          status: 409,
          message: 'An attribute with this name exists.',
          data: { refusals: [{ code: 'SLUG_TAKEN', message: 'An attribute with this name exists.', field: 'title' }] },
        });
      },
    });
    const { data } = layer(api);
    const error = await failure(data.attributes.create('acme', { objectId: PEOPLE.id, title: 'Name', type: 'text' }));
    expect(error).toMatchObject({ code: 'SLUG_TAKEN', data: { refusals: [{ field: 'title' }] } });
  });

  it('maps an attribute to the field set’s, reading references and members as read only in this loop', () => {
    expect(toFieldAttribute(TITLE)).toEqual({
      id: TITLE.id,
      name: 'Job title',
      type: 'text',
      allowMultiple: false,
      isRequired: false,
      isUnique: false,
      isReadOnly: false,
    });
    const owner = { ...TITLE, type: 'actor_reference' as const, title: 'Owner' };
    expect(toFieldAttribute(owner, 'Set on the record page')).toMatchObject({
      isReadOnly: true,
      readOnlyReason: 'Set on the record page',
    });
    const company = { ...TITLE, type: 'record_reference' as const, isMulti: true };
    expect(toFieldAttribute(company)).toMatchObject({ isReadOnly: true, cardinality: 'many', allowMultiple: true });
    const createdAt = { ...TITLE, type: 'timestamp' as const, isSystem: true };
    expect(toFieldAttribute(createdAt, 'unused')).toMatchObject({ isReadOnly: true });
    expect(toFieldAttribute(createdAt, 'unused').readOnlyReason).toBeUndefined();
  });

  it('makes a field the server says the person may only read read only, with the server’s reason (AC-142)', () => {
    const ruled = { ...TITLE, readOnly: { reason: "Your role can't change Job title." } };
    expect(toFieldAttribute(ruled)).toMatchObject({
      isReadOnly: true,
      readOnlyReason: "Your role can't change Job title.",
    });
    expect(isEditableHere(ruled)).toBe(false);
    expect(isEditableHere(TITLE)).toBe(true);
    // On a reference, the server's reason wins over the screen's.
    const company = { ...ruled, type: 'record_reference' as const };
    expect(toFieldAttribute(company, 'Set on the record page').readOnlyReason).toBe(
      "Your role can't change Job title.",
    );
    // A system attribute keeps the field set's own reason.
    const createdAt = { ...TITLE, isSystem: true, readOnly: { reason: 'Created at is set by the system.' } };
    expect(toFieldAttribute(createdAt).readOnlyReason).toBeUndefined();
  });
});

describe('records', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 40));

  it('opens a view with its count and first block, reading the first 100 rows by position', async () => {
    const positions: number[] = [];
    const api = fakeApi({
      query: (position, limit) => {
        positions.push(position, limit);
        return [personRow(0), personRow(1), personRow(2)];
      },
    });
    const { data } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id);
    const state = view.getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.source.count).toBe(3);
    expect(state.source.getItem(1)?.values[TITLE.id]).toBe('Engineer');
    expect(positions).toEqual([0, 100]);
    expect(await data.records.view('acme', PEOPLE.id)).toBe(view);
  });

  it('waits the answer’s Retry-After when the workspace has too many reads in flight, then reads again', async () => {
    let busy = true;
    const api = fakeApi({
      count: () => {
        if (busy) {
          busy = false;
          throw new ORPCError('TOO_MANY_REQUESTS', { status: 429, message: 'Busy.' });
        }
        return 3;
      },
    });
    const { data } = layer({
      fetch: async (input, init) => {
        const response = await api.fetch(input, init);
        const headers = new Headers(response.headers);
        if (response.status === 429) headers.set('retry-after', '0');
        return new Response(response.body, { status: response.status, headers });
      },
    });
    const view = await data.records.view('acme', PEOPLE.id);
    expect(view.getSnapshot().status).toBe('ready');
    expect(count(api.calls, '/api/rpc/records/count')).toBe(2);
  });

  it('drops a pending edit with every record when the session ended, and goes to sign in', async () => {
    const api = fakeApi({
      setValues: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, notices } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id);
    const row = view.getSnapshot().source.getItem(0);
    data.records.setValue('acme', { rowId: row?.id ?? '', columnId: TITLE.id, value: 'Lead' });
    await settled();
    // The last person's records leave the browser with their session; nothing shows the edit.
    expect(view.getSnapshot().source.getItem(0)).toBeUndefined();
    expect(signedOut).toEqual(['/w/acme/objects/people?view=all']);
    expect(notices.map((notice) => notice.message)).toEqual(['You were signed out. Sign in again to carry on.']);
  });
});

describe('live updates', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 40));

  /** A realtime client that records what it was asked to listen to. */
  function fakeTransport() {
    const channels: LiveChannel[] = [];
    let closed = 0;
    const transport: LiveTransport = {
      listen: (channel) => {
        channels.push(channel);
        return () => undefined;
      },
      onTrouble: () => () => undefined,
      close: () => {
        closed += 1;
      },
    };
    const channel = () => {
      const [first] = channels;
      if (first === undefined) throw new Error('Nothing is listened to.');
      return first;
    };
    return { transport, channels, channel, closed: () => closed };
  }

  const AT = '2026-10-08T09:00:00.000Z';
  const changed = (seq: number, recordIds: readonly string[], mutationId?: string): ChangeEvent => ({
    seq,
    at: AT,
    kind: 'records',
    objectId: PEOPLE.id,
    recordIds: [...recordIds],
    attributeIds: [TITLE.id],
    ...(mutationId === undefined ? {} : { mutationId }),
  });
  const definitions = (seq: number): ChangeEvent => ({ seq, at: AT, kind: 'definitions', objectId: PEOPLE.id });

  /** The layer with live updates on a fake client, its view of People open and subscribed. */
  async function liveLayer(
    overrides: Partial<Behaviour> = {},
    more: Partial<Parameters<typeof createDataLayer>[0]> = {},
  ) {
    const api = fakeApi(overrides);
    const client = fakeTransport();
    let definitionChanges = 0;
    const { data } = layer(api, '/w/acme/objects/people', {
      ...more,
      realtimeUrl: 'ws://centrifugo.test/connection/websocket',
      onDefinitionsChange: () => {
        definitionChanges += 1;
      },
      loadLive: () =>
        Promise.resolve({
          // No spread before a resync or catch up: the tests wait on real time.
          createLive: (options) =>
            createLive({ ...options, open: () => Promise.resolve(client.transport), random: () => 0 }),
        }),
    });
    const view = await data.records.view('acme', PEOPLE.id);
    await settled();
    client.channel().onSubscribed({ wasRecovering: false, recovered: false });
    await settled();
    return { api, client, data, view, definitionChanges: () => definitionChanges };
  }

  it("listens to the workspace's channel with the API's tokens, and fetches a change from elsewhere in place", async () => {
    const edited = { ...personRow(0, 'CEO'), versions: { [TITLE.id]: '0199a6f2-0002-7000-8000-000000000000' } };
    const { api, client, view } = await liveLayer({ get: (ids) => (ids.includes(edited.id) ? [edited] : []) });
    expect(client.channel()).toMatchObject({ name: 'workspace:acme', token: 'subscription-token' });
    expect(await client.channel().renew()).toBe('subscription-token');
    const gets = count(api.calls, '/api/rpc/records/get');
    client.channel().onPublication(changed(1, [edited.id]));
    await settled();
    expect(count(api.calls, '/api/rpc/records/get')).toBe(gets + 1);
    expect(view.getSnapshot().source.getItem(0)?.values[TITLE.id]).toBe('CEO');
  });

  it("skips this tab's own write when it comes back", async () => {
    const { api, client, data, view } = await liveLayer({ setValues: () => personRow(1, 'Lead') });
    data.records.setValue('acme', { rowId: personRow(1).id, columnId: TITLE.id, value: 'Lead' });
    await settled();
    const [mutationId] = api.mutationIds;
    const gets = count(api.calls, '/api/rpc/records/get');
    client.channel().onPublication(changed(1, [personRow(1).id], mutationId));
    await settled();
    expect(count(api.calls, '/api/rpc/records/get')).toBe(gets);
    expect(view.getSnapshot().source.getItem(1)?.values[TITLE.id]).toBe('Lead');
  });

  it('tells this tab, by name, when another member replaced a value it saved (spec 0006, AC-46)', async () => {
    const BEA: MemberSummary = { id: '0199a6f2-0000-7000-8000-0000000000b0', name: 'Bea', email: 'bea@example.com' };
    const MINE = '0199a6f2-0003-7000-8000-000000000000';
    const replaced: ReplacedValue[] = [];
    let memberReads = 0;
    const saved = { ...personRow(1, 'Lead'), revision: 1, versions: { [TITLE.id]: MINE } };
    const { client, data } = await liveLayer(
      // Bea joined after the member list was first read: the notice reads it once more to name her.
      { setValues: () => saved, members: () => (memberReads++ === 0 ? [ADA_MEMBER] : [ADA_MEMBER, BEA]) },
      { onReplaced: (notice) => replaced.push(notice) },
    );
    data.records.setValue('acme', { rowId: saved.id, columnId: TITLE.id, value: 'Lead' });
    await settled();
    const by = (member: MemberSummary) => ({
      ...changed(1, [saved.id]),
      replaced: {
        by: { type: 'member' as const, id: member.id },
        cells: [{ recordId: saved.id, attributeId: TITLE.id, versionId: MINE }],
      },
    });
    // Saved by this person elsewhere (another tab): nothing.
    client.channel().onPublication(by(ADA_MEMBER));
    await settled();
    expect(replaced).toEqual([]);
    client.channel().onPublication({ ...by(BEA), seq: 2 });
    await settled();
    expect(replaced).toMatchObject([
      {
        workspace: 'acme',
        recordId: saved.id,
        recordName: 'P1',
        attributeTitle: 'Job title',
        others: 0,
        by: { kind: 'member', name: 'Bea' },
      },
    ]);
  });

  it('undoes the last change, naming the attribute, and finds nothing more to undo (spec 0006, AC-48)', async () => {
    const before = personRow(1, 'Engineer');
    const saved = {
      ...personRow(1, 'Lead'),
      revision: 1,
      versions: { [TITLE.id]: '0199a6f2-0003-7000-8000-000000000000' },
    };
    const answers = [
      saved,
      { ...before, revision: 2, versions: { [TITLE.id]: '0199a6f2-0004-7000-8000-000000000000' } },
    ];
    const { data, view } = await liveLayer({ setValues: () => answers.shift() ?? saved });
    await data.records.setValues('acme', [{ rowId: saved.id, columnId: TITLE.id, value: 'Lead' }]);
    const undone = await data.undo.run('acme');
    expect(undone).toMatchObject({ kind: 'undone', action: 'cell', undone: 1, kept: 0, attributeTitle: 'Job title' });
    expect(view.getSnapshot().source.getItem(1)?.values[TITLE.id]).toBe('Engineer');
    expect(await data.undo.run('acme')).toEqual({ kind: 'nothing' });
  });

  it("reads an object's attributes again on a definitions change, and reloads the app's pages only when they changed", async () => {
    const NICKNAME: AttributeDefinition = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000015', apiSlug: 'nickname' };
    let lists = 0;
    const { api, client, data, definitionChanges } = await liveLayer({
      attributes: () => {
        lists += 1;
        return lists >= 3 ? [TITLE, NICKNAME] : [TITLE];
      },
    });
    await data.attributes.list('acme', PEOPLE.id);
    // Read again, the same: nothing to reload.
    client.channel().onPublication(definitions(1));
    await settled();
    expect(definitionChanges()).toBe(0);
    // Read again, with a new column: the app's pages load again, and find it cached.
    client.channel().onPublication(definitions(2));
    await settled();
    expect(definitionChanges()).toBe(1);
    expect(await data.attributes.list('acme', PEOPLE.id)).toEqual([TITLE, NICKNAME]);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(3);
  });

  it('says paused while the subscription is down, and stops listening on sign out', async () => {
    const { client, data } = await liveLayer();
    const heard: string[] = [];
    data.live.subscribe(() => heard.push(data.live.status()));
    expect(data.live.status()).toBe('live');
    client.channel().onDown('resubscribing');
    expect(data.live.status()).toBe('paused');
    client.channel().onSubscribed({ wasRecovering: true, recovered: true });
    expect(heard).toEqual(['paused', 'live']);
    await data.auth.signOut();
    await settled();
    expect(client.closed()).toBe(1);
  });

  it('is off without a realtime address, and asks for no token', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    data.live.prepare('acme');
    await data.records.view('acme', PEOPLE.id);
    await settled();
    expect(data.live.status()).toBe('off');
    expect(count(api.calls, '/api/rpc/realtime/subscriptionToken')).toBe(0);
    expect(count(api.calls, '/api/rpc/realtime/catchUp')).toBe(0);
  });

  it('reads the head before the first read, and reuses that token to listen (spec 0007, AC-74)', async () => {
    const { api } = await liveLayer({ head: () => 7 });
    const first = api.calls.findIndex((path) => path.startsWith('/api/rpc/realtime/subscriptionToken'));
    const reads = ['/api/rpc/records/count', '/api/rpc/records/query'].map((path) => api.calls.indexOf(path));
    expect(first).toBeGreaterThanOrEqual(0);
    for (const read of reads) expect(read).toBeGreaterThan(first);
    expect(count(api.calls, '/api/rpc/realtime/subscriptionToken')).toBe(1);
  });

  it('catches up from the head on subscribing, and a write made during the first load shows (AC-74)', async () => {
    const edited = { ...personRow(0, 'CEO'), versions: { [TITLE.id]: '0199a6f2-0002-7000-8000-000000000000' } };
    const afters: number[] = [];
    const { api, view } = await liveLayer({
      head: () => 4,
      catchUp: (after) => {
        afters.push(after);
        return { head: 5, reset: false, events: [changed(5, [edited.id])] };
      },
      get: (ids) => (ids.includes(edited.id) ? [edited] : []),
    });
    expect(afters).toEqual([4]);
    // The caught up ids are fetched a frame later, which a slow CI runner can push past the setup's settle.
    await expect.poll(() => count(api.calls, '/api/rpc/records/get')).toBe(1);
    await expect.poll(() => view.getSnapshot().source.getItem(0)?.values[TITLE.id]).toBe('CEO');
  });

  it('resyncs and starts from the live token when the head could not be read before the first reads (AC-74)', async () => {
    let tokens = 0;
    const afters: number[] = [];
    const { api } = await liveLayer({
      head: () => {
        tokens += 1;
        if (tokens === 1) throw new ORPCError('INTERNAL', { status: 500, message: 'Something went wrong.' });
        return 7;
      },
      catchUp: (after) => {
        afters.push(after);
        return { head: after, reset: false, events: [] };
      },
    });
    await settled();
    // The reads went ahead without a head; the live client's own token gives it, and what was read is read again.
    expect(afters).toEqual([7]);
    expect(count(api.calls, '/api/rpc/records/count')).toBe(2);
  });

  it('fills a gap through catch up rather than refetching everything held', async () => {
    const afters: number[] = [];
    const { api, client } = await liveLayer({
      catchUp: (after) => {
        afters.push(after);
        return after === 0 ? { head: 0, reset: false, events: [] } : { head: 3, reset: false, events: [] };
      },
    });
    const queries = count(api.calls, '/api/rpc/records/query');
    client.channel().onPublication(changed(1, []));
    client.channel().onPublication(changed(3, []));
    await settled();
    expect(afters).toEqual([0, 1]);
    expect(count(api.calls, '/api/rpc/records/query')).toBe(queries);
  });

  it('resyncs every store when catch up answers reset, with no reload of the page (AC-73)', async () => {
    let resets = 0;
    const { api, client } = await liveLayer({
      catchUp: () => {
        resets += 1;
        return { head: 9_000, reset: true, events: [] };
      },
    });
    await settled();
    expect(resets).toBe(1);
    // The view's count and the blocks on screen again, once; the next event counts on from the new head.
    expect(count(api.calls, '/api/rpc/records/count')).toBe(2);
    const counts = count(api.calls, '/api/rpc/records/count');
    client.channel().onPublication(changed(9_001, []));
    await settled();
    expect(resets).toBe(1);
    expect(count(api.calls, '/api/rpc/records/count')).toBe(counts);
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

describe('reporting faults the server never saw (spec 0010, AC-163)', () => {
  const proxyPage = (status: number) =>
    new Response('<html>Bad gateway</html>', { status, headers: { 'x-request-id': 'req-from-the-edge' } });

  it("reports a proxy's page, with the answer's request id and the procedure, once", async () => {
    const { data, faults } = layer({ fetch: () => Promise.resolve(proxyPage(502)) });
    expect(await failure(data.system.status())).toMatchObject({ code: 'API_UNAVAILABLE' });
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ requestId: 'req-from-the-edge', procedure: 'system.status' });
  });

  it('reports an error thrown inside the layer, which no answer carried', async () => {
    const bug = new RangeError('a bug on the way out');
    const { data, faults } = layer({ fetch: () => Promise.reject(bug) });
    expect(await failure(data.system.status())).toMatchObject({ code: 'INTERNAL' });
    expect(faults).toEqual([{ error: bug }]);
  });

  it('never reports being offline, a refusal, or a fault the server reported itself', async () => {
    const offline = layer({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    await failure(offline.data.system.status());
    const refused = layer(
      fakeApi({
        objects: () => {
          throw new ORPCError('NOT_FOUND', { status: 404, message: 'There is no workspace at this address.' });
        },
      }),
    );
    await failure(refused.data.objects.list('acme'));
    const internal = layer(
      fakeApi({
        objects: () => {
          throw new ORPCError('INTERNAL', { status: 500, message: 'Something went wrong. Try again.' });
        },
      }),
    );
    await failure(internal.data.objects.list('acme'));
    expect([...offline.faults, ...refused.faults, ...internal.faults]).toEqual([]);
  });

  it('still rejects with the DataError when monitoring itself throws', async () => {
    const data = createDataLayer({
      origin: ORIGIN,
      notify: () => undefined,
      mintId: () => 'id',
      onSignedOut: () => undefined,
      currentPath: () => '/',
      fetch: () => Promise.resolve(proxyPage(502)),
      report: () => {
        throw new Error('monitoring is broken');
      },
    });
    expect(await failure(data.system.status())).toMatchObject({ code: 'API_UNAVAILABLE' });
  });

  it('reports a sign in step answered by a proxy, and not a refused code', async () => {
    const proxied = layer({ fetch: () => Promise.resolve(proxyPage(502)) });
    await failure(proxied.data.auth.sendCode('ada@example.com'));
    expect(proxied.faults).toHaveLength(1);
    expect(proxied.faults[0]).toMatchObject({ requestId: 'req-from-the-edge', procedure: 'auth.sendCode' });

    const refused = layer(
      fakeApi({}, () => json({ code: 'INVALID_OTP', message: 'That code isn’t right.', status: 400 }, 400)),
    );
    await failure(refused.data.auth.verify('ada@example.com', '000000'));
    expect(refused.faults).toEqual([]);
  });

  it('counts a cancelled call as nothing that failed', () => {
    expect(isUnseenFault(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
    expect(isUnseenFault(new Error('a bug inside the layer'))).toBe(true);
    expect(isUnseenFault(dataError('INTERNAL', 'Something went wrong.'))).toBe(false);
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

  it('sends Google back to the deep link, and a refused Google sign in to /sign-in that still holds it', async () => {
    const sent: { readonly path: string; readonly callbackURL: unknown; readonly errorCallbackURL: unknown }[] = [];
    const api = fakeApi({}, (path, body) => {
      const { callbackURL, errorCallbackURL } = (body ?? {}) as Record<string, unknown>;
      sent.push({ path, callbackURL, errorCallbackURL });
      return json({ url: 'https://accounts.google.com/o/oauth2/auth', redirect: false });
    });
    const { data } = layer(api);
    await data.auth.signInWithGoogle('/w/acme/objects/people');
    await data.auth.signInWithGoogle('/');
    expect(sent).toEqual([
      {
        path: '/sign-in/social',
        callbackURL: `${ORIGIN}/w/acme/objects/people`,
        errorCallbackURL: `${ORIGIN}/sign-in?redirect=%2Fw%2Facme%2Fobjects%2Fpeople`,
      },
      { path: '/sign-in/social', callbackURL: `${ORIGIN}/`, errorCallbackURL: `${ORIGIN}/sign-in` },
    ]);
  });

  it('rejects a closed sign up and a wrong code with their codes and messages', async () => {
    const api = fakeApi({}, (path) =>
      path === '/sign-in/email-otp'
        ? json({ code: 'INVALID_OTP', message: 'That code isn’t right. Try again, or send a new one.' }, 400)
        : json({ code: 'SIGNUP_CLOSED', message: "Sign up isn't open yet." }, 403),
    );
    const { data, signedOut } = layer(api);
    expect(await failure(data.auth.sendCode('new@example.com'))).toMatchObject({
      code: 'SIGNUP_CLOSED',
      message: "Sign up isn't open yet.",
    });
    expect(await failure(data.auth.verify('ada@example.com', '123456'))).toMatchObject({
      code: 'INVALID_OTP',
      message: 'That code isn’t right. Try again, or send a new one.',
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

describe('refusal wording', () => {
  const taken = dataError('UNIQUE_CONFLICT', 'Not saved.', {
    refusals: [
      { code: 'UNIQUE_CONFLICT', message: 'Another record already has this value for Email.', attributeId: 'a1' },
    ],
  });

  it('gives a field, a cell and a toast the same sentence', () => {
    expect(refusalFor(taken, 'a1')).toBe('Another record already has this value for Email.');
    expect(refusalSummary(taken)).toBe('Another record already has this value for Email.');
  });

  it('gives other attributes nothing, and a refusal about nothing in particular to every one', () => {
    expect(refusalFor(taken, 'a2')).toBeUndefined();
    const whole = dataError('LIMIT_REACHED', 'This object is full.');
    expect(refusalFor(whole, 'a2')).toBe('This object is full.');
    expect(refusalSummary(whole)).toBe('This object is full.');
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
