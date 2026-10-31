// Link page blocks and reach (spec 0061), against the real Postgres: the new kinds' limits and the featured cap
// (AC-6115), scheduled blocks left out of the public read (AC-6111), several contact cards (AC-6114), a picture
// served only while a live block of that page uses it and never another person's (AC-6129), a view's facts rolled up
// and folded into Other past a day's 50 (AC-6116, AC-6117), and a booking counted only through a live block (AC-6119).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import type { ProfileBlock } from '@crm/contracts';
import {
  countProfileBooking,
  countProfileView,
  enterContactCard,
  enterLinkImage,
  enterLinkPage,
  enterTimesBlock,
} from '../access/door.ts';
import { readLinkPage } from '../booking/public.ts';
import { createBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { profileImageStorePath } from './images.ts';
import {
  addProfileImage,
  archiveProfileItem,
  profileInsightsCsv,
  readOwnProfileImage,
  readProfileCounts,
  readQrStyle,
  saveProfileItem,
  saveQrStyle,
} from './items.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-link-reach-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person with a handle and a workspace of theirs, as its owner. */
async function person(name: string) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Reach',
    slug: `reach-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = `reach-${randomUUID().slice(0, 8)}`;
  await updateMyMemberProfile(scope, { handle });
  return { ...created, userId, scope, handle };
}

type Person = Awaited<ReturnType<typeof person>>;

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, message: error.refusal.message };
    throw error;
  }
}

const add = (who: Person, block: ProfileBlock, id = newId()) => saveProfileItem(who.scope, { id, block });

/** One of the person's pictures, kept as an upload would be (its bytes are never read here). */
async function picture(who: Person): Promise<string> {
  const id = newId();
  await addProfileImage(who.scope, {
    id,
    kind: 'upload',
    path: profileImageStorePath(who.userId, who.workspaceId, id, 'image/png'),
    type: 'image/png',
    bytes: 1200,
    width: 800,
    height: 600,
  });
  return id;
}

const visitorRead = async (handle: string) => readLinkPage(await enterLinkPage({ db }, handle, { max: 21 }));

const visitor = () => randomBytes(16).toString('hex');

describe('the new kinds', () => {
  it('holds a picture, a gallery and a banner, each drawn from our origin with its size', async () => {
    const ada = await person('Ada');
    const [one, two] = [await picture(ada), await picture(ada)];
    const image = await add(ada, {
      kind: 'image',
      image: one,
      alt: 'The view',
      caption: 'Morning',
      size: 'wide',
    });
    await add(ada, {
      kind: 'gallery',
      images: [
        { image: one, alt: 'One' },
        { image: two, alt: 'Two' },
      ],
      display: 'grid',
    });
    await add(ada, { kind: 'banner', text: 'Sale ends Friday', url: 'shop.example.com/sale' });
    const seen = await visitorRead(ada.handle);
    expect(seen.items).toEqual([
      {
        kind: 'image',
        id: image.id,
        image: { src: `/api/public/profiles/${ada.handle}/images/${one}`, width: 800, height: 600 },
        alt: 'The view',
        caption: 'Morning',
        size: 'wide',
      },
      expect.objectContaining({
        kind: 'gallery',
        display: 'grid',
        images: [expect.objectContaining({ alt: 'One' }), expect.objectContaining({ alt: 'Two' })],
      }),
      expect.objectContaining({ kind: 'banner', text: 'Sale ends Friday', url: 'https://shop.example.com/sale' }),
    ]);
    // A second live banner is refused; one at a time.
    const second = await refusalOf(add(ada, { kind: 'banner', text: 'Another' }));
    expect(second).toEqual({ code: 'LIMIT_REACHED', message: 'A link page shows one banner at a time.' });
  });

  it('caps featured links at three, on an add, an edit and a restore', async () => {
    const ada = await person('Ada');
    const made = [];
    for (const n of [1, 2, 3]) {
      made.push(
        await add(ada, { kind: 'link', title: `L${String(n)}`, url: `a${String(n)}.example.com`, style: 'featured' }),
      );
    }
    const fourth = await refusalOf(add(ada, { kind: 'link', title: 'L4', url: 'a4.example.com', style: 'featured' }));
    expect(fourth).toEqual({ code: 'LIMIT_REACHED', message: 'A link page holds up to 3 featured links.' });
    const plain = await add(ada, { kind: 'link', title: 'L5', url: 'a5.example.com' });
    const edit = await refusalOf(
      saveProfileItem(ada.scope, {
        id: plain.id,
        isEdit: true,
        block: { kind: 'link', title: 'L5', url: 'a5.example.com', style: 'featured' },
      }),
    );
    expect(edit?.code).toBe('LIMIT_REACHED');
    const [first] = made;
    await archiveProfileItem(ada.scope, { id: first?.id ?? '', archived: true });
    await saveProfileItem(ada.scope, {
      id: plain.id,
      isEdit: true,
      block: { kind: 'link', title: 'L5', url: 'a5.example.com', style: 'featured' },
    });
    const restore = await refusalOf(archiveProfileItem(ada.scope, { id: first?.id ?? '', archived: false }));
    expect(restore?.code).toBe('LIMIT_REACHED');
  });

  it('refuses a picture that is another person’s, or none', async () => {
    const ada = await person('Ada');
    const bob = await person('Bob');
    const bobs = await picture(bob);
    for (const block of [
      { kind: 'image', image: bobs, alt: 'Not mine' },
      { kind: 'link', title: 'Shop', url: 'shop.example.com', thumb: bobs },
      { kind: 'image', image: newId(), alt: 'Nobody’s' },
    ] satisfies ProfileBlock[]) {
      expect(await refusalOf(add(ada, block))).toEqual({
        code: 'NOT_FOUND',
        message: 'That picture isn’t on your link page. Add it again.',
      });
    }
  });
});

describe('a picture’s address (AC-6129)', () => {
  it('answers only while a live block of that page uses it, and never by another handle', async () => {
    const ada = await person('Ada');
    const bob = await person('Bob');
    const id = await picture(ada);
    // Kept, but no block uses it yet.
    expect(await refusalOf(enterLinkImage({ db }, ada.handle, id))).toMatchObject({ code: 'NOT_FOUND' });
    const block = await add(ada, { kind: 'image', image: id, alt: 'A view' });
    expect(await enterLinkImage({ db }, ada.handle, id)).toMatchObject({
      path: `link-page/${ada.userId}/${ada.workspaceId}/${id}.png`,
      type: 'image/png',
    });
    // Ada's picture by Bob's handle is no picture.
    expect(await refusalOf(enterLinkImage({ db }, bob.handle, id))).toMatchObject({ code: 'NOT_FOUND' });
    await archiveProfileItem(ada.scope, { id: block.id, archived: true });
    expect(await refusalOf(enterLinkImage({ db }, ada.handle, id))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never answers the share QR’s centre picture to a visitor: only its owner’s editor draws it', async () => {
    const ada = await person('Ada');
    const id = await picture(ada);
    await saveQrStyle(ada.scope, { picture: { from: 'upload', image: id } });
    expect(await refusalOf(enterLinkImage({ db }, ada.handle, id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await readOwnProfileImage(ada.scope, id)).toMatchObject({ type: 'image/png' });
  });

  it('is refused to the app login directly, as every link page table is', async () => {
    for (const table of ['profile_images', 'profile_view_source_days', 'profile_booking_days']) {
      await expect(testQuery(appUrl, `select 1 from auth.${table} limit 1`)).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('scheduled blocks (AC-6111)', () => {
  it('leaves out a block before its start and after its end', async () => {
    const ada = await person('Ada');
    const day = 86_400_000;
    const now = Date.now();
    const iso = (at: number) => new Date(at).toISOString();
    await add(ada, {
      kind: 'link',
      title: 'Live',
      url: 'live.example.com',
      showFrom: iso(now - day),
      hideAfter: iso(now + day),
    });
    await add(ada, { kind: 'link', title: 'Later', url: 'later.example.com', showFrom: iso(now + day) });
    await add(ada, { kind: 'link', title: 'Over', url: 'over.example.com', hideAfter: iso(now - day) });
    const seen = await visitorRead(ada.handle);
    expect(seen.items.map((item) => ('title' in item ? item.title : item.kind))).toEqual(['Live']);
    const refused = await refusalOf(
      add(ada, { kind: 'link', title: 'Back', url: 'b.example.com', showFrom: iso(now + day), hideAfter: iso(now) }),
    );
    expect(refused).toMatchObject({ code: 'CONFIG_INVALID', message: '“Hide after” has to come after “Show from”.' });
  });
});

describe('several contact cards (AC-6114)', () => {
  it('answers the card asked for, the first with none, and nothing for another page’s', async () => {
    const ada = await person('Ada');
    const bob = await person('Bob');
    const work = await add(ada, { kind: 'contact', fullName: 'Ada at work' });
    const home = await add(ada, { kind: 'contact', fullName: 'Ada at home' });
    const bobs = await add(bob, { kind: 'contact', fullName: 'Bob' });
    expect((await enterContactCard({ db }, ada.handle)).data).toMatchObject({ fullName: 'Ada at work' });
    expect((await enterContactCard({ db }, ada.handle, { card: home.id })).data).toMatchObject({
      fullName: 'Ada at home',
    });
    expect((await enterContactCard({ db }, ada.handle, { card: work.id })).data).toMatchObject({
      fullName: 'Ada at work',
    });
    expect(await refusalOf(enterContactCard({ db }, ada.handle, { card: bobs.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(enterContactCard({ db }, ada.handle, { card: 'nope' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('insights (AC-6116 to AC-6120)', () => {
  it('rolls each fact up by day, one visitor per value, and folds the 51st value into Other', async () => {
    const ada = await person('Ada');
    const one = visitor();
    await countProfileView({ db }, ada.userId, ada.workspaceId, one, {
      referrer: 'instagram.com',
      source: 'ig_bio',
      country: 'GB',
      device: 'mobile',
    });
    await countProfileView({ db }, ada.userId, ada.workspaceId, one, {
      referrer: 'instagram.com',
      source: 'ig_bio',
      country: 'GB',
      device: 'mobile',
    });
    for (let n = 0; n < 51; n += 1) {
      await countProfileView({ db }, ada.userId, ada.workspaceId, visitor(), {
        referrer: `site${String(n)}.example.com`,
        device: 'desktop',
      });
    }
    const counts = await readProfileCounts(ada.scope, new Date(), 7);
    expect(counts.views).toBe(53);
    expect(counts.visitors).toBe(52);
    expect(counts.facts?.source).toEqual([{ value: 'ig_bio', views: 2, visitors: 1 }]);
    expect(counts.facts?.device).toEqual([
      { value: 'desktop', views: 51, visitors: 51 },
      { value: 'mobile', views: 2, visitors: 1 },
    ]);
    // 50 values of the day are kept as themselves; the 51st folded into Other; Insights shows the top 5 and sums the rest.
    const referrers = counts.facts?.referrer ?? [];
    expect(referrers[0]).toEqual({ value: 'instagram.com', views: 2, visitors: 1 });
    expect(referrers).toHaveLength(6);
    expect(referrers.at(-1)).toEqual({ value: 'Other', views: 47, visitors: 47 });
    expect(counts.series).toHaveLength(7);
    expect(counts.funnel).toEqual({ views: 53, presses: 0, bookings: 0 });
  });

  it('counts a booking only through a live block of that handle’s page', async () => {
    const ada = await person('Ada');
    const bob = await person('Bob');
    const page = await createBookingPage(ada.scope, {
      id: newId(),
      title: 'Intro',
      timeZone: 'Europe/London',
      settings: {},
    });
    const bobsPage = await createBookingPage(bob.scope, {
      id: newId(),
      title: 'Bob',
      timeZone: 'Europe/London',
      settings: {},
    });
    expect(await countProfileBooking({ db }, ada.handle, page.id)).toBe(true);
    expect(await countProfileBooking({ db }, ada.handle, bobsPage.id)).toBe(false);
    expect(await countProfileBooking({ db }, 'nobody-here', page.id)).toBe(false);
    const counts = await readProfileCounts(ada.scope, new Date(), 7);
    expect(counts.funnel?.bookings).toBe(1);
    // A next times block names the page too, and reads as the page's entry.
    const times = await add(ada, { kind: 'times', workspaceId: ada.workspaceId, pageId: page.id });
    expect((await enterTimesBlock({ db }, ada.handle, times.id)).entry.pageId).toBe(page.id);
    expect(await refusalOf(enterTimesBlock({ db }, bob.handle, times.id))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('writes a CSV with the formula guard, and refuses more than 365 days', async () => {
    const ada = await person('Ada');
    await countProfileView({ db }, ada.userId, ada.workspaceId, visitor(), { referrer: 'Direct', device: 'desktop' });
    const today = new Date().toISOString().slice(0, 10);
    const csv = await profileInsightsCsv(ada.scope, { from: today, to: today });
    expect(csv).toContain(`${today},views,,1`);
    expect(csv).toContain(`${today},referrer views,Direct,1`);
    expect(await refusalOf(profileInsightsCsv(ada.scope, { from: '2025-01-01', to: '2026-01-01' }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});

describe('the share QR style (AC-6124)', () => {
  it('keeps a dark enough colour and a label, and refuses a light one', async () => {
    const ada = await person('Ada');
    expect(await readQrStyle(ada.scope)).toEqual({});
    expect(await saveQrStyle(ada.scope, { colour: '#1F2937', label: 'Scan me', picture: { from: 'person' } })).toEqual({
      colour: '#1f2937',
      label: 'Scan me',
      picture: { from: 'person' },
    });
    expect(await refusalOf(saveQrStyle(ada.scope, { colour: '#ffff00' }))).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await refusalOf(saveQrStyle(ada.scope, { picture: { from: 'upload', image: newId() } }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect(await saveQrStyle(ada.scope, null)).toEqual({});
  });
});
