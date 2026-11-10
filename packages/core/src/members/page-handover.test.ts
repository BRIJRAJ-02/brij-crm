// A page only person's page handed over (9 Nov 2026) against the real Postgres: Invite to manage their page sends an
// invitation naming the person; opening it with no session makes their own identity a login at that address, so they
// stay the same member with the same page; it is single use, bound to its workspace and person, and the address must be
// nobody else's here and no other login's; a partner's person and anyone holding more than Member can't be handed over.
import { randomUUID } from 'node:crypto';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { startWorkspace } from '../account/account.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { addPageOnlyPerson, removePageOnlyPerson } from '../profile/page-only.ts';
import { listTeamLinkPages } from '../profile/team-pages.ts';
import { signedInNow } from '../testing.ts';
import { acceptInvite, inviteMembers, listInvitations, peekInvite, seatsUsed } from './invitations.ts';
import { setMemberRole } from './members.ts';
import { cancelPageInvite, claimPageInvite, inviteToManagePage } from './page-handover.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-page-handover-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-page-handover-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; field?: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) {
      return { code: error.refusal.code, ...(error.refusal.field === undefined ? {} : { field: error.refusal.field }) };
    }
    throw error;
  }
}

const makers = {
  users: {
    ensurePageOnlyUser: (person: { workspaceId: string; personId: string; name: string }) =>
      identity.ensurePageOnlyUser(person),
    dropPageOnlyUser: (userId: string) => identity.dropPageOnlyUser(userId),
  },
};
const enders = {
  users: {
    endManagedUserSessions: (userId: string) => identity.endManagedUserSessions(userId),
    dropMembership: (userId: string, workspaceId: string, memberId?: string) =>
      identity.dropMembership(userId, workspaceId, memberId),
  },
};
const claimers = {
  claimPageOnlyUser: (claim: Parameters<IdentityStore['claimPageOnlyUser']>[0]) => identity.claimPageOnlyUser(claim),
  unclaimPageOnlyUser: (claim: Parameters<IdentityStore['unclaimPageOnlyUser']>[0]) =>
    identity.unclaimPageOnlyUser(claim),
  claimManagedUser: (claim: Parameters<IdentityStore['claimManagedUser']>[0]) => identity.claimManagedUser(claim),
  unclaimManagedUser: (claim: Parameters<IdentityStore['unclaimManagedUser']>[0]) => identity.unclaimManagedUser(claim),
};
const claim = (token: string) => claimPageInvite({ db, users: claimers }, token);

/** A workspace its owner Ada started, with Nick, a page only person, in it. */
async function workspace() {
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email, name: 'Ada' });
  const slug = `handover-${tag()}`;
  const started = await startWorkspace(
    { db, identity },
    { id: userId, name: 'Ada', email },
    { id: newId(), name: 'Acme', slug, memberName: 'Ada' },
  );
  const owner = await enterWorkspace({ db, identity, rules: NO_RULE_SOURCE }, { userId, slug, session: signedInNow() });
  const handle = `nick-${tag()}`;
  const nick = await addPageOnlyPerson(owner, { name: 'Nick Kim', handle }, makers);
  return { owner, ownerEmail: email, slug, workspaceId: started.workspace.id, nick, handle };
}

/** The identity, member and managed rows behind a member. */
async function rowsOf(memberId: string) {
  const [row] = await testQuery<{
    user_id: string;
    email: string;
    verified: boolean;
    member_email: string;
    managed: number;
    managed_users: number;
  }>(
    ownerUrl,
    `select u.id::text as user_id, u.email, u.email_verified as verified, m.email as member_email,
       (select count(*)::int from managed_members mm where mm.member_id = m.id) as managed,
       (select count(*)::int from auth.managed_users mu where mu.user_id = u.id) as managed_users
     from members m join auth."user" u on u.id = m.user_id where m.id = $1`,
    [memberId],
  );
  return row;
}

describe('handing a page only person their page', () => {
  it('makes their own identity a login at the invited address: the same member, page and handle', async () => {
    const w = await workspace();
    const before = await rowsOf(w.nick.memberId);
    const address = `nick-${tag()}@example.com`;
    const sent = await inviteToManagePage(w.owner, { member: w.nick.memberId, email: address });
    expect(sent.invite.email).toBe(address);
    expect(sent.page).toEqual({ name: 'Nick Kim', handle: w.handle });
    // Team pages shows it on their row; it holds no seat, and the Invitations tab never lists it.
    const listed = await listTeamLinkPages(w.owner);
    expect(listed.pages.find((page) => page.memberId === w.nick.memberId)?.invite?.email).toBe(address);
    expect(await listInvitations(w.owner)).toEqual([]);
    expect(await db.withWorkspace(w.workspaceId, (tx) => seatsUsed(tx, w.workspaceId))).toBe(2);

    const peek = await peekInvite({ db }, sent.token);
    expect(peek).toMatchObject({ workspaceName: 'Acme', page: { name: 'Nick Kim', handle: w.handle } });

    expect(await claim(sent.token)).toEqual({ slug: w.slug, email: address });
    const after = await rowsOf(w.nick.memberId);
    expect(after).toEqual({
      user_id: before?.user_id,
      email: address,
      verified: true,
      member_email: address,
      managed: 0,
      managed_users: 0,
    });
    expect(await identity.isManagedUser(after?.user_id ?? '')).toBe(false);
    // No page only person any more, the same handle, and the invitation spent: the link opens nothing again.
    const now = (await listTeamLinkPages(w.owner)).pages.find((page) => page.memberId === w.nick.memberId);
    expect(now).toMatchObject({ handle: w.handle });
    expect(now?.isPageOnly).toBeUndefined();
    expect(now?.invite).toBeUndefined();
    // The link opened again says its login stands (sign in is what is left), and taking it again changes nothing.
    expect(await peekInvite({ db }, sent.token)).toMatchObject({ isClaimed: true, page: { name: 'Nick Kim' } });
    expect(await claim(sent.token)).toEqual({ slug: w.slug, email: address });
    const [history] = await testQuery<{ action: string; after: unknown }>(
      ownerUrl,
      `select action, after from audit_events where workspace_id = $1 and action = 'invitation.accepted'`,
      [w.workspaceId],
    );
    expect(history?.after).toMatchObject({ via: 'page' });
  });

  it('replaces the open invitation when sent again, and cancels it: an old link opens nothing', async () => {
    const w = await workspace();
    const a = `a-${tag()}@example.com`;
    const first = await inviteToManagePage(w.owner, { member: w.nick.memberId, email: a });
    const again = await inviteToManagePage(w.owner, { member: w.nick.memberId, email: a });
    expect(again.invitationId).toBe(first.invitationId);
    expect(await refusalOf(claim(first.token))).toEqual({ code: 'INVITE_INVALID' });
    // To another address: the open one is revoked and a new one made, so History says where each went.
    const second = await inviteToManagePage(w.owner, { member: w.nick.memberId, email: `b-${tag()}@example.com` });
    expect(second.invitationId).not.toBe(first.invitationId);
    expect(await testQuery(ownerUrl, `select status from invitations where id = $1`, [first.invitationId])).toEqual([
      { status: 'revoked' },
    ]);
    expect(await refusalOf(claim(again.token))).toEqual({ code: 'INVITE_INVALID' });
    expect(await cancelPageInvite(w.owner, { member: w.nick.memberId })).toEqual({ cancelled: true });
    expect(await cancelPageInvite(w.owner, { member: w.nick.memberId })).toEqual({ cancelled: false });
    expect(await refusalOf(claim(second.token))).toEqual({ code: 'INVITE_INVALID' });
    expect((await rowsOf(w.nick.memberId))?.managed).toBe(1);
  });

  it('refuses an address someone here uses or another invitation names, and one that already has a login', async () => {
    const w = await workspace();
    expect(await refusalOf(inviteToManagePage(w.owner, { member: w.nick.memberId, email: w.ownerEmail }))).toEqual({
      code: 'UNIQUE_CONFLICT',
      field: 'email',
    });
    const invited = `grace-${tag()}@example.com`;
    await inviteMembers(w.owner, { emails: [invited], role: 'member' });
    expect(await refusalOf(inviteToManagePage(w.owner, { member: w.nick.memberId, email: invited }))).toEqual({
      code: 'UNIQUE_CONFLICT',
      field: 'email',
    });
    // An address with a Timefix login of its own: never merged (AC-7021), and nothing changes.
    const taken = `taken-${tag()}@example.com`;
    await createTestUser(identityUrl, { email: taken, name: 'Taken' });
    const sent = await inviteToManagePage(w.owner, { member: w.nick.memberId, email: taken });
    const before = await rowsOf(w.nick.memberId);
    expect(await refusalOf(claim(sent.token))).toEqual({ code: 'UNIQUE_CONFLICT', field: 'email' });
    expect(await rowsOf(w.nick.memberId)).toEqual(before);
    // Inviting that address to join is refused while the hand over names it.
    const joined = await inviteMembers(w.owner, { emails: [taken], role: 'member' });
    expect(joined.refused).toMatchObject([{ email: taken }]);
  });

  it('is never accepted as a join by a signed in account', async () => {
    const w = await workspace();
    const address = `nick-${tag()}@example.com`;
    const userId = await createTestUser(identityUrl, { email: address, name: 'Nick' });
    const sent = await inviteToManagePage(w.owner, { member: w.nick.memberId, email: address });
    expect(
      await refusalOf(
        acceptInvite({ db }, { id: userId, name: 'Nick', email: address, emailVerified: true }, sent.token),
      ),
    ).toEqual({ code: 'INVITE_EMAIL_MISMATCH' });
    expect(await testQuery(ownerUrl, 'select 1 from members where user_id = $1', [userId])).toEqual([]);
  });

  it('hands over only a page only person holding Member, and opens nothing once they are removed', async () => {
    const w = await workspace();
    const [ada] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id from members where workspace_id = $1 and role = 'owner'`,
      [w.workspaceId],
    );
    expect(
      await refusalOf(inviteToManagePage(w.owner, { member: ada?.id ?? '', email: `x-${tag()}@example.com` })),
    ).toEqual({ code: 'NOT_FOUND' });
    await setMemberRole(w.owner, { memberId: w.nick.memberId, role: 'guest' });
    expect(
      await refusalOf(inviteToManagePage(w.owner, { member: w.nick.memberId, email: `x-${tag()}@example.com` })),
    ).toEqual({ code: 'FORBIDDEN' });
    await setMemberRole(w.owner, { memberId: w.nick.memberId, role: 'member' });
    const sent = await inviteToManagePage(w.owner, { member: w.nick.memberId, email: `x-${tag()}@example.com` });
    await removePageOnlyPerson(w.owner, { member: w.nick.memberId }, enders);
    // Their removal cancelled it.
    expect(await refusalOf(claim(sent.token))).toEqual({ code: 'INVITE_INVALID' });
    expect(
      await testQuery(ownerUrl, `select status from invitations where workspace_id = $1 and member_id = $2`, [
        w.workspaceId,
        w.nick.memberId,
      ]),
    ).toEqual([{ status: 'revoked' }]);
  });
});
