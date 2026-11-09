// Embedded screens (spec 0070, slice 4, AC-7030, AC-7031, AC-7035) against the real Postgres: a launch's code works
// once and only within its minute, only while its person is still in and its connection live, a code's secret is
// checked, a member's own role decides Team pages, and a sandbox partner's test connections are wiped in one go.
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterAsPartner, enterWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { startWorkspace } from '../account/account.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { signedInNow } from '../testing.ts';
import { approvePartnerConnect } from './connect.ts';
import { disconnectApp } from './connections.ts';
import { exchangePartnerCode } from './exchange.ts';
import {
  describeEmbedSession,
  embedConnectionModules,
  launchPartnerScreen,
  parsePartnerLaunchCode,
  redeemPartnerLaunch,
  wipeTestConnections,
} from './launch.ts';
import { putPartnerMember, removePartnerMember } from './members.ts';
import { registerPartner, updatePartner } from './registry.ts';
import { s256Challenge } from './tokens.ts';

const { appUrl, identityUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-partner-launch-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-partner-launch-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);
const REDIRECT = 'https://hub.example.com/timefix/callback';
const audit = () => ({ userId: randomUUID(), action: 'operator.partnerTest', requestId: randomUUID() });

async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

const users = {
  users: {
    ensureManagedUser: (person: Parameters<IdentityStore['ensureManagedUser']>[0]) =>
      identity.ensureManagedUser(person),
    endManagedUserSessions: (userId: string) => identity.endManagedUserSessions(userId),
    dropMembership: (userId: string, workspaceId: string, memberId?: string) =>
      identity.dropMembership(userId, workspaceId, memberId),
  },
};

/** A workspace connected to a new partner (a sandbox one with `isTest`), with an admin and a member it added. */
async function connected(isTest = false) {
  const made = await registerPartner(
    { partners: identity },
    { name: `Hub ${tag()}`, frameOrigins: ['https://hub.example.com'], redirectUris: [REDIRECT] },
    audit(),
  );
  if (isTest) await updatePartner({ partners: identity }, { partnerId: made.partner.id, isTest: true }, audit());
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email, name: 'Ada' });
  const slug = `launch-${tag()}`;
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
  const swapped = await exchangePartnerCode(
    { db, partners: identity },
    {
      clientId: made.partner.clientId,
      clientSecret: made.secret,
      code: new URL(approved.redirectTo).searchParams.get('code') ?? '',
      redirectUri: REDIRECT,
      codeVerifier: verifier,
    },
  );
  if (!swapped.ok) throw new Error(swapped.message);
  const entry = await enterAsPartner({ db }, swapped.token);
  if (entry === undefined) throw new Error('The partner door refused its own token.');
  const connectionId = swapped.connection.id;
  for (const [externalId, role] of [
    ['lead', 'admin'],
    ['crew', 'member'],
  ] as const) {
    await putPartnerMember(
      entry.scope,
      { connectionId, externalId, person: { email: `${externalId}-${tag()}@example.com`, name: externalId, role } },
      users,
    );
  }
  return {
    partner: made.partner,
    owner,
    slug,
    workspaceId: started.workspace.id,
    connectionId,
    isTest: swapped.connection.isTest,
    scope: entry.scope,
  };
}

describe('a launch (AC-7030, AC-7031)', () => {
  it('works once, within its minute, for the person it names', async () => {
    const hub = await connected();
    const now = new Date();
    const launched = await launchPartnerScreen(
      hub.scope,
      { connectionId: hub.connectionId, launch: { externalId: 'lead', screen: 'link_pages.team', theme: 'dark' } },
      { now: () => now },
    );
    expect(launched.expiresAt.getTime() - now.getTime()).toBe(60_000);
    // A minute on, it has run out.
    const late = new Date(now.getTime() + 60_001);
    expect(await redeemPartnerLaunch({ db, now: () => late }, launched.code)).toBeUndefined();

    const fresh = await launchPartnerScreen(hub.scope, {
      connectionId: hub.connectionId,
      launch: { externalId: 'lead', screen: 'link_pages.team' },
    });
    // The right row with a wrong secret opens nothing, and doesn't use the code up.
    const parts = parsePartnerLaunchCode(fresh.code);
    expect(parts).toBeDefined();
    const wrong = fresh.code.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A'));
    expect(await redeemPartnerLaunch({ db }, wrong)).toBeUndefined();
    const redeemed = await redeemPartnerLaunch({ db }, fresh.code);
    expect(redeemed).toMatchObject({
      workspaceId: hub.workspaceId,
      connectionId: hub.connectionId,
      partnerId: hub.partner.id,
      screen: 'link_pages.team',
    });
    expect((redeemed?.sessionExpiresAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(11.9 * 60 * 60 * 1000);
    expect(await redeemPartnerLaunch({ db }, fresh.code)).toBeUndefined();

    // What the session opens, through the member door: the admin may manage Team pages.
    const facts = await describeEmbedSession(
      { db, identity, rules: NO_RULE_SOURCE },
      {
        userId: redeemed?.userId ?? '',
        workspaceId: hub.workspaceId,
        connectionId: hub.connectionId,
        session: signedInNow(),
      },
    );
    expect(facts).toMatchObject({ slug: hub.slug, personName: 'lead', canManageTeam: true, modules: ['link_pages'] });
  });

  it('refuses Team pages for a member, and a person the partner never added or removed since', async () => {
    const hub = await connected();
    const launch = (externalId: string, screen: 'link_pages.mine' | 'link_pages.team') =>
      launchPartnerScreen(hub.scope, { connectionId: hub.connectionId, launch: { externalId, screen } });
    expect(await refusalOf(launch('crew', 'link_pages.team'))).toBe('FORBIDDEN');
    expect(await refusalOf(launch('nobody', 'link_pages.mine'))).toBe('NOT_FOUND');
    const mine = await launch('crew', 'link_pages.mine');
    // Removed after the launch: the code no longer opens anything.
    await removePartnerMember(hub.scope, { connectionId: hub.connectionId, externalId: 'crew' }, users);
    expect(await redeemPartnerLaunch({ db }, mine.code)).toBeUndefined();
    expect(await refusalOf(launch('crew', 'link_pages.mine'))).toBe('NOT_FOUND');
    // Another connection's id, or an owner's scope, opens nothing.
    expect(
      await refusalOf(
        launchPartnerScreen(hub.scope, {
          connectionId: newId(),
          launch: { externalId: 'lead', screen: 'link_pages.mine' },
        }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await refusalOf(
        launchPartnerScreen(hub.owner, {
          connectionId: hub.connectionId,
          launch: { externalId: 'lead', screen: 'link_pages.mine' },
        }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('stops opening anything once the connection is disconnected', async () => {
    const hub = await connected();
    const launched = await launchPartnerScreen(hub.scope, {
      connectionId: hub.connectionId,
      launch: { externalId: 'lead', screen: 'link_pages.mine' },
    });
    expect(await embedConnectionModules({ db }, hub)).toEqual(['link_pages']);
    await disconnectApp(hub.owner, { partners: identity }, { connectionId: hub.connectionId });
    expect(await redeemPartnerLaunch({ db }, launched.code)).toBeUndefined();
    expect(await embedConnectionModules({ db }, hub)).toBeUndefined();
  });
});

describe('the sandbox (AC-7035)', () => {
  it('marks a test partner’s connections as test, and wipes only those, in one go', async () => {
    const live = await connected();
    const sandbox = await connected(true);
    expect(live.isTest).toBe(false);
    expect(sandbox.isTest).toBe(true);
    // The live partner's connection is never wiped, even asked by its own id.
    expect(await wipeTestConnections({ db }, { id: live.partner.id, name: live.partner.name })).toEqual([]);
    expect(await embedConnectionModules({ db }, live)).toEqual(['link_pages']);
    const wiped = await wipeTestConnections({ db }, { id: sandbox.partner.id, name: sandbox.partner.name });
    expect(wiped).toEqual([sandbox.connectionId]);
    expect(await embedConnectionModules({ db }, sandbox)).toBeUndefined();
    expect(await wipeTestConnections({ db }, { id: sandbox.partner.id, name: sandbox.partner.name })).toEqual([]);
  });
});
