// The brand kit and a link page's look through the real app (spec 0060, AC-2, AC-4, AC-14, AC-22, AC-23): who may
// change the kit, the logo's upload and its public route, the booking page's stylesheet, a refused colour, and a
// Private link page whose look and photos answer only its owner. Real sessions, real Postgres, an in memory store.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { jpegWith } from '../test/pictures.ts';
import { newIp, rpcClient, signIn, signInApp, testConnections } from '../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../test/workspace.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from './edge.ts';
import type { FileStore } from './storage/blob.ts';
import { APP_URL, TEST_EDGE_SECRET } from './testing.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
const kept = new Map<string, { body: Uint8Array; contentType: string }>();
const store: FileStore = {
  put: (pathname, body, contentType) => {
    kept.set(pathname, { body, contentType });
    return Promise.resolve();
  },
  get: (pathname) => {
    const found = kept.get(pathname);
    if (found === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      stream: new Blob([found.body]).stream(),
      size: found.body.byteLength,
      contentType: found.contentType,
    });
  },
  copy: () => Promise.reject(new Error('Not used here.')),
  remove: (pathnames) => {
    for (const pathname of pathnames) kept.delete(pathname);
    return Promise.resolve();
  },
};

/** What the app filed under the edge cache's tags, and what it asked the edge to delete (AC-21). */
const tagged: string[][] = [];
const forgotten: string[][] = [];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
    { db, identity },
    {},
    {
      files: store,
      edgeCache: {
        tag: (tags) => void tagged.push([...tags]),
        forget: (tags) => {
          forgotten.push([...tags]);
          return Promise.resolve();
        },
      },
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A request through the edge from the app's own origin, as a browser sends it. */
function send(
  path: string,
  init: { method?: string; cookie?: string; workspace?: string; type?: string; body?: Uint8Array } = {},
) {
  return app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      'x-forwarded-for': newIp(),
      [ORIGIN_HEADER]: APP_URL,
      origin: APP_URL,
      ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
      ...(init.workspace === undefined ? {} : { 'x-crm-workspace': init.workspace }),
      ...(init.type === undefined ? {} : { 'content-type': init.type }),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

/** Someone else, signed in, added to `workspaceId` with `role`, their cookie and client. */
async function joined(workspaceId: string, role: 'admin' | 'member') {
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, $3, 'Bea', $4, $5, 'system', 'system')`,
    [workspaceId, newId(), user?.id, email, role],
  );
  return { cookie, client: rpcClient(app, cookie) };
}

const JPEG = jpegWith({ exif: true });

describe('the brand kit', () => {
  it('is changed by owners and admins only: a member gets FORBIDDEN and 403 before any byte is kept (AC-23)', async () => {
    const owner = await memberWithWorkspace(app);
    const member = await joined(owner.workspace.id, 'member');
    expect(await member.client.brand.get({ workspace: owner.slug })).toEqual({ canEdit: false });
    expect(
      await refusal(() =>
        member.client.brand.save({ workspace: owner.slug, accent: '#1f5fd6', accentDark: null, mutationId: newId() }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const before = kept.size;
    const upload = await send('/api/brand/logo', {
      method: 'POST',
      cookie: member.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(upload.status).toBe(403);
    expect(kept.size).toBe(before);
    expect(
      (await send('/api/brand/logo', { method: 'DELETE', cookie: member.cookie, workspace: owner.slug })).status,
    ).toBe(403);
    // An admin may.
    const admin = await joined(owner.workspace.id, 'admin');
    expect(
      await admin.client.brand.save({
        workspace: owner.slug,
        accent: '#1f5fd6',
        accentDark: null,
        mutationId: newId(),
      }),
    ).toEqual({ accent: '#1f5fd6', canEdit: true });
  });

  it('refuses a colour that is not a six digit hex (AC-22)', async () => {
    const owner = await memberWithWorkspace(app);
    for (const bad of ['#12345g', 'red', '#123456;}', '#1234567']) {
      expect(
        await refusal(() =>
          owner.client.brand.save({ workspace: owner.slug, accent: bad, accentDark: null, mutationId: newId() }),
        ),
      ).toMatchObject({ code: 'INPUT_INVALID' });
    }
  });

  it('dresses a booking page in its accent and logo, each at its current version only (AC-2, AC-4)', async () => {
    const owner = await memberWithWorkspace(app);
    const page = await owner.client.bookingPages.create({
      workspace: owner.slug,
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      mutationId: newId(),
    });
    const facts = async () =>
      (
        (await (await send(`/api/public/booking/${page.publicKey}`)).json()) as {
          brand?: { version?: string; logo?: string };
        }
      ).brand;
    expect(await facts()).toBeUndefined();
    await owner.client.brand.save({ workspace: owner.slug, accent: '#e11d48', accentDark: null, mutationId: newId() });
    const version = (await facts())?.version ?? '';
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    const css = await send(`/api/public/booking/${page.publicKey}/brand.css?v=${version}`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(css.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await css.text()).toMatch(/^:root\{--brand-accent:#[0-9a-f]{6};/);
    const stale = await send(`/api/public/booking/${page.publicKey}/brand.css?v=000000000000`);
    expect(stale.status).toBe(404);
    expect(stale.headers.get('cache-control')).toBe('no-store');

    const uploaded = await send('/api/brand/logo', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(uploaded.status).toBe(200);
    const { version: logo } = (await uploaded.json()) as { version: string };
    expect([...kept.keys()].some((path) => path.startsWith(`logos/${owner.workspace.id}/`))).toBe(true);
    expect((await facts())?.logo).toBe(logo);
    const image = await send(`/api/public/booking/${page.publicKey}/logo?v=${logo}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    // The location the camera wrote is gone from what is kept and served.
    expect(new TextDecoder().decode(new Uint8Array(await image.arrayBuffer()))).not.toContain('GPS');
    // An SVG is refused, whatever it is named.
    const svg = await send('/api/brand/logo', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/svg+xml',
      body: new TextEncoder().encode('<svg/>'),
    });
    expect(svg.status).toBe(400);
    const removed = await send('/api/brand/logo', { method: 'DELETE', cookie: owner.cookie, workspace: owner.slug });
    expect(await removed.json()).toEqual({ removed: true });
    expect((await send(`/api/public/booking/${page.publicKey}/logo?v=${logo}`)).status).toBe(404);
  });

  it('dresses a hosted form, named by its address, in the same accent and logo (AC-4)', async () => {
    const owner = await memberWithWorkspace(app);
    const form = await owner.client.forms.create({
      workspace: owner.slug,
      id: newId(),
      name: 'Project enquiry',
      mainObjectId: owner.people.id,
      mutationId: newId(),
    });
    const live = await owner.client.forms.publish({
      workspace: owner.slug,
      formId: form.id,
      expectedRevision: form.revision,
      mutationId: newId(),
    });
    // A form's key is its address, a slug, not a booking page's 16 characters.
    expect(live.publicKey).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    await owner.client.brand.save({ workspace: owner.slug, accent: '#e11d48', accentDark: null, mutationId: newId() });
    const uploaded = await send('/api/brand/logo', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    const { version: logo } = (await uploaded.json()) as { version: string };
    const read = (await (await send(`/api/public/forms/${live.publicKey}`)).json()) as {
      brand?: { version?: string; logo?: string };
    };
    expect(read.brand?.logo).toBe(logo);
    const css = await send(`/api/public/forms/${live.publicKey}/brand.css?v=${read.brand?.version ?? ''}`);
    expect(css.status).toBe(200);
    expect(await css.text()).toMatch(/^:root\{--brand-accent:#[0-9a-f]{6};/);
    const image = await send(`/api/public/forms/${live.publicKey}/logo?v=${logo}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    // A key no form could have never reaches the door.
    expect((await send(`/api/public/forms/Not_A_Slug/brand.css?v=${read.brand?.version ?? ''}`)).status).toBe(404);
  });

  it('keeps brand.css and the logo an hour under the workspace’s tag, and a save purges it (AC-21)', async () => {
    const owner = await memberWithWorkspace(app);
    const page = await owner.client.bookingPages.create({
      workspace: owner.slug,
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      mutationId: newId(),
    });
    const tag = `brand:${owner.workspace.id}`;
    const purges = forgotten.length;
    await owner.client.brand.save({ workspace: owner.slug, accent: '#e11d48', accentDark: null, mutationId: newId() });
    expect(forgotten.slice(purges)).toContainEqual([tag]);
    const facts = (await (await send(`/api/public/booking/${page.publicKey}`)).json()) as {
      brand?: { version?: string };
    };
    const css = await send(`/api/public/booking/${page.publicKey}/brand.css?v=${facts.brand?.version ?? ''}`);
    expect(css.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
    expect(tagged.at(-1)).toEqual([tag]);
    // A new logo, and its removal, purge it too.
    const before = forgotten.length;
    await send('/api/brand/logo', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    await send('/api/brand/logo', { method: 'DELETE', cookie: owner.cookie, workspace: owner.slug });
    expect(forgotten.slice(before)).toEqual([[tag], [tag]]);
  });

  it('purges the workspace’s brand answers when a member saves their own accent, which a personal page wears (AC-14, AC-21)', async () => {
    const owner = await memberWithWorkspace(app);
    const tag = `brand:${owner.workspace.id}`;
    const before = forgotten.length;
    expect(
      await owner.client.profile.saveAccent({
        workspace: owner.slug,
        accent: '#7c3aed',
        accentDark: null,
        mutationId: newId(),
      }),
    ).toEqual({ accent: '#7c3aed', accentDark: null });
    expect(forgotten.slice(before)).toEqual([[tag]]);
  });
});

describe('a link page’s look', () => {
  it('answers a Private page’s look and photos to its owner alone, never cached at the edge (AC-14, AC-23)', async () => {
    const owner = await memberWithWorkspace(app);
    const handle = `ada-${newId().slice(-8)}`;
    await owner.client.profile.update({ workspace: owner.slug, handle, mutationId: newId() });
    await owner.client.profile.saveAccent({
      workspace: owner.slug,
      accent: '#16a34a',
      accentDark: null,
      mutationId: newId(),
    });
    const cover = await send('/api/me/link-page/cover', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(cover.status).toBe(200);
    const read = async (cookie?: string) =>
      (
        (await (await send(`/api/public/handles/${handle}`, cookie === undefined ? {} : { cookie })).json()) as {
          look?: { version?: string; cover?: string };
        }
      ).look;
    const look = await read();
    expect(look?.version).toMatch(/^[0-9a-f]{12}$/);
    const sheet = await send(`/api/public/handles/${handle}/look.css?v=${look?.version ?? ''}`);
    expect(sheet.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
    expect(await sheet.text()).toContain(`url("/api/public/profiles/${handle}/cover?v=${look?.cover ?? ''}")`);

    await owner.client.profile.show({ workspace: owner.slug, live: false, mutationId: newId() });
    const hidden = await send(`/api/public/handles/${handle}/look.css?v=${look?.version ?? ''}`);
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get('cache-control')).toBe('no-store');
    expect((await send(`/api/public/profiles/${handle}/cover?v=${look?.cover ?? ''}`)).status).toBe(404);
    const own = await send(`/api/public/handles/${handle}/look.css?v=${look?.version ?? ''}`, { cookie: owner.cookie });
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('private, max-age=3600');

    // Somebody else, signed in, can neither read it nor put a photo on it: their upload lands on their own page.
    const stranger = await memberWithWorkspace(app);
    expect(
      (await send(`/api/public/handles/${handle}/look.css?v=${look?.version ?? ''}`, { cookie: stranger.cookie }))
        .status,
    ).toBe(404);
    const theirs = await send('/api/me/link-page/cover', {
      method: 'POST',
      cookie: stranger.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(theirs.status).toBe(404);
  });
});
