// objects.list (spec 0005): a member gets their workspace's live objects for
// the sidebar, and anyone else the same NOT_FOUND as an unknown address,
// through a real session against a real Postgres.
import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '@crm/core';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';

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
