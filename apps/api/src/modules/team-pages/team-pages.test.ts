// Team link pages through the real app (spec 0070, slice 1) and the real Postgres: every way to reach someone else's
// link page refuses a member without `link_pages.manage_team` (the RPC with `member`, and the picture, audio, CSV and
// photo routes with `x-crm-page-member` or `?member=`), another workspace's member is no one here, and an owner's
// change lands on the member's own page with History's row and their "Edited by".
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import forge from 'node-forge';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../../edge.ts';
import { createMailpitMailer } from '../../mail/mailpit.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../../testing.ts';
import { MAILPIT_URL, newIp, rpcClient, signIn, testConnections } from '../../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  app = createApp({
    services: testServices(env, {
      db,
      identity,
      mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }),
    }),
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** Someone signed in and put straight into `workspaceId` as a `role`, with their client and member id. */
async function joined(workspaceId: string, slug: string, name: string, role: 'admin' | 'member') {
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, `select id::text as id from auth."user" where email = $1`, [
    email,
  ]);
  if (user === undefined) throw new Error('No account was made.');
  const memberId = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, name, email, role, user_id, created_by_type, updated_by_type)
     values ($1, $2, $3, $4, $5, $6, 'system', 'system')`,
    [workspaceId, memberId, name, email, role, user.id],
  );
  const client = rpcClient(app, cookie);
  await client.profile.update({ workspace: slug, handle: `team-${newId().slice(-10)}`, mutationId: newId() });
  return { client, cookie, memberId };
}

/** A request through the edge, from a browser on our own page, signed in as `cookie`. */
function edge(path: string, cookie: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      [ORIGIN_HEADER]: APP_URL,
      origin: APP_URL,
      cookie,
      'x-forwarded-for': newIp(),
      'sec-fetch-site': 'same-origin',
      ...init.headers,
    },
    ...(init.method === 'POST' ? { body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } : {}),
  });
}

describe('someone else’s link page through the api (AC-7001 to AC-7004)', () => {
  it('refuses a member without the permission on every transport, and lets an owner edit it', async () => {
    const ada = await memberWithWorkspace(app);
    const [row] = await testQuery<{ id: string }>(ownerUrl, `select id::text as id from workspaces where slug = $1`, [
      ada.slug,
    ]);
    if (row === undefined) throw new Error('No workspace.');
    const bea = await joined(row.id, ada.slug, 'Bea', 'member');
    const cy = await joined(row.id, ada.slug, 'Cy', 'member');

    // Bea holds no `link_pages.manage_team`: Cy's page is out of reach however she asks.
    const forbidden = { code: 'FORBIDDEN', status: 403 };
    expect(await refusal(() => bea.client.profile.items({ workspace: ada.slug, member: cy.memberId }))).toMatchObject(
      forbidden,
    );
    expect(
      await refusal(() =>
        bea.client.profile.saveItem({
          workspace: ada.slug,
          member: cy.memberId,
          id: newId(),
          block: { kind: 'link', title: 'Mine now', url: 'https://example.com' },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject(forbidden);
    expect(await refusal(() => bea.client.teamPages.list({ workspace: ada.slug }))).toMatchObject(forbidden);
    for (const [path, init] of [
      [
        '/api/profile/images',
        {
          method: 'POST',
          headers: { 'x-crm-workspace': ada.slug, 'x-crm-page-member': cy.memberId, 'content-type': 'image/png' },
        },
      ],
      [
        '/api/profile/audio',
        {
          method: 'POST',
          headers: { 'x-crm-workspace': ada.slug, 'x-crm-page-member': cy.memberId, 'content-type': 'audio/mpeg' },
        },
      ],
      [
        '/api/me/link-page/cover',
        {
          method: 'POST',
          headers: { 'x-crm-workspace': ada.slug, 'x-crm-page-member': cy.memberId, 'content-type': 'image/png' },
        },
      ],
      [`/api/profile/insights.csv?workspace=${ada.slug}&member=${cy.memberId}&from=2026-11-01&to=2026-11-02`, {}],
      [`/api/profile/images/${newId()}?workspace=${ada.slug}&member=${cy.memberId}`, {}],
      [`/api/me/link-page/avatar?workspace=${ada.slug}&member=${cy.memberId}&v=0123456789ab`, {}],
    ] as const) {
      const answer = await edge(path, bea.cookie, init);
      expect([path, answer.status]).toEqual([path, 403]);
    }

    // Another workspace's member is no one here, for the owner too.
    const elsewhere = await memberWithWorkspace(app);
    const [stranger] = await testQuery<{ id: string }>(
      ownerUrl,
      `select m.id::text as id from members m join workspaces w on w.id = m.workspace_id where w.slug = $1`,
      [elsewhere.slug],
    );
    expect(
      await refusal(() => ada.client.profile.items({ workspace: ada.slug, member: stranger?.id ?? newId() })),
    ).toMatchObject({ code: 'NOT_FOUND' });

    // Ada (the owner) edits Cy's page: it lands on Cy's own page, History names her, and Cy reads "Edited by".
    const id = newId();
    await ada.client.profile.saveItem({
      workspace: ada.slug,
      member: cy.memberId,
      id,
      block: { kind: 'link', title: 'Site', url: 'https://cy.example' },
      mutationId: newId(),
    });
    expect((await cy.client.profile.items({ workspace: ada.slug })).items.map((item) => item.id)).toEqual([id]);
    expect((await ada.client.profile.items({ workspace: ada.slug })).items.map((item) => item.id)).not.toContain(id);
    const listed = await ada.client.teamPages.list({ workspace: ada.slug });
    expect(listed.pages.map((page) => page.name).sort()).toEqual(['Ada', 'Bea', 'Cy']);
    expect((await cy.client.teamPages.editedBy({ workspace: ada.slug })).last?.name).toBe('Ada');
  });
});

/** A certificate and key of this test's own: nothing here ever touches a real Pass Type ID certificate. */
function selfSigned(commonName: string): { readonly certificatePem: string; readonly privateKeyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const name = [{ name: 'commonName', value: commonName }];
  certificate.setSubject(name);
  certificate.setIssuer(name);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

describe('Team pages’ Apple Wallet passes (13 Nov 2026)', () => {
  it('says nothing of passes, and makes none, where Apple has no certificate', async () => {
    const ada = await memberWithWorkspace(app);
    const listed = await ada.client.teamPages.list({ workspace: ada.slug });
    expect(listed.hasWallet).toBeUndefined();
    const [self] = listed.pages.filter((page) => page.isSelf);
    if (self === undefined) throw new Error('No own row.');
    expect(
      await refusal(() => ada.client.teamPages.walletPass({ workspace: ada.slug, member: self.memberId })),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('hands a manager the pass of a Live page, never a Private one’s, and nobody without the permission', async () => {
    const signer = selfSigned('Pass Type ID: pass.com.timefix.linkpage');
    const env = {
      ...testEnv(),
      WALLET_PASSES: 'on' as const,
      APPLE_WALLET_PASS_TYPE_ID: 'pass.com.timefix.linkpage',
      APPLE_WALLET_TEAM_ID: 'ABCDE12345',
      APPLE_WALLET_CERTIFICATE: signer.certificatePem,
      APPLE_WALLET_KEY: signer.privateKeyPem,
      APPLE_WALLET_WWDR: selfSigned('Apple WWDR CA').certificatePem,
    };
    // The same databases and sign in secrets, so the first app's sessions are this one's too.
    const walletApp = createApp({
      services: testServices(env, {
        db,
        identity,
        mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }),
      }),
      env,
    });
    const ada = await memberWithWorkspace(app);
    const [row] = await testQuery<{ id: string }>(ownerUrl, `select id::text as id from workspaces where slug = $1`, [
      ada.slug,
    ]);
    if (row === undefined) throw new Error('No workspace.');
    const bea = await joined(row.id, ada.slug, 'Bea', 'member');
    const manager = rpcClient(walletApp, ada.cookie);

    const listed = await manager.teamPages.list({ workspace: ada.slug });
    expect(listed.hasWallet).toBe(true);

    // Bea claimed her own handle, so her page is Live: her pass is a real zip, named for her handle.
    const beaRow = listed.pages.find((page) => page.memberId === bea.memberId);
    expect(beaRow?.isLive).toBe(true);
    const pass = await manager.teamPages.walletPass({ workspace: ada.slug, member: bea.memberId });
    expect(pass.name).toBe(`${beaRow?.handle ?? ''}.pkpass`);
    const bytes = Buffer.from(pass.data, 'base64');
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(bytes.includes(Buffer.from('pass.json'))).toBe(true);

    // Made Private, her page offers no pass to anyone, a manager included.
    await manager.profile.show({ workspace: ada.slug, member: bea.memberId, live: false, mutationId: newId() });
    expect(
      await refusal(() => manager.teamPages.walletPass({ workspace: ada.slug, member: bea.memberId })),
    ).toMatchObject({ code: 'NOT_FOUND' });

    // Bea holds no `link_pages.manage_team`: somebody else's pass never comes from Team pages for her.
    const adaRow = listed.pages.find((page) => page.isSelf);
    if (adaRow === undefined) throw new Error('No own row.');
    const member = rpcClient(walletApp, bea.cookie);
    expect(
      await refusal(() => member.teamPages.walletPass({ workspace: ada.slug, member: adaRow.memberId })),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});
