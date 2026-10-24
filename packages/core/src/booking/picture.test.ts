// A host's account picture on the public pages (23 Oct 2026), against the real Postgres: only Google's picture hosts
// are ever named, a personal page's facts point at our own origin's copy (never Google's URL), a team page names
// none (AC-754), and a profile does the same under its current handle. A person who keeps their picture off their
// public pages (owner ask A124) is named by none of them, and the choice is theirs alone, audited.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, enterLinkPage, findHandleOwner } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyProfile, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { greeting } from './chat/agent.ts';
import { createBookingPage } from './pages.ts';
import { accountPicture, isPictureHost, pictureVersion } from './picture.ts';
import { getPublicBookingPage, readLinkPage, readPagePicture, readProfilePicture } from './public.ts';

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
    const profile = await readLinkPage(await enterLinkPage({ db }, handle, { max: 21 }));
    const version = pictureVersion(ada.userId, GOOGLE);
    expect(profile.image).toBe(`/api/public/profiles/${handle}/picture?v=${version}`);
    expect(JSON.stringify(profile)).not.toContain('googleusercontent');
    expect(readProfilePicture(await findHandleOwner({ db }, handle))).toEqual({ url: new URL(SIZED), version });
  });

  it('names none without a Google picture, and a handle no one holds is NOT_FOUND', async () => {
    const bob = await person('Bob', 'https://evil.example/me.png');
    const handle = `bob-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(bob.scope, { handle });
    const profile = await readLinkPage(await enterLinkPage({ db }, handle, { max: 21 }));
    expect(profile.image).toBeUndefined();
    expect(readProfilePicture(await findHandleOwner({ db }, handle))).toBeUndefined();
    const missing = await findHandleOwner({ db }, `nobody-${randomUUID().slice(0, 8)}`).catch(
      (error: unknown) => error,
    );
    expect(isRefusal(missing) ? missing.refusal.code : missing).toBe('NOT_FOUND');
  });
});

/** The profile audit rows of a workspace, oldest first. */
async function profileAudit(workspaceId: string) {
  return testQuery<{ target_id: string; actor_member_id: string; before: unknown; after: unknown }>(
    ownerUrl,
    `select target_id, actor_member_id::text, before, after from audit_events
     where workspace_id = $1 and action = 'member.profile_updated' order by at, id`,
    [workspaceId],
  );
}

/** A refusal's code and field, or what else the call ended in. */
async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, field: error.refusal.field };
    throw error;
  }
  throw new Error('It was let through.');
}

describe('a person who keeps their picture off their public pages (owner ask A124)', () => {
  it('reads as shown until they hide it, and writes one audit row a change, none for no change', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    expect((await getMyProfile(ada.scope)).pictureHidden).toBe(false);
    expect(await updateMyMemberProfile(ada.scope, { pictureHidden: true })).toMatchObject({ pictureHidden: true });
    expect((await getMyProfile(ada.scope)).pictureHidden).toBe(true);
    await updateMyMemberProfile(ada.scope, { pictureHidden: true });
    expect(await updateMyMemberProfile(ada.scope, { pictureHidden: false })).toMatchObject({ pictureHidden: false });
    expect(await profileAudit(ada.workspaceId)).toEqual([
      {
        target_id: ada.memberId,
        actor_member_id: ada.memberId,
        before: { pictureHidden: false },
        after: { pictureHidden: true },
      },
      {
        target_id: ada.memberId,
        actor_member_id: ada.memberId,
        before: { pictureHidden: true },
        after: { pictureHidden: false },
      },
    ]);
  });

  it('names no picture on the page, its route, the profile or its route, and never asks for it', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    const handle = `ada-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(ada.scope, { handle });
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const version = pictureVersion(ada.userId, GOOGLE);
    const asked: string[] = [];
    const counting = {
      pictureOf: (userId: string) => {
        asked.push(userId);
        return pictureOf(userId);
      },
    };
    await updateMyMemberProfile(ada.scope, { pictureHidden: true });

    // A visitor's reads, each through the door anew, as an anonymous request makes them.
    const entry = await enterBookingPage({ db }, page.publicKey);
    const facts = await getPublicBookingPage(entry, counting);
    expect(facts.hostImage).toBeUndefined();
    expect(facts.hostName).toBe('Ada Lovelace');
    expect(await readPagePicture(await enterBookingPage({ db }, page.publicKey), counting)).toBeUndefined();
    expect(asked).toEqual([]);
    const profile = await readLinkPage(await enterLinkPage({ db }, handle, { max: 21 }));
    expect(profile.image).toBeUndefined();
    expect(profile.initials).toBe('AL');
    expect(JSON.stringify(profile)).not.toContain('picture');
    const owner = await findHandleOwner({ db }, handle);
    expect(owner.image).toBeUndefined();
    expect(readProfilePicture(owner)).toBeUndefined();
    // The chat's greeting names the host in words only.
    expect(greeting({ ...facts }, 30)).not.toContain('picture');

    // Shown again: the same paths as before, since the picture itself didn't change.
    await updateMyMemberProfile(ada.scope, { pictureHidden: false });
    const again = await enterBookingPage({ db }, page.publicKey);
    expect((await getPublicBookingPage(again, counting)).hostImage).toBe(
      `/api/public/booking/${page.publicKey}/picture?v=${version}`,
    );
    expect(await readPagePicture(again, counting)).toEqual({ url: new URL(SIZED), version });
    expect((await readLinkPage(await enterLinkPage({ db }, handle, { max: 21 }))).image).toBe(
      `/api/public/profiles/${handle}/picture?v=${version}`,
    );
  });

  it('is the person’s in every workspace: their pages elsewhere leave it off too', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    const second = await createWorkspace(db, {
      name: 'Second',
      slug: `pictures-second-${String(Date.now())}-${String(count)}`,
      firstMember: { name: 'Ada Lovelace', email: `${ada.userId}@example.com`, userId: ada.userId },
    });
    const there = testScope({
      db,
      workspaceId: second.workspaceId,
      actor: { type: 'member', id: second.memberId },
      userId: ada.userId,
    });
    const page = await createBookingPage(there, { id: newId(), title: 'Elsewhere', timeZone: 'UTC' });
    await updateMyMemberProfile(ada.scope, { pictureHidden: true });
    expect((await getMyProfile(there)).pictureHidden).toBe(true);
    const entry = await enterBookingPage({ db }, page.publicKey);
    expect((await getPublicBookingPage(entry, pictures)).hostImage).toBeUndefined();
    expect(await readPagePicture(entry, pictures)).toBeUndefined();
    // Each workspace audits the change made in it.
    expect(await profileAudit(second.workspaceId)).toEqual([]);
    expect(await profileAudit(ada.workspaceId)).toHaveLength(1);
  });

  it('is set by the person alone: a colleague’s change is their own, and no one else has one to make', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    const beaUser = randomUUID();
    await testQuery(ownerUrl, `insert into auth."user" (id, name, email, image) values ($1, 'Bea', $2, $3)`, [
      beaUser,
      `${beaUser}@example.com`,
      GOOGLE,
    ]);
    const beaId = newId();
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
            values (${ada.workspaceId}, ${beaId}, ${beaUser}, 'Bea', ${`${beaUser}@example.com`}, 'admin', 'system', 'system')`,
      ),
    );
    const bea = testScope({
      db,
      workspaceId: ada.workspaceId,
      actor: { type: 'member', id: beaId },
      role: 'admin',
      userId: beaUser,
    });
    await updateMyMemberProfile(bea, { pictureHidden: true });
    expect((await getMyProfile(bea)).pictureHidden).toBe(true);
    expect((await getMyProfile(ada.scope)).pictureHidden).toBe(false);
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    expect((await getPublicBookingPage(await enterBookingPage({ db }, page.publicKey), pictures)).hostImage).toBe(
      `/api/public/booking/${page.publicKey}/picture?v=${pictureVersion(ada.userId, GOOGLE)}`,
    );

    // An API key, or a page's own visitor actor, has no profile; a member with no sign in has no picture to hide.
    const key = testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'api_key', id: newId() } });
    expect(await refusalOf(updateMyMemberProfile(key, { pictureHidden: true }))).toMatchObject({ code: 'FORBIDDEN' });
    const visitor = (await enterBookingPage({ db }, page.publicKey)).scope;
    expect(await refusalOf(updateMyMemberProfile(visitor, { pictureHidden: true }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const unsigned = testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'member', id: ada.memberId } });
    expect((await getMyProfile(unsigned)).pictureHidden).toBeUndefined();
    expect(await refusalOf(updateMyMemberProfile(unsigned, { pictureHidden: true }))).toEqual({
      code: 'FORBIDDEN',
      field: 'pictureHidden',
    });
    expect((await getMyProfile(ada.scope)).pictureHidden).toBe(false);
    expect(await profileAudit(ada.workspaceId)).toEqual([
      { target_id: beaId, actor_member_id: beaId, before: { pictureHidden: false }, after: { pictureHidden: true } },
    ]);
  });

  it('keeps a team page without pictures, whatever its members chose (AC-754)', async () => {
    const ada = await person('Ada Lovelace', GOOGLE);
    await updateMyMemberProfile(ada.scope, { pictureHidden: true });
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Panel', timeZone: 'UTC' });
    await db.withWorkspace(ada.workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set kind = 'collective' where id = ${page.id}::uuid`);
      await tx.execute(sql`delete from booking_page_members where page_id = ${page.id}::uuid`);
      await tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${ada.workspaceId}, ${page.id}, ${ada.memberId}, 0)`,
      );
    });
    for (const hidden of [true, false]) {
      await updateMyMemberProfile(ada.scope, { pictureHidden: hidden });
      const entry = await enterBookingPage({ db }, page.publicKey);
      const facts = await getPublicBookingPage(entry, pictures);
      expect(facts.team, String(hidden)).toBeDefined();
      expect(facts.hostImage, String(hidden)).toBeUndefined();
      expect(facts.team?.avatars.every((avatar) => avatar.image === undefined)).toBe(true);
      expect(await readPagePicture(entry, pictures), String(hidden)).toBeUndefined();
    }
  });
});
