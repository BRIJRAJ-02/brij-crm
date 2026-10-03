// A signed in user's workspace (spec 0005, AC-30), against a real Postgres as
// the app role: one transaction with the directory rows, an idempotent repeat,
// and both slug constraints refusing the same way.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser } from '@crm/db/testing';
import { newId } from './ids.ts';
import { isRefusal } from './refusals.ts';
import { createUserWorkspace, createWorkspace, type UserWorkspaceInput } from './workspaces.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-user-workspace-tests' });
  identity = createIdentityStore({ url: appUrl, applicationName: 'crm-user-workspace-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);

async function user(name = 'Ada Lovelace') {
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(appUrl, { email });
  return { userId, name, email };
}

async function input(overrides: Partial<UserWorkspaceInput> = {}): Promise<UserWorkspaceInput> {
  return { id: newId(), name: ' Acme ', slug: `acme-${tag()}`, firstMember: await user(), ...overrides };
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

/** What the workspace holds, read inside it. */
async function inside(workspaceId: string) {
  return db.withWorkspace(workspaceId, async (tx) => {
    const workspaces = await tx.execute<{ id: string }>(sql`select id from workspaces`);
    const members = await tx.execute<{ id: string; user_id: string; name: string; email: string }>(
      sql`select id, user_id, name, email from members`,
    );
    const objects = await tx.execute<{ standard_key: string }>(sql`select standard_key from objects order by 1`);
    return { workspaces: workspaces.rows, members: members.rows, objects: objects.rows.map((row) => row.standard_key) };
  });
}

describe('a signed in user creates a workspace', () => {
  it('writes the workspace, the template, their member row and the directory rows', async () => {
    const given = await input();
    const created = await createUserWorkspace(db, given);
    expect(created).toEqual({
      workspace: { id: given.id, slug: given.slug, name: 'Acme' },
      memberId: expect.any(String) as string,
      replayed: false,
    });
    const state = await inside(given.id);
    expect(state.workspaces).toEqual([{ id: given.id }]);
    expect(state.members).toEqual([
      { id: created.memberId, user_id: given.firstMember.userId, name: 'Ada Lovelace', email: given.firstMember.email },
    ]);
    expect(state.objects).toEqual(['companies', 'deals', 'people']);
    expect(await identity.findWorkspace(given.slug)).toEqual(created.workspace);
    expect(await identity.workspacesOf(given.firstMember.userId)).toEqual([created.workspace]);
  });

  it('is one transaction: a failure after the directory rows leaves no workspace and no directory rows', async () => {
    const given = await input();
    const failing = () => Promise.reject(new Error('forced'));
    await expect(createUserWorkspace(db, given, [failing])).rejects.toThrow('forced');
    expect(await inside(given.id)).toEqual({ workspaces: [], members: [], objects: [] });
    expect(await identity.findWorkspace(given.slug)).toBeUndefined();
    expect(await identity.workspacesOf(given.firstMember.userId)).toEqual([]);
    // And the id and slug are still free.
    expect((await createUserWorkspace(db, given)).replayed).toBe(false);
  });

  it('returns the same workspace when the request is repeated, creating nothing twice', async () => {
    const given = await input();
    const first = await createUserWorkspace(db, given);
    const again = await createUserWorkspace(db, given);
    expect(again).toEqual({ ...first, replayed: true });
    // Even with a different name and slug, the id is what makes it the same request.
    const renamed = await createUserWorkspace(db, { ...given, name: 'Other', slug: `other-${tag()}` });
    expect(renamed).toEqual({ ...first, replayed: true });
    expect((await inside(given.id)).members).toHaveLength(1);
    expect(await identity.workspacesOf(given.firstMember.userId)).toEqual([first.workspace]);
  });

  it('makes one workspace when the same request arrives twice at once', async () => {
    const given = await input();
    const results = await Promise.all([createUserWorkspace(db, given), createUserWorkspace(db, given)]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0].memberId).toBe(results[1].memberId);
    expect((await inside(given.id)).members).toHaveLength(1);
  });

  it('refuses ID_TAKEN when the id belongs to another user’s workspace', async () => {
    const given = await input();
    await createUserWorkspace(db, given);
    const other = await user('Grace Hopper');
    expect(await refusalOf(createUserWorkspace(db, { ...given, firstMember: other }))).toMatchObject({
      code: 'ID_TAKEN',
    });
    expect(
      await refusalOf(createUserWorkspace(db, { ...given, slug: `fresh-${tag()}`, firstMember: other })),
    ).toMatchObject({ code: 'ID_TAKEN' });
    expect(await identity.workspacesOf(other.userId)).toEqual([]);
  });

  it('refuses SLUG_TAKEN for a live workspace’s address (workspaces_slug)', async () => {
    const slug = `taken-${tag()}`;
    // A workspace that isn't in the directory, so only the tenant index can catch it.
    await createWorkspace(db, { name: 'Seeded', slug, firstMember: { name: 'Seed', email: 'seed@example.com' } });
    const given = await input({ slug });
    expect(await refusalOf(createUserWorkspace(db, given))).toEqual({
      code: 'SLUG_TAKEN',
      message: 'That workspace address is taken. Pick another.',
    });
    expect(await inside(given.id)).toEqual({ workspaces: [], members: [], objects: [] });
  });

  it('refuses SLUG_TAKEN for an address the directory ever held (workspace_directory_slug)', async () => {
    const first = await input();
    await createUserWorkspace(db, first);
    // The workspace stops using it, so only the directory's unconditional index remembers it.
    await db.withWorkspace(first.id, (tx) => tx.execute(sql`update workspaces set deleted_at = now()`));
    const given = await input({ slug: first.slug });
    expect(await refusalOf(createUserWorkspace(db, given))).toEqual({
      code: 'SLUG_TAKEN',
      message: 'That workspace address is taken. Pick another.',
    });
    expect(await inside(given.id)).toEqual({ workspaces: [], members: [], objects: [] });
    expect(await identity.workspacesOf(given.firstMember.userId)).toEqual([]);
  });

  it('refuses an address outside the slug rule', async () => {
    for (const slug of ['Acme', 'ab', 'a--b', '-acme', 'acme-', 'a'.repeat(41), 'acme co']) {
      expect(await refusalOf(createUserWorkspace(db, await input({ slug })))).toMatchObject({
        code: 'CONFIG_INVALID',
      });
    }
  });

  it('refuses an id that is not a UUID v7', async () => {
    expect(await refusalOf(createUserWorkspace(db, await input({ id: randomUUID() })))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});
