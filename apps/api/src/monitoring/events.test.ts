// The product events, end to end (spec 0010, AC-173 to AC-177): the real app
// on the test Postgres, signing in by code through Mailpit, with the real
// PostHog wrapper sending to a fake capture endpoint on this machine. A new
// user, a workspace and a first record each send one parsed event, after the
// write commits and with ids only; signing in again, a replayed or refused
// workspace create, a second record and a refused create send none; and each
// milestone row exists once.
import { milestoneEventId } from '@crm/contracts/events';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { type FakePostHog, startFakePostHog } from '../../test/posthog.ts';
import {
  codeFor,
  cookieFrom,
  newEmail,
  newIp,
  rpcClient,
  sendCode,
  signInApp,
  testConnections,
  verifyCode,
} from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, tag } from '../../test/workspace.ts';
import { signUpMethod } from '../auth/auth.ts';
import { log } from '../log.ts';
import { type Analytics, createAnalytics } from './posthog.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let fake: FakePostHog;
let analytics: Analytics;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
});
afterAll(async () => {
  await identity.close();
  await db.close();
});
beforeEach(async () => {
  fake = await startFakePostHog();
  analytics = createAnalytics({ key: 'phc_testkey', host: fake.host, environment: 'production', log, flushAt: 1 });
  ({ app } = signInApp({ db, identity }, {}, { analytics }));
});
afterEach(async () => {
  await analytics.shutdown(2000);
  await fake.close();
});

/** Every event sent so far, once everything queued has gone out. */
async function sent() {
  await analytics.shutdown(2000);
  return fake.events();
}

/** The milestone rows a workspace holds, read as the owner. */
const milestonesOf = (workspaceId: string) =>
  testQuery<{ milestone: string }>(
    ownerUrl,
    'select milestone from workspace_milestones where workspace_id = $1 order by reached_at, milestone',
    [workspaceId],
  );

/** Signs `email` in by code and answers the session cookie. */
async function signInBy(email: string): Promise<string> {
  const ip = newIp();
  await sendCode(app, email, ip);
  const signedIn = await verifyCode(app, email, await codeFor(email), ip);
  expect(signedIn.status).toBe(200);
  return cookieFrom(signedIn);
}

describe('user_signed_up (AC-174)', () => {
  it('is sent once for a new account, by user id with the email code method, and never on signing in again', async () => {
    const email = newEmail();
    const cookie = await signInBy(email);
    const { user } = await rpcClient(app, cookie).me.get();
    await expect.poll(() => fake.events()).toHaveLength(1);
    await signInBy(email);
    const events = await sent();
    expect(events).toEqual([
      expect.objectContaining({
        event: 'user_signed_up',
        distinct_id: user.id,
        properties: expect.objectContaining({ method: 'email_code', environment: 'production' }) as unknown,
      }),
    ]);
    // Nothing personal left: not the email, not its domain's address, not a name.
    expect(JSON.stringify(fake.requests)).not.toContain(email);
  });
});

describe('signUpMethod', () => {
  it('names the method by the route that made the account, and none for any other route', () => {
    expect(signUpMethod('/sign-in/email-otp')).toBe('email_code');
    // Google's callback, as a request reaches it and as Better Auth declares it, and a sign in with its id token.
    for (const route of ['/callback/google', '/callback/:id', '/sign-in/social'])
      expect(signUpMethod(route)).toBe('google');
    for (const route of [undefined, '/sign-up/email', '/callback/github', 'virtual:']) {
      expect(signUpMethod(route)).toBeUndefined();
    }
  });
});

describe('workspace_created (AC-175, AC-177)', () => {
  it('is sent once after the workspace commits, with its fixed id; a replay and a refused create send nothing', async () => {
    const cookie = await signInBy(newEmail());
    const client = rpcClient(app, cookie);
    const { user } = await client.me.get();
    const input = { id: newId(), name: 'Acme Ltd', slug: `acme-${tag()}`, memberName: 'Ada Lovelace' };
    const { workspace } = await client.workspaces.create(input);
    // The same request again (a lost response): the same workspace, no second event.
    expect((await client.workspaces.create(input)).workspace).toEqual(workspace);
    // A different workspace on a taken address: refused, nothing stored or sent.
    const refused = await failure(() => client.workspaces.create({ ...input, id: newId() }));
    expect(refused.code).toBe('SLUG_TAKEN');

    const events = (await sent()).filter((event) => event.event === 'workspace_created');
    // Dated when the row says the workspace was made, not when the event left.
    const [row] = await testQuery<{ reached_at: Date }>(
      ownerUrl,
      `select reached_at from workspace_milestones where workspace_id = $1`,
      [workspace.id],
    );
    expect(events).toEqual([
      {
        event: 'workspace_created',
        distinct_id: user.id,
        uuid: milestoneEventId(workspace.id, 'workspace_created'),
        timestamp: row?.reached_at.toISOString(),
        properties: expect.objectContaining({ workspace_id: workspace.id, environment: 'production' }) as unknown,
      },
    ]);
    expect(Object.keys(events[0]?.properties ?? {}).filter((key) => !key.startsWith('$'))).toEqual([
      'workspace_id',
      'environment',
    ]);
    expect(await milestonesOf(workspace.id)).toEqual([{ milestone: 'workspace_created' }]);
    // Neither the workspace's name, its address nor the member's name went to PostHog.
    const wire = JSON.stringify(fake.requests);
    for (const personal of ['Acme Ltd', input.slug, 'Ada Lovelace']) expect(wire).not.toContain(personal);
  });
});

describe('first_record_created (AC-176, AC-177)', () => {
  it('is sent once, for the first record a member makes; a refused create and later records send nothing', async () => {
    const m = await memberWithWorkspace(app);
    const { user } = await m.client.me.get();
    // Setting the workspace up made no record and reached only workspace_created.
    expect(await milestonesOf(m.workspace.id)).toEqual([{ milestone: 'workspace_created' }]);

    // Refused: a person needs a name. Nothing stored, nothing sent.
    await failure(() =>
      m.client.records.create({ workspace: m.slug, objectId: m.people.id, id: newId(), mutationId: newId() }),
    );
    expect(await milestonesOf(m.workspace.id)).toEqual([{ milestone: 'workspace_created' }]);

    const values = { [m.attribute('name')]: { firstName: 'Grace', lastName: 'Hopper' } };
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      values,
      mutationId: newId(),
    });
    await m.client.records.create({ workspace: m.slug, objectId: m.companies.id, id: newId(), mutationId: newId() });

    const events = (await sent()).filter((event) => event.event === 'first_record_created');
    expect(events).toEqual([
      expect.objectContaining({
        event: 'first_record_created',
        distinct_id: user.id,
        uuid: milestoneEventId(m.workspace.id, 'first_record_created'),
        properties: expect.objectContaining({
          workspace_id: m.workspace.id,
          object_kind: 'people',
          environment: 'production',
          $process_person_profile: false,
        }) as unknown,
      }),
    ]);
    expect(await milestonesOf(m.workspace.id)).toEqual([
      { milestone: 'workspace_created' },
      { milestone: 'first_record_created' },
    ]);
    expect(JSON.stringify(fake.requests)).not.toContain('Hopper');
  });

  it('sends the three events in the order a person gets going, each once', async () => {
    const m = await memberWithWorkspace(app);
    await m.client.records.create({ workspace: m.slug, objectId: m.companies.id, id: newId(), mutationId: newId() });
    const events = await sent();
    expect(events.map((event) => event.event)).toEqual(['user_signed_up', 'workspace_created', 'first_record_created']);
    expect(events[2]?.properties.object_kind).toBe('companies');
    expect(new Set(events.map((event) => event.distinct_id)).size).toBe(1);
  });
});

describe('without a key (AC-178)', () => {
  it('sends nothing and changes nothing the app answers', async () => {
    ({ app } = signInApp({ db, identity }));
    const m = await memberWithWorkspace(app);
    await m.client.records.create({ workspace: m.slug, objectId: m.companies.id, id: newId(), mutationId: newId() });
    // The milestones are still stored: they are the source of truth, PostHog only charts them.
    expect(await milestonesOf(m.workspace.id)).toHaveLength(2);
    expect(await sent()).toEqual([]);
  });
});
