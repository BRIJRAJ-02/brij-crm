// Managed members (spec 0070, slice 3, AC-7020 to AC-7025) against the real Postgres: a PUT adds a person silently
// with an identity of their own (never a Timefix account with the same address), the same external id is always the
// same person, roles map to Admin and Member and never touch an owner, a DELETE removes them and ends their sessions,
// the same id brings the same identity back, every change is History as the partner, and a partner reaches only its
// own connection.
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterAsPartner, enterWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { startWorkspace } from '../account/account.ts';
import { listAuditEvents } from '../audit/audit.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { signedInNow } from '../testing.ts';
import { approvePartnerConnect } from './connect.ts';
import { exchangePartnerCode } from './exchange.ts';
import { listPartnerMembers, putPartnerMember, removePartnerMember } from './members.ts';
import { registerPartner } from './registry.ts';
import { s256Challenge } from './tokens.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-partner-members-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-partner-members-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);
const REDIRECT = 'https://hub.example.com/timefix/callback';

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, message: error.refusal.message };
    throw error;
  }
}

/** A workspace connected to a new partner: its owner, and the partner's scope through the door. */
async function connected() {
  const made = await registerPartner(
    { partners: identity },
    { name: `Hub ${tag()}`, frameOrigins: ['https://hub.example.com'], redirectUris: [REDIRECT] },
    { userId: randomUUID(), action: 'operator.partnerTest', requestId: randomUUID() },
  );
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email, name: 'Ada' });
  const slug = `managed-${tag()}`;
  const started = await startWorkspace(
    { db, identity },
    { id: userId, name: 'Ada', email },
    { id: newId(), name: 'Acme', slug, memberName: 'Ada' },
  );
  const owner = await enterWorkspace({ db, identity, rules: NO_RULE_SOURCE }, { userId, slug, session: signedInNow() });
  const verifier = randomBytes(32).toString('base64url');
  const approved = await approvePartnerConnect(
    owner,
    { partners: identity },
    {
      request: {
        clientId: made.partner.clientId,
        redirectUri: REDIRECT,
        state: `state-${tag()}`,
        codeChallenge: s256Challenge(verifier),
        codeChallengeMethod: 'S256',
        responseType: 'code',
      },
      modules: ['link_pages'],
    },
  );
  const code = new URL(approved.redirectTo).searchParams.get('code') ?? '';
  const swapped = await exchangePartnerCode(
    { db, partners: identity },
    { clientId: made.partner.clientId, clientSecret: made.secret, code, redirectUri: REDIRECT, codeVerifier: verifier },
  );
  if (!swapped.ok) throw new Error(swapped.message);
  const entry = await enterAsPartner({ db }, swapped.token);
  if (entry === undefined) throw new Error('The partner door refused its own token.');
  return {
    owner,
    ownerEmail: email,
    workspaceId: started.workspace.id,
    connectionId: swapped.connection.id,
    scope: entry.scope,
  };
}

const users = () => ({
  users: {
    ensureManagedUser: (person: Parameters<IdentityStore['ensureManagedUser']>[0]) =>
      identity.ensureManagedUser(person),
    endManagedUserSessions: (userId: string) => identity.endManagedUserSessions(userId),
    dropMembership: (userId: string, workspaceId: string, memberId?: string) =>
      identity.dropMembership(userId, workspaceId, memberId),
  },
});

const grace = { email: 'grace@example.com', name: 'Grace Hopper', role: 'admin' as const };

describe('adding a managed member (AC-7020, AC-7021, AC-7023)', () => {
  it('adds a person silently, with an identity of their own, and the same id is always the same person', async () => {
    const hub = await connected();
    const first = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'u-1', person: grace },
      users(),
    );
    expect(first).toMatchObject({
      created: true,
      member: { externalId: 'u-1', name: 'Grace Hopper', email: 'grace@example.com', role: 'admin' },
    });
    expect(first.member.handle).toBeDefined();
    const again = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'u-1', person: grace },
      users(),
    );
    expect(again).toMatchObject({ created: false, member: { memberId: first.member.memberId } });

    // The identity: a made up .invalid address, no password and no linked account; their real address on the member.
    const [identityRow] = await testQuery<{ email: string; name: string; accounts: number }>(
      ownerUrl,
      `select u.email, u.name, (select count(*)::int from auth.account a where a.user_id = u.id) as accounts
       from managed_members m join auth.user u on u.id = m.user_id where m.member_id = $1`,
      [first.member.memberId],
    );
    expect(identityRow?.email).toMatch(/@managed\.timefix\.invalid$/);
    expect(identityRow).toMatchObject({ name: 'Grace Hopper', accounts: 0 });
    expect(await identity.isManagedUser((await memberUser(first.member.memberId)) ?? '')).toBe(true);
    // No invitation, no welcome: nothing queued for them.
    const queued = await testQuery(ownerUrl, 'select 1 from emails where to_member_id = $1', [first.member.memberId]);
    expect(queued).toEqual([]);
    expect((await listPartnerMembers(hub.scope, { connectionId: hub.connectionId })).members).toEqual([
      expect.objectContaining({ externalId: 'u-1', memberId: first.member.memberId, role: 'admin' }),
    ]);
  });

  it('never merges with a Timefix account that has the same address', async () => {
    const hub = await connected();
    const email = `${tag()}@example.com`;
    const account = await createTestUser(identityUrl, { email, name: 'Someone' });
    const added = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'u-2', person: { email, name: 'Someone', role: 'member' } },
      users(),
    );
    const userId = await memberUser(added.member.memberId);
    expect(userId).toBeDefined();
    expect(userId).not.toBe(account);
    expect(await identity.isManagedUser(account)).toBe(false);
  });

  it('refuses an address an active member of the workspace already uses', async () => {
    const hub = await connected();
    expect(
      await refusalOf(
        putPartnerMember(
          hub.scope,
          { connectionId: hub.connectionId, externalId: 'u-3', person: { ...grace, email: hub.ownerEmail } },
          users(),
        ),
      ),
    ).toMatchObject({ code: 'UNIQUE_CONFLICT' });
  });

  it('answers NOT_FOUND for another connection’s id', async () => {
    const hub = await connected();
    expect(
      await refusalOf(
        putPartnerMember(hub.scope, { connectionId: newId(), externalId: 'u-4', person: grace }, users()),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(listPartnerMembers(hub.scope, { connectionId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('roles (AC-7024)', () => {
  it('maps admin and member, and never changes or removes an owner', async () => {
    const hub = await connected();
    const added = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'r-1', person: grace },
      users(),
    );
    const down = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'r-1', person: { ...grace, role: 'member' } },
      users(),
    );
    expect(down.member.role).toBe('member');
    // The workspace makes them an owner: the partner's role is then left alone, and it can't remove them.
    await testQuery(ownerUrl, `update members set role = 'owner' where id = $1`, [added.member.memberId]);
    const kept = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'r-1', person: { ...grace, name: 'Grace B. Hopper' } },
      users(),
    );
    expect(kept.member).toMatchObject({ role: 'owner', name: 'Grace B. Hopper' });
    expect(
      await refusalOf(removePartnerMember(hub.scope, { connectionId: hub.connectionId, externalId: 'r-1' }, users())),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('removing a managed member (AC-7022)', () => {
  it('removes them, ends their sessions, and the same id brings the same identity back', async () => {
    const hub = await connected();
    const added = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'd-1', person: { ...grace, role: 'member' } },
      users(),
    );
    const userId = (await memberUser(added.member.memberId)) ?? '';
    await testQuery(
      ownerUrl,
      `insert into auth.session (expires_at, token, user_id) values (now() + interval '1 hour', $1, $2)`,
      [randomUUID(), userId],
    );
    expect(
      await removePartnerMember(hub.scope, { connectionId: hub.connectionId, externalId: 'd-1' }, users()),
    ).toEqual({ removed: true });
    expect(await testQuery(ownerUrl, 'select status from members where id = $1', [added.member.memberId])).toEqual([
      { status: 'removed' },
    ]);
    expect(await testQuery(ownerUrl, 'select 1 from auth.session where user_id = $1', [userId])).toEqual([]);
    // Their page's content stays.
    expect(
      await testQuery(ownerUrl, 'select 1 from auth.public_profiles where user_id = $1 and workspace_id = $2', [
        userId,
        hub.workspaceId,
      ]),
    ).toHaveLength(1);
    // Sent again: nothing more to do.
    expect(
      await removePartnerMember(hub.scope, { connectionId: hub.connectionId, externalId: 'd-1' }, users()),
    ).toEqual({ removed: false });
    expect((await listPartnerMembers(hub.scope, { connectionId: hub.connectionId })).members).toEqual([]);
    // Back again: a new member row on the same identity, with the same handle.
    const back = await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'd-1', person: { ...grace, role: 'member' } },
      users(),
    );
    expect(back.created).toBe(true);
    expect(back.member.memberId).not.toBe(added.member.memberId);
    expect(back.member.handle).toBe(added.member.handle);
    expect(await memberUser(back.member.memberId)).toBe(userId);
    expect(
      await refusalOf(removePartnerMember(hub.scope, { connectionId: hub.connectionId, externalId: 'never' }, users())),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('History (AC-7025)', () => {
  it('writes every change as the partner', async () => {
    const hub = await connected();
    await putPartnerMember(hub.scope, { connectionId: hub.connectionId, externalId: 'h-1', person: grace }, users());
    await putPartnerMember(
      hub.scope,
      { connectionId: hub.connectionId, externalId: 'h-1', person: { ...grace, role: 'member', name: 'G. Hopper' } },
      users(),
    );
    await removePartnerMember(hub.scope, { connectionId: hub.connectionId, externalId: 'h-1' }, users());
    const history = await listAuditEvents(hub.owner);
    const mine = history.entries.filter((entry) => entry.actor.kind === 'partner').map((entry) => entry.action);
    expect(mine.sort()).toEqual(['member.added', 'member.profile_updated', 'member.removed', 'member.role_changed']);
  });
});

/** The identity a member row names. */
async function memberUser(memberId: string): Promise<string | undefined> {
  const rows = await testQuery<{ user_id: string | null }>(ownerUrl, 'select user_id from members where id = $1', [
    memberId,
  ]);
  return rows[0]?.user_id ?? undefined;
}
