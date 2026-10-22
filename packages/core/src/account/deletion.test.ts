// Deleting your own account in a deleted workspace (spec 0033, AC-903), against a real Postgres: a workspace deleted
// but inside its window is left too, so a restore never brings the person back, and it never blocks the deletion.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { enterDeletedWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { decodeTokenKey, sealTokens } from '../calendar/tokens.ts';
import { newId } from '../engine/ids.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { deleteWorkspace, restoreWorkspace } from '../workspace/settings.ts';
import { accountDeletionCheck, deleteMyAccount, DELETED_USER_NAME, type CalendarGrant } from './deletion.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-deletion-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-deletion-tests-identity' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => newId().slice(-12);
const tokenKey = decodeTokenKey(Buffer.alloc(32, 9).toString('base64'));

/** The deletion's dependencies, the session always freshly checked; `revoked` collects every grant handed back. */
function deletionDeps(revoked: CalendarGrant[]) {
  return {
    db,
    rules: NO_RULE_SOURCE,
    // A session that proved itself just now: the step up has its own tests.
    identity: {
      findWorkspace: (slug: string) => identity.findWorkspace(slug),
      workspacesOf: (userId: string) => identity.workspacesOf(userId),
      deletedWorkspacesOf: (userId: string) => identity.deletedWorkspacesOf(userId),
      twoFactorState: (userId: string) => identity.twoFactorState(userId),
      deleteUser: (userId: string) => identity.deleteUser(userId),
      sessionVerification: () => Promise.resolve({ at: new Date().toISOString(), with: 'email' as const }),
    },
    hooks: () => [],
    signedOut: () => Promise.resolve(),
    calendar: {
      tokenKey,
      revoke: (grant: CalendarGrant) => {
        revoked.push(grant);
        return Promise.resolve();
      },
    },
    closeJoinRequests: () => Promise.resolve(),
    sendFarewell: () => Promise.resolve(),
  };
}

/** A workspace A made (its owner), with B, another signed up person, as a second owner when asked. */
async function workspace(options: { readonly secondOwner: boolean }) {
  const slug = `leave-${tag()}`;
  const aEmail = `ada-${tag()}@example.com`;
  const aUser = await createTestUser(identityUrl, { email: aEmail, name: 'Ada' });
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: 'Acme',
    slug,
    firstMember: { userId: aUser, name: 'Ada', email: aEmail },
  });
  const workspaceId = created.workspace.id;
  const bMember = newId();
  const bUser = options.secondOwner
    ? await createTestUser(identityUrl, { email: `bo-${tag()}@example.com`, name: 'Bo' })
    : undefined;
  if (bUser !== undefined) {
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
            values (${workspaceId}, ${bMember}, ${bUser}, 'Bo', ${`bo-${slug}@example.com`}, 'owner', 'system', 'system')`,
      ),
    );
  }
  // A's calendar, connected in this workspace.
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(sql`
      insert into calendar_connections (workspace_id, member_id, provider, account_email, status, tokens,
        created_by_type, updated_by_type)
      values (${workspaceId}, ${created.memberId}, 'google', 'ada@acme.dev', 'connected',
        ${sealTokens(
          tokenKey,
          { accessToken: 'at-ada', refreshToken: 'rt-ada', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
          { workspaceId, memberId: created.memberId, provider: 'google', accountEmail: 'ada@acme.dev' },
        )}, 'system', 'system')
    `),
  );
  // A deletes it, as the API does: the tenant row, then the directory's mark.
  await deleteWorkspace(
    testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId }, role: 'owner' }),
    {
      confirmName: 'Acme',
    },
  );
  await identity.setWorkspaceDeleted(workspaceId, true);
  const doorDeps = {
    db,
    rules: NO_RULE_SOURCE,
    identity: { findWorkspace: (wanted: string) => identity.findWorkspace(wanted) },
  };
  return { slug, workspaceId, aUser, aEmail, aMember: created.memberId, bUser, bMember, doorDeps };
}

const memberRow = async (memberId: string) =>
  (
    await testQuery<{ name: string; email: string; user_id: string | null; status: string; role: string }>(
      ownerUrl,
      'select name, email, user_id::text, status, role from members where id = $1',
      [memberId],
    )
  )[0];

describe('deleting your account while in a deleted workspace (spec 0033, AC-903)', () => {
  it('leaves it and forgets them there, so another owner restores it without them', async () => {
    const w = await workspace({ secondOwner: true });
    const revoked: CalendarGrant[] = [];
    const deps = deletionDeps(revoked);
    expect(await accountDeletionCheck(deps, { userId: w.aUser, sessionId: randomUUID() })).toEqual({ blockers: [] });
    await expect(
      deleteMyAccount(deps, { userId: w.aUser, sessionId: randomUUID(), email: w.aEmail }, { email: w.aEmail }),
    ).resolves.toEqual({ deleted: true });

    // B restores it: A is not brought back.
    const entry = await enterDeletedWorkspace(w.doorDeps, { userId: w.bUser ?? '', slug: w.slug });
    await restoreWorkspace(entry.scope);
    expect(await memberRow(w.aMember)).toEqual({
      name: DELETED_USER_NAME,
      email: `deleted-${w.aMember}@deleted.invalid`,
      user_id: null,
      status: 'removed',
      role: 'owner',
    });
    const owners = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text from members where workspace_id = $1 and role = 'owner' and status = 'active'`,
      [w.workspaceId],
    );
    expect(owners).toEqual([{ id: w.bMember }]);
    // A's calendar connection there is revoked, and its grant handed back to Google.
    const connections = await testQuery<{ status: string }>(
      ownerUrl,
      'select status::text from calendar_connections where workspace_id = $1 and member_id = $2',
      [w.workspaceId, w.aMember],
    );
    // Revoked now, so the restore queues no sync for it; the worker's sync deletes the row.
    expect(connections).toEqual([{ status: 'revoked' }]);
    expect(revoked.map((grant) => [grant.provider, grant.tokens.refreshToken])).toEqual([['google', 'rt-ada']]);
    const audit = await testQuery<{ action: string }>(
      ownerUrl,
      `select action from audit_events where workspace_id = $1 and target_id = $2 and action = 'account.deleted'`,
      [w.workspaceId, w.aMember],
    );
    expect(audit).toHaveLength(1);
    // Nothing of A's left in auth, the directory's rows for the deleted workspace included.
    expect(
      await testQuery(identityUrl, 'select 1 from auth.workspace_membership where user_id = $1', [w.aUser]),
    ).toHaveLength(0);
    expect(await testQuery(identityUrl, 'select 1 from auth."user" where id = $1', [w.aUser])).toHaveLength(0);
  });

  it('never blocks on a deleted workspace the person is the only owner of: it stays deleted, and they are forgotten', async () => {
    const w = await workspace({ secondOwner: false });
    const deps = deletionDeps([]);
    expect(await accountDeletionCheck(deps, { userId: w.aUser, sessionId: randomUUID() })).toEqual({ blockers: [] });
    await expect(
      deleteMyAccount(deps, { userId: w.aUser, sessionId: randomUUID(), email: w.aEmail }, { email: w.aEmail }),
    ).resolves.toEqual({ deleted: true });
    expect(await memberRow(w.aMember)).toMatchObject({ name: DELETED_USER_NAME, user_id: null, status: 'removed' });
    const [row] = await testQuery<{ deleted: boolean }>(
      ownerUrl,
      'select deleted_at is not null as deleted from workspaces where id = $1',
      [w.workspaceId],
    );
    expect(row).toEqual({ deleted: true });
  });

  it('skips a deleted workspace past its window', async () => {
    const w = await workspace({ secondOwner: false });
    await testQuery(ownerUrl, `update workspaces set purge_after = now() - interval '1 hour' where id = $1`, [
      w.workspaceId,
    ]);
    const deps = deletionDeps([]);
    await expect(
      deleteMyAccount(deps, { userId: w.aUser, sessionId: randomUUID(), email: w.aEmail }, { email: w.aEmail }),
    ).resolves.toEqual({ deleted: true });
    // The purge takes it whole; the row is left as it was.
    expect(await memberRow(w.aMember)).toMatchObject({ name: 'Ada', status: 'active' });
  });
});
