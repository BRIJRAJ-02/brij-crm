// Partner connect (spec 0070, slice 2, AC-7010 to AC-7013) against the real Postgres: the registry keeps only a
// secret's hash and a replaced secret stops at once; the connect refuses an unregistered redirect address, a missing
// state and anything but S256; only an owner approves; a code works once, within 60 seconds, for its own partner,
// redirect address and verifier, and a reused code ends its connection; the token opens the partner door and stops at
// Disconnect; and the partner principal reads its own connection and nothing else.
import { randomBytes, randomUUID } from 'node:crypto';
import type { PartnerConnectRequest } from '@crm/contracts';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterAsPartner, enterWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { startWorkspace } from '../account/account.ts';
import { listAuditEvents } from '../audit/audit.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { signedInNow, testScope } from '../testing.ts';
import { approvePartnerConnect, denyPartnerConnect, partnerConnectOffer } from './connect.ts';
import { disconnectApp, listConnectedApps, readPartnerConnection, setConnectedAppModules } from './connections.ts';
import { exchangePartnerCode } from './exchange.ts';
import { registerPartner, replacePartnerSecret, updatePartner } from './registry.ts';
import { s256Challenge } from './tokens.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-partner-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-partner-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);
const audit = () => ({ userId: randomUUID(), action: 'operator.partnerTest', requestId: randomUUID() });
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

/** A registered partner, its secret, and a PKCE pair. */
async function partner(redirectUris: string[] = [REDIRECT]) {
  const made = await registerPartner(
    { partners: identity },
    { name: `Hub ${tag()}`, frameOrigins: ['https://hub.example.com'], redirectUris },
    audit(),
  );
  return made;
}

/** A person who owns a workspace made the way the app makes one, with its owner's scope. */
async function owner() {
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email, name: 'Ada' });
  const slug = `partner-${tag()}`;
  const started = await startWorkspace(
    { db, identity },
    { id: userId, name: 'Ada', email },
    { id: newId(), name: 'Acme', slug, memberName: 'Ada' },
  );
  const scope = await enterWorkspace({ db, identity, rules: NO_RULE_SOURCE }, { userId, slug, session: signedInNow() });
  return { userId, slug, workspaceId: started.workspace.id, scope };
}

function request(clientId: string, overrides: Partial<PartnerConnectRequest> = {}) {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    request: {
      clientId,
      redirectUri: REDIRECT,
      state: `state-${tag()}`,
      codeChallenge: s256Challenge(verifier),
      codeChallengeMethod: 'S256',
      responseType: 'code',
      ...overrides,
    } satisfies PartnerConnectRequest,
  };
}

/** The code and state a redirect address carries. */
function codeOf(redirectTo: string): { code: string; state: string | null; base: string } {
  const url = new URL(redirectTo);
  return {
    code: url.searchParams.get('code') ?? '',
    state: url.searchParams.get('state'),
    base: `${url.origin}${url.pathname}`,
  };
}

describe('the registry (AC-7010)', () => {
  it('shows the secret once, keeps only its hash, and a replaced secret stops at once', async () => {
    const made = await partner();
    expect(made.secret).toMatch(/^tfs_[A-Za-z0-9_-]{43}$/);
    expect(made.partner.clientId).toMatch(/^tfp_[A-Za-z0-9_-]{22}$/);
    expect(made.partner.secretHint).toBe(made.secret.slice(-4));
    const stored = await testQuery(ownerUrl, 'select secret_hash, secret_hint from auth.partners where id = $1', [
      made.partner.id,
    ]);
    const row = stored[0] as { secret_hash: Buffer; secret_hint: string };
    expect(row.secret_hash.length).toBe(32);
    expect(row.secret_hash.toString('utf8')).not.toContain(made.secret);
    expect(JSON.stringify(made.partner)).not.toContain(made.secret);

    const { scope } = await owner();
    const { request: asked, verifier } = request(made.partner.clientId);
    const { code } = codeOf(
      (await approvePartnerConnect(scope, { partners: identity }, { request: asked, modules: ['link_pages'] }))
        .redirectTo,
    );
    const replaced = await replacePartnerSecret({ partners: identity }, { partnerId: made.partner.id }, audit());
    expect(replaced.secret).not.toBe(made.secret);
    const withOld = await exchangePartnerCode(
      { db, partners: identity },
      {
        clientId: made.partner.clientId,
        clientSecret: made.secret,
        code,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
      },
    );
    expect(withOld).toMatchObject({ ok: false, reason: 'invalid_client' });
    const withNew = await exchangePartnerCode(
      { db, partners: identity },
      {
        clientId: made.partner.clientId,
        clientSecret: replaced.secret,
        code,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
      },
    );
    expect(withNew.ok).toBe(true);
  });

  it('refuses a redirect address that isn’t https or isn’t written in full, and a frame origin with a path', async () => {
    for (const bad of [
      'http://hub.example.com/cb',
      'https://hub.example.com',
      'hub.example.com/cb',
      'https://a@b.com/x',
    ]) {
      expect(
        await refusalOf(
          registerPartner({ partners: identity }, { name: 'Hub', frameOrigins: [], redirectUris: [bad] }, audit()),
        ),
      ).toMatchObject({ code: 'CONFIG_INVALID' });
    }
    expect(
      await refusalOf(
        registerPartner(
          { partners: identity },
          { name: 'Hub', frameOrigins: ['https://hub.example.com/app'], redirectUris: [REDIRECT] },
          audit(),
        ),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    // A loopback address over http is a partner's own laptop (RFC 8252).
    const local = await partner(['http://localhost:5390/callback']);
    expect(local.partner.redirectUris).toEqual(['http://localhost:5390/callback']);
    expect(
      await refusalOf(updatePartner({ partners: identity }, { partnerId: randomUUID(), name: 'X' }, audit())),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('takes a logo only when its bytes are the type it claims', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
    const made = await registerPartner(
      { partners: identity },
      { name: 'Logo', logo: { type: 'image/png', data: png }, frameOrigins: [], redirectUris: [REDIRECT] },
      audit(),
    );
    expect(made.partner.logoUrl).toBe(`/api/public/partners/${made.partner.clientId}/logo?v=1`);
    expect(
      await refusalOf(
        updatePartner(
          { partners: identity },
          { partnerId: made.partner.id, logo: { type: 'image/jpeg', data: png } },
          audit(),
        ),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

describe('the connect (AC-7011, AC-7012)', () => {
  it('names the partner and the workspaces the person owns, and refuses what the partner didn’t register', async () => {
    const made = await partner();
    const ada = await owner();
    const offer = await partnerConnectOffer(
      { partners: identity, identity, door: { db, identity, rules: NO_RULE_SOURCE } },
      { userId: ada.userId, session: signedInNow(), request: request(made.partner.clientId).request },
    );
    expect(offer).toEqual({
      partner: { name: made.partner.name },
      modules: ['link_pages'],
      workspaces: [{ slug: ada.slug, name: 'Acme', connected: false }],
      otherWorkspaces: 0,
    });
    const deps = { partners: identity };
    const cases: Partial<PartnerConnectRequest>[] = [
      { redirectUri: 'https://evil.example.com/cb' },
      { redirectUri: `${REDIRECT}/../steal` },
      { redirectUri: `${REDIRECT}?next=https://evil.example.com` },
      { codeChallengeMethod: 'plain' },
      { codeChallenge: '' },
      { state: '' },
      { responseType: 'token' },
    ];
    for (const overrides of cases) {
      const asked = request(made.partner.clientId, overrides).request;
      expect(await refusalOf(denyPartnerConnect(deps, asked))).toMatchObject({ code: 'CONFIG_INVALID' });
      expect(
        await refusalOf(approvePartnerConnect(ada.scope, deps, { request: asked, modules: ['link_pages'] })),
      ).toMatchObject({ code: 'CONFIG_INVALID' });
    }
    expect(await refusalOf(denyPartnerConnect(deps, request('tfp_AAAAAAAAAAAAAAAAAAAAAA').request))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const denied = new URL((await denyPartnerConnect(deps, request(made.partner.clientId).request)).redirectTo);
    expect(denied.searchParams.get('error')).toBe('access_denied');
  });

  it('lets only an owner approve: an admin and a member are refused', async () => {
    const made = await partner();
    const ada = await owner();
    for (const role of ['admin', 'member'] as const) {
      const memberId = newId();
      await testQuery(
        ownerUrl,
        `insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
         values ($1, $2, 'Bea', $3, $4, 'system', 'system')`,
        [ada.workspaceId, memberId, `${tag()}@example.com`, role],
      );
      const scope = testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'member', id: memberId }, role });
      expect(
        await refusalOf(
          approvePartnerConnect(
            scope,
            { partners: identity },
            { request: request(made.partner.clientId).request, modules: ['link_pages'] },
          ),
        ),
      ).toEqual({ code: 'FORBIDDEN', message: 'Only workspace owners can connect apps.' });
    }
  });
});

describe('the token exchange (AC-7011)', () => {
  async function approved() {
    const made = await partner();
    const ada = await owner();
    const { request: asked, verifier } = request(made.partner.clientId);
    const answer = await approvePartnerConnect(
      ada.scope,
      { partners: identity },
      { request: asked, modules: ['link_pages'] },
    );
    const back = codeOf(answer.redirectTo);
    expect(back.base).toBe(REDIRECT);
    expect(back.state).toBe(asked.state);
    const input = {
      clientId: made.partner.clientId,
      clientSecret: made.secret,
      code: back.code,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
    };
    return { made, ada, input };
  }
  const deps = () => ({ db, partners: identity });

  it('swaps a code once for a connection whose token opens only its own connection', async () => {
    const { ada, input } = await approved();
    const swapped = await exchangePartnerCode(deps(), input);
    if (!swapped.ok) throw new Error(swapped.message);
    expect(swapped.token).toMatch(/^tfa_/);
    expect(swapped.connection).toMatchObject({
      workspace: { id: ada.workspaceId, name: 'Acme' },
      modules: ['link_pages'],
    });
    const stored = await testQuery(ownerUrl, 'select token_hash from partner_connections where id = $1', [
      swapped.connection.id,
    ]);
    expect((stored[0] as { token_hash: Buffer }).token_hash.length).toBe(32);

    const entry = await enterAsPartner({ db }, swapped.token);
    expect(entry?.scope.access.principal).toMatchObject({ kind: 'partner', connectionId: swapped.connection.id });
    expect(entry?.scope.access.permissions).toEqual([]);
    if (entry === undefined) throw new Error('No entry.');
    expect(await readPartnerConnection(entry.scope, { connectionId: swapped.connection.id })).toMatchObject({
      id: swapped.connection.id,
      modules: ['link_pages'],
    });
    expect(await refusalOf(readPartnerConnection(entry.scope, { connectionId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // A partner scope is no member: Connected apps refuses it.
    expect(await refusalOf(listConnectedApps(entry.scope, { partners: identity }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await enterAsPartner({ db }, `${swapped.token.slice(0, -1)}A`)).toBeUndefined();

    // Used again: refused, and the connection it made ends at once.
    expect(await exchangePartnerCode(deps(), input)).toMatchObject({ ok: false, reason: 'invalid_grant' });
    expect(await enterAsPartner({ db }, swapped.token)).toBeUndefined();
    const history = await listAuditEvents(ada.scope);
    expect(history.entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['partner.connected', 'partner.disconnected']),
    );
  });

  it('refuses the wrong verifier, address, client or secret, and burns the code on a bad verifier', async () => {
    const { input } = await approved();
    const other = await partner();
    expect(await exchangePartnerCode(deps(), { ...input, clientSecret: other.secret })).toMatchObject({
      reason: 'invalid_client',
    });
    expect(
      await exchangePartnerCode(deps(), { ...input, clientId: other.partner.clientId, clientSecret: other.secret }),
    ).toMatchObject({ reason: 'invalid_grant' });
    expect(
      await exchangePartnerCode(deps(), { ...input, codeVerifier: randomBytes(32).toString('base64url') }),
    ).toMatchObject({ reason: 'invalid_grant' });
    // Burnt: the right verifier no longer helps.
    expect(await exchangePartnerCode(deps(), input)).toMatchObject({ reason: 'invalid_grant' });

    const second = await approved();
    expect(await exchangePartnerCode(deps(), { ...second.input, redirectUri: `${REDIRECT}?x=1` })).toMatchObject({
      reason: 'invalid_grant',
    });
  });

  it('refuses a code once its approver is no longer an owner, and burns it', async () => {
    const { ada, input } = await approved();
    const coOwner = newId();
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
       values ($1, $2, 'Bea', $3, 'owner', 'system', 'system')`,
      [ada.workspaceId, coOwner, `${tag()}@example.com`],
    );
    await testQuery(
      ownerUrl,
      `update members set role = 'admin' where workspace_id = $1 and id <> $2 and role = 'owner'`,
      [ada.workspaceId, coOwner],
    );
    expect(await exchangePartnerCode(deps(), input)).toMatchObject({ ok: false, reason: 'invalid_grant' });
    const left = await testQuery(ownerUrl, 'select count(*)::int as n from partner_codes where workspace_id = $1', [
      ada.workspaceId,
    ]);
    expect(left[0]).toEqual({ n: 0 });
  });

  it('refuses a code past its 60 seconds', async () => {
    const { ada, input } = await approved();
    await testQuery(
      ownerUrl,
      `update partner_codes set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
       where workspace_id = $1`,
      [ada.workspaceId],
    );
    expect(await exchangePartnerCode(deps(), input)).toMatchObject({ ok: false, reason: 'invalid_grant' });
  });

  it('lists the connection in Connected apps, changes its modules, and Disconnect stops its token at once', async () => {
    const { made, ada, input } = await approved();
    const swapped = await exchangePartnerCode(deps(), input);
    if (!swapped.ok) throw new Error(swapped.message);
    const listed = await listConnectedApps(ada.scope, { partners: identity });
    expect(listed.apps).toEqual([
      {
        id: swapped.connection.id,
        partner: { name: made.partner.name },
        modules: ['link_pages'],
        connectedAt: expect.any(String) as string,
        approvedBy: 'Ada',
        isTest: false,
      },
    ]);
    expect(
      await refusalOf(
        setConnectedAppModules(ada.scope, { partners: identity }, { connectionId: swapped.connection.id, modules: [] }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    await disconnectApp(ada.scope, { partners: identity }, { connectionId: swapped.connection.id });
    expect(await enterAsPartner({ db }, swapped.token)).toBeUndefined();
    expect((await listConnectedApps(ada.scope, { partners: identity })).apps).toEqual([]);
    expect(
      await refusalOf(disconnectApp(ada.scope, { partners: identity }, { connectionId: swapped.connection.id })),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never lets another workspace read a connection or a code', async () => {
    const { input } = await approved();
    const swapped = await exchangePartnerCode(deps(), input);
    if (!swapped.ok) throw new Error(swapped.message);
    const bea = await owner();
    expect((await listConnectedApps(bea.scope, { partners: identity })).apps).toEqual([]);
    expect(
      await refusalOf(disconnectApp(bea.scope, { partners: identity }, { connectionId: swapped.connection.id })),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });
});
