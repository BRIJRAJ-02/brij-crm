// The social links of someone with no login of their own (10 Nov 2026), kept by a team page manager, against the real
// Postgres: a page only person's and a connected app's person's set saved, read back on their page, written to
// History once; never someone with a login, an owner or admin, another workspace's person, or, from inside an app's
// frame, another app's person; and never for someone without `link_pages.manage_team`.
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterAsPartner, enterTeamLinkPage, enterWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { startWorkspace } from '../account/account.ts';
import { listAuditEvents } from '../audit/audit.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { setMemberRole } from '../members/members.ts';
import { getMyProfile } from '../members/profile.ts';
import { approvePartnerConnect } from '../partners/connect.ts';
import { exchangePartnerCode } from '../partners/exchange.ts';
import { putPartnerMember } from '../partners/members.ts';
import { registerPartner } from '../partners/registry.ts';
import { s256Challenge } from '../partners/tokens.ts';
import { rescope, signedInNow } from '../testing.ts';
import { setManagedSocials } from './managed-socials.ts';
import { addPageOnlyPerson, removePageOnlyPerson } from './page-only.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-managed-socials-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-managed-socials-tests' });
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
  const slug = `socials-${tag()}`;
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

const LINKEDIN = { network: 'linkedin', href: 'https://www.linkedin.com/in/nickpage' } as const;
const SITE = { network: 'website', href: 'https://nick.example.com/' } as const;

/** A partner's person in `hub`'s workspace, with no login. */
async function partnerPerson(hub: Awaited<ReturnType<typeof connected>>) {
  const put = await putPartnerMember(
    hub.partner,
    {
      connectionId: hub.connectionId,
      externalId: `ext-${tag()}`,
      person: { name: 'Pat', email: `${tag()}@example.com`, role: 'member' },
    },
    partnerUsers,
  );
  return put.member.memberId;
}

describe('a managed person’s social links', () => {
  it('saves a page only person’s set, live on their page, with one History row', async () => {
    const w = await workspace();
    const added = await addPageOnlyPerson(w.owner, { name: 'Nick', handle: handle() }, makers);
    const page = await enterTeamLinkPage(w.owner, added.memberId);
    expect(await getMyProfile(page)).toMatchObject({ socials: [], socialsByManager: true });

    const saved = await setManagedSocials(w.owner, { member: added.memberId, socials: [LINKEDIN, SITE] });
    expect(saved.socials.map((link) => link.network)).toEqual(['linkedin', 'website']);
    expect(saved.handle).toBe(added.handle);
    expect((await getMyProfile(page)).socials?.map((link) => link.network)).toEqual(['linkedin', 'website']);
    // The same set again writes nothing; a reorder is a change.
    await setManagedSocials(w.owner, { member: added.memberId, socials: saved.socials });
    await setManagedSocials(w.owner, { member: added.memberId, socials: [...saved.socials].reverse() });
    const history = (await listAuditEvents(w.owner, {})).entries.filter(
      (entry) => entry.action === 'member.profile_updated',
    );
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ params: { isOwn: false, fields: ['socials'] } });
    // Checked again here: a link to another site is refused on its row.
    expect(
      await refusalOf(
        setManagedSocials(w.owner, {
          member: added.memberId,
          socials: [{ network: 'linkedin', href: 'https://example.com/nick' }],
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'socials.0.href' });
  });

  it('never keeps the set of someone with a login, an admin, another workspace’s person, or for a plain member', async () => {
    const w = await workspace();
    const other = await workspace();
    const added = await addPageOnlyPerson(w.owner, { name: 'Nick', handle: handle() }, makers);
    const ada = w.owner.access.principal.kind === 'member' ? w.owner.access.principal.memberId : '';
    expect(await refusalOf(setManagedSocials(w.owner, { member: ada, socials: [LINKEDIN] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await getMyProfile(w.owner)).not.toHaveProperty('socialsByManager');
    expect(
      await refusalOf(setManagedSocials(other.owner, { member: added.memberId, socials: [LINKEDIN] })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    const member = rescope(w.owner, { role: 'member' });
    expect(await refusalOf(setManagedSocials(member, { member: added.memberId, socials: [LINKEDIN] }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    await testQuery(ownerUrl, `update members set role = 'admin' where id = $1`, [added.memberId]);
    expect(await refusalOf(setManagedSocials(w.owner, { member: added.memberId, socials: [LINKEDIN] }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const page = await enterTeamLinkPage(w.owner, added.memberId);
    expect(await getMyProfile(page)).not.toHaveProperty('socialsByManager');
    expect((await getMyProfile(page)).socials).toEqual([]);
  });

  it('never keeps the set of a guest or someone removed', async () => {
    const w = await workspace();
    const guest = await addPageOnlyPerson(w.owner, { name: 'Gus', handle: handle() }, makers);
    await setMemberRole(w.owner, { memberId: guest.memberId, role: 'guest' });
    expect(await refusalOf(setManagedSocials(w.owner, { member: guest.memberId, socials: [LINKEDIN] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const gone = await addPageOnlyPerson(w.owner, { name: 'Rae', handle: handle() }, makers);
    await removePageOnlyPerson(w.owner, { member: gone.memberId }, enders);
    expect(await refusalOf(setManagedSocials(w.owner, { member: gone.memberId, socials: [LINKEDIN] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps a connected app’s person’s set, inside its own frame only, until they have a login', async () => {
    const hub = await connected();
    const pat = await partnerPerson(hub);
    const page = await enterTeamLinkPage(hub.owner, pat);
    // In Timefix, and inside this app's frame.
    expect(await getMyProfile(page)).toMatchObject({ socialsByManager: true });
    expect(await getMyProfile(page, { fromConnection: hub.connectionId })).toMatchObject({ socialsByManager: true });
    await setManagedSocials(
      hub.owner,
      { member: pat, socials: [LINKEDIN] },
      [],
      {},
      {
        fromConnection: hub.connectionId,
      },
    );
    expect((await getMyProfile(page)).socials).toHaveLength(1);
    // Another app's frame on the same workspace never reaches them.
    const elsewhere = randomUUID();
    expect(await getMyProfile(page, { fromConnection: elsewhere })).not.toHaveProperty('socialsByManager');
    expect(
      await refusalOf(
        setManagedSocials(hub.owner, { member: pat, socials: [] }, [], {}, { fromConnection: elsewhere }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    // A page only person is reachable from any frame of the workspace.
    const added = await addPageOnlyPerson(hub.owner, { name: 'Nick', handle: handle() }, makers);
    await setManagedSocials(
      hub.owner,
      { member: added.memberId, socials: [SITE] },
      [],
      {},
      {
        fromConnection: elsewhere,
      },
    );
    // With a login of their own, the set is theirs.
    await testQuery(ownerUrl, `update managed_members set claimed_at = now() where member_id = $1`, [pat]);
    expect(await getMyProfile(page)).not.toHaveProperty('socialsByManager');
    expect(await refusalOf(setManagedSocials(hub.owner, { member: pat, socials: [] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await getMyProfile(page)).socials).toHaveLength(1);
  });
});
