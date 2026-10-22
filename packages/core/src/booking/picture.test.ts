// A host's account picture on the public pages (23 Oct 2026), against the real Postgres: only Google's picture hosts
// are ever named, a personal page's facts point at our own origin's copy (never Google's URL), a team page names
// none (AC-754), and a profile does the same under its current handle.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, enterBookingProfile, findHandleOwner } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { createBookingPage } from './pages.ts';
import { accountPicture, isPictureHost, pictureVersion } from './picture.ts';
import { getPublicBookingPage, readBookingProfile, readPagePicture, readProfilePicture } from './public.ts';

const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocK_abc-123=s96-c';
const SIZED = 'https://lh3.googleusercontent.com/a/ACg8ocK_abc-123=s256-c';

describe('accountPicture', () => {
  it('takes an https picture on Google’s picture hosts, asked for as a 256px square', () => {
    expect(accountPicture(GOOGLE)?.href).toBe(SIZED);
    expect(accountPicture('https://lh3.googleusercontent.com/a/ACg8ocK_abc')?.href).toBe(
      'https://lh3.googleusercontent.com/a/ACg8ocK_abc=s256-c',
    );
    expect(accountPicture('https://lh5.googleusercontent.com/a-/AOh14Gh=s96-c')?.href).toBe(
      'https://lh5.googleusercontent.com/a-/AOh14Gh=s256-c',
    );
    // An older account picture's path is kept as it is.
    const legacy = 'https://lh3.googleusercontent.com/-XdUIqdMkCWA/AAAAAAAAAAI/AAAAAAAAAAA/4252rscbv5M/s96-c/photo.jpg';
    expect(accountPicture(legacy)?.href).toBe(legacy);
  });

  it('versions a picture by its person and address, so a new picture or a new owner is a new path', () => {
    const ada = randomUUID();
    expect(pictureVersion(ada, GOOGLE)).toMatch(/^[0-9a-f]{12}$/);
    expect(pictureVersion(ada, GOOGLE)).toBe(pictureVersion(ada, GOOGLE));
    expect(pictureVersion(ada, `${GOOGLE}x`)).not.toBe(pictureVersion(ada, GOOGLE));
    expect(pictureVersion(randomUUID(), GOOGLE)).not.toBe(pictureVersion(ada, GOOGLE));
  });

  it('refuses every other place: no picture, plain http, other hosts, ports, credentials, look alikes', () => {
    for (const refused of [
      undefined,
      '',
      'not a url',
      'http://lh3.googleusercontent.com/a/x',
      'https://evil.example/a/x',
      'https://lh3.googleusercontent.com.evil.example/a/x',
      'https://googleusercontent.com/a/x',
      'https://doc-0s-docs.googleusercontent.com/a/x',
      'https://lh3.googleusercontent.com:8443/a/x',
      'https://user:pass@lh3.googleusercontent.com/a/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/a/x',
      // Other content those hosts serve is no account picture.
      'https://lh3.googleusercontent.com/d/some-drive-file',
      'https://lh3.googleusercontent.com/proxy/abc',
      'https://lh3.googleusercontent.com/a/x/y',
      `https://lh3.googleusercontent.com/a/${'x'.repeat(2100)}`,
    ]) {
      expect(accountPicture(refused), String(refused)).toBeUndefined();
    }
  });

  it('follows a redirect only to the same hosts', () => {
    expect(isPictureHost(new URL(SIZED))).toBe(true);
    expect(isPictureHost(new URL('https://lh6.googleusercontent.com/x'))).toBe(true);
    expect(isPictureHost(new URL('http://lh3.googleusercontent.com/x'))).toBe(false);
    expect(isPictureHost(new URL('https://:secret@lh3.googleusercontent.com/x'))).toBe(false);
    expect(isPictureHost(new URL('https://www.google.com/x'))).toBe(false);
  });
});

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-picture-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person with this account picture (or none), and a workspace of theirs, as its owner. */
async function person(name: string, image: string | null) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email, image) values ($1, $2, $3, $4)`, [
    userId,
    name,
    `${userId}@example.com`,
    image,
  ]);
  const created = await createWorkspace(db, {
    name: 'Pictures',
    slug: `pictures-${String(count)}-${String(Date.now())}`,
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

/** Reads pictures as the identity login would: straight from schema auth, as the test's owner. */
async function pictureOf(userId: string): Promise<string | undefined> {
  const rows = await testQuery<{ image: string | null }>(ownerUrl, `select image from auth."user" where id = $1`, [
    userId,
  ]);
  return rows[0]?.image ?? undefined;
}

const pictures = { pictureOf };

describe('a personal page’s host picture', () => {
  it('points at our own origin when the owner has a Google picture, never at Google', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Intro call', timeZone: 'Europe/London' });
    const entry = await enterBookingPage({ db }, page.publicKey);
    const facts = await getPublicBookingPage(entry, pictures);
    const version = pictureVersion(ada.userId, GOOGLE);
    expect(facts.hostImage).toBe(`/api/public/booking/${page.publicKey}/picture?v=${version}`);
    expect(JSON.stringify(facts)).not.toContain('googleusercontent');
    expect(await readPagePicture(entry, pictures)).toEqual({ url: new URL(SIZED), version });
    // Without the reader (the chat's own read), no picture is named.
    expect((await getPublicBookingPage(entry)).hostImage).toBeUndefined();
  });

  it('names none for a picture elsewhere, or none at all', async () => {
    for (const image of ['https://evil.example/me.png', 'http://lh3.googleusercontent.com/a/x', null]) {
      const ada = await person('Ada', image);
      const page = await createBookingPage(ada.scope, { id: newId(), title: 'Intro', timeZone: 'UTC' });
      const entry = await enterBookingPage({ db }, page.publicKey);
      expect((await getPublicBookingPage(entry, pictures)).hostImage, String(image)).toBeUndefined();
      expect(await readPagePicture(entry, pictures), String(image)).toBeUndefined();
    }
  });

  it('shows only where the page does: a paused or deleted page refuses its picture as it refuses its facts', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    const paused = await createBookingPage(ada.scope, { id: newId(), title: 'Paused', timeZone: 'UTC' });
    const deleted = await createBookingPage(ada.scope, { id: newId(), title: 'Deleted', timeZone: 'UTC' });
    const pausedEntry = await enterBookingPage({ db }, paused.publicKey);
    const deletedEntry = await enterBookingPage({ db }, deleted.publicKey);
    await db.withWorkspace(ada.workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set status = 'paused' where id = ${paused.id}::uuid`);
      await tx.execute(sql`update booking_pages set deleted_at = now() where id = ${deleted.id}::uuid`);
    });
    const codeOf = (promise: Promise<unknown>) =>
      promise.then(
        () => 'answered',
        (error: unknown) => (isRefusal(error) ? error.refusal.code : 'thrown'),
      );
    expect(await codeOf(readPagePicture(pausedEntry, pictures))).toBe('BOOKING_CLOSED');
    expect(await codeOf(readPagePicture(deletedEntry, pictures))).toBe('NOT_FOUND');
  });

  it('names none on a team page, which names no member (AC-754)', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Panel', timeZone: 'UTC' });
    await db.withWorkspace(ada.workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set kind = 'collective' where id = ${page.id}::uuid`);
      await tx.execute(sql`delete from booking_page_members where page_id = ${page.id}::uuid`);
      await tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${ada.workspaceId}, ${page.id}, ${ada.memberId}, 0)`,
      );
    });
    const entry = await enterBookingPage({ db }, page.publicKey);
    const facts = await getPublicBookingPage(entry, pictures);
    expect(facts.team).toBeDefined();
    expect(facts.hostImage).toBeUndefined();
    expect(facts.team?.avatars.every((avatar) => avatar.image === undefined)).toBe(true);
    expect(await readPagePicture(entry, pictures)).toBeUndefined();
  });
});

describe('a profile’s picture', () => {
  it('points at our own origin under the current handle, and reads the Google picture for the route', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    const handle = `ada-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(ada.scope, { handle });
    const profile = await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 21 }));
    const version = pictureVersion(ada.userId, GOOGLE);
    expect(profile.image).toBe(`/api/public/profiles/${handle}/picture?v=${version}`);
    expect(JSON.stringify(profile)).not.toContain('googleusercontent');
    expect(readProfilePicture(await findHandleOwner({ db }, handle))).toEqual({ url: new URL(SIZED), version });
  });

  it('names none without a Google picture, and a handle no one holds is NOT_FOUND', async () => {
    const bob = await person('Bob', 'https://evil.example/me.png');
    const handle = `bob-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(bob.scope, { handle });
    const profile = await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 21 }));
    expect(profile.image).toBeUndefined();
    expect(readProfilePicture(await findHandleOwner({ db }, handle))).toBeUndefined();
    const missing = await findHandleOwner({ db }, `nobody-${randomUUID().slice(0, 8)}`).catch(
      (error: unknown) => error,
    );
    expect(isRefusal(missing) ? missing.refusal.code : missing).toBe('NOT_FOUND');
  });
});
