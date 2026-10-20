// The signed in person's account (spec 0005, AC-30) against a real Postgres:
// the workspace list comes from the directory, and making a workspace names
// the account only while it has no name.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser } from '@crm/db/testing';
import { NO_RULE_SOURCE } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { getMe, setLastWorkspace, startWorkspace } from './account.ts';

const { appUrl, identityUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-account-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-account-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);

async function person(name = '') {
  const email = `${tag()}@example.com`;
  const id = await createTestUser(identityUrl, { email, name });
  return { id, name, email };
}

describe('the account', () => {
  it('starts a workspace, names an unnamed account, and lists it', async () => {
    const user = await person();
    expect(await getMe({ identity }, user)).toEqual({ user, workspaces: [] });

    const input = { id: newId(), name: 'Acme', slug: `acme-${tag()}`, memberName: ' Ada Lovelace ' };
    const created = await startWorkspace({ db, identity }, user, input);
    expect(created).toEqual({
      workspace: { id: input.id, slug: input.slug, name: 'Acme' },
      milestones: [{ milestone: 'workspace_created', workspaceId: input.id, reachedAt: expect.any(String) as string }],
    });
    expect((await identity.getUser(user.id))?.name).toBe('Ada Lovelace');
    expect((await getMe({ identity }, user)).workspaces).toEqual([created.workspace]);

    // The same request again returns the same workspace, and keeps the name.
    expect(await startWorkspace({ db, identity }, user, { ...input, memberName: 'Someone' })).toEqual({
      workspace: created.workspace,
      milestones: [],
    });
    expect((await identity.getUser(user.id))?.name).toBe('Ada Lovelace');
  });

  it('keeps a name the account already has', async () => {
    const user = await person('Grace Hopper');
    await startWorkspace({ db, identity }, user, {
      id: newId(),
      name: 'Navy',
      slug: `navy-${tag()}`,
      memberName: 'Amazing Grace',
    });
    expect((await identity.getUser(user.id))?.name).toBe('Grace Hopper');
  });
});

describe('the last workspace (spec 0031, AC-802)', () => {
  it('remembers the workspace a member opened, and answers it while they are still in it', async () => {
    const user = await person('Ada');
    const make = (name: string) =>
      startWorkspace({ db, identity }, user, {
        id: newId(),
        name,
        slug: `${name.toLowerCase()}-${tag()}`,
        memberName: 'Ada',
      });
    const first = await make('First');
    const second = await make('Second');
    expect((await getMe({ identity }, user)).lastWorkspaceId).toBeUndefined();
    await setLastWorkspace({ db, identity, rules: NO_RULE_SOURCE }, user, second.workspace.slug);
    expect((await getMe({ identity }, user)).lastWorkspaceId).toBe(second.workspace.id);
    await setLastWorkspace({ db, identity, rules: NO_RULE_SOURCE }, user, first.workspace.slug);
    expect((await getMe({ identity }, user)).lastWorkspaceId).toBe(first.workspace.id);
    // Gone from the directory (they left): no longer answered, so `/` falls back to the oldest.
    await identity.dropMembership(user.id, first.workspace.id);
    expect(await getMe({ identity }, user)).toEqual({ user, workspaces: [second.workspace] });
  });

  it("refuses a workspace the person isn't in, as the door does, and writes nothing", async () => {
    const owner = await person('Owner');
    const stranger = await person('Stranger');
    const theirs = await startWorkspace({ db, identity }, owner, {
      id: newId(),
      name: 'Theirs',
      slug: `theirs-${tag()}`,
      memberName: 'Owner',
    });
    await expect(
      setLastWorkspace({ db, identity, rules: NO_RULE_SOURCE }, stranger, theirs.workspace.slug),
    ).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    await expect(
      setLastWorkspace({ db, identity, rules: NO_RULE_SOURCE }, stranger, `missing-${tag()}`),
    ).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    expect(await identity.lastWorkspaceOf(stranger.id)).toBeUndefined();
  });
});
