// The link page's blocks (spec 0051, built as blocks), against the real Postgres: adding, editing, ordering,
// archiving and deleting through crm_handle's definers with the session's own id; the limits and the address rules;
// a booking page block shown only while the door lists its page; the public read a page at a time and its search;
// a kind this build doesn't know skipped; another person's id changing nothing; and the backfill of 0096.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import type { ProfileBlock } from '@crm/contracts';
import { enterLinkPage } from '../access/door.ts';
import { readLinkPage } from '../booking/public.ts';
import { createBookingPage } from '../booking/pages.ts';
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
    const intro = await page(ada.scope, 'Intro call');
    const site = await add(ada.scope, link('My site', 'www.timefix.com'));
    expect(site).toMatchObject({ kind: 'link', url: 'https://www.timefix.com' });
    expect(site.kind === 'link' && site.hue).toEqual(expect.stringMatching(/^[a-z]+$/));
    await add(ada.scope, { kind: 'heading', title: 'Meet me' });
    await add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: intro.id });
    await add(ada.scope, link('LinkedIn', 'https://www.linkedin.com/in/ada-lovelace', { note: 'Say hi' }));
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
        message: 'That address can’t be a link.',
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
    await add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: intro.id });
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

  it('offers the person’s Public pages from every workspace, without the ones placed', async () => {
    const ada = await person('Ada', randomUUID(), 'Acme');
    const other = await person('Ada', ada.userId, 'Personal');
    const intro = await page(ada.scope, 'Intro');
    const coffee = await page(other.scope, 'Coffee');
    await page(ada.scope, 'Secret', { isPrivate: true });
    const before = await listProfilePageChoices(ada.scope);
    expect(before.map((choice) => [choice.facts.workspaceName, choice.facts.title])).toEqual([
      ['Acme', 'Intro'],
      ['Personal', 'Coffee'],
    ]);
    // A page from the other workspace, placed from this one.
    await add(ada.scope, { kind: 'page', workspaceId: other.workspaceId, pageId: coffee.id });
    expect((await listProfilePageChoices(ada.scope)).map((choice) => choice.pageId)).toEqual([intro.id]);
    // Named under another workspace than its own, it is refused.
    expect(
      await refusalOf(add(ada.scope, { kind: 'page', workspaceId: ada.workspaceId, pageId: coffee.id })),
    ).toMatchObject({ code: 'NOT_FOUND' });
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
    expect(found.items.map((item) => item.title)).toEqual(['Link 7']);
    expect((await visitorRead(handle, { search: 'links' })).items).toEqual([]);
    expect(found.next).toBeUndefined();
  });

  it('skips a block of a kind this build doesn’t draw, in both reads', async () => {
    const ada = await person('Ada');
    const handle = fresh('later');
    await updateMyMemberProfile(ada.scope, { handle });
    await add(ada.scope, link('Site', 'https://ada.dev'));
    await testQuery(
      ownerUrl,
      `insert into auth.profile_items (id, user_id, kind, position, data) values ($1, $2, 'contact', 5, '{"fullName":"Ada"}')`,
      [newId(), ada.userId],
    );
    expect((await readProfileItems(ada.scope)).items.map((item) => item.kind)).toEqual(['link']);
    expect((await visitorRead(handle)).items.map((item) => item.kind)).toEqual(['link']);
  });

  it('is NOT_FOUND for a handle no one holds', async () => {
    expect(await refusalOf(enterLinkPage({ db }, fresh('nobody'), { max: 5 }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the backfill (migration 0096, AC-5129)', () => {
  /** The migration's backfill, run for one person only, as the owner (as the migration runs). */
  async function backfill(userId: string) {
    const text = readFileSync(new URL('../../../db/migrations/0096_profile_items.sql', import.meta.url), 'utf8');
    const from = text.lastIndexOf('set local row_security = off;');
    const to = text.indexOf('-- Refuse to finish unless the new functions');
    const statements = text
      .slice(from, to)
      .split('--> statement-breakpoint')
      .filter((each) => each.trim() !== '')
      .map((each) => each.replace('and p.owner_user_id is not null', `and p.owner_user_id = '${userId}'::uuid`));
    expect(statements).toHaveLength(3);
    await testQuery(ownerUrl, `begin;\n${statements.join(';\n')};\ncommit;`.replaceAll(';;', ';'));
  }

  it('turns one workspace’s profile into blocks: no section first, then each section as a heading', async () => {
    const ada = await person('Ada');
    const handle = fresh('backfill');
    await updateMyMemberProfile(ada.scope, { handle });
    await page(ada.scope, 'Pitch', { profilePosition: 0, profileSection: 'Sales' });
    await page(ada.scope, 'Coffee', { profilePosition: 1 });
    await page(ada.scope, 'Demo', { profilePosition: 2, profileSection: ' sales ' });
    await page(ada.scope, 'Paused', { profilePosition: 3, status: 'paused' });
    await page(ada.scope, 'Secret', { profilePosition: 4, isPrivate: true });
    await backfill(ada.userId);
    const { items } = await readProfileItems(ada.scope);
    expect(
      items.map((item) => (item.kind === 'page' ? item.page?.title : item.kind === 'heading' ? `# ${item.title}` : '')),
    ).toEqual(['Coffee', 'Paused', '# Sales', 'Pitch', 'Demo']);
    expect((await visitorRead(handle)).items.map((item) => item.title)).toEqual(['Coffee', 'Sales', 'Pitch', 'Demo']);
  });

  it('heads each workspace’s pages with no section with that workspace’s name', async () => {
    const ada = await person('Ada', randomUUID(), 'Acme');
    const other = await person('Ada', ada.userId, 'Personal');
    await page(ada.scope, 'Pitch', { profilePosition: 0, profileSection: 'Sales' });
    await page(other.scope, 'Coffee', { profilePosition: 1 });
    await page(ada.scope, 'Intro', { profilePosition: 2 });
    await backfill(ada.userId);
    const { items } = await readProfileItems(ada.scope);
    expect(
      items.map((item) => (item.kind === 'page' ? item.page?.title : item.kind === 'heading' ? `# ${item.title}` : '')),
    ).toEqual(['# Personal', 'Coffee', '# Acme', 'Intro', '# Sales', 'Pitch']);
  });
});
