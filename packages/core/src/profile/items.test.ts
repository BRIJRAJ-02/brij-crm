// The link page's blocks (spec 0051, built as blocks), against the real Postgres: adding, editing, ordering,
// archiving and deleting through crm_handle's definers with the session's own id; the limits and the address rules;
// a booking page block shown only while the door lists its page; the public read a page at a time and its search;
// a kind this build doesn't know skipped; another person's id changing nothing; and one link page per workspace (spec 0056). The backfill of 0113 is in home-workspace.test.ts.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { ProfileBlock } from '@crm/contracts';
import { countItemPress, countProfileView, enterLinkPage } from '../access/door.ts';
import { readLinkPage } from '../booking/public.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import {
  archiveProfileItem,
  deleteProfileItem,
  listProfilePageChoices,
  orderProfileItems,
  readProfileCounts,
  readProfileItems,
  saveProfileItem,
} from './items.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-link-page-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person who can sign in and a workspace of theirs (or, with their id, another one), as its owner. */
async function person(name: string, userId: string = randomUUID(), workspace = 'Link page') {
  count += 1;
  await testQuery(
    ownerUrl,
    `insert into auth."user" (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`,
    [userId, name, `${userId}@example.com`],
  );
  const created = await createWorkspace(db, {
    name: workspace,
    slug: `link-page-${String(count)}-${String(Date.now())}`,
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

const fresh = (stem: string) => `${stem}-${randomUUID().slice(0, 8)}`;

/** A person's handle, claimed now: the public counters find them by it. */
async function handleOf(who: { readonly scope: ReturnType<typeof testScope> }): Promise<string> {
  const handle = fresh('counts');
  await updateMyMemberProfile(who.scope, { handle });
  return handle;
}

/** A visitor's block by its words: a contact card by its name. */
const titleOf = (item: { readonly kind: string; readonly title?: string; readonly fullName?: string }) =>
  item.kind === 'contact' ? item.fullName : item.title;

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, message: error.refusal.message };
    throw error;
  }
}

const page = (scope: ReturnType<typeof testScope>, title: string, settings = {}) =>
  createBookingPage(scope, { id: newId(), title, timeZone: 'Europe/London', settings });

const link = (title: string, url: string, more: Partial<ProfileBlock & { kind: 'link' }> = {}): ProfileBlock => ({
  kind: 'link',
  title,
  url,
  ...more,
});

const add = (scope: ReturnType<typeof testScope>, block: ProfileBlock, id = newId()) =>
  saveProfileItem(scope, { id, block });

const visitorRead = async (handle: string, query: { after?: { position: number; id: string }; search?: string } = {}) =>
  readLinkPage(
    await enterLinkPage({ db }, handle, {
      ...(query.after === undefined ? {} : { after: query.after }),
      max: query.search === undefined ? 21 : 61,
    }),
    query.search === undefined ? {} : { search: query.search },
  );

describe('a link page', () => {
  it('holds links, headings and booking pages in one order, the same for a visitor', async () => {
    const ada = await person('Ada Lovelace');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle, bio: 'Product at Acme.' });
    // A new Public page joins the link page by itself, at the end; here it then moves after the heading.
    const intro = await page(ada.scope, 'Intro call');
    const site = await add(ada.scope, link('My site', 'www.timefix.com'));
    expect(site).toMatchObject({ kind: 'link', url: 'https://www.timefix.com' });
    expect(site.kind === 'link' && site.hue).toEqual(expect.stringMatching(/^[a-z]+$/));
    const heading = await add(ada.scope, { kind: 'heading', title: 'Meet me' });
    const linkedin = await add(
      ada.scope,
      link('LinkedIn', 'https://www.linkedin.com/in/ada-lovelace', { note: 'Say hi' }),
    );
    const placed = (await readProfileItems(ada.scope)).items[0];
    expect(placed).toMatchObject({ kind: 'page', pageId: intro.id });
    await orderProfileItems(ada.scope, [site.id, heading.id, placed?.id ?? '', linkedin.id]);
    const mine = await readProfileItems(ada.scope);
    expect(mine.items.map((item) => item.kind)).toEqual(['link', 'heading', 'page', 'link']);
    expect(mine.items[2]).toMatchObject({
      kind: 'page',
      page: { title: 'Intro call', status: 'live', workspaceName: 'Link page', isTeam: false },
    });
    const seen = await visitorRead(handle);
    expect(seen).toMatchObject({ handle, name: 'Ada Lovelace', initials: 'AL', bio: 'Product at Acme.' });
    expect(seen.items).toEqual([
      expect.objectContaining({ kind: 'link', title: 'My site', url: 'https://www.timefix.com' }),
      expect.objectContaining({ kind: 'heading', title: 'Meet me' }),
      expect.objectContaining({ kind: 'page', slug: intro.slug, title: 'Intro call', durations: [30] }),
      expect.objectContaining({ kind: 'link', title: 'LinkedIn', mark: 'linkedin', note: 'Say hi' }),
    ]);
    expect(seen.items[0]).not.toHaveProperty('mark');
    // No workspace, member or page id, and no email, in what a visitor reads.
    const body = JSON.stringify(seen);
    for (const secret of [ada.workspaceId, ada.memberId, intro.id, ada.userId, '@example.com']) {
      expect(body).not.toContain(secret);
    }
  });

  it('is idempotent on the block id, and an edit keeps its place', async () => {
    const ada = await person('Ada');
    const id = newId();
    await add(ada.scope, link('Site', 'https://ada.dev'), id);
    await add(ada.scope, link('Site', 'https://ada.dev'), id);
    await add(ada.scope, link('Blog', 'https://ada.dev/blog'));
    await add(ada.scope, link('Site, renamed', 'https://ada.dev', { hue: 'green' }), id);
    const { items } = await readProfileItems(ada.scope);
    expect(items.map((item) => item.kind === 'link' && item.title)).toEqual(['Site, renamed', 'Blog']);
    expect(items[0]).toMatchObject({ hue: 'green' });
  });

  it('refuses an address that can’t be a link, and keeps the schemes the spec allows', async () => {
    const ada = await person('Ada');
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://user:pass@ada.dev',
      'intro',
      'ftp://x.io',
    ]) {
      expect(await refusalOf(add(ada.scope, link('Bad', url)))).toEqual({
        code: 'CONFIG_INVALID',
        message: 'Use a web address, an email or a phone number.',
      });
    }
    for (const url of ['mailto:ada@ada.dev', 'tel:+441234567890', 'sms:+441234567890', 'http://ada.dev']) {
      expect(await add(ada.scope, link('Fine', url))).toMatchObject({ url });
    }
    expect(await refusalOf(add(ada.scope, link('', 'https://ada.dev')))).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('keeps one heading per text, ignoring case and spaces, and at most twelve', async () => {
    const ada = await person('Ada');
    await add(ada.scope, { kind: 'heading', title: 'Sales' });
    expect(await refusalOf(add(ada.scope, { kind: 'heading', title: '  sales ' }))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'You already have a heading called that.',
    });
    for (let n = 2; n <= 12; n += 1) await add(ada.scope, { kind: 'heading', title: `Heading ${String(n)}` });
    expect(await refusalOf(add(ada.scope, { kind: 'heading', title: 'One more' }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds up to 12 headings.',
    });
  });

  it('refuses the 41st link with the limit’s sentence', async () => {
    const ada = await person('Ada');
    for (let n = 0; n < 40; n += 1) await add(ada.scope, link(`Link ${String(n)}`, `https://ada.dev/${String(n)}`));
    expect(await refusalOf(add(ada.scope, link('Over', 'https://ada.dev/over')))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds up to 40 links.',
    });
  });

  it('refuses the 6th piece of writing and the 3rd set of questions (spec 0052)', async () => {
    const ada = await person('Ada');
    const firstId = newId();
    await add(ada.scope, { kind: 'text', body: 'Words 0' }, firstId);
    for (let n = 1; n < 5; n += 1) await add(ada.scope, { kind: 'text', body: `Words ${String(n)}` });
    expect(await refusalOf(add(ada.scope, { kind: 'text', body: 'One more' }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds up to 5 pieces of writing.',
    });
    const asked = (question: string) => ({ kind: 'faq' as const, items: [{ question, answer: 'Yes.' }] });
    await add(ada.scope, asked('First?'));
    await add(ada.scope, asked('Second?'));
    expect(await refusalOf(add(ada.scope, asked('Third?')))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds up to 2 sets of questions.',
    });
    // A restore is an add: one archived to make room, replaced, then put back is over the limit again.
    await archiveProfileItem(ada.scope, { id: firstId, archived: true });
    await add(ada.scope, { kind: 'text', body: 'In its place' });
    expect(await refusalOf(archiveProfileItem(ada.scope, { id: firstId, archived: false }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds up to 5 pieces of writing.',
    });
  });

  it('refuses the 7th testimonial, on an add and on a restore alike (spec 0052)', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const said = (author: string) => ({ kind: 'testimonial' as const, quote: 'It books itself.', author });
    const firstId = newId();
    await add(ada.scope, said('Sam'), firstId);
    for (let n = 1; n < 6; n += 1) await add(ada.scope, said(`Friend ${String(n)}`));
    expect(await refusalOf(add(ada.scope, said('One more')))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds up to 6 testimonials.',
    });
    // A restore is an add: one archived to make room, replaced, then put back is over the limit again.
    await archiveProfileItem(ada.scope, { id: firstId, archived: true });
    await add(ada.scope, said('In its place'));
    expect(await refusalOf(archiveProfileItem(ada.scope, { id: firstId, archived: false }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds up to 6 testimonials.',
    });
    // A visitor reads the words, the name and the role, and nothing else about it.
    const seen = (await visitorRead(handle)).items.find((item) => item.kind === 'testimonial');
    expect(seen).toMatchObject({ kind: 'testimonial', quote: 'It books itself.' });
    expect(seen).not.toHaveProperty('role');
  });

  it('keeps a heading’s group, stores nothing for an open one, and refuses a word that is neither', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const open = await add(ada.scope, { kind: 'heading', title: 'Find me' });
    const folded = await add(ada.scope, { kind: 'heading', title: 'Read', group: 'folder' });
    const held = (await readProfileItems(ada.scope)).items;
    expect(held.find((item) => item.id === open.id)).toMatchObject({ kind: 'heading', title: 'Find me' });
    expect(held.find((item) => item.id === open.id)).not.toHaveProperty('group');
    expect(held.find((item) => item.id === folded.id)).toMatchObject({ group: 'folder' });
    // The visitor's read says the same, and an open heading is not rewritten on its way out.
    const seen = (await visitorRead(handle)).items;
    expect(seen.find((item) => item.id === folded.id)).toMatchObject({ kind: 'heading', group: 'folder' });
    expect(seen.find((item) => item.id === open.id)).toMatchObject({ kind: 'heading', group: 'open' });
    // The schema refuses a third word, and so does the database for a caller that skipped it (AC-5415). The check
    // runs inside crm_save_profile_item, which is the only way in: crm_app may not execute the check itself.
    expect(ProfileBlock.safeParse({ kind: 'heading', title: 'Tabs', group: 'tabs' }).success).toBe(false);
    await expect(
      testQuery(appUrl, `select crm_save_profile_item($1, $2, $3, 'heading', $4, null, null)`, [
        ada.userId,
        ada.workspaceId,
        newId(),
        JSON.stringify({ title: 'Tabs', group: 'tabs' }),
      ]),
    ).rejects.toThrow(/PROFILE_ITEM_DATA/);
    // And the two it allows go through, so the function and the schema agree on the whole set.
    for (const group of ['open', 'folder']) {
      await testQuery(appUrl, `select crm_save_profile_item($1, $2, $3, 'heading', $4, null, null)`, [
        ada.userId,
        ada.workspaceId,
        newId(),
        JSON.stringify({ title: `Section ${group}`, group }),
      ]);
    }
  });

  it('sets the whole order at once, and refuses an order that missed a change', async () => {
    const ada = await person('Ada');
    const a = await add(ada.scope, link('A', 'https://a.dev'));
    const b = await add(ada.scope, link('B', 'https://b.dev'));
    const c = await add(ada.scope, { kind: 'heading', title: 'C' });
    const ordered = await orderProfileItems(ada.scope, [c.id, a.id, b.id]);
    expect(ordered.items.map((item) => item.id)).toEqual([c.id, a.id, b.id]);
    expect(await refusalOf(orderProfileItems(ada.scope, [a.id, b.id]))).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await refusalOf(orderProfileItems(ada.scope, [a.id, b.id, c.id, newId()]))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect(await refusalOf(orderProfileItems(ada.scope, [a.id, a.id, b.id]))).toMatchObject({ code: 'CONFIG_INVALID' });
    expect((await readProfileItems(ada.scope)).items.map((item) => item.id)).toEqual([c.id, a.id, b.id]);
  });

  it('archives a block off the page at once, restores it to the end, and deletes for good', async () => {
    const ada = await person('Ada');
    const handle = fresh('arch');
    await updateMyMemberProfile(ada.scope, { handle });
    const a = await add(ada.scope, link('A', 'https://a.dev'));
    const b = await add(ada.scope, link('B', 'https://b.dev'));
    const archived = await archiveProfileItem(ada.scope, { id: a.id, archived: true });
    expect(archived.items.map((item) => item.id)).toEqual([b.id]);
    expect(archived.archived.map((item) => [item.id, typeof item.archivedAt])).toEqual([[a.id, 'string']]);
    expect((await visitorRead(handle)).items.map((item) => item.id)).toEqual([b.id]);
    // A heading's twin can't come back while a live one holds its text.
    const heading = await add(ada.scope, { kind: 'heading', title: 'Work' });
    await archiveProfileItem(ada.scope, { id: heading.id, archived: true });
    await add(ada.scope, { kind: 'heading', title: 'work' });
    expect(await refusalOf(archiveProfileItem(ada.scope, { id: heading.id, archived: false }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    const restored = await archiveProfileItem(ada.scope, { id: a.id, archived: false });
    expect(restored.items.map((item) => item.id).at(-1)).toBe(a.id);
    // The order still works after the gaps the archive left.
    await orderProfileItems(
      ada.scope,
      restored.items.map((item) => item.id),
    );
    expect(await deleteProfileItem(ada.scope, b.id)).toEqual({ id: b.id });
    expect(await refusalOf(deleteProfileItem(ada.scope, b.id))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('shows a booking page only while its page’s own rules let it, and keeps its place meanwhile', async () => {
    const ada = await person('Ada');
    const handle = fresh('pages');
    await updateMyMemberProfile(ada.scope, { handle });
    const intro = await page(ada.scope, 'Intro');
    const hidden = await page(ada.scope, 'Secret', { isPrivate: true });
    await add(ada.scope, link('Site', 'https://ada.dev'));
    // A Link only page can't be placed: its address can't be guessed.
    expect(
      await refusalOf(add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: hidden.id })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    // The same page twice is refused.
    expect(
      await refusalOf(add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: intro.id })),
    ).toMatchObject({ code: 'CONFIG_INVALID', message: 'That booking page is on your link page already.' });
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set status = 'paused' where id = ${intro.id}`),
    );
    expect((await visitorRead(handle)).items.map((item) => item.kind)).toEqual(['link']);
    expect((await readProfileItems(ada.scope)).items[0]).toMatchObject({ kind: 'page', page: { status: 'paused' } });
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set status = 'live' where id = ${intro.id}`),
    );
    expect((await visitorRead(handle)).items.map((item) => item.kind)).toEqual(['page', 'link']);
  });

  it('puts a page made Public at the end once, as the profile always did, and never one archived', async () => {
    const ada = await person('Ada');
    await add(ada.scope, link('Site', 'https://ada.dev'));
    const intro = await page(ada.scope, 'Intro');
    const secret = await page(ada.scope, 'Secret', { isPrivate: true });
    const kinds = async () =>
      (await readProfileItems(ada.scope)).items.map((item) => (item.kind === 'page' ? item.pageId : item.kind));
    expect(await kinds()).toEqual(['link', intro.id]);
    await updateBookingPage(ada.scope, { pageId: secret.id, settings: { isPrivate: false } });
    expect(await kinds()).toEqual(['link', intro.id, secret.id]);
    // Archived on purpose, it stays off when the page goes Link only and Public again.
    const placed = (await readProfileItems(ada.scope)).items.find(
      (item) => item.kind === 'page' && item.pageId === secret.id,
    );
    await archiveProfileItem(ada.scope, { id: placed?.id ?? '', archived: true });
    await updateBookingPage(ada.scope, { pageId: secret.id, settings: { isPrivate: true } });
    await updateBookingPage(ada.scope, { pageId: secret.id, settings: { isPrivate: false } });
    expect(await kinds()).toEqual(['link', intro.id]);
    // An edit that leaves a Public page Public places nothing.
    const intros = (await readProfileItems(ada.scope)).items.find(
      (item) => item.kind === 'page' && item.pageId === intro.id,
    );
    await deleteProfileItem(ada.scope, intros?.id ?? '');
    await updateBookingPage(ada.scope, { pageId: intro.id, settings: { title: 'Intro, longer' } });
    expect(await kinds()).toEqual(['link']);
  });

  it('offers only the pages of the workspace they are in, without the ones placed (spec 0056, AC-5606)', async () => {
    const ada = await person('Ada', randomUUID(), 'Acme');
    const other = await person('Ada', ada.userId, 'Personal');
    const intro = await page(ada.scope, 'Intro');
    const coffee = await page(other.scope, 'Coffee');
    await page(ada.scope, 'Secret', { isPrivate: true });
    // Each joined its own workspace's link page as it was made: take Acme's off, so it is offered again.
    for (const item of (await readProfileItems(ada.scope)).items) await deleteProfileItem(ada.scope, item.id);
    const before = await listProfilePageChoices(ada.scope);
    // Acme's only: Personal's Coffee is never offered here, and the other workspace offers only its own.
    expect(before.map((choice) => choice.facts.title)).toEqual(['Intro']);
    expect((await listProfilePageChoices(other.scope)).map((choice) => choice.pageId)).toEqual([]);
    expect((await readProfileItems(other.scope)).items.map((item) => item.kind === 'page' && item.pageId)).toEqual([
      coffee.id,
    ]);
    await add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: intro.id });
    expect(await listProfilePageChoices(ada.scope)).toEqual([]);
  });

  it('refuses a booking page or form of another workspace, a deleted one and a guessed id, writing nothing (AC-5605)', async () => {
    const ada = await person('Ada', randomUUID(), 'Acme');
    const other = await person('Ada', ada.userId, 'Personal');
    const coffee = await page(other.scope, 'Coffee');
    const refused = { code: 'NOT_FOUND', message: 'That page isn’t in this workspace.' };
    // Named under either workspace, Personal's page can't go on Acme's link page.
    expect(
      await refusalOf(add(ada.scope, { kind: 'page', workspaceId: other.workspaceId, pageId: coffee.id })),
    ).toEqual(refused);
    expect(await refusalOf(add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: coffee.id }))).toEqual(
      refused,
    );
    expect(await refusalOf(add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: newId() }))).toEqual(
      refused,
    );
    expect(
      await refusalOf(add(ada.scope, { kind: 'form', workspaceId: ada.workspaceId, formId: newId(), label: 'Hello' })),
    ).toEqual(refused);
    // The definer refuses it too, past core: it reads the page through its workspace, never the item's say so.
    await expect(
      testQuery(appUrl, `select crm_save_profile_item($1, $2, $3, 'page', '{}', $4, null)`, [
        ada.userId,
        ada.workspaceId,
        newId(),
        coffee.id,
      ]),
    ).rejects.toThrow(/PROFILE_TARGET_MISSING/);
    // A workspace the owner isn't an active member of is refused whatever the block is.
    await expect(
      testQuery(appUrl, `select crm_save_profile_item($1, $2, $3, 'heading', '{"title":"Hi"}', null, null)`, [
        ada.userId,
        randomUUID(),
        newId(),
      ]),
    ).rejects.toThrow(/PROFILE_NOT_MEMBER/);
    // Nothing was written for Acme.
    expect((await readProfileItems(ada.scope)).items.filter((item) => item.kind === 'page')).toEqual([]);
  });

  it('keeps each workspace’s link page, order and limits its own', async () => {
    const ada = await person('Ada', randomUUID(), 'Acme');
    const other = await person('Ada', ada.userId, 'Personal');
    await add(ada.scope, link('Acme site', 'https://acme.dev'));
    await add(other.scope, link('Personal site', 'https://ada.dev'));
    await add(other.scope, { kind: 'heading', title: 'Sales' });
    // One heading per text is per page, so Acme may hold the same word.
    await add(ada.scope, { kind: 'heading', title: 'Sales' });
    expect((await readProfileItems(ada.scope)).items.map((item) => item.kind)).toEqual(['link', 'heading']);
    expect((await readProfileItems(other.scope)).items.map((item) => item.kind)).toEqual(['link', 'heading']);
    // An order from one page never names the other's blocks.
    const mine = (await readProfileItems(ada.scope)).items.map((item) => item.id);
    expect(await refusalOf(orderProfileItems(other.scope, mine))).toMatchObject({ code: 'CONFIG_INVALID' });
    // And the other workspace's block can't be reached by its id from here.
    const theirs = (await readProfileItems(other.scope)).items[0];
    expect(await refusalOf(deleteProfileItem(ada.scope, theirs?.id ?? ''))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never lets another person change or read a block by its id', async () => {
    const ada = await person('Ada');
    const bob = await person('Bob');
    const mine = await add(ada.scope, link('Mine', 'https://ada.dev'));
    expect(await refusalOf(add(bob.scope, link('Taken', 'https://bob.dev'), mine.id))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(deleteProfileItem(bob.scope, mine.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(archiveProfileItem(bob.scope, { id: mine.id, archived: true }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await readProfileItems(bob.scope)).items).toEqual([]);
    expect((await readProfileItems(ada.scope)).items).toEqual([
      expect.objectContaining({ id: mine.id, title: 'Mine' }),
    ]);
  });

  it('never lets a colleague place a page that isn’t theirs, even in the same workspace', async () => {
    const ada = await person('Ada');
    const intro = await page(ada.scope, 'Intro');
    const bobId = randomUUID();
    await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, 'Bob', $2)`, [
      bobId,
      `${bobId}@example.com`,
    ]);
    const bobMember = newId();
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${ada.workspaceId}, ${bobMember}, ${bobId}, 'Bob', ${`${bobId}@example.com`}, 'admin', 'system', 'system')`,
      ),
    );
    const bob = testScope({
      db,
      workspaceId: ada.workspaceId,
      actor: { type: 'member', id: bobMember },
      userId: bobId,
    });
    expect(await refusalOf(add(bob, { kind: 'page', workspaceId: ada.workspaceId, pageId: intro.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // Even a row written past the service shows Bob nothing of Ada's page, in his editor or on his public page.
    const bobHandle = fresh('bob');
    await updateMyMemberProfile(bob, { handle: bobHandle });
    await testQuery(
      ownerUrl,
      `insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id) values ($1, $2, 'page', 7, '{}', $3, $4)`,
      [newId(), bobId, ada.workspaceId, intro.id],
    );
    expect(
      (await readProfileItems(bob)).items.filter((item) => item.kind === 'page' && item.page !== undefined),
    ).toEqual([]);
    expect((await visitorRead(bobHandle)).items).toEqual([]);
  });

  it('refuses an edit of a block another tab deleted, rather than making it again', async () => {
    const ada = await person('Ada');
    const site = await add(ada.scope, link('Site', 'https://ada.dev'));
    await deleteProfileItem(ada.scope, site.id);
    expect(
      await refusalOf(
        saveProfileItem(ada.scope, { id: site.id, block: link('Site, renamed', 'https://ada.dev'), isEdit: true }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect((await readProfileItems(ada.scope)).items).toEqual([]);
  });

  it('stores what people type for a phone, an email and a spaced address, as the database accepts it', async () => {
    const ada = await person('Ada');
    expect(await add(ada.scope, link('Call me', '+44 20 7946 0958'))).toMatchObject({ url: 'tel:+442079460958' });
    expect(await add(ada.scope, link('Mail me', 'ada@ada.dev'))).toMatchObject({ url: 'mailto:ada@ada.dev' });
    expect(await add(ada.scope, link('Text me', 'sms:+1 555 0100?body=Hi there'))).toMatchObject({
      url: 'sms:+15550100?body=Hi%20there',
    });
    expect(await add(ada.scope, link('Page', 'https://example.com/my page'))).toMatchObject({
      url: 'https://example.com/my%20page',
    });
  });

  it('keeps one contact card, its empty fields left out, and shows a visitor its name and line only', async () => {
    const ada = await person('Ada');
    const handle = fresh('card');
    await updateMyMemberProfile(ada.scope, { handle });
    const card = await add(ada.scope, {
      kind: 'contact',
      fullName: ' Ada Lovelace ',
      jobTitle: 'Founder',
      company: 'Acme',
      email: 'ada@acme.dev',
      phone: '+44 20 7946 0958',
      website: 'acme.dev',
    });
    expect(card).toMatchObject({ kind: 'contact', fullName: 'Ada Lovelace', website: 'https://acme.dev' });
    expect(card).not.toHaveProperty('note');
    const second = await refusalOf(add(ada.scope, { kind: 'contact', fullName: 'Ada at home' }));
    expect(second).toEqual({ code: 'LIMIT_REACHED', message: 'A link page holds one contact card.' });
    const seen = await visitorRead(handle);
    expect(seen.items).toEqual([
      { kind: 'contact', id: card.id, fullName: 'Ada Lovelace', jobTitle: 'Founder', company: 'Acme' },
    ]);
    expect((await visitorRead(handle, { search: 'acme' })).items.map(titleOf)).toEqual(['Ada Lovelace']);
    // Archived, another may be made; the first then can't come back beside it.
    await archiveProfileItem(ada.scope, { id: card.id, archived: true });
    await add(ada.scope, { kind: 'contact', fullName: 'Ada at home' });
    const restore = await refusalOf(archiveProfileItem(ada.scope, { id: card.id, archived: false }));
    expect(restore?.code).toEqual('LIMIT_REACHED');
  });

  it('refuses a contact card the rule refuses, in core and in the database alike', async () => {
    const ada = await person('Ada');
    for (const [block, field] of [
      [{ kind: 'contact', fullName: '' }, 'fullName'],
      [{ kind: 'contact', fullName: 'Ada', email: 'ada at acme' }, 'email'],
      [{ kind: 'contact', fullName: 'Ada', phone: 'call me' }, 'phone'],
      [{ kind: 'contact', fullName: 'Ada', website: 'mailto:ada@acme.dev' }, 'website'],
    ] as const) {
      const refused = await refusalOf(add(ada.scope, block));
      expect(refused?.code, field).toEqual('CONFIG_INVALID');
    }
    // Past core's own check, the database's check refuses the same shapes.
    for (const given of [
      { fullName: '' },
      { fullName: 'Ada', email: 'ada at acme' },
      { fullName: 'Ada', phone: '12' },
      { fullName: 'Ada', website: 'javascript:alert(1)' },
      { fullName: 'Ada', colour: 'red' },
      { fullName: ' Ada' },
    ]) {
      await expect(
        testQuery(appUrl, `select crm_save_profile_item($1, $2, $3, 'contact', $4, null, null)`, [
          ada.userId,
          ada.workspaceId,
          newId(),
          JSON.stringify(given),
        ]),
        JSON.stringify(given),
      ).rejects.toThrow(/PROFILE_ITEM_DATA/);
    }
  });

  it('reads its figures over 30 days against the 30 before, and the cleanup sweeps them after a year', async () => {
    const ada = await person('Ada');
    const site = await add(ada.scope, link('Site', 'ada.dev'));
    const gone = await add(ada.scope, link('Gone', 'gone.dev'));
    const visitor = (n: number) => n.toString(16).padStart(32, '0');
    const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    // A visitor's row and the day's row, as crm_count_profile_view keeps them.
    const view = async (back: number, n: number, views = 1) => {
      await testQuery(
        ownerUrl,
        `insert into auth.profile_views (user_id, workspace_id, day, visitor, views) values ($1, $2, $3, $4, $5)`,
        [ada.userId, ada.workspaceId, day(back), visitor(n), views],
      );
      await testQuery(
        ownerUrl,
        `insert into auth.profile_view_days (user_id, workspace_id, day, views, visitors) values ($1, $2, $3, $4, 1)
         on conflict (user_id, workspace_id, day) do update set views = profile_view_days.views + excluded.views,
           visitors = profile_view_days.visitors + 1`,
        [ada.userId, ada.workspaceId, day(back), views],
      );
    };
    await view(0, 1, 3);
    await view(5, 2);
    await view(29, 3);
    await view(30, 4, 2);
    await view(59, 5);
    await view(400, 6);
    const handle = await handleOf(ada);
    await countItemPress({ db }, handle, site.id, visitor(7));
    await countItemPress({ db }, handle, site.id, visitor(7));
    await countItemPress({ db }, handle, gone.id, visitor(8));
    // The owner's own press, signed in, counts nothing.
    await countItemPress({ db }, handle, site.id, visitor(9), { signedInAs: ada.userId });
    await archiveProfileItem(ada.scope, { id: gone.id, archived: true });
    expect(await readProfileCounts(ada.scope)).toEqual({
      days: 30,
      views: 5,
      visitors: 3,
      before: { views: 3, visitors: 2 },
      presses: [{ id: site.id, presses: 2 }],
    });
    const swept = await testQuery<{ gone: number }>(appUrl, 'select crm_sweep_profile_counts(500) as gone');
    expect(Number(swept[0]?.gone)).toBeGreaterThanOrEqual(1);
    const left = await testQuery<{ day: string }>(
      ownerUrl,
      `select day::text as day from auth.profile_views where user_id = $1 order by day`,
      [ada.userId],
    );
    expect(left.map((row) => row.day)).not.toContain(day(400));
    expect(left).toHaveLength(5);
    const days = await testQuery<{ day: string }>(
      ownerUrl,
      `select day::text as day from auth.profile_view_days where user_id = $1`,
      [ada.userId],
    );
    expect(days.map((row) => row.day)).not.toContain(day(400));
    // The counters keep the day rows themselves: a real view adds to today's.
    await countProfileView({ db }, ada.userId, ada.workspaceId, visitor(1));
    await countProfileView({ db }, ada.userId, ada.workspaceId, visitor(99));
    expect((await readProfileCounts(ada.scope)).views).toBe(7);
    expect((await readProfileCounts(ada.scope)).visitors).toBe(4);
  });

  it('pages a visitor’s read at 20 with a cursor, and a search finds matches flat', async () => {
    const ada = await person('Ada');
    const handle = fresh('many');
    await updateMyMemberProfile(ada.scope, { handle });
    await add(ada.scope, { kind: 'heading', title: 'Links' });
    for (let n = 0; n < 21; n += 1) {
      await add(
        ada.scope,
        link(`Link ${String(n)}`, `https://ada.dev/${String(n)}`, n === 7 ? { note: 'The podcast' } : {}),
      );
    }
    const first = await visitorRead(handle);
    expect(first.items).toHaveLength(20);
    const [position, id] = (first.next ?? '').split('.');
    const rest = await visitorRead(handle, { after: { position: Number(position), id: id ?? '' } });
    expect(rest.items).toHaveLength(2);
    expect(rest.next).toBeUndefined();
    const found = await visitorRead(handle, { search: 'podcast' });
    expect(found.items.map(titleOf)).toEqual(['Link 7']);
    expect((await visitorRead(handle, { search: 'links' })).items).toEqual([]);
    expect(found.next).toBeUndefined();
  });

  it('skips a block whose stored fields no longer parse, in both reads', async () => {
    const ada = await person('Ada');
    const handle = fresh('later');
    await updateMyMemberProfile(ada.scope, { handle });
    await add(ada.scope, link('Site', 'https://ada.dev'));
    await testQuery(
      ownerUrl,
      `insert into auth.profile_items (id, user_id, workspace_id, kind, position, data) values ($1, $2, $3, 'contact', 5, '{"fullName":""}')`,
      [newId(), ada.userId, ada.workspaceId],
    );
    expect((await readProfileItems(ada.scope)).items.map((item) => item.kind)).toEqual(['link']);
    expect((await visitorRead(handle)).items.map((item) => item.kind)).toEqual(['link']);
  });

  it('is NOT_FOUND for a handle no one holds', async () => {
    expect(await refusalOf(enterLinkPage({ db }, fresh('nobody'), { max: 5 }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('every definer asks for an active member of the workspace (spec 0056, AC-5601, AC-5613)', () => {
  it('refuses a write, and answers nothing to a read, for a workspace the person is not in', async () => {
    const ada = await person('Ada');
    const mine = await add(ada.scope, link('Mine', 'https://ada.dev'));
    await add(ada.scope, { kind: 'heading', title: 'Hello' });
    const elsewhere = randomUUID();
    const user = ada.userId;
    const writes: readonly (readonly [string, readonly unknown[]])[] = [
      ['crm_save_public_profile($1, $2, $3, $4)', [user, elsewhere, fresh('nobody'), '']],
      [
        'crm_save_profile_item($1, $2, $3, $4, $5, null, null)',
        [user, elsewhere, newId(), 'link', '{"title":"x","url":"https://x.dev"}'],
      ],
      ['crm_order_profile_items($1, $2, $3::uuid[])', [user, elsewhere, `{${mine.id}}`]],
      ['crm_archive_profile_item($1, $2, $3, true)', [user, elsewhere, mine.id]],
      ['crm_delete_profile_item($1, $2, $3)', [user, elsewhere, mine.id]],
      [
        'crm_import_profile_links($1, $2, $3, $4, $5::jsonb, $6::jsonb)',
        [user, elsewhere, newId(), 'https://linktr.ee/x', '[]', '[]'],
      ],
      [
        'crm_save_profile_theme($1, $2, $3::jsonb)',
        [user, elsewhere, '{"ground":"plain","hue":"blue","mode":"light","shape":"soft","fill":"plain","font":"sans"}'],
      ],
      ['crm_save_profile_indexable($1, $2, $3)', [user, elsewhere, false]],
      // The share image moved onto the membership with the rest (spec 0055's picture, migration 0114).
      ['crm_save_profile_share_image($1, $2, null, null)', [user, elsewhere]],
      ['crm_place_profile_page($1, $2, $3)', [user, elsewhere, newId()]],
    ];
    for (const [call, args] of writes) {
      await expect(testQuery(appUrl, `select ${call}`, args), call).rejects.toThrow(/PROFILE_NOT_MEMBER/);
    }
    // The reads answer no row, whatever the id of the person's items.
    for (const call of [
      'crm_profile_items($1, $2)',
      'crm_profile_items_archived($1, $2)',
      'crm_profile_items_public($1, $2, 0::smallint, null::uuid, 50)',
      'crm_profile_share_image($1, $2)',
    ]) {
      expect(await testQuery(appUrl, `select * from ${call}`, [user, elsewhere]), call).toEqual([]);
    }
    // A person who is not the owner of this workspace's page reads nothing of it either.
    expect(await testQuery(appUrl, 'select * from crm_profile_items($1, $2)', [randomUUID(), ada.workspaceId])).toEqual(
      [],
    );
    // The page itself is untouched.
    expect((await readProfileItems(ada.scope)).items.map((item) => item.id)).toContain(mine.id);
  });
});
