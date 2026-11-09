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
import { publishingReads } from '../test/published-reads.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
/** The app's own `request`, before `publishingReads` wraps it: a guest's read of what is really published. */
let rawRequest: (path: string, init: RequestInit) => Response | Promise<Response>;
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
  rawRequest = app.request.bind(app);
  // Spec 0068: reads of a link page see it as its owner would have published it.
  app = publishingReads(app, inject('testDatabase').adminUrl);
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A request through the edge from the app's own origin, as a browser sends it. */
function send(
  path: string,
  init: {
    method?: string;
    cookie?: string;
    workspace?: string;
    member?: string;
    type?: string;
    body?: Uint8Array;
  } = {},
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
      ...(init.member === undefined ? {} : { 'x-crm-page-member': init.member }),
      ...(init.type === undefined ? {} : { 'content-type': init.type }),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

/** A read through the edge as `send` makes it, without publishing the page first: what guests really get. */
async function read(path: string, cookie?: string): Promise<Response> {
  return rawRequest(path, {
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      'x-forwarded-for': newIp(),
      ...(cookie === undefined ? {} : { cookie }),
    },
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
    expect(await member.client.brand.get({ workspace: owner.slug })).toEqual({ canEdit: false, template: 'classic' });
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
    ).toEqual({ accent: '#1f5fd6', canEdit: true, template: 'classic' });
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
    expect(forgotten.slice(purges).flat()).toContain(tag);
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

  it('names the logo’s version on the access read every workspace page makes, for any member (sidebar, favicon)', async () => {
    const owner = await memberWithWorkspace(app);
    const member = await joined(owner.workspace.id, 'member');
    expect((await member.client.access.mine({ workspace: owner.slug })).workspaceLogo).toBeUndefined();
    const uploaded = await send('/api/brand/logo', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    const { version } = (await uploaded.json()) as { version: string };
    expect((await member.client.access.mine({ workspace: owner.slug })).workspaceLogo).toBe(version);
    // The member route serves it to them, privately; the favicon and the sidebar read exactly this address.
    const logo = await send(`/api/brand/logo?workspace=${owner.slug}&v=${version}`, { cookie: member.cookie });
    expect(logo.status).toBe(200);
    expect(logo.headers.get('x-content-type-options')).toBe('nosniff');
    await send('/api/brand/logo', { method: 'DELETE', cookie: owner.cookie, workspace: owner.slug });
    expect((await member.client.access.mine({ workspace: owner.slug })).workspaceLogo).toBeUndefined();
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

describe('a drafted cover (spec 0068, AC-6810)', () => {
  /** A page with a handle, published once with no cover, then a cover uploaded into its draft. */
  async function drafted() {
    const owner = await memberWithWorkspace(app);
    const handle = `ada-${newId().slice(-8)}`;
    await owner.client.profile.update({ workspace: owner.slug, handle, mutationId: newId() });
    await owner.client.profile.publish({ workspace: owner.slug, mutationId: newId() });
    const uploaded = await send('/api/me/link-page/cover', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(uploaded.status).toBe(200);
    const { version } = (await uploaded.json()) as { version: string };
    expect((await owner.client.profile.look({ workspace: owner.slug })).cover).toBe(version);
    return { owner, handle, version };
  }

  it('answers its owner the drafted cover, kept by their browser alone, so the editor can draw and crop it', async () => {
    const { owner, handle, version } = await drafted();
    const own = await read(`/api/public/profiles/${handle}/cover?v=${version}`, owner.cookie);
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('private, max-age=3600');
    // Their own Preview (`?draft=1`) names the draft's cover, and its stylesheet answers them at the draft's version.
    const preview = (await (await read(`/api/public/handles/${handle}?draft=1`, owner.cookie)).json()) as {
      look?: { version?: string; cover?: string };
    };
    expect(preview.look?.cover).toBe(version);
    const sheet = await read(`/api/public/handles/${handle}/look.css?v=${preview.look?.version ?? ''}`, owner.cookie);
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(await sheet.text()).toContain(`/cover?v=${version}`);
  });

  it('never answers a guest, or anyone else signed in, the draft: only what was published', async () => {
    const { owner, handle, version } = await drafted();
    const stranger = await memberWithWorkspace(app);
    for (const cookie of [undefined, stranger.cookie]) {
      expect((await read(`/api/public/profiles/${handle}/cover?v=${version}`, cookie)).status).toBe(404);
      const page = (await (await read(`/api/public/handles/${handle}?draft=1`, cookie)).json()) as {
        look?: { cover?: string };
      };
      expect(page.look?.cover).toBeUndefined();
    }
    // Published, the cover is everyone's, and the edge may keep it.
    await owner.client.profile.publish({ workspace: owner.slug, mutationId: newId() });
    const shown = await read(`/api/public/profiles/${handle}/cover?v=${version}`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
  });

  it('takes the same photo again as no change, storing nothing and saying so', async () => {
    const { owner, version } = await drafted();
    const changes = async () => (await owner.client.profile.publication({ workspace: owner.slug })).changes;
    const before = await changes();
    expect(before).toContain('Cover photo added');
    const files = kept.size;
    const again = await send('/api/me/link-page/cover', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ version, same: true });
    expect(kept.size).toBe(files);
    expect(await changes()).toEqual(before);
  });
});

describe('a page’s own profile photo (9 Nov 2026)', () => {
  it('is drafted, read by its editor alone through the door, and is the page’s picture once published', async () => {
    const owner = await memberWithWorkspace(app);
    const handle = `ada-${newId().slice(-8)}`;
    await owner.client.profile.update({ workspace: owner.slug, handle, mutationId: newId() });
    await owner.client.profile.publish({ workspace: owner.slug, mutationId: newId() });
    const uploaded = await send('/api/me/link-page/avatar', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(uploaded.status).toBe(200);
    const { version } = (await uploaded.json()) as { version: string };
    expect((await owner.client.profile.look({ workspace: owner.slug })).avatar).toBe(version);
    expect((await owner.client.profile.publication({ workspace: owner.slug })).changes).toContain(
      'Profile photo added',
    );

    // The editor's own copy: at its version only, theirs alone, never the edge's.
    const own = await read(`/api/me/link-page/avatar?workspace=${owner.slug}&v=${version}`, owner.cookie);
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('private, max-age=3600');
    expect((await read(`/api/me/link-page/avatar?workspace=${owner.slug}&v=000000000000`, owner.cookie)).status).toBe(
      404,
    );
    const stranger = await memberWithWorkspace(app);
    expect((await read(`/api/me/link-page/avatar?workspace=${owner.slug}&v=${version}`, stranger.cookie)).status).toBe(
      404,
    );
    expect((await read(`/api/me/link-page/avatar?workspace=${owner.slug}&v=${version}`)).status).toBe(401);

    // Guests see no picture until Publish, then this one, however the account picture stands.
    const pictureOf = async () =>
      ((await (await read(`/api/public/handles/${handle}`)).json()) as { image?: string }).image;
    expect(await pictureOf()).toBeUndefined();
    await owner.client.profile.publish({ workspace: owner.slug, mutationId: newId() });
    const image = await pictureOf();
    expect(image).toMatch(new RegExp(`^/api/public/profiles/${handle}/picture\\?v=[0-9a-f]{12}$`));
    const shown = await read(image ?? '');
    expect(shown.status).toBe(200);
    expect(shown.headers.get('content-type')).toBe('image/jpeg');

    // Removed and published, the page has no picture again (this account has none).
    expect(
      (await send('/api/me/link-page/avatar', { method: 'DELETE', cookie: owner.cookie, workspace: owner.slug }))
        .status,
    ).toBe(200);
    await owner.client.profile.publish({ workspace: owner.slug, mutationId: newId() });
    expect(await pictureOf()).toBeUndefined();
  });

  it('is put on a member’s page by an owner editing it (spec 0070), and read back through the same door', async () => {
    const owner = await memberWithWorkspace(app);
    const [row] = await testQuery<{ id: string }>(ownerUrl, 'select id::text as id from workspaces where slug = $1', [
      owner.slug,
    ]);
    const bea = await joined(row?.id ?? '', 'member');
    await bea.client.profile.update({ workspace: owner.slug, handle: `bea-${newId().slice(-8)}`, mutationId: newId() });
    const members = await testQuery<{ id: string; name: string }>(
      ownerUrl,
      `select m.id::text as id, m.name from members m join workspaces w on w.id = m.workspace_id where w.slug = $1`,
      [owner.slug],
    );
    const beaId = members.find((one) => one.name === 'Bea')?.id ?? '';
    const ownerId = members.find((one) => one.name !== 'Bea')?.id ?? '';
    const uploaded = await send('/api/me/link-page/avatar', {
      method: 'POST',
      cookie: owner.cookie,
      workspace: owner.slug,
      member: beaId,
      type: 'image/jpeg',
      body: JPEG,
    });
    expect(uploaded.status).toBe(200);
    const { version } = (await uploaded.json()) as { version: string };
    // On Bea's page, not the owner's.
    expect((await bea.client.profile.look({ workspace: owner.slug })).avatar).toBe(version);
    expect((await owner.client.profile.look({ workspace: owner.slug })).avatar).toBeUndefined();
    const theirs = `/api/me/link-page/avatar?workspace=${owner.slug}&member=${beaId}&v=${version}`;
    expect((await read(theirs, owner.cookie)).status).toBe(200);
    // Bea holds no team page permission: the owner's page is out of her reach, to read or to write.
    expect(
      (await read(`/api/me/link-page/avatar?workspace=${owner.slug}&member=${ownerId}&v=${version}`, bea.cookie))
        .status,
    ).toBe(403);
    expect(
      (
        await send('/api/me/link-page/avatar', {
          method: 'POST',
          cookie: bea.cookie,
          workspace: owner.slug,
          member: ownerId,
          type: 'image/jpeg',
          body: JPEG,
        })
      ).status,
    ).toBe(403);
  });
});
