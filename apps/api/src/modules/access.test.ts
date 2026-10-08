// access.mine and the schema permission at the API (spec 0009, AC-135,
// AC-136): a person reads their own role and permissions, and a member's
// attributes.create answers 403 FORBIDDEN and writes nothing, while an
// admin's succeeds. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../test/workspace.ts';

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

describe('access.mine', () => {
  it('answers the creator as the owner, with every permission', async () => {
    const { client, slug } = await memberWithWorkspace(app);
    const mine = await client.access.mine({ workspace: slug });
    expect(mine.role).toBe('owner');
    expect(mine.roleLabel).toBe('Owner');
    expect(mine.permissions).toContain('schema.manage');
    expect(mine.permissions).toContain('billing.manage');
  });

  it('answers a member with their role and export alone, and a non member NOT_FOUND', async () => {
    const { workspace, slug } = await memberWithWorkspace(app);
    const member = await joined(workspace.id, 'member');
    expect(await member.access.mine({ workspace: slug })).toEqual({
      role: 'member',
      roleLabel: 'Member',
      permissions: ['records.export'],
    });
    const stranger = await memberWithWorkspace(app);
    expect(await refusal(() => stranger.client.access.mine({ workspace: slug }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

describe('attributes.create needs schema.manage (AC-135)', () => {
  it('refuses a member 403 and writes no attribute and no outbox row; an admin adds one', async () => {
    const { workspace, slug, people } = await memberWithWorkspace(app);
    const count = async (table: 'attributes' | 'outbox') =>
      (
        await testQuery<{ count: number }>(
          ownerUrl,
          `select count(*)::int as count from ${table} where workspace_id = $1`,
          [workspace.id],
        )
      )[0]?.count;
    const before = { attributes: await count('attributes'), outbox: await count('outbox') };
    const member = await joined(workspace.id, 'member');
    expect(
      await refusal(() =>
        member.attributes.create({
          workspace: slug,
          objectId: people.id,
          title: 'Nickname',
          type: 'text',
          mutationId: newId(),
        }),
      ),
    ).toEqual({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Only workspace owners and admins can change objects and attributes.',
    });
    expect({ attributes: await count('attributes'), outbox: await count('outbox') }).toEqual(before);

    const admin = await joined(workspace.id, 'admin');
    const made = await admin.attributes.create({
      workspace: slug,
      objectId: people.id,
      title: 'Nickname',
      type: 'text',
      mutationId: newId(),
    });
    expect(made.title).toBe('Nickname');
  });
});
