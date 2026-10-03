// The signed in person's account (spec 0005, AC-30) against a real Postgres:
// the workspace list comes from the directory, and making a workspace names
// the account only while it has no name.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser } from '@crm/db/testing';
import { newId } from '../engine/ids.ts';
import { getMe, startWorkspace } from './account.ts';

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
    expect(created).toEqual({ workspace: { id: input.id, slug: input.slug, name: 'Acme' } });
    expect((await identity.getUser(user.id))?.name).toBe('Ada Lovelace');
    expect((await getMe({ identity }, user)).workspaces).toEqual([created.workspace]);

    // The same request again returns the same workspace, and keeps the name.
    expect(await startWorkspace({ db, identity }, user, { ...input, memberName: 'Someone' })).toEqual(created);
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
