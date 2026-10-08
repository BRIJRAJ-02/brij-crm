// The load harness's minted sessions (spec 0011, AC-196, AC-212): the API
// accepts a cookie minted by packages/core/scripts/load-sessions.ts exactly as
// one from signing in, so a Better Auth upgrade that changes the cookie or
// session format fails here, not in a load run. And no API source imports the
// minting script: only this test may (a lint rule in packages/config refuses
// it too; the search below backs it up).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, type Database, type IdentityStore } from '@crm/db';
import { createTestUser } from '@crm/db/testing';
import { LOAD_AUTH_SECRET, mintSessions, signSessionCookie } from '@crm/core/load-sessions';
import { createUserWorkspace, newId } from '@crm/core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { rpcClient, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, tag } from '../../test/workspace.ts';

const { ownerUrl, identityUrl } = inject('testDatabase');
let connections: { db: Database; identity: IdentityStore };
let owner: Database;

beforeAll(() => {
  connections = testConnections();
  owner = createDatabase({ url: ownerUrl, applicationName: 'crm-api-minted-session-tests' });
});
afterAll(async () => {
  await owner.close();
  await connections.db.close();
  await connections.identity.close();
});

/** The app as the load stack runs it: local, signing sessions with the load stack's secret. */
const loadStackApp = () => signInApp(connections, { BETTER_AUTH_SECRET: LOAD_AUTH_SECRET }).app;

/** A seeded load user (the email the seed gives) with its own workspace: the only kind minting accepts. */
async function loadUser(): Promise<{ email: string; userId: string; workspaceId: string }> {
  const email = `load-user-${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email, name: 'Load User 1' });
  const workspaceId = newId();
  await createUserWorkspace(owner, {
    id: workspaceId,
    name: 'Load',
    slug: `load-${tag()}`,
    firstMember: { userId, name: 'Load User 1', email },
  });
  return { email, userId, workspaceId };
}

describe('a minted session', () => {
  it('signs its user in to the API, as a signed in session does', async () => {
    const { email, userId, workspaceId } = await loadUser();
    const cookies = await mintSessions(owner, {
      workspaceId,
      users: [{ n: 1, userId }],
      secret: LOAD_AUTH_SECRET,
    });
    const me = await rpcClient(loadStackApp(), cookies['1']).me.get();
    expect(me.user).toEqual({ id: userId, name: 'Load User 1', email });
  });

  it('is refused when signed with another secret', async () => {
    const { userId, workspaceId } = await loadUser();
    const cookies = await mintSessions(owner, {
      workspaceId,
      users: [{ n: 1, userId }],
      secret: LOAD_AUTH_SECRET,
    });
    const token = decodeURIComponent((cookies['1'] ?? '').split('=')[1] ?? '').split('.')[0] ?? '';
    const forged = signSessionCookie(token, 'local-only-some-other-secret-of-enough-length');
    const refused = await failure(() => rpcClient(loadStackApp(), forged).me.get());
    expect(refused.status).toBe(401);
  });
});

describe('the API source', () => {
  it('never imports the minting script outside a test', async () => {
    const root = join(import.meta.dirname, '..');
    const files = (await readdir(root, { recursive: true })).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    const importers = [];
    for (const file of files) {
      if ((await readFile(join(root, file), 'utf8')).includes('load-sessions')) importers.push(file);
    }
    expect(importers).toEqual([]);
  });
});
