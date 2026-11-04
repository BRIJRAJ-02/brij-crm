// The link page's Menu and Reserve blocks (spec 0065, AC-6528) against the real Postgres as the app role: a block
// names one of its own workspace's places; it waits for Publish like every block; a visitor sees a Menu block's first
// dishes from the published menu (never the draft) and a Reserve block only while the place takes reservations
// online; a hidden menu, a removed app or a place from another workspace shows nothing; the database's own check
// refuses a malformed block and the fourth of a kind.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FirstBusiness, ProfileBlock } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterLinkPage } from '../access/door.ts';
import { readLinkPage } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { installApp, removeApp } from '../hospitality/apps.ts';
import { publishMenus, saveItem, saveMenu, saveSection, setMenuHidden } from '../hospitality/menu.ts';
import { getBusiness } from '../hospitality/places.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { setEarlyAccess } from '../operator/early-access.ts';
import { testScope } from '../testing.ts';
import { getTableSetup, saveTableSetup } from '../visits/table-service.ts';
import { readProfileItems, saveProfileItem } from './items.ts';
import { publishLinkPage } from './link-publish.ts';
import { listPlaceChoices } from './place-blocks.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-place-block-tests' });
});
afterAll(async () => {
  await db.close();
});

const CARD: FirstBusiness = {
  name: 'Somewhere',
  kind: 'restaurant',
  place: { country: 'GB', timeZone: 'Europe/London', city: 'London', addressLine: '1 Example Street' },
  currency: 'GBP',
};

let count = 0;

/** "Somewhere": its owner with a link page, Menu and Table seating installed, a published menu of four dishes. */
async function somewhere(options: { readonly withMenu?: boolean } = {}) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, 'Ada', $2)`, [
    userId,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `place-blocks-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = `somewhere-${randomUUID().slice(0, 8)}`;
  await updateMyMemberProfile(scope, { handle });
  await setEarlyAccess({ db }, { workspaceId: created.workspaceId, flag: 'business_apps', on: true });
  await installApp(scope, { app: 'menu', business: CARD });
  const placeId = (await getBusiness(scope)).places[0]?.id ?? '';
  if (options.withMenu !== false) {
    const menuId = newId();
    const sectionId = newId();
    await saveMenu(scope, { id: menuId, name: 'Dinner', placeIds: [placeId] });
    await saveSection(scope, { id: sectionId, menuId, name: 'Mains', layout: 'list' });
    for (const [name, priceMinor] of [
      ['Soup', 650],
      ['Risotto', 1450],
      ['Tart', 700],
      ['Cheese', 900],
    ] as const) {
      await saveItem(scope, {
        id: newId(),
        sectionId,
        item: { name, priceMinor, diet: [], allergens: [], kcal: null, featured: false, sizes: [], groupIds: [] },
      });
    }
    await publishMenus(scope);
  }
  return { ...created, userId, scope, handle, placeId };
}

/** Table seating installed and the place taking reservations online: hours all week and one table. */
async function takeReservations(w: Awaited<ReturnType<typeof somewhere>>) {
  await installApp(w.scope, { app: 'table_seating' });
  const week = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [{ from: '12:00', to: '23:00' }]]),
  );
  await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute(
      sql`update places set hours = ${JSON.stringify({ weekly: week, exceptions: [] })}::jsonb where id = ${w.placeId}::uuid`,
    ),
  );
  await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute(sql`insert into resources (workspace_id, place_id, kind, label, min_capacity, max_capacity, position)
      values (${w.workspaceId}, ${w.placeId}, 'table', 'T1', 1, 8, 0)`),
  );
  const setup = await getTableSetup(w.scope, { placeId: w.placeId });
  await saveTableSetup(w.scope, { placeId: w.placeId, rules: { ...setup.rules, online: true } });
}

/** What a visitor sees of the page's Menu and Reserve blocks. */
async function guest(handle: string) {
  const page = await readLinkPage(await enterLinkPage({ db }, handle, { max: 21 }));
  return page.items.filter((item) => item.kind === 'menu' || item.kind === 'reserve');
}

async function refusalOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (isInputError(error)) return 'INPUT_INVALID';
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
  throw new Error('It was let through.');
}

const menuBlock = (placeId: string, label?: string): ProfileBlock => ({
  kind: 'menu',
  placeId,
  ...(label === undefined ? {} : { label }),
});

describe('a Menu block (spec 0065, AC-6528)', () => {
  it('waits for Publish, then shows the first three dishes of the published menu and opens /m/<key>', async () => {
    const w = await somewhere();
    await saveProfileItem(w.scope, { id: newId(), block: menuBlock(w.placeId) });
    expect(await guest(w.handle)).toEqual([]);
    await publishLinkPage(w.scope);
    const [shown] = await guest(w.handle);
    expect(shown).toMatchObject({
      kind: 'menu',
      title: 'Our menu',
      dishes: [
        { name: 'Soup', price: '£6.50' },
        { name: 'Risotto', price: '£14.50' },
        { name: 'Tart', price: '£7.00' },
      ],
    });
    expect(shown?.kind === 'menu' ? shown.path : '').toMatch(/^\/m\/[A-Za-z0-9_-]{16}$/);
    // No place id, workspace id or anything else of the business in the answer.
    expect(JSON.stringify(shown)).not.toContain(w.placeId);
    expect(JSON.stringify(shown)).not.toContain(w.workspaceId);
  });

  it('reads only what was published: a draft dish waits, a hidden menu or a removed app hides the block', async () => {
    const w = await somewhere();
    await saveProfileItem(w.scope, { id: newId(), block: menuBlock(w.placeId, 'See what we cook') });
    await publishLinkPage(w.scope);
    const before = await guest(w.handle);
    expect(before[0]).toMatchObject({ title: 'See what we cook' });
    await setMenuHidden(w.scope, { hidden: true });
    expect(await guest(w.handle)).toEqual([]);
    const items = await readProfileItems(w.scope);
    expect(items.items[0]).toMatchObject({ kind: 'menu', place: { status: 'paused', reason: 'hidden' } });
    await setMenuHidden(w.scope, { hidden: false });
    expect(await guest(w.handle)).toHaveLength(1);
    await removeApp(w.scope, { app: 'menu', withDependents: true });
    expect(await guest(w.handle)).toEqual([]);
    expect((await readProfileItems(w.scope)).items[0]).toMatchObject({ place: { status: 'paused', reason: 'app' } });
  });

  it('shows nothing before the menu’s first Publish, and says so in the editor', async () => {
    const w = await somewhere({ withMenu: false });
    await saveProfileItem(w.scope, { id: newId(), block: menuBlock(w.placeId) });
    await publishLinkPage(w.scope);
    expect(await guest(w.handle)).toEqual([]);
    expect((await readProfileItems(w.scope)).items[0]).toMatchObject({
      place: { status: 'paused', reason: 'unpublished' },
    });
  });
});

describe('a Reserve block (spec 0065, AC-6528)', () => {
  it('shows only while the place takes reservations online, and opens /r/<key>', async () => {
    const w = await somewhere();
    await saveProfileItem(w.scope, { id: newId(), block: { kind: 'reserve', placeId: w.placeId } });
    await publishLinkPage(w.scope);
    // Table seating isn't installed yet: nothing.
    expect(await guest(w.handle)).toEqual([]);
    await takeReservations(w);
    const [shown] = await guest(w.handle);
    expect(shown).toMatchObject({ kind: 'reserve', title: 'Reserve a table' });
    expect(shown?.kind === 'reserve' ? shown.path : '').toMatch(/^\/r\/[A-Za-z0-9_-]{16}$/);
    const setup = await getTableSetup(w.scope, { placeId: w.placeId });
    await saveTableSetup(w.scope, { placeId: w.placeId, rules: { ...setup.rules, online: false } });
    expect(await guest(w.handle)).toEqual([]);
    expect((await readProfileItems(w.scope)).items[0]).toMatchObject({ place: { reason: 'offline' } });
  });
});

describe('the places a block may name', () => {
  it('lists this workspace’s places with each kind’s facts, and none without the apps', async () => {
    const w = await somewhere();
    expect(await listPlaceChoices(w.scope)).toEqual([
      {
        placeId: w.placeId,
        menu: { name: expect.any(String) as string, status: 'live', path: expect.stringMatching(/^\/m\//) as string },
      },
    ]);
    await removeApp(w.scope, { app: 'menu', withDependents: true });
    expect(await listPlaceChoices(w.scope)).toEqual([]);
  });

  it('refuses another workspace’s place on save, and a stray one never shows', async () => {
    const a = await somewhere();
    const b = await somewhere();
    expect(await refusalOf(saveProfileItem(b.scope, { id: newId(), block: menuBlock(a.placeId) }))).toBe('NOT_FOUND');
    // Written past the core check, straight through the definer, the block saves but shows nothing: the place is read
    // under b's row level security.
    await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute(
        sql`select id from crm_save_profile_item(${b.userId}::uuid, ${b.workspaceId}::uuid, ${newId()}::uuid, 'menu', ${JSON.stringify({ placeId: a.placeId })}::jsonb, null::uuid, null::uuid)`,
      ),
    );
    await publishLinkPage(b.scope);
    expect(await guest(b.handle)).toEqual([]);
  });

  it('the database refuses a malformed block, a workspace or page column, and a fourth of a kind', async () => {
    const w = await somewhere();
    const save = (data: unknown, page: string | null = null) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(
          sql`select id from crm_save_profile_item(${w.userId}::uuid, ${w.workspaceId}::uuid, ${newId()}::uuid, 'menu', ${JSON.stringify(data)}::jsonb, ${page}::uuid, null::uuid)`,
        ),
      );
    const codeOf = async (call: Promise<unknown>) => {
      try {
        await call;
        return 'saved';
      } catch (error) {
        const cause = (error as { cause?: { message?: string } }).cause;
        return cause?.message ?? (error as Error).message;
      }
    };
    expect(await codeOf(save({ placeId: 'nope' }))).toContain('PROFILE_ITEM_DATA');
    expect(await codeOf(save({}))).toContain('PROFILE_ITEM_DATA');
    expect(await codeOf(save({ placeId: w.placeId, url: 'https://evil.example' }))).toContain('PROFILE_ITEM_DATA');
    expect(await codeOf(save({ placeId: w.placeId, label: ' padded ' }))).toContain('PROFILE_ITEM_DATA');
    expect(await codeOf(save({ placeId: w.placeId, size: 'wide' }))).toContain('PROFILE_ITEM_DATA');
    expect(await codeOf(save({ placeId: w.placeId }, w.placeId))).toContain('PROFILE_ITEM_DATA');
    for (let made = 0; made < 3; made += 1) expect(await codeOf(save({ placeId: w.placeId }))).toBe('saved');
    expect(await codeOf(save({ placeId: w.placeId }))).toContain('PROFILE_ITEM_LIMIT');
    expect(await refusalOf(saveProfileItem(w.scope, { id: newId(), block: menuBlock(w.placeId) }))).toBe(
      'LIMIT_REACHED',
    );
  });
});
