// Page only people (9 Nov 2026) against the real Postgres: someone with `link_pages.manage_team` adds a person from
// Team pages, who gets an identity that can't sign in, a Private page at the handle given, no invitation and no
// email, and a seat; their address is never another member's or an invited one; a partner's PUT and DELETE never find
// them; removing them stops the handle and keeps the page; and History says each.
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterAsPartner, enterTeamLinkPage, enterWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { startWorkspace } from '../account/account.ts';
import { listAuditEvents } from '../audit/audit.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { LIMITS } from '../engine/limits.ts';
import { listMembers, setMemberRole, transferOwnership } from '../members/members.ts';
import { getMyProfile } from '../members/profile.ts';
import { approvePartnerConnect } from '../partners/connect.ts';
import { exchangePartnerCode } from '../partners/exchange.ts';
import { listPartnerMembers, putPartnerMember, removePartnerMember } from '../partners/members.ts';
import { registerPartner } from '../partners/registry.ts';
import { s256Challenge } from '../partners/tokens.ts';
import { rescope, signedInNow } from '../testing.ts';
import {
  addPageOnlyPerson,
  checkTeamHandle,
  namePageOnlyPerson,
  removePageOnlyPerson,
  suggestTeamHandle,
} from './page-only.ts';
import { listTeamLinkPages } from './team-pages.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-page-only-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-page-only-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);
const handle = () => `page-${tag()}`;
const REDIRECT = 'https://hub.example.com/timefix/callback';

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: string; message: string; field?: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) {
      return {
        code: error.refusal.code,
        message: error.refusal.message,
        ...(error.refusal.field === undefined ? {} : { field: error.refusal.field }),
      };
    }
    throw error;
  }
}

/** A workspace its owner Ada started, her scope through the door. */
async function workspace() {
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email, name: 'Ada' });
  const slug = `page-only-${tag()}`;
  const started = await startWorkspace(
    { db, identity },
    { id: userId, name: 'Ada', email },
    { id: newId(), name: 'Acme', slug, memberName: 'Ada' },
  );
  const owner = await enterWorkspace({ db, identity, rules: NO_RULE_SOURCE }, { userId, slug, session: signedInNow() });
  return { owner, ownerEmail: email, slug, workspaceId: started.workspace.id };
}

/** `workspace()`, connected to a new partner: the partner's scope through its door. */
async function connected() {
  const made = await registerPartner(
    { partners: identity },
    { name: `Hub ${tag()}`, frameOrigins: ['https://hub.example.com'], redirectUris: [REDIRECT] },
    { userId: randomUUID(), action: 'operator.partnerTest', requestId: randomUUID() },
  );
  const w = await workspace();
  const verifier = randomBytes(32).toString('base64url');
  const approved = await approvePartnerConnect(
    w.owner,
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
  return { ...w, connectionId: swapped.connection.id, partner: entry.scope };
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
const partnerUsers = {
  users: {
    ensureManagedUser: (person: Parameters<IdentityStore['ensureManagedUser']>[0]) =>
      identity.ensureManagedUser(person),
    endManagedUserSessions: (userId: string) => identity.endManagedUserSessions(userId),
    dropMembership: (userId: string, workspaceId: string, memberId?: string) =>
      identity.dropMembership(userId, workspaceId, memberId),
  },
};

/** The identity and managed row behind a member. */
async function identityOf(memberId: string) {
  const [row] = await testQuery<{
    user_id: string;
    email: string;
    member_email: string;
    accounts: number;
    partner_id: string | null;
    managed_partner: string | null;
    created_by_member_id: string | null;
    removed_at: string | null;
  }>(
    ownerUrl,
    `select u.id as user_id, u.email, m.email as member_email,
       (select count(*)::int from auth.account a where a.user_id = u.id) as accounts,
       mu.partner_id, mm.partner_id as managed_partner, mm.created_by_member_id, mm.removed_at
     from members m join auth."user" u on u.id = m.user_id
     join auth.managed_users mu on mu.user_id = u.id
     join managed_members mm on mm.workspace_id = m.workspace_id and mm.member_id = m.id
     where m.id = $1`,
    [memberId],
  );
  return row;
}

describe('adding a page only person', () => {
  it('makes a person with no login, a Private page at the handle, no invitation and no email', async () => {
    const w = await workspace();
    const nick = handle();
    const added = await addPageOnlyPerson(w.owner, { name: 'Nick Kim', handle: nick }, makers);
    expect(added).toMatchObject({ name: 'Nick Kim', handle: nick, isLive: false, views: 0, isPageOnly: true });

    const row = await identityOf(added.memberId);
    expect(row?.email).toMatch(/@managed\.timefix\.invalid$/);
    expect(row?.accounts).toBe(0);
    expect(row?.partner_id).toBeNull();
    expect(row?.managed_partner).toBeNull();
    expect(row?.created_by_member_id).not.toBeNull();
    // No address of their own: the member row holds the identity's made up one, which Members never shows.
    expect(row?.member_email).toBe(row?.email);
    expect(await identity.isManagedUser(row?.user_id ?? '')).toBe(true);

    // No invitation and no email.
    expect(await testQuery(ownerUrl, `select 1 from invitations where workspace_id = $1`, [w.workspaceId])).toEqual([]);
    expect(
      await testQuery(ownerUrl, `select 1 from emails where workspace_id = $1 and to_member_id = $2`, [
        w.workspaceId,
        added.memberId,
      ]),
    ).toEqual([]);

    // Team pages lists them with the mark; Members says Page only, with no address.
    const listed = await listTeamLinkPages(w.owner);
    expect(listed.pages.find((page) => page.memberId === added.memberId)).toMatchObject({ isPageOnly: true });
    expect(listed.pages.find((page) => page.name === 'Ada')?.isPageOnly).toBeUndefined();
    const people = await listMembers(w.owner);
    const shown = people.members.find((member) => member.id === added.memberId);
    expect(shown?.pageOnly).toBe(true);
    expect(shown?.email).toBeUndefined();

    // History: added, as the owner, with the handle.
    const history = await listAuditEvents(w.owner, {});
    expect(history.entries.find((entry) => entry.action === 'member.added')).toMatchObject({
      params: { pageOnly: true, handle: nick },
    });
  });

  it('keeps an address on the member, never merged with the Timefix account that has it', async () => {
    const w = await workspace();
    const elsewhere = `${tag()}@example.com`;
    const account = await createTestUser(identityUrl, { email: elsewhere, name: 'Kate' });
    const added = await addPageOnlyPerson(w.owner, { name: 'Kate', email: elsewhere, handle: handle() }, makers);
    const row = await identityOf(added.memberId);
    expect(row?.member_email).toBe(elsewhere);
    expect(row?.user_id).not.toBe(account);
    expect(row?.email).toMatch(/@managed\.timefix\.invalid$/);
  });

  it('refuses an address in use or invited, a taken handle and a full workspace, leaving nothing behind', async () => {
    const w = await workspace();
    expect(
      await refusalOf(addPageOnlyPerson(w.owner, { name: 'Copy', email: w.ownerEmail, handle: handle() }, makers)),
    ).toMatchObject({ code: 'UNIQUE_CONFLICT', field: 'email' });
    await testQuery(
      ownerUrl,
      `insert into invitations (workspace_id, email, role, token_hash, expires_at, created_by_type, updated_by_type)
       values ($1, 'invited@example.com', 'member', $2, now() + interval '7 days', 'system', 'system')`,
      [w.workspaceId, randomBytes(32).toString('hex')],
    );
    expect(
      await refusalOf(
        addPageOnlyPerson(w.owner, { name: 'Inv', email: 'INVITED@example.com', handle: handle() }, makers),
      ),
    ).toMatchObject({ code: 'UNIQUE_CONFLICT' });

    const taken = handle();
    await addPageOnlyPerson(w.owner, { name: 'First', handle: taken }, makers);
    expect(await checkTeamHandle(w.owner, { handle: taken })).toEqual({ isFree: false });
    expect(await checkTeamHandle(w.owner, { handle: handle() })).toEqual({ isFree: true });
    expect(await checkTeamHandle(w.owner, { handle: 'ab' })).toEqual({ isFree: false });
    expect(await refusalOf(addPageOnlyPerson(w.owner, { name: 'Second', handle: taken }, makers))).toMatchObject({
      code: 'SLUG_TAKEN',
      field: 'handle',
    });
    const suggested = await suggestTeamHandle(w.owner, { name: 'First' });
    expect(suggested.handle).toBeDefined();

    // Two seats used (Ada and First); a plan of two has none left.
    const full = rescope(w.owner, { limits: { ...LIMITS, seats: 2 } });
    expect(await refusalOf(addPageOnlyPerson(full, { name: 'Third', handle: handle() }, makers))).toMatchObject({
      code: 'SEAT_LIMIT',
    });
    // Nothing was made for the refused adds: one page only identity in the workspace.
    const made = await testQuery(
      ownerUrl,
      `select 1 from auth.managed_users where workspace_id = $1 and partner_id is null`,
      [w.workspaceId],
    );
    expect(made).toHaveLength(1);
  });

  it('is for people who manage team pages only', async () => {
    const w = await workspace();
    const member = rescope(w.owner, { role: 'member' });
    expect(await refusalOf(addPageOnlyPerson(member, { name: 'Nope', handle: handle() }, makers))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(checkTeamHandle(member, { handle: handle() }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(suggestTeamHandle(member, { name: 'Nope' }))).toMatchObject({ code: 'FORBIDDEN' });
    const added = await addPageOnlyPerson(w.owner, { name: 'Kept', handle: handle() }, makers);
    expect(await refusalOf(removePageOnlyPerson(member, { member: added.memberId }, enders))).toMatchObject({
      code: 'FORBIDDEN',
    });
    // An admin may, as the built in Admin holds the permission.
    const admin = rescope(w.owner, { role: 'admin' });
    expect((await addPageOnlyPerson(admin, { name: 'By admin', handle: handle() }, makers)).isPageOnly).toBe(true);
  });
});

describe('beside a partner', () => {
  it('is never found, changed or removed by the partner’s PUT and DELETE, and keeps its address', async () => {
    const hub = await connected();
    const added = await addPageOnlyPerson(
      hub.owner,
      { name: 'Nick', email: 'nick@example.com', handle: handle() },
      makers,
    );
    const personId = (
      await testQuery<{ id: string }>(ownerUrl, `select id from managed_members where member_id = $1`, [added.memberId])
    )[0]?.id;
    expect(personId).toBeDefined();
    const external = personId ?? '';

    // The same id as the partner's external id is another person, never Nick.
    expect(
      await refusalOf(
        removePartnerMember(hub.partner, { connectionId: hub.connectionId, externalId: external }, partnerUsers),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listPartnerMembers(hub.partner, { connectionId: hub.connectionId })).members).toEqual([]);
    // Nick's address is his: the partner can't take it.
    expect(
      await refusalOf(
        putPartnerMember(
          hub.partner,
          {
            connectionId: hub.connectionId,
            externalId: external,
            person: { name: 'Other', email: 'nick@example.com', role: 'member' },
          },
          partnerUsers,
        ),
      ),
    ).toMatchObject({ code: 'UNIQUE_CONFLICT' });
    const theirs = await putPartnerMember(
      hub.partner,
      {
        connectionId: hub.connectionId,
        externalId: external,
        person: { name: 'Other', email: 'other@example.com', role: 'member' },
      },
      partnerUsers,
    );
    expect(theirs.member.memberId).not.toBe(added.memberId);
    expect((await identityOf(added.memberId))?.removed_at).toBeNull();

    // Members marks each kind.
    const people = await listMembers(hub.owner);
    expect(people.members.find((member) => member.id === added.memberId)?.pageOnly).toBe(true);
    expect(people.members.find((member) => member.id === theirs.member.memberId)?.viaApp).toBeDefined();
    expect(people.members.find((member) => member.id === theirs.member.memberId)?.pageOnly).toBeUndefined();
    // Team pages removes only a page only person.
    expect(await refusalOf(removePageOnlyPerson(hub.owner, { member: theirs.member.memberId }, enders))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('removing a page only person', () => {
  it('stops their handle, keeps their page, writes History, and answers false a second time', async () => {
    const w = await workspace();
    const nick = handle();
    const added = await addPageOnlyPerson(w.owner, { name: 'Nick', handle: nick }, makers);
    const before = await identityOf(added.memberId);

    expect(await removePageOnlyPerson(w.owner, { member: added.memberId }, enders)).toEqual({ removed: true });
    const [member] = await testQuery<{ status: string }>(ownerUrl, `select status from members where id = $1`, [
      added.memberId,
    ]);
    expect(member?.status).toBe('removed');
    expect((await identityOf(added.memberId))?.removed_at).not.toBeNull();
    // The handle stops (no active member answers for it) and the page's content stays.
    expect((await listTeamLinkPages(w.owner)).pages.map((page) => page.memberId)).not.toContain(added.memberId);
    expect(
      await testQuery(ownerUrl, `select 1 from auth.public_profiles where user_id = $1`, [before?.user_id]),
    ).toHaveLength(1);
    expect(
      await testQuery(ownerUrl, `select 1 from auth.workspace_membership where user_id = $1`, [before?.user_id]),
    ).toEqual([]);
    const history = await listAuditEvents(w.owner, {});
    expect(history.entries.find((entry) => entry.action === 'member.removed')).toMatchObject({
      params: { pageOnly: true },
    });

    expect(await removePageOnlyPerson(w.owner, { member: added.memberId }, enders)).toEqual({ removed: false });
    // Ada isn't a page only person: Members removes her, never Team pages.
    const ada = w.owner.access.principal.kind === 'member' ? w.owner.access.principal.memberId : '';
    expect(await refusalOf(removePageOnlyPerson(w.owner, { member: ada }, enders))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers NOT_FOUND for another workspace’s person', async () => {
    const one = await workspace();
    const two = await workspace();
    const added = await addPageOnlyPerson(one.owner, { name: 'Nick', handle: handle() }, makers);
    expect(await refusalOf(removePageOnlyPerson(two.owner, { member: added.memberId }, enders))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('leaves one the workspace made an owner to Members', async () => {
    const w = await workspace();
    const added = await addPageOnlyPerson(w.owner, { name: 'Owen', handle: handle() }, makers);
    await testQuery(ownerUrl, `update members set role = 'owner' where id = $1`, [added.memberId]);
    expect(await refusalOf(removePageOnlyPerson(w.owner, { member: added.memberId }, enders))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('roles and identities', () => {
  it('never makes a page only person an owner or an admin', async () => {
    const w = await workspace();
    const added = await addPageOnlyPerson(w.owner, { name: 'Nick', handle: handle() }, makers);
    for (const role of ['admin', 'owner'] as const) {
      expect(await refusalOf(setMemberRole(w.owner, { memberId: added.memberId, role }))).toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(await refusalOf(transferOwnership(w.owner, { memberId: added.memberId }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    // A guest and back is theirs to have, as anyone's.
    await setMemberRole(w.owner, { memberId: added.memberId, role: 'guest' });
    await setMemberRole(w.owner, { memberId: added.memberId, role: 'member' });
  });

  it('drops only an identity a refused add left behind', async () => {
    const w = await workspace();
    const orphan = await identity.ensurePageOnlyUser({ workspaceId: w.workspaceId, personId: newId(), name: 'Gone' });
    expect(await identity.dropPageOnlyUser(orphan)).toBe(true);
    expect(await testQuery(ownerUrl, `select 1 from auth."user" where id = $1`, [orphan])).toEqual([]);
    // One that joined stays, and so does anyone who isn't page only.
    const added = await addPageOnlyPerson(w.owner, { name: 'Kept', handle: handle() }, makers);
    const joined = (await identityOf(added.memberId))?.user_id ?? '';
    expect(await identity.dropPageOnlyUser(joined)).toBe(false);
    const someone = await createTestUser(identityUrl, { email: `${tag()}@example.com` });
    expect(await identity.dropPageOnlyUser(someone)).toBe(false);
  });
});

describe('naming a page only person', () => {
  it('changes the name and the title under it, shows a title given, and writes History once', async () => {
    const w = await workspace();
    const added = await addPageOnlyPerson(w.owner, { name: 'Nick', handle: handle() }, makers);
    // The manager's editor reads who keeps the name: this workspace's team.
    const page = await enterTeamLinkPage(w.owner, added.memberId);
    expect((await getMyProfile(page)).managedBy).toBe('team');

    const named = await namePageOnlyPerson(w.owner, {
      member: added.memberId,
      name: '  Nick Page ',
      jobTitle: 'Barista',
    });
    expect(named).toMatchObject({ name: 'Nick Page', jobTitle: 'Barista', showJobTitle: true });
    expect(await getMyProfile(page)).toMatchObject({ name: 'Nick Page', jobTitle: 'Barista', showJobTitle: true });
    // The same again writes nothing.
    await namePageOnlyPerson(w.owner, { member: added.memberId, name: 'Nick Page' });
    // A title reworded leaves the choice where it stands: turned off by hand, it stays off.
    await testQuery(ownerUrl, `update auth.public_profiles set show_job_title = false where workspace_id = $1`, [
      w.workspaceId,
    ]);
    expect(await namePageOnlyPerson(w.owner, { member: added.memberId, jobTitle: 'Head barista' })).toMatchObject({
      jobTitle: 'Head barista',
      showJobTitle: false,
    });
    // A title cleared shows nothing.
    const cleared = await namePageOnlyPerson(w.owner, { member: added.memberId, jobTitle: '' });
    expect(cleared).toEqual({ handle: cleared.handle, name: 'Nick Page', showJobTitle: false });
    expect(cleared.handle).toBe(added.handle);
    const history = (await listAuditEvents(w.owner, {})).entries.filter(
      (entry) => entry.action === 'member.profile_updated',
    );
    expect(history).toHaveLength(3);
    expect(history.at(-1)).toMatchObject({
      params: { isOwn: false, fields: ['name', 'jobTitle', 'showJobTitle'] },
    });
    expect(await refusalOf(namePageOnlyPerson(w.owner, { member: added.memberId, name: 'Two\nlines' }))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'name',
    });
  });

  it('never names someone with a login, a guest, another workspace’s person, or for a plain member', async () => {
    const w = await workspace();
    const other = await workspace();
    const added = await addPageOnlyPerson(w.owner, { name: 'Nick', handle: handle() }, makers);
    const ada = w.owner.access.principal.kind === 'member' ? w.owner.access.principal.memberId : '';
    expect(await refusalOf(namePageOnlyPerson(w.owner, { member: ada, name: 'Renamed' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await getMyProfile(w.owner)).not.toHaveProperty('managedBy');
    expect(await refusalOf(namePageOnlyPerson(other.owner, { member: added.memberId, name: 'Taken' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const member = rescope(w.owner, { role: 'member' });
    expect(await refusalOf(namePageOnlyPerson(member, { member: added.memberId, name: 'Nope' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    await setMemberRole(w.owner, { memberId: added.memberId, role: 'guest' });
    expect(await refusalOf(namePageOnlyPerson(w.owner, { member: added.memberId, name: 'Guest' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // One made an admin since (never by Team pages, so by hand here) is theirs to keep.
    await testQuery(ownerUrl, `update members set role = 'admin' where id = $1`, [added.memberId]);
    expect(await refusalOf(namePageOnlyPerson(w.owner, { member: added.memberId, name: 'Admin' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const [row] = await testQuery<{ name: string }>(ownerUrl, `select name from members where id = $1`, [
      added.memberId,
    ]);
    expect(row?.name).toBe('Nick');
  });

  it('leaves a partner’s person to the partner', async () => {
    const hub = await connected();
    const theirs = await putPartnerMember(
      hub.partner,
      {
        connectionId: hub.connectionId,
        externalId: `ext-${tag()}`,
        person: { name: 'Pat', email: `${tag()}@example.com`, role: 'member' },
      },
      partnerUsers,
    );
    expect(
      await refusalOf(namePageOnlyPerson(hub.owner, { member: theirs.member.memberId, name: 'Renamed' })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    const page = await enterTeamLinkPage(hub.owner, theirs.member.memberId);
    expect((await getMyProfile(page)).managedBy).toBe('partner');
  });
});
