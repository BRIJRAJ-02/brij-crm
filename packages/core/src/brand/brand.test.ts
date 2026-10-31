// The brand kit and a link page's own accent and photos (spec 0060), against the real Postgres as the app role: who
// may change what (AC-23), what a booking page, a form and a link page wear (AC-4, AC-14), that another
// workspace's kit never reaches a page, and that nothing but a checked hex or a server made path reaches the rows
// or the stylesheets (AC-22).
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { PERMISSIONS } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, findHandleOwner } from '../access/door.ts';
import { createBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { rescope, testScope } from '../testing.ts';
import {
  brandLogoFolder,
  clearBrandLogo,
  getWorkspaceBrand,
  readBrandLogo,
  saveBrandLogo,
  saveWorkspaceBrand,
} from './brand.ts';
import { pageImageFolder, readProfileLook, saveProfileAccent, saveProfileImage } from './look.ts';
import { brandStylesheet, lookStylesheet, readBookingBrand, readFormBrand, readHandleLook } from './public.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-brand-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person who can sign in, and a workspace of theirs, as its owner. */
async function person(name: string) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Brand',
    slug: `brand-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  return { ...created, userId, scope };
}

/** The refusal code a promise rejects with, `INPUT_INVALID` for an input problem. */
async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isInputError(error)) return 'INPUT_INVALID';
    return isRefusal(error) ? error.refusal.code : 'thrown';
  }
}

const version = () => randomUUID().replace(/-/g, '').slice(0, 12);

describe('the brand kit', () => {
  it('is read by any member and saved only with workspace.manage (AC-1, AC-23)', async () => {
    const ada = await person('Ada');
    const asMember = rescope(ada.scope, { role: 'member' });
    expect(await getWorkspaceBrand(asMember)).toEqual({ canEdit: false });
    expect(await getWorkspaceBrand(ada.scope)).toEqual({ canEdit: true });
    await expect(saveWorkspaceBrand(asMember, { accent: '#1f5fd6', accentDark: null })).rejects.toMatchObject({
      refusal: { code: 'FORBIDDEN', message: PERMISSIONS['workspace.manage'].message },
    });
    expect(await saveWorkspaceBrand(ada.scope, { accent: '#1F5FD6', accentDark: null })).toEqual({
      accent: '#1f5fd6',
      canEdit: true,
    });
    expect(await getWorkspaceBrand(asMember)).toEqual({ accent: '#1f5fd6', canEdit: false });
    // Clearing it is the product's accent again.
    expect(await saveWorkspaceBrand(ada.scope, { accent: null, accentDark: null })).toEqual({ canEdit: true });
  });

  it('refuses anything but a six digit hex, and a dark colour alone (AC-22)', async () => {
    const ada = await person('Ada');
    for (const bad of ['#12345g', 'red', '#123456;}', '#1234567']) {
      expect(await refusalOf(saveWorkspaceBrand(ada.scope, { accent: bad, accentDark: null }))).toBe('INPUT_INVALID');
    }
    expect(await refusalOf(saveWorkspaceBrand(ada.scope, { accent: null, accentDark: '#123456' }))).toBe(
      'INPUT_INVALID',
    );
  });

  it('keeps a logo in its own workspace folder, answers the one it replaced, and serves only its version', async () => {
    const ada = await person('Ada');
    const first = {
      path: `${brandLogoFolder(ada.workspaceId)}${randomUUID()}.png`,
      type: 'image/png',
      version: version(),
    } as const;
    expect(await saveBrandLogo(ada.scope, first)).toEqual({});
    const second = {
      path: `${brandLogoFolder(ada.workspaceId)}${randomUUID()}.webp`,
      type: 'image/webp',
      version: version(),
    } as const;
    expect(await saveBrandLogo(ada.scope, second)).toEqual({ previous: first.path });
    expect(await readBrandLogo(rescope(ada.scope, { role: 'member' }), second.version)).toEqual({
      logo: { path: second.path, type: 'image/webp' },
    });
    expect(await readBrandLogo(ada.scope, first.version)).toEqual({});
    // Another workspace's folder is never written, nor a climb out of this one.
    const bea = await person('Bea');
    await expect(
      saveBrandLogo(ada.scope, { ...second, path: `${brandLogoFolder(bea.workspaceId)}${randomUUID()}.png` }),
    ).rejects.toThrow();
    expect(await clearBrandLogo(ada.scope)).toEqual({ previous: second.path });
    expect(await clearBrandLogo(ada.scope)).toEqual({});
    expect(await refusalOf(clearBrandLogo(rescope(ada.scope, { role: 'member' })))).toBe('FORBIDDEN');
  });

  it("never reaches another workspace's pages (AC-23)", async () => {
    const ada = await person('Ada');
    const bea = await person('Bea');
    await saveWorkspaceBrand(ada.scope, { accent: '#e11d48', accentDark: null });
    expect(await getWorkspaceBrand(bea.scope)).toEqual({ canEdit: true });
    expect((await readFormBrand({ scope: bea.scope })).answer).toBeUndefined();
    const seen = await db.withWorkspace(bea.workspaceId, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspace_brands`),
    );
    expect(seen.rows).toEqual([]);
  });
});

describe('what a page wears', () => {
  it('a team page and a form wear the workspace accent; a personal page its owner’s own when set (AC-4, AC-14)', async () => {
    const ada = await person('Ada');
    await saveWorkspaceBrand(ada.scope, { accent: '#e11d48', accentDark: null });
    const made = await createBookingPage(ada.scope, {
      id: newId(),
      title: 'Intro',
      timeZone: 'Europe/London',
      settings: {},
    });
    const entry = await enterBookingPage({ db }, made.publicKey);
    const workspaceWorn = await readBookingBrand(entry);
    expect(workspaceWorn.accents).toEqual({ accent: '#e11d48' });
    expect(workspaceWorn.answer?.version).toMatch(/^[0-9a-f]{12}$/);
    expect((await readFormBrand({ scope: ada.scope })).accents).toEqual({ accent: '#e11d48' });
    expect(brandStylesheet(workspaceWorn)).toMatch(/^:root\{--brand-accent:#[0-9a-f]{6};/);

    // Ada sets her own: her link page and her personal page wear it.
    const handle = `ada-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(ada.scope, { handle });
    expect(await saveProfileAccent(ada.scope, { accent: '#16A34A', accentDark: null })).toEqual({
      accent: '#16a34a',
      accentDark: null,
    });
    expect(await readProfileLook(ada.scope)).toEqual({ accent: '#16a34a' });
    const own = await readBookingBrand(entry);
    expect(own.accents).toEqual({ accent: '#16a34a' });
    expect(own.answer?.version).not.toBe(workspaceWorn.answer?.version);
    const owner = await findHandleOwner({ db }, handle, { viewer: ada.userId });
    const look = await readHandleLook({ db }, owner);
    expect(look.accents).toEqual({ accent: '#16a34a' });
    // The form keeps the workspace's: a person's accent is their own pages' alone.
    expect((await readFormBrand({ scope: ada.scope })).accents).toEqual({ accent: '#e11d48' });
  });

  it('carries a link page’s photos only from its own folder, and only as our own paths (AC-10, AC-13, AC-22)', async () => {
    const ada = await person('Ada');
    const handle = `ada-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(ada.scope, { handle });
    const cover = {
      path: `${pageImageFolder(ada.userId, ada.workspaceId)}${randomUUID()}.jpg`,
      type: 'image/jpeg',
      version: version(),
    } as const;
    expect(await saveProfileImage(ada.scope, { slot: 'cover', image: cover })).toEqual({});
    const owner = await findHandleOwner({ db }, handle, { viewer: ada.userId });
    const look = await readHandleLook({ db }, owner);
    expect(look.cover).toEqual(cover);
    expect(look.answer).toMatchObject({ cover: cover.version });
    expect(lookStylesheet(look, handle)).toBe(
      `:root{--page-cover-image:url("/api/public/profiles/${handle}/cover?v=${cover.version}")}\n`,
    );
    expect(await saveProfileImage(ada.scope, { slot: 'cover' })).toEqual({ previous: cover.path });
    await expect(
      saveProfileImage(ada.scope, {
        slot: 'ground',
        image: { ...cover, path: `${pageImageFolder(randomUUID(), ada.workspaceId)}${randomUUID()}.jpg` },
      }),
    ).rejects.toThrow();
  });

  it('refuses a person with no page, and anyone but a signed in member', async () => {
    const ada = await person('Ada');
    expect(await refusalOf(saveProfileAccent(ada.scope, { accent: '#123456', accentDark: null }))).toBe('NOT_FOUND');
    expect(await readProfileLook(ada.scope)).toEqual({});
    const key = testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'api_key', id: newId() } });
    expect(await refusalOf(saveProfileAccent(key, { accent: '#123456', accentDark: null }))).toBe('FORBIDDEN');
  });

  it('keeps every old look whole: the stored theme carries all ten keys after the migration (AC-17)', async () => {
    const ada = await person('Ada');
    await updateMyMemberProfile(ada.scope, { handle: `ada-${randomUUID().slice(0, 8)}` });
    const rows = await testQuery<{ theme: Record<string, string> }>(
      ownerUrl,
      `select theme from auth.public_profiles where user_id = $1`,
      [ada.userId],
    );
    expect(Object.keys(rows[0]?.theme ?? {}).sort()).toEqual(
      ['avatar', 'fill', 'font', 'gradient', 'ground', 'header', 'hue', 'mode', 'pattern', 'shape'].sort(),
    );
    // And the database refuses a look of the old six alone, or a colour in it.
    await expect(
      testQuery(ownerUrl, `update auth.public_profiles set theme = theme - 'header' where user_id = $1`, [ada.userId]),
    ).rejects.toThrow();
    await expect(
      testQuery(ownerUrl, `update auth.public_profiles set accent = '#123456;}' where user_id = $1`, [ada.userId]),
    ).rejects.toThrow();
  });
});
