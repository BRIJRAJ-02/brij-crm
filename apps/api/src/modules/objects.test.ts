// objects.list (spec 0005): a member gets their workspace's live objects for
// the sidebar, and anyone else the same NOT_FOUND as an unknown address; the
// object writes and usage.get (spec 0012): schema.manage for every write (a
// member's 403 writes nothing), refusals on their fields, and usage through
// the caller's access, and a custom object's name attribute (late trap #15).
// A real session against a real Postgres.
import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '@crm/core';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { refusalsOf } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
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

/** A signed in person with their own workspace, made through the real procedure. */
async function memberWithWorkspace() {
  const { cookie } = await signIn(app);
  const client = rpcClient(app, cookie);
  const { workspace } = await client.workspaces.create({
    id: newId(),
    name: 'Acme',
    slug: `objects-${tag()}`,
    memberName: 'Ada',
  });
  return { client, workspace };
}

describe('objects.list', () => {
  it("answers a member their workspace's live objects, People first, with each tile and primary attribute", async () => {
    const { client, workspace } = await memberWithWorkspace();
    const objects = await client.objects.list({ workspace: workspace.slug });
    expect(objects[0]).toEqual({
      id: expect.any(String) as string,
      apiSlug: 'people',
      singularName: 'Person',
      pluralName: 'People',
      icon: 'user',
      hue: 'blue',
      standardKey: 'people',
      primaryAttributeId: expect.any(String) as string,
      // What the member may do with its records (spec 0009): every role writes everything until #24.
      access: 'write',
      // The workspace's order, and the settings' badges (spec 0012).
      position: 0,
      isStandard: true,
      isArchived: false,
    });
    expect(objects.map((object) => object.standardKey)).toContain('companies');

    await testQuery(
      ownerUrl,
      `update objects set archived_at = now() where workspace_id = $1 and standard_key = 'companies'`,
      [workspace.id],
    );
    const live = await client.objects.list({ workspace: workspace.slug });
    expect(live.map((object) => object.standardKey)).not.toContain('companies');
    expect(live.length).toBe(objects.length - 1);
  });

  it('answers a non member and an unknown address the same NOT_FOUND, and no session 401', async () => {
    const a = await memberWithWorkspace();
    const b = await memberWithWorkspace();
    const notFound = {
      code: 'NOT_FOUND',
      status: 404,
      message: "That workspace doesn't exist, or you're not a member of it.",
    };
    const shape = (error: ORPCError<string, unknown>) => ({
      code: error.code,
      status: error.status,
      message: error.message,
    });
    expect(shape(await failure(() => b.client.objects.list({ workspace: a.workspace.slug })))).toEqual(notFound);
    expect(shape(await failure(() => a.client.objects.list({ workspace: `nowhere-${tag()}` })))).toEqual(notFound);
    expect(shape(await failure(() => rpcClient(app).objects.list({ workspace: a.workspace.slug })))).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
  });
});

/** Someone else, signed in, added to `workspaceId` with `role` (as #23's invites will), and their client. */
async function joined(workspaceId: string, role: 'admin' | 'member') {
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, $3, 'Bea', $4, $5, 'system', 'system')`,
    [workspaceId, newId(), user?.id, email, role],
  );
  return rpcClient(app, cookie);
}

const outboxCount = async (workspaceId: string) =>
  (
    await testQuery<{ n: number }>(ownerUrl, 'select count(*)::int as n from outbox where workspace_id = $1', [
      workspaceId,
    ])
  )[0]?.n ?? 0;

/** A workspace with its People object. */
async function withPeople() {
  const made = await memberWithWorkspace();
  const people = (await made.client.objects.list({ workspace: made.workspace.slug })).find(
    (object) => object.standardKey === 'people',
  );
  if (people === undefined) throw new Error('No People.');
  return { ...made, people };
}

describe('the object writes (spec 0012)', () => {
  it('creates an object at the end, and lists the archived ones only when asked', async () => {
    const { client, workspace } = await memberWithWorkspace();
    const made = await client.objects.create({
      workspace: workspace.slug,
      id: newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
      mutationId: newId(),
    });
    expect(made).toMatchObject({
      apiSlug: 'projects',
      position: 3,
      isStandard: false,
      isArchived: false,
      access: 'write',
    });
    await client.objects.archive({ workspace: workspace.slug, objectId: made.id, mutationId: newId() });
    expect((await client.objects.list({ workspace: workspace.slug })).map((object) => object.id)).not.toContain(
      made.id,
    );
    const all = await client.objects.list({ workspace: workspace.slug, includeArchived: true });
    expect(all.find((object) => object.id === made.id)).toMatchObject({ isArchived: true });
    const restored = await client.objects.restore({
      workspace: workspace.slug,
      objectId: made.id,
      mutationId: newId(),
    });
    expect(restored).toMatchObject({ isArchived: false, position: 3 });
  });

  it('answers a taken name 409 NAME_TAKEN on its field, and a reserved API name 422 on apiSlug', async () => {
    const { client, workspace } = await memberWithWorkspace();
    const taken = await failure(() =>
      client.objects.create({
        workspace: workspace.slug,
        id: newId(),
        singularName: 'Human',
        pluralName: 'people',
        apiSlug: 'humans',
        icon: 'user',
        hue: 'red',
        mutationId: newId(),
      }),
    );
    expect({ code: taken.code, status: taken.status }).toEqual({ code: 'NAME_TAKEN', status: 409 });
    expect(refusalsOf(taken)).toEqual([
      { code: 'NAME_TAKEN', message: 'An object called people already exists.', field: 'pluralName' },
    ]);
    const reserved = await failure(() =>
      client.objects.create({
        workspace: workspace.slug,
        id: newId(),
        singularName: 'Setting',
        pluralName: 'Settings list',
        apiSlug: 'settings',
        icon: 'folder',
        hue: 'red',
        mutationId: newId(),
      }),
    );
    expect({ code: reserved.code, status: reserved.status }).toEqual({ code: 'CONFIG_INVALID', status: 422 });
    expect(refusalsOf(reserved)[0]).toMatchObject({ field: 'apiSlug' });
  });

  it('answers a member 403 FORBIDDEN for every object write, and stores nothing', async () => {
    const { workspace, people } = await withPeople();
    const member = await joined(workspace.id, 'member');
    const before = await outboxCount(workspace.id);
    const base = { workspace: workspace.slug, mutationId: newId() };
    const calls = [
      () =>
        member.objects.create({
          ...base,
          id: newId(),
          singularName: 'Project',
          pluralName: 'Projects',
          icon: 'folder',
          hue: 'blue',
        }),
      () => member.objects.update({ ...base, objectId: people.id, pluralName: 'Humans' }),
      () => member.objects.reorder({ ...base, objectId: people.id, position: 2 }),
      () => member.objects.archive({ ...base, objectId: people.id }),
      () => member.objects.restore({ ...base, objectId: people.id }),
    ];
    for (const call of calls) {
      const error = await failure(call);
      expect({ code: error.code, status: error.status }).toEqual({ code: 'FORBIDDEN', status: 403 });
    }
    expect(await outboxCount(workspace.id)).toBe(before);
    expect((await member.objects.list({ workspace: workspace.slug })).map((object) => object.pluralName)).toContain(
      'People',
    );
  });

  it("changes a custom object's name attribute, and answers a standard object's 422 on primaryAttributeId", async () => {
    const { client, workspace, people } = await withPeople();
    const made = await client.objects.create({
      workspace: workspace.slug,
      id: newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
      attributes: [{ title: 'Code', type: 'text' }],
      mutationId: newId(),
    });
    const attributes = await client.attributes.list({ workspace: workspace.slug, objectId: made.id });
    const code = attributes.find((attribute) => attribute.title === 'Code')?.id ?? '';
    const edited = await client.objects.update({
      workspace: workspace.slug,
      objectId: made.id,
      primaryAttributeId: code,
      mutationId: newId(),
    });
    expect(edited.primaryAttributeId).toBe(code);
    const locked = await failure(() =>
      client.objects.update({
        workspace: workspace.slug,
        objectId: people.id,
        primaryAttributeId: code,
        mutationId: newId(),
      }),
    );
    expect({ code: locked.code, status: locked.status }).toEqual({ code: 'CONFIG_INVALID', status: 422 });
    expect(refusalsOf(locked)[0]).toMatchObject({ field: 'primaryAttributeId' });
  });

  it('moves an object in every member’s order', async () => {
    const { client, workspace, people } = await withPeople();
    const moved = await client.objects.reorder({
      workspace: workspace.slug,
      objectId: people.id,
      position: 2,
      mutationId: newId(),
    });
    expect(moved.map((object) => object.standardKey)).toEqual(['companies', 'deals', 'people']);
    const member = await joined(workspace.id, 'member');
    expect((await member.objects.list({ workspace: workspace.slug })).map((object) => object.standardKey)).toEqual([
      'companies',
      'deals',
      'people',
    ]);
  });
});

describe('usage.get (spec 0012, AC-243)', () => {
  it('answers an owner the custom object meter, and a member the per object counts only', async () => {
    const { client, workspace, people } = await withPeople();
    const owner = await client.usage.get({ workspace: workspace.slug });
    expect(owner.customObjects).toEqual({ used: 0, limit: 50 });
    expect(owner.attributes[people.id]?.limit).toBe(250);
    const member = await joined(workspace.id, 'member');
    const theirs = await member.usage.get({ workspace: workspace.slug });
    expect(theirs.customObjects).toBeUndefined();
    expect(theirs.attributes[people.id]).toEqual(owner.attributes[people.id]);
  });
});
