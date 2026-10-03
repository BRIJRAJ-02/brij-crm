// The bootstrap procedures (spec 0005, AC-30, AC-31): who am I, and making
// my first workspace, through a real session against a real Postgres.
import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '@crm/core';
import { newEmail, rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';

const { identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);

async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

async function signedIn() {
  const { email, cookie } = await signIn(app);
  return { email, cookie, client: rpcClient(app, cookie) };
}

describe('me.get', () => {
  it('answers 401 UNAUTHENTICATED without a session, or with a cookie that names none', async () => {
    for (const cookie of [undefined, 'better-auth.session_token=forged.value']) {
      const error = await failure(() => rpcClient(app, cookie).me.get());
      expect(error).toMatchObject({ code: 'UNAUTHENTICATED', status: 401, message: 'Sign in to continue.' });
    }
  });

  it('answers the signed in person and their workspaces, oldest first', async () => {
    const { email, client } = await signedIn();
    const me = await client.me.get();
    expect(me.user).toEqual({ id: expect.any(String) as string, name: '', email });
    const first = { id: newId(), name: 'First', slug: `first-${tag()}`, memberName: 'Ada' };
    const second = { id: newId(), name: 'Second', slug: `second-${tag()}`, memberName: 'Ada' };
    await client.workspaces.create(first);
    await client.workspaces.create(second);
    await testQuery(
      identityUrl,
      `update auth.workspace_directory set created_at = now() - interval '1 day' where workspace_id = $1`,
      [first.id],
    );
    const after = await client.me.get();
    expect(after.user.name).toBe('Ada');
    expect(after.workspaces).toEqual([
      { id: first.id, slug: first.slug, name: 'First' },
      { id: second.id, slug: second.slug, name: 'Second' },
    ]);
  });
});

describe('workspaces.create', () => {
  it('makes the workspace, its member row with the typed name, and the directory rows', async () => {
    const { client } = await signedIn();
    const input = { id: newId(), name: ' Acme ', slug: `acme-${tag()}`, memberName: ' Ada Lovelace ' };
    const created = await client.workspaces.create(input);
    expect(created).toEqual({ workspace: { id: input.id, slug: input.slug, name: 'Acme' } });
    expect((await client.me.get()).user.name).toBe('Ada Lovelace');
    expect(await identity.findWorkspace(input.slug)).toEqual(created.workspace);
    // Exempt from the outbox (spec 0005): nobody can be subscribed to a workspace that didn't exist.
    const events = await testQuery<{ events: number; seq: number }>(
      ownerUrl,
      `select (select count(*)::int from outbox where workspace_id = $1) as events,
        (select outbox_seq::int from workspace_counters where workspace_id = $1) as seq`,
      [input.id],
    );
    expect(events).toEqual([{ events: 0, seq: 0 }]);
  });

  it('answers a repeated request (a dropped response) with the same workspace, creating nothing twice', async () => {
    const { client } = await signedIn();
    const input = { id: newId(), name: 'Acme', slug: `acme-${tag()}`, memberName: 'Ada' };
    const first = await client.workspaces.create(input);
    expect(await client.workspaces.create(input)).toEqual(first);
    expect((await client.me.get()).workspaces).toEqual([first.workspace]);
  });

  it('refuses a taken address with 409 SLUG_TAKEN on the slug field', async () => {
    const owner = await signedIn();
    const slug = `taken-${tag()}`;
    await owner.client.workspaces.create({ id: newId(), name: 'Mine', slug, memberName: 'Ada' });
    const other = await signedIn();
    const error = await failure(() =>
      other.client.workspaces.create({ id: newId(), name: 'Yours', slug, memberName: 'Grace' }),
    );
    expect(error).toMatchObject({
      code: 'SLUG_TAKEN',
      status: 409,
      data: {
        refusals: [{ code: 'SLUG_TAKEN', field: 'slug', message: 'That workspace address is taken. Pick another.' }],
      },
    });
    expect((await other.client.me.get()).workspaces).toEqual([]);
  });

  it("refuses another person's workspace id with 409 ID_TAKEN", async () => {
    const owner = await signedIn();
    const id = newId();
    await owner.client.workspaces.create({ id, name: 'Mine', slug: `mine-${tag()}`, memberName: 'Ada' });
    const other = await signedIn();
    const error = await failure(() =>
      other.client.workspaces.create({ id, name: 'Yours', slug: `yours-${tag()}`, memberName: 'Grace' }),
    );
    expect(error).toMatchObject({ code: 'ID_TAKEN', status: 409, data: { refusals: [{ field: 'id' }] } });
  });

  it('refuses a bad address or a non v7 id as INPUT_INVALID, naming the field', async () => {
    const { client } = await signedIn();
    const bad = await failure(() =>
      client.workspaces.create({ id: newId(), name: 'Acme', slug: 'Not A Slug', memberName: 'Ada' }),
    );
    expect(bad).toMatchObject({ code: 'INPUT_INVALID', status: 400, data: { issues: [{ path: ['slug'] }] } });
    const v4 = await failure(() =>
      client.workspaces.create({ id: randomUUID(), name: 'Acme', slug: `acme-${tag()}`, memberName: 'Ada' }),
    );
    expect(v4).toMatchObject({ code: 'INPUT_INVALID', data: { issues: [{ path: ['id'] }] } });
  });

  it('needs a session, and a verified email', async () => {
    const input = { id: newId(), name: 'Acme', slug: `acme-${tag()}`, memberName: 'Ada' };
    expect(await failure(() => rpcClient(app).workspaces.create(input))).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    const { email, client } = await signedIn();
    // A Google account whose email Google hasn't verified would look like this.
    await testQuery(identityUrl, 'update auth."user" set email_verified = false where email = $1', [email]);
    expect(await failure(() => client.workspaces.create(input))).toMatchObject({
      code: 'EMAIL_UNVERIFIED',
      status: 403,
    });
    expect(await identity.findWorkspace(input.slug)).toBeUndefined();
  });

  it('keeps an unlisted email from signing up at all, so it never reaches this procedure', async () => {
    const closed = signInApp({ db, identity }, { SIGNUP_ALLOWLIST: [newEmail()] });
    await expect(signIn(closed.app)).rejects.toThrow(/403/);
  });
});
