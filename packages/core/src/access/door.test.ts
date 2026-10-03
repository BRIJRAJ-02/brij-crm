// The access door (spec 0005, AC-32) against a real Postgres as the app role:
// a member gets a scope for their workspace and nothing else, and every other
// caller gets the same NOT_FOUND, so nothing says whether a workspace exists.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser } from '@crm/db/testing';
import { listAttributes } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { enterWorkspace } from './door.ts';

const { appUrl, identityUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-door-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-door-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);

/** A signed up user with their own workspace. */
async function userWithWorkspace() {
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email });
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: 'Acme',
    slug: `acme-${tag()}`,
    firstMember: { userId, name: 'Ada', email },
  });
  return { userId, ...created };
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

describe('the access door', () => {
  it("gives an active member a scope that reads their workspace, and nothing of anyone else's", async () => {
    const a = await userWithWorkspace();
    const b = await userWithWorkspace();
    const scope = await enterWorkspace({ db, identity }, { userId: a.userId, slug: a.workspace.slug });
    expect(scope).toEqual({ db, workspaceId: a.workspace.id, actor: { type: 'member', id: a.memberId } });

    const seen = await db.withWorkspace(scope.workspaceId, async (tx) => ({
      workspaces: (await tx.execute<{ id: string }>(sql`select id from workspaces`)).rows.map((row) => row.id),
      members: (await tx.execute<{ id: string }>(sql`select id from members`)).rows.map((row) => row.id),
    }));
    expect(seen).toEqual({ workspaces: [a.workspace.id], members: [a.memberId] });
    expect(seen.members).not.toContain(b.memberId);

    // An engine read with the scope sees this workspace's People and not the other's.
    const peopleOf = async (workspaceId: string) =>
      db.withWorkspace(workspaceId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`select id from objects where standard_key = 'people'`);
        return rows.rows[0]?.id ?? '';
      });
    expect((await listAttributes(scope, await peopleOf(a.workspace.id))).length).toBeGreaterThan(0);
    expect(await listAttributes(scope, await peopleOf(b.workspace.id))).toEqual([]);
  });

  it('refuses a non member, a removed member, an unknown address and a deleted workspace all the same way', async () => {
    const a = await userWithWorkspace();
    const b = await userWithWorkspace();
    const removed = await userWithWorkspace();
    await db.withWorkspace(removed.workspace.id, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${removed.memberId}`),
    );
    const deleted = await userWithWorkspace();
    await db.withWorkspace(deleted.workspace.id, (tx) => tx.execute(sql`update workspaces set deleted_at = now()`));
    const nobody = await createTestUser(identityUrl, { email: `${tag()}@example.com` });

    const attempts = [
      // Workspace B's member asking for workspace A.
      { userId: b.userId, slug: a.workspace.slug },
      // A signed up user in no workspace at all.
      { userId: nobody, slug: a.workspace.slug },
      { userId: removed.userId, slug: removed.workspace.slug },
      { userId: a.userId, slug: `missing-${tag()}` },
      { userId: deleted.userId, slug: deleted.workspace.slug },
      // Not a user id at all.
      { userId: 'not-a-uuid', slug: a.workspace.slug },
      { userId: randomUUID(), slug: a.workspace.slug },
    ];
    const refusals = await Promise.all(attempts.map((input) => refusalOf(enterWorkspace({ db, identity }, input))));
    const expected = [{ code: 'NOT_FOUND', message: "That workspace doesn't exist, or you're not a member of it." }];
    for (const refusal of refusals) expect(refusal).toEqual(expected);
  });
});
