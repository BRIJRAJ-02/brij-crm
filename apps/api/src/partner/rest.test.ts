// The partner API through the real app (spec 0070, slice 2): an owner's approval through the RPC, then the partner's
// server swaps the code at `/api/partner/v1/token` (HTTP Basic or the body, form encoded or JSON, no cookie and no
// Origin) and reads its connection with the token; every refusal is `{ code, message }` and never cached; a code
// works once; Disconnect in Connected apps stops the token at once; the connect refuses an address the partner
// didn't register before anything is stored; and a logo answers only at its current version.
import { randomBytes } from 'node:crypto';
import { newId, registerPartner, s256Challenge } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';

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

  it('answers a logo at its current version only, as an image that is never sniffed', async () => {
    const made = await partner();
    const logo = await app.request(made.partner.logoUrl ?? '');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect(logo.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await app.request(`/api/public/partners/${made.partner.clientId}/logo?v=7`)).status).toBe(404);
  });
});
