// The partner API through the real app (spec 0070, slice 2): an owner's approval through the RPC, then the partner's
// server swaps the code at `/api/partner/v1/token` (HTTP Basic or the body, form encoded or JSON, no cookie and no
// Origin) and reads its connection with the token; every refusal is `{ code, message }` and never cached; a code
// works once; Disconnect in Connected apps stops the token at once; the connect refuses an address the partner
// didn't register before anything is stored; and a logo answers only at its current version.
import { randomBytes } from 'node:crypto';
import { newId, registerPartner, s256Challenge } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { testQuery } from '@crm/db/testing';
import { rpcClient, signInApp, testConnections } from '../../test/sign-in.ts';
import { EDGE_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const REDIRECT = 'https://hub.example.com/timefix/callback';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function partner() {
  return registerPartner(
    { partners: identity },
    {
      name: 'Hub',
      logo: { type: 'image/png', data: PNG.toString('base64') },
      frameOrigins: ['https://hub.example.com'],
      redirectUris: [REDIRECT],
    },
    { userId: newId(), action: 'operator.partnerTest', requestId: newId() },
  );
}

/** A connect request as the hub's button sends it, with its verifier. */
function request(clientId: string) {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    request: {
      clientId,
      redirectUri: REDIRECT,
      state: 'hub-state',
      codeChallenge: s256Challenge(verifier),
      codeChallengeMethod: 'S256',
      responseType: 'code',
    },
  };
}

/** The token exchange as a hub's server sends it. */
function token(body: Record<string, string>, basic?: { id: string; secret: string }) {
  return app.request('/api/partner/v1/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(basic === undefined
        ? {}
        : { authorization: `Basic ${Buffer.from(`${basic.id}:${basic.secret}`).toString('base64')}` }),
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe('/api/partner/v1', () => {
  it('swaps an owner’s code once for a connection its token reads, and Disconnect stops the token', async () => {
    const made = await partner();
    const owner = await memberWithWorkspace(app);
    const { request: asked, verifier } = request(made.partner.clientId);
    const offer = await owner.client.partnerConnect.offer(asked);
    expect(offer.workspaces.map((each) => each.slug)).toEqual([owner.slug]);
    const approved = await owner.client.partnerConnect.approve({
      workspace: owner.slug,
      request: asked,
      modules: ['link_pages'],
      mutationId: newId(),
    });
    const back = new URL(approved.redirectTo);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('hub-state');
    const code = back.searchParams.get('code') ?? '';

    const body = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier };
    const swapped = await token(body, { id: made.partner.clientId, secret: made.secret });
    expect(swapped.status).toBe(200);
    expect(swapped.headers.get('cache-control')).toBe('no-store');
    const answer = (await swapped.json()) as { access_token: string; connection_id: string; token_type: string };
    expect(answer.token_type).toBe('Bearer');

    const read = (bearer: string, id = answer.connection_id) =>
      app.request(`/api/partner/v1/connections/${id}`, { headers: { authorization: `Bearer ${bearer}` } });
    const connection = await read(answer.access_token);
    expect(connection.status).toBe(200);
    expect(await connection.json()).toMatchObject({ id: answer.connection_id, modules: ['link_pages'] });
    expect((await read(answer.access_token, newId())).status).toBe(404);

    // The same code again: refused, and the connection it made ends.
    const again = await token({ ...body, client_id: made.partner.clientId, client_secret: made.secret }, undefined);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: 'INPUT_INVALID' });
    expect((await read(answer.access_token)).status).toBe(401);

    // Connect again, then Disconnect from Connected apps: the token stops at once.
    const second = request(made.partner.clientId);
    const secondBack = new URL(
      (
        await owner.client.partnerConnect.approve({
          workspace: owner.slug,
          request: second.request,
          modules: ['link_pages'],
          mutationId: newId(),
        })
      ).redirectTo,
    );
    const secondSwap = (await (
      await token(
        {
          grant_type: 'authorization_code',
          code: secondBack.searchParams.get('code') ?? '',
          redirect_uri: REDIRECT,
          code_verifier: second.verifier,
        },
        { id: made.partner.clientId, secret: made.secret },
      )
    ).json()) as { access_token: string; connection_id: string };
    expect((await read(secondSwap.access_token, secondSwap.connection_id)).status).toBe(200);
    const listed = await owner.client.connectedApps.list({ workspace: owner.slug });
    expect(listed.apps.map((each) => each.partner.name)).toEqual(['Hub']);
    await owner.client.connectedApps.disconnect({
      workspace: owner.slug,
      connectionId: secondSwap.connection_id,
      mutationId: newId(),
    });
    const refused = await read(secondSwap.access_token, secondSwap.connection_id);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe('Bearer');
    expect(await refused.json()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Send the connection’s access token as Authorization: Bearer <token>.',
    });
  });

  it('refuses a wrong secret, an unknown client and a malformed body in the same shapes', async () => {
    const made = await partner();
    const body = {
      grant_type: 'authorization_code',
      code: 'tfc_nothing',
      redirect_uri: REDIRECT,
      code_verifier: randomBytes(32).toString('base64url'),
    };
    for (const basic of [
      { id: made.partner.clientId, secret: 'tfs_wrong' },
      { id: 'tfp_AAAAAAAAAAAAAAAAAAAAAA', secret: made.secret },
    ]) {
      const refused = await token(body, basic);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'The client id or client secret is wrong.',
      });
    }
    const plain = await token({ ...body, code_verifier: 'short' }, { id: made.partner.clientId, secret: made.secret });
    expect(plain.status).toBe(400);
    expect(((await plain.json()) as { code: string }).code).toBe('INPUT_INVALID');
  });

  it('never sends the browser to an address the partner didn’t register, and stores nothing for it', async () => {
    const made = await partner();
    const owner = await memberWithWorkspace(app);
    const asked = { ...request(made.partner.clientId).request, redirectUri: 'https://evil.example.com/cb' };
    await expect(owner.client.partnerConnect.offer(asked)).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    await expect(owner.client.partnerConnect.deny(asked)).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    await expect(
      owner.client.partnerConnect.approve({
        workspace: owner.slug,
        request: asked,
        modules: ['link_pages'],
        mutationId: newId(),
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('adds, lists, changes and removes a managed member (slice 3), each answer `{ code, message }` on refusal', async () => {
    const made = await partner();
    const owner = await memberWithWorkspace(app);
    const { request: asked, verifier } = request(made.partner.clientId);
    const approved = await owner.client.partnerConnect.approve({
      workspace: owner.slug,
      request: asked,
      modules: ['link_pages'],
      mutationId: newId(),
    });
    const swapped = (await (
      await token(
        {
          grant_type: 'authorization_code',
          code: new URL(approved.redirectTo).searchParams.get('code') ?? '',
          redirect_uri: REDIRECT,
          code_verifier: verifier,
        },
        { id: made.partner.clientId, secret: made.secret },
      )
    ).json()) as { access_token: string; connection_id: string };
    const base = `/api/partner/v1/connections/${swapped.connection_id}/members`;
    const auth = { authorization: `Bearer ${swapped.access_token}` };
    const put = (externalId: string, body: unknown) =>
      app.request(`${base}/${externalId}`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const person = { email: 'lin@example.com', name: 'Lin', role: 'admin' };

    const added = await put('hub-42', person);
    expect(added.status).toBe(201);
    const member = (await added.json()) as { memberId: string; role: string; externalId: string };
    expect(member).toMatchObject({ externalId: 'hub-42', role: 'admin' });
    expect((await put('hub-42', { ...person, role: 'member' })).status).toBe(200);
    const listed = await app.request(base, { headers: auth });
    expect(await listed.json()).toMatchObject({ members: [{ externalId: 'hub-42', role: 'member' }] });
    // The workspace sees them as a member.
    const people = await owner.client.members.list({ workspace: owner.slug });
    expect(people.members.map((each) => each.id)).toContain(member.memberId);

    const badId = await put('not ok!', person);
    expect(badId.status).toBe(400);
    expect(((await badId.json()) as { code: string }).code).toBe('INPUT_INVALID');
    const owner_ = await put('hub-43', { ...person, role: 'owner' });
    expect(owner_.status).toBe(400);
    expect(((await owner_.json()) as { code: string }).code).toBe('INPUT_INVALID');
    expect((await app.request(`${base}/hub-42`, { method: 'PUT', body: 'x' })).status).toBe(401);

    const removed = await app.request(`${base}/hub-42`, { method: 'DELETE', headers: auth });
    expect(removed.status).toBe(204);
    expect((await app.request(`${base}/hub-42`, { method: 'DELETE', headers: auth })).status).toBe(204);
    const gone = await app.request(`${base}/nobody`, { method: 'DELETE', headers: auth });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({
      code: 'NOT_FOUND',
      message: 'This connection has no person with that external id.',
    });
    const after = await owner.client.members.list({ workspace: owner.slug });
    expect(after.members.map((each) => each.id)).not.toContain(member.memberId);
  });

  it('launches a screen once, opens an embedded session that reaches only the shared module, and ends it on Disconnect (slice 4)', async () => {
    const made = await partner();
    const owner = await memberWithWorkspace(app);
    const { request: asked, verifier } = request(made.partner.clientId);
    const approved = await owner.client.partnerConnect.approve({
      workspace: owner.slug,
      request: asked,
      modules: ['link_pages'],
      mutationId: newId(),
    });
    const swapped = (await (
      await token(
        {
          grant_type: 'authorization_code',
          code: new URL(approved.redirectTo).searchParams.get('code') ?? '',
          redirect_uri: REDIRECT,
          code_verifier: verifier,
        },
        { id: made.partner.clientId, secret: made.secret },
      )
    ).json()) as { access_token: string; connection_id: string };
    const bearer = { authorization: `Bearer ${swapped.access_token}`, 'content-type': 'application/json' };
    const base = `/api/partner/v1/connections/${swapped.connection_id}`;
    for (const [externalId, role] of [
      ['hub-admin', 'admin'],
      ['hub-member', 'member'],
    ] as const) {
      const put = await app.request(`${base}/members/${externalId}`, {
        method: 'PUT',
        headers: bearer,
        body: JSON.stringify({ email: `${externalId}-${newId().slice(0, 8)}@example.com`, name: externalId, role }),
      });
      expect(put.status).toBe(201);
    }
    const launch = (body: unknown) =>
      app.request(`${base}/launch`, { method: 'POST', headers: bearer, body: JSON.stringify(body) });

    // Refusals, each `{ code, message }`: Team pages for a plain member, someone never added, a screen not offered.
    const notTeam = await launch({ externalId: 'hub-member', screen: 'link_pages.team' });
    expect(notTeam.status).toBe(403);
    expect(((await notTeam.json()) as { code: string }).code).toBe('FORBIDDEN');
    const nobody = await launch({ externalId: 'nobody', screen: 'link_pages.mine' });
    expect(nobody.status).toBe(404);
    const badScreen = await launch({ externalId: 'hub-admin', screen: 'people' });
    expect(badScreen.status).toBe(400);
    expect((await app.request(`${base}/launch`, { method: 'POST' })).status).toBe(401);

    const launched = await launch({ externalId: 'hub-admin', screen: 'link_pages.team', theme: 'dark' });
    expect(launched.status).toBe(200);
    expect(launched.headers.get('cache-control')).toBe('no-store');
    const { url } = (await launched.json()) as { url: string; expiresAt: string };
    const address = new URL(url);
    expect(address.pathname).toBe(`/embed/${made.partner.clientId}/start`);
    const code = new URLSearchParams(address.hash.slice(1)).get('code') ?? '';
    expect(code).toMatch(/^tfl_/);

    // The frame's own calls: its header, and its own cookie once `start` set it.
    let cookie = '';
    const frame = rpcClient(app, undefined, () => ({ 'x-crm-embed': '1', ...(cookie === '' ? {} : { cookie }) }), {
      onResponse: (response) => {
        const set = response.headers.getSetCookie().find((line) => line.startsWith('tf_embed='));
        if (set !== undefined) {
          expect(set).toMatch(/; HttpOnly; Secure; SameSite=None; Partitioned$/);
          expect(set).toMatch(/; Path=\/; Max-Age=4(3200|3199);/);
          cookie = set.split(';')[0] ?? '';
        }
      },
    });
    const started = await frame.embed.start({ code });
    expect(started).toMatchObject({
      workspace: owner.slug,
      partner: { clientId: made.partner.clientId, name: 'Hub' },
      frameOrigins: ['https://hub.example.com'],
      screen: 'link_pages.team',
      theme: 'dark',
      person: { name: 'hub-admin' },
      canManageTeam: true,
    });
    expect(cookie).not.toBe('');
    // Once only.
    await expect(rpcClient(app).embed.start({ code })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await frame.embed.session()).toMatchObject({ workspace: owner.slug, canManageTeam: true });
    await expect(frame.profile.get({ workspace: owner.slug })).resolves.toBeDefined();
    await expect(frame.teamPages.list({ workspace: owner.slug })).resolves.toBeDefined();
    // Nothing outside the shared module, whatever the person's role would allow in the app.
    await expect(frame.me.get()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(frame.members.list({ workspace: owner.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(frame.objects.list({ workspace: owner.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(frame.profile.pageChoices({ workspace: owner.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The embedded cookie is no app session, and the app's door reads no embedded one: without the header, nobody.
    await expect(rpcClient(app, cookie).me.get()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // The embedded token under the app's own cookie name opens nothing either.
    const asApp = cookie.replace(/^tf_embed=/, 'better-auth.session_token=');
    await expect(rpcClient(app, asApp).me.get()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // Nor at any sign in route (renaming the identity here), and no read of it ever extends the embedded session.
    const expiry = () =>
      testQuery<{ expires_at: string }>(
        ownerUrl,
        'select expires_at::text from auth.session where embed_connection_id = $1',
        [swapped.connection_id],
      );
    const [before] = await expiry();
    const read = await app.request('/api/auth/get-session', {
      headers: { cookie: asApp, origin: APP_URL, [EDGE_HEADER]: TEST_EDGE_SECRET },
    });
    expect(read.status).toBe(401);
    await testQuery(
      ownerUrl,
      "update auth.session set expires_at = now() + interval '30 days' where embed_connection_id = $1",
      [swapped.connection_id],
    );
    expect(await expiry()).toEqual([before]);
    // And the owner's app session sent as the frame's opens nothing in the frame.
    await expect(rpcClient(app, owner.cookie, () => ({ 'x-crm-embed': '1' })).embed.session()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    // Disconnect in Connected apps ends the embedded session at once.
    await owner.client.connectedApps.disconnect({
      workspace: owner.slug,
      connectionId: swapped.connection_id,
      mutationId: newId(),
    });
    await expect(frame.embed.session()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('keeps the social links of its own people from the frame, never another app’s, nor from Timefix itself (10 Nov 2026)', async () => {
    const owner = await memberWithWorkspace(app);
    /** A partner connected to the owner's workspace, with one person of its own; its admin launched into the frame. */
    const connect = async (admin: boolean) => {
      const made = await partner();
      const { request: asked, verifier } = request(made.partner.clientId);
      const approved = await owner.client.partnerConnect.approve({
        workspace: owner.slug,
        request: asked,
        modules: ['link_pages'],
        mutationId: newId(),
      });
      const swapped = (await (
        await token(
          {
            grant_type: 'authorization_code',
            code: new URL(approved.redirectTo).searchParams.get('code') ?? '',
            redirect_uri: REDIRECT,
            code_verifier: verifier,
          },
          { id: made.partner.clientId, secret: made.secret },
        )
      ).json()) as { access_token: string; connection_id: string };
      const bearer = { authorization: `Bearer ${swapped.access_token}`, 'content-type': 'application/json' };
      const base = `/api/partner/v1/connections/${swapped.connection_id}`;
      const people = admin ? (['hub-admin', 'hub-member'] as const) : (['hub-member'] as const);
      const ids: Record<string, string> = {};
      for (const externalId of people) {
        const put = await app.request(`${base}/members/${externalId}`, {
          method: 'PUT',
          headers: bearer,
          body: JSON.stringify({
            email: `${externalId}-${newId().slice(-12)}@example.com`,
            name: externalId,
            role: externalId === 'hub-admin' ? 'admin' : 'member',
          }),
        });
        const body = (await put.json()) as { memberId: string };
        if (put.status !== 201) throw new Error(JSON.stringify(body));
        ids[externalId] = body.memberId;
      }
      if (!admin) return { ids };
      const launched = await app.request(`${base}/launch`, {
        method: 'POST',
        headers: bearer,
        body: JSON.stringify({ externalId: 'hub-admin', screen: 'link_pages.team' }),
      });
      const { url } = (await launched.json()) as { url: string };
      const code = new URLSearchParams(new URL(url).hash.slice(1)).get('code') ?? '';
      let cookie = '';
      const frame = rpcClient(app, undefined, () => ({ 'x-crm-embed': '1', ...(cookie === '' ? {} : { cookie }) }), {
        onResponse: (response) => {
          const set = response.headers.getSetCookie().find((line) => line.startsWith('tf_embed='));
          if (set !== undefined) cookie = set.split(';')[0] ?? '';
        },
      });
      await frame.embed.start({ code });
      return { ids, frame };
    };
    const hub = await connect(true);
    const other = await connect(false);
    const frame = hub.frame;
    if (frame === undefined) throw new Error('No frame.');
    const ours = hub.ids['hub-member'] ?? '';
    const theirs = other.ids['hub-member'] ?? '';
    const links = [{ network: 'linkedin' as const, href: 'https://www.linkedin.com/in/hubmember' }];
    // Its own person: editable from the frame, and saved.
    expect(await frame.profile.get({ workspace: owner.slug, member: ours })).toMatchObject({ socialsByManager: true });
    const saved = await frame.teamPages.setSocials({
      workspace: owner.slug,
      member: ours,
      socials: links,
      mutationId: newId(),
    });
    expect(saved.socials).toHaveLength(1);
    // Another app's person on the same workspace: read only from this frame, and refused as absent.
    const theirsFromFrame = await frame.profile.get({ workspace: owner.slug, member: theirs });
    expect(theirsFromFrame).not.toHaveProperty('socialsByManager');
    expect(theirsFromFrame).not.toHaveProperty('managedByApp');
    await expect(
      frame.teamPages.setSocials({ workspace: owner.slug, member: theirs, socials: links, mutationId: newId() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // In Timefix itself, an app's people are that app's (10 Nov 2026): read only, the app named, and refused.
    const theirsInTimefix = await owner.client.profile.get({ workspace: owner.slug, member: theirs });
    expect(theirsInTimefix).toMatchObject({ managedByApp: { name: 'Hub' } });
    expect(theirsInTimefix).not.toHaveProperty('socialsByManager');
    expect(await owner.client.profile.get({ workspace: owner.slug, member: ours })).not.toHaveProperty(
      'socialsByManager',
    );
    await expect(
      owner.client.teamPages.setSocials({ workspace: owner.slug, member: theirs, socials: links, mutationId: newId() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Hub manages this person’s social links.' });
  });

  it('answers a partner’s frame origins for the edge, and none for an unknown client id', async () => {
    const made = await partner();
    const known = await app.request(`/api/public/partners/${made.partner.clientId}/frame`);
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({ frameOrigins: ['https://hub.example.com'] });
    const unknown = await app.request('/api/public/partners/tfp_AAAAAAAAAAAAAAAAAAAAAA/frame');
    expect(await unknown.json()).toEqual({ frameOrigins: [] });
  });

  it('answers a logo at its current version only, as an image that is never sniffed', async () => {
    const made = await partner();
    const logo = await app.request(made.partner.logoUrl ?? '');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect(logo.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await app.request(`/api/public/partners/${made.partner.clientId}/logo?v=7`)).status).toBe(404);
  });
});
