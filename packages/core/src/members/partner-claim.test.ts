// A connected app's person sets up their own Timefix login (spec 0070, AC-7023; owner, 10 Nov 2026) against the real
// Postgres: the person themselves (from the app's frame) or a manager sends the invitation; opening it makes their own
// managed identity a login at that address, the same member and page; the app keeps managing them (list, PUT, launch);
// an address that already has a login is refused and never merged (AC-7021); the app's DELETE afterwards only lets go
// of them, and they stay a member with their login.
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterAsPartner, enterWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { startWorkspace } from '../account/account.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { approvePartnerConnect } from '../partners/connect.ts';
import { exchangePartnerCode } from '../partners/exchange.ts';
import { launchPartnerScreen } from '../partners/launch.ts';
import { listPartnerMembers, putPartnerMember, removePartnerMember } from '../partners/members.ts';
import { registerPartner } from '../partners/registry.ts';
import { s256Challenge } from '../partners/tokens.ts';
import { addPageOnlyPerson } from '../profile/page-only.ts';
import { listTeamLinkPages } from '../profile/team-pages.ts';
import { rescope, signedInNow } from '../testing.ts';
import { peekInvite } from './invitations.ts';
import { removeMember } from './members.ts';
import { claimPageInvite } from './page-handover.ts';
import { cancelLoginInvite, inviteToClaimLogin, readMyLogin } from './partner-claim.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-partner-claim-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-partner-claim-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);
const REDIRECT = 'https://hub.example.com/timefix/callback';

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

const users = {
  ensureManagedUser: (person: Parameters<IdentityStore['ensureManagedUser']>[0]) => identity.ensureManagedUser(person),
  endManagedUserSessions: (userId: string) => identity.endManagedUserSessions(userId),
  dropMembership: (userId: string, workspaceId: string, memberId?: string) =>
    identity.dropMembership(userId, workspaceId, memberId),
};
const claimers = {
  claimPageOnlyUser: (claim: Parameters<IdentityStore['claimPageOnlyUser']>[0]) => identity.claimPageOnlyUser(claim),
  unclaimPageOnlyUser: (claim: Parameters<IdentityStore['unclaimPageOnlyUser']>[0]) =>
    identity.unclaimPageOnlyUser(claim),
  claimManagedUser: (claim: Parameters<IdentityStore['claimManagedUser']>[0]) => identity.claimManagedUser(claim),
  unclaimManagedUser: (claim: Parameters<IdentityStore['unclaimManagedUser']>[0]) => identity.unclaimManagedUser(claim),
};
const claim = (token: string) => claimPageInvite({ db, users: claimers }, token);
const partnerName = async (partnerId: string) => (await identity.partnerById(partnerId))?.name;

/** A workspace connected to a new partner, with Grace, the partner's plain member, and her own scope in its frame. */
async function connected() {
  const made = await registerPartner(
    { partners: identity },
    { name: `Hub ${tag()}`, frameOrigins: ['https://hub.example.com'], redirectUris: [REDIRECT] },
    { userId: randomUUID(), action: 'operator.partnerTest', requestId: randomUUID() },
  );
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email, name: 'Ada' });
  const slug = `claim-${tag()}`;
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
  const hubEmail = `grace-${tag()}@example.com`;
  const added = await putPartnerMember(
    entry.scope,
    {
      connectionId: swapped.connection.id,
      externalId: 'u-grace',
      person: { email: hubEmail, name: 'Grace Hopper', role: 'member' },
    },
    { users },
  );
  const graceUser = await memberUser(added.member.memberId);
  const grace = await enterWorkspace(
    { db, identity, rules: NO_RULE_SOURCE },
    { userId: graceUser, slug, session: signedInNow() },
  );
  return {
    owner,
    slug,
    workspaceId: started.workspace.id,
    connectionId: swapped.connection.id,
    partner: entry.scope,
    partnerName: made.partner.name,
    grace,
    graceMember: added.member.memberId,
    graceUser,
    hubEmail,
  };
}

/** The identity a member row names. */
async function memberUser(memberId: string): Promise<string> {
  const rows = await testQuery<{ user_id: string }>(
    ownerUrl,
    'select user_id::text as user_id from members where id = $1',
    [memberId],
  );
  const userId = rows[0]?.user_id;
  if (userId === undefined) throw new Error('No identity for that member.');
  return userId;
}

/** The identity, member and managed rows behind a member. */
async function rowsOf(memberId: string) {
  const [row] = await testQuery<{
    email: string;
    verified: boolean;
    member_email: string;
    status: string;
    managed: number;
    claimed: boolean;
    removed: boolean;
    identity_claimed: boolean;
  }>(
    ownerUrl,
    `select u.email, u.email_verified as verified, m.email as member_email, m.status,
       (select count(*)::int from managed_members mm where mm.member_id = m.id) as managed,
       exists (select 1 from managed_members mm where mm.member_id = m.id and mm.claimed_at is not null) as claimed,
       exists (select 1 from managed_members mm where mm.member_id = m.id and mm.removed_at is not null) as removed,
       exists (select 1 from auth.managed_users mu where mu.user_id = u.id and mu.claimed_at is not null)
         as identity_claimed
     from members m join auth."user" u on u.id = m.user_id where m.id = $1`,
    [memberId],
  );
  return row;
}

describe('a connected app’s person setting up their own Timefix login (AC-7023)', () => {
  it('turns their own identity into a login, and the app keeps managing them', async () => {
    const hub = await connected();
    expect(await identity.isManagedUser(hub.graceUser)).toBe(true);
    expect(await readMyLogin(hub.grace)).toEqual({
      canSetUp: true,
      hasLogin: false,
      memberId: hub.graceMember,
      email: hub.hubEmail,
    });
    // Grace asks for her own, as a plain Member with no Members permission.
    const address = `grace-own-${tag()}@example.com`;
    const sent = await inviteToClaimLogin(hub.grace, { member: hub.graceMember, email: address });
    expect(sent.invite.email).toBe(address);
    expect((await readMyLogin(hub.grace)).invite?.email).toBe(address);
    const row = (await listTeamLinkPages(hub.owner)).pages.find((page) => page.memberId === hub.graceMember);
    expect(row).toMatchObject({ isFromApp: true, invite: { email: address } });
    expect(row?.hasLogin).toBeUndefined();

    const peek = await peekInvite({ db, partnerName }, sent.token);
    expect(peek).toMatchObject({ page: { name: 'Grace Hopper' }, login: { app: hub.partnerName } });

    expect(await claim(sent.token)).toEqual({ slug: hub.slug, email: address });
    expect(await rowsOf(hub.graceMember)).toEqual({
      email: address,
      verified: true,
      member_email: address,
      status: 'active',
      managed: 1,
      claimed: true,
      removed: false,
      identity_claimed: true,
    });
    // A login now: the session hook lets it in, and Team pages and her own card say so.
    expect(await identity.isManagedUser(hub.graceUser)).toBe(false);
    expect(await readMyLogin(hub.grace)).toEqual({ canSetUp: false, hasLogin: true, memberId: hub.graceMember });
    const now = (await listTeamLinkPages(hub.owner)).pages.find((page) => page.memberId === hub.graceMember);
    expect(now).toMatchObject({ isFromApp: true, hasLogin: true });
    expect(now?.invite).toBeUndefined();
    // The app still lists, changes and launches her; her address is her login's from now on.
    expect((await listPartnerMembers(hub.partner, { connectionId: hub.connectionId })).members).toEqual([
      expect.objectContaining({ externalId: 'u-grace', email: address, hasTimefixLogin: true }),
    ]);
    const put = await putPartnerMember(
      hub.partner,
      {
        connectionId: hub.connectionId,
        externalId: 'u-grace',
        person: { email: hub.hubEmail, name: 'Grace B. Hopper', role: 'member' },
      },
      { users },
    );
    expect(put.member).toMatchObject({ name: 'Grace B. Hopper', email: address, hasTimefixLogin: true });
    expect((await rowsOf(hub.graceMember))?.member_email).toBe(address);
    // Her account's own name is hers, in every workspace: the app renames her on her member row here only.
    const [account] = await testQuery<{ name: string }>(ownerUrl, 'select name from auth."user" where id = $1', [
      hub.graceUser,
    ]);
    expect(account?.name).toBe('Grace Hopper');
    const launched = await launchPartnerScreen(hub.partner, {
      connectionId: hub.connectionId,
      launch: { externalId: 'u-grace', screen: 'link_pages.mine' },
    });
    expect(launched.code).toBeTruthy();
    // The link opened again: its login stands, and nothing changes twice.
    expect(await peekInvite({ db, partnerName }, sent.token)).toMatchObject({
      isClaimed: true,
      login: { app: hub.partnerName },
    });
    expect(await claim(sent.token)).toEqual({ slug: hub.slug, email: address });
    // History: the invitation and the login, as the person.
    const actions = await testQuery<{ action: string; after: Record<string, unknown> }>(
      ownerUrl,
      `select action, after from audit_events where workspace_id = $1 and action like 'invitation.%' order by at`,
      [hub.workspaceId],
    );
    expect(actions.map((each) => [each.action, each.after['login'] ?? each.after['via']])).toEqual([
      ['invitation.created', true],
      ['invitation.accepted', 'login'],
    ]);
  });

  it('refuses an address that already has a Timefix login, and never merges (AC-7021)', async () => {
    const hub = await connected();
    const taken = `taken-${tag()}@example.com`;
    await createTestUser(identityUrl, { email: taken, name: 'Someone' });
    const sent = await inviteToClaimLogin(hub.grace, { member: hub.graceMember, email: taken });
    expect(await refusalOf(claim(sent.token))).toEqual({ code: 'UNIQUE_CONFLICT', field: 'email' });
    expect(await rowsOf(hub.graceMember)).toMatchObject({
      verified: false,
      claimed: false,
      identity_claimed: false,
      member_email: hub.hubEmail,
    });
    expect(await identity.isManagedUser(hub.graceUser)).toBe(true);
  });

  it('lets a manager send one with both permissions, and nobody else', async () => {
    const hub = await connected();
    const address = `grace-m-${tag()}@example.com`;
    // A plain member who isn't Grace holds neither permission.
    const other = rescope(hub.owner, { role: 'member' });
    expect(await refusalOf(inviteToClaimLogin(other, { member: hub.graceMember, email: address }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    // The owner (both permissions) sends it; it opens though Grace never sent it.
    const sent = await inviteToClaimLogin(hub.owner, { member: hub.graceMember, email: address });
    // Sent again to another address: the first stops.
    const again = await inviteToClaimLogin(hub.owner, { member: hub.graceMember, email: `x-${address}` });
    expect(await refusalOf(claim(sent.token))).toMatchObject({ code: 'INVITE_INVALID' });
    // Cancelled: the second stops too.
    expect(await cancelLoginInvite(hub.owner, { member: hub.graceMember })).toEqual({ cancelled: true });
    expect(await refusalOf(claim(again.token))).toMatchObject({ code: 'INVITE_INVALID' });
    // Grace cancels or sends her own; someone else can't cancel hers without the permissions.
    const mine = await inviteToClaimLogin(hub.grace, { member: hub.graceMember, email: address });
    expect(await refusalOf(cancelLoginInvite(other, { member: hub.graceMember }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await claim(mine.token)).toEqual({ slug: hub.slug, email: address });
  });

  it('is only for a connected app’s person: never a page only person or someone with a login', async () => {
    const hub = await connected();
    const nick = await addPageOnlyPerson(
      hub.owner,
      { name: 'Nick Kim', handle: `nick-${tag()}` },
      {
        users: {
          ensurePageOnlyUser: (person) => identity.ensurePageOnlyUser(person),
          dropPageOnlyUser: (userId) => identity.dropPageOnlyUser(userId),
        },
      },
    );
    const address = `n-${tag()}@example.com`;
    expect(await refusalOf(inviteToClaimLogin(hub.owner, { member: nick.memberId, email: address }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const ownerMember = hub.owner.actor.type === 'member' ? (hub.owner.actor.id ?? '') : '';
    expect(await refusalOf(inviteToClaimLogin(hub.owner, { member: ownerMember, email: address }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await readMyLogin(hub.owner)).toMatchObject({ canSetUp: false, hasLogin: false });
    // An address someone else here uses is refused before anything is written.
    const ownerEmail = (await rowsOf(ownerMember))?.member_email ?? '';
    expect(
      await refusalOf(inviteToClaimLogin(hub.grace, { member: hub.graceMember, email: ownerEmail })),
    ).toMatchObject({ code: 'UNIQUE_CONFLICT', field: 'email' });
  });

  it('keeps them a member with their login when the app lets go of them, and takes them back on a PUT', async () => {
    const hub = await connected();
    const address = `grace-k-${tag()}@example.com`;
    const sent = await inviteToClaimLogin(hub.grace, { member: hub.graceMember, email: address });
    await claim(sent.token);
    expect(
      await removePartnerMember(hub.partner, { connectionId: hub.connectionId, externalId: 'u-grace' }, { users }),
    ).toEqual({ removed: true });
    expect(await rowsOf(hub.graceMember)).toMatchObject({ status: 'active', claimed: true, removed: true });
    expect(await identity.isManagedUser(hub.graceUser)).toBe(false);
    expect((await listPartnerMembers(hub.partner, { connectionId: hub.connectionId })).members).toEqual([]);
    expect(
      await refusalOf(
        launchPartnerScreen(hub.partner, {
          connectionId: hub.connectionId,
          launch: { externalId: 'u-grace', screen: 'link_pages.mine' },
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    // Sent again, nothing changes; History says the app let go of her.
    expect(
      await removePartnerMember(hub.partner, { connectionId: hub.connectionId, externalId: 'u-grace' }, { users }),
    ).toEqual({ removed: false });
    const released = await testQuery(
      ownerUrl,
      `select 1 from audit_events where workspace_id = $1 and action = 'member.app_released' and target_id = $2`,
      [hub.workspaceId, hub.graceMember],
    );
    expect(released).toHaveLength(1);
    // The same external id again: the app manages her again, the same member.
    const back = await putPartnerMember(
      hub.partner,
      {
        connectionId: hub.connectionId,
        externalId: 'u-grace',
        person: { email: hub.hubEmail, name: 'Grace Hopper', role: 'member' },
      },
      { users },
    );
    expect(back).toMatchObject({ created: false, member: { memberId: hub.graceMember, email: address } });
    expect(await rowsOf(hub.graceMember)).toMatchObject({ status: 'active', claimed: true, removed: false });
  });

  it('never lets the app bring back a login the workspace removed', async () => {
    const hub = await connected();
    const sent = await inviteToClaimLogin(hub.grace, {
      member: hub.graceMember,
      email: `grace-r-${tag()}@example.com`,
    });
    await claim(sent.token);
    // The app lets go, then the workspace removes her.
    await removePartnerMember(hub.partner, { connectionId: hub.connectionId, externalId: 'u-grace' }, { users });
    await removeMember(hub.owner, { memberId: hub.graceMember });
    const again = putPartnerMember(
      hub.partner,
      {
        connectionId: hub.connectionId,
        externalId: 'u-grace',
        person: { email: hub.hubEmail, name: 'Grace Hopper', role: 'member' },
      },
      { users },
    );
    expect(await refusalOf(again)).toMatchObject({ code: 'FORBIDDEN' });
    expect(await rowsOf(hub.graceMember)).toMatchObject({ status: 'removed' });
  });
});

describe('inside a connected app’s frame (security review, 10 Nov 2026)', () => {
  it('reaches only that app’s own people, holding plain Member', async () => {
    const hub = await connected();
    const frame = { frame: { connectionId: hub.connectionId } };
    // Its own Member, from its own frame: allowed (the person, or the app's admin for them).
    const mine = await inviteToClaimLogin(
      hub.grace,
      { member: hub.graceMember, email: `grace-f-${tag()}@example.com` },
      [],
      frame,
    );
    expect(mine.isSelf).toBe(true);
    expect(await peekInvite({ db, partnerName }, mine.token)).toMatchObject({ login: { isSelf: true } });
    // A frame of another app (a connection this workspace can't see) never reaches her.
    const other = await connected();
    expect(
      await refusalOf(
        inviteToClaimLogin(hub.owner, { member: hub.graceMember, email: `x-${tag()}@example.com` }, [], {
          frame: { connectionId: other.connectionId },
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await refusalOf(
        cancelLoginInvite(hub.owner, { member: hub.graceMember }, [], {}, { connectionId: other.connectionId }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    // The app's admin's own login is never set up from the frame: it would carry Admin out of it.
    const admin = await putPartnerMember(
      hub.partner,
      {
        connectionId: hub.connectionId,
        externalId: 'u-admin',
        person: { email: `admin-${tag()}@example.com`, name: 'Alan Admin', role: 'admin' },
      },
      { users },
    );
    const adminScope = await enterWorkspace(
      { db, identity, rules: NO_RULE_SOURCE },
      { userId: await memberUser(admin.member.memberId), slug: hub.slug, session: signedInNow() },
    );
    expect(
      await refusalOf(
        inviteToClaimLogin(
          adminScope,
          { member: admin.member.memberId, email: `alan-${tag()}@example.com` },
          [],
          frame,
        ),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    // Sent from the frame for a Member, then made the app's admin before it is opened: it opens nothing.
    const late = await inviteToClaimLogin(
      hub.grace,
      { member: hub.graceMember, email: `grace-late-${tag()}@example.com` },
      [],
      frame,
    );
    await putPartnerMember(
      hub.partner,
      {
        connectionId: hub.connectionId,
        externalId: 'u-grace',
        person: { email: hub.hubEmail, name: 'Grace Hopper', role: 'admin' },
      },
      { users },
    );
    expect(await refusalOf(claim(late.token))).toMatchObject({ code: 'INVITE_INVALID' });
    expect(await rowsOf(hub.graceMember)).toMatchObject({ verified: false, claimed: false, identity_claimed: false });
    expect(await identity.isManagedUser(hub.graceUser)).toBe(true);
    // In Timefix, the workspace's owner sets it up for them.
    const fromTimefix = await inviteToClaimLogin(hub.owner, {
      member: admin.member.memberId,
      email: `alan-${tag()}@example.com`,
    });
    expect(fromTimefix.isSelf).toBe(false);
  });
});
