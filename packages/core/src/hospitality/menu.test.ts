// The Menu app (spec 0065, H1) against the real Postgres as the app role: edits save into the draft and the guest page
// reads only what Publish froze (AC-6525), Sold out is live over it (AC-6526), one item placed in two menus changes
// everywhere (AC-6524), sizes and shared option groups (AC-6523), one level of sub sections (AC-6521), Discard goes
// back to the last Publish, the limits refuse clearly, the gate refuses with Menu removed (AC-6504), and a menu key
// never reads another workspace.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type FirstBusiness, type ItemFields } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { setEarlyAccess } from '../operator/early-access.ts';
import { testScope } from '../testing.ts';
import { installApp, removeApp } from './apps.ts';
import {
  deleteItem,
  discardMenuDraft,
  placeItem,
  publishMenus,
  readMenuDraft,
  saveItem,
  saveMenu,
  saveOptionGroup,
  saveSection,
  setItemSoldOut,
} from './menu.ts';
import { enterMenuPage, readPublicMenu } from './public-menu.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-menu-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

const CARD: FirstBusiness = {
  name: 'Somewhere Nowhere',
  kind: 'restaurant',
  place: { country: 'GB', timeZone: 'Europe/London', city: 'London' },
  currency: 'GBP',
};

/** A workspace with Menu installed, its owner's scope and a plain member's, and its first place. */
async function menuWorkspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `menu-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  await setEarlyAccess({ db }, { workspaceId: created.workspaceId, flag: 'business_apps', on: true });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const member = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: memberId },
    role: 'member',
  });
  await installApp(owner, { app: 'menu', business: CARD });
  const draft = await readMenuDraft(owner);
  const place = draft.places[0];
  if (place === undefined) throw new Error('No place.');
  return { ...created, owner, member, place };
}

async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isInputError(error)) return 'INPUT_INVALID';
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

const dish = (name: string, priceMinor: number | null, extra: Partial<ItemFields> = {}): ItemFields => ({
  name,
  priceMinor,
  diet: [],
  allergens: [],
  kcal: null,
  featured: false,
  sizes: [],
  groupIds: [],
  ...extra,
});

/** A menu at the place with one section, answering their ids. */
async function dinner(w: Awaited<ReturnType<typeof menuWorkspace>>, name = 'Dinner') {
  const menuId = newId();
  const sectionId = newId();
  await saveMenu(w.owner, { id: menuId, name, placeIds: [w.place.id] });
  await saveSection(w.owner, { id: sectionId, menuId, name: 'Mains', layout: 'list' });
  return { menuId, sectionId };
}

/** The guest page's answer for the workspace's place, through the public door. */
async function guestMenu(key: string) {
  const entry = await enterMenuPage({ db }, key);
  return entry === undefined ? undefined : readPublicMenu({ db }, entry);
}

describe('the draft and Publish (AC-6525)', () => {
  it('keeps edits in the draft until Publish, counting them; guests see only what Publish froze', async () => {
    const w = await menuWorkspace();
    const { sectionId } = await dinner(w);
    const itemId = newId();
    let draft = await saveItem(w.owner, { id: itemId, sectionId, item: dish('Soup', 650) });
    expect(draft.changes).toBe(3);
    expect(draft.sections[0]?.itemIds).toEqual([itemId]);
    // Nothing published yet: the guest page has nothing to show.
    expect(await guestMenu(w.place.menuKey)).toBeUndefined();
    draft = await publishMenus(w.owner).then((done) => done.draft);
    expect(draft.changes).toBe(0);
    const first = await guestMenu(w.place.menuKey);
    expect(first?.menu.menu.items[itemId]?.priceMinor).toBe(650);
    expect(first?.menu.menu.currency).toBe('GBP');
    expect(first?.menu.business.name).toBe('Somewhere Nowhere');
    // A price change waits in the draft: guests still see the old one.
    await saveItem(w.owner, { id: itemId, item: dish('Soup', 700) });
    expect((await guestMenu(w.place.menuKey))?.menu.menu.items[itemId]?.priceMinor).toBe(650);
    await publishMenus(w.owner);
    const second = await guestMenu(w.place.menuKey);
    expect(second?.menu.menu.items[itemId]?.priceMinor).toBe(700);
    expect(second?.menu.version).toBe(2);
  });

  it('Discard goes back to the last Publish, and refuses before the first', async () => {
    const w = await menuWorkspace();
    const { sectionId } = await dinner(w);
    expect(await refusalOf(discardMenuDraft(w.owner))).toBe('CONFLICT');
    const itemId = newId();
    await saveItem(w.owner, { id: itemId, sectionId, item: dish('Soup', 650) });
    await publishMenus(w.owner);
    await saveItem(w.owner, { id: itemId, item: dish('Broth', 900) });
    await saveItem(w.owner, { id: newId(), sectionId, item: dish('Bread', 300) });
    await setItemSoldOut(w.owner, { itemId, soldOut: true });
    const { draft } = await discardMenuDraft(w.owner);
    expect(draft.changes).toBe(0);
    expect(draft.items.map((item) => [item.name, item.priceMinor, item.soldOut])).toEqual([['Soup', 650, true]]);
    expect(draft.sections[0]?.itemIds).toEqual([itemId]);
  });
});

describe('Sold out is live (AC-6526)', () => {
  it('shows on the guest page without Publish, and Run service alone may flip it', async () => {
    const w = await menuWorkspace();
    const { sectionId } = await dinner(w);
    const itemId = newId();
    await saveItem(w.owner, { id: itemId, sectionId, item: dish('Soup', 650) });
    await publishMenus(w.owner);
    const { draft, placeIds } = await setItemSoldOut(w.owner, { itemId, soldOut: true });
    expect(draft.changes).toBe(0);
    expect(placeIds).toEqual([w.place.id]);
    expect((await guestMenu(w.place.menuKey))?.menu.soldOut).toEqual([itemId]);
    // A plain member holds neither power.
    expect(await refusalOf(setItemSoldOut(w.member, { itemId, soldOut: false }))).toBe('FORBIDDEN');
    const back = await setItemSoldOut(w.owner, { itemId, soldOut: false });
    expect(back.draft.items[0]?.soldOut).toBe(false);
    expect((await guestMenu(w.place.menuKey))?.menu.soldOut).toEqual([]);
  });
});

describe('items placed, not copied (AC-6524), sizes and shared groups (AC-6523)', () => {
  it('one item in Dinner and Drinks: a rename shows in both, and one entry in the snapshot', async () => {
    const w = await menuWorkspace();
    const a = await dinner(w, 'Dinner');
    const b = await dinner(w, 'Drinks');
    const itemId = newId();
    await saveItem(w.owner, { id: itemId, sectionId: a.sectionId, item: dish('Spritz', 900) });
    await placeItem(w.owner, { itemId, sectionId: b.sectionId, placed: true });
    await saveItem(w.owner, { id: itemId, item: dish('Aperol spritz', 950) });
    await publishMenus(w.owner);
    const read = await guestMenu(w.place.menuKey);
    expect(read?.menu.menu.menus.map((menu) => menu.sections[0]?.itemIds)).toEqual([[itemId], [itemId]]);
    expect(Object.values(read?.menu.menu.items ?? {}).map((item) => item.name)).toEqual(['Aperol spritz']);
    await deleteItem(w.owner, { itemId });
    const draft = await readMenuDraft(w.owner);
    expect(draft.sections.flatMap((section) => section.itemIds)).toEqual([]);
  });

  it('prices each size, shares a group between items, and puts only used groups in the snapshot', async () => {
    const w = await menuWorkspace();
    const { sectionId } = await dinner(w);
    const milk = newId();
    const unused = newId();
    await saveOptionGroup(w.owner, {
      id: milk,
      name: 'Milk',
      rule: 'one',
      options: [
        { name: 'Whole', priceDeltaMinor: 0 },
        { name: 'Oat', priceDeltaMinor: 50 },
      ],
    });
    await saveOptionGroup(w.owner, {
      id: unused,
      name: 'Sauce',
      rule: 'any',
      options: [{ name: 'Ketchup', priceDeltaMinor: 0 }],
    });
    const latte = newId();
    const flat = newId();
    await saveItem(w.owner, {
      id: latte,
      sectionId,
      item: dish('Latte', null, {
        sizes: [
          { name: 'Small', priceMinor: 350 },
          { name: 'Large', priceMinor: 420 },
        ],
        groupIds: [milk],
      }),
    });
    await saveItem(w.owner, { id: flat, sectionId, item: dish('Flat white', 380, { groupIds: [milk] }) });
    await publishMenus(w.owner);
    const read = await guestMenu(w.place.menuKey);
    expect(read?.menu.menu.items[latte]?.sizes).toEqual([
      { name: 'Small', priceMinor: 350 },
      { name: 'Large', priceMinor: 420 },
    ]);
    expect(read?.menu.menu.items[latte]?.priceMinor).toBeUndefined();
    expect(Object.keys(read?.menu.menu.groups ?? {})).toEqual([milk]);
    expect(read?.menu.menu.groups[milk]?.options.map((option) => option.priceDeltaMinor)).toEqual([0, 50]);
    expect(await refusalOf(saveItem(w.owner, { id: newId(), item: dish('Tea', 300, { groupIds: [newId()] }) }))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('sections one level deep (AC-6521)', () => {
  it('nests Red under Wines, and never deeper', async () => {
    const w = await menuWorkspace();
    const menuId = newId();
    await saveMenu(w.owner, { id: menuId, name: 'Drinks', placeIds: [w.place.id] });
    const wines = newId();
    const red = newId();
    await saveSection(w.owner, { id: wines, menuId, name: 'Wines', layout: 'list' });
    await saveSection(w.owner, { id: red, menuId, parentId: wines, name: 'Red', layout: 'list' });
    await saveItem(w.owner, { id: newId(), sectionId: red, item: dish('Rioja', 900) });
    expect(
      await refusalOf(saveSection(w.owner, { id: newId(), menuId, parentId: red, name: 'Rioja', layout: 'list' })),
    ).toBe('CONFIG_INVALID');
    await publishMenus(w.owner);
    const read = await guestMenu(w.place.menuKey);
    expect(
      read?.menu.menu.menus[0]?.sections.map((section) => [section.name, section.sections.map((sub) => sub.name)]),
    ).toEqual([['Wines', ['Red']]]);
  });
});

describe('limits and the gate', () => {
  it('refuses to publish a menu shown at no place, naming it, and keeps the rates and per day serving', async () => {
    const w = await menuWorkspace();
    const menuId = newId();
    const sectionId = newId();
    await saveMenu(w.owner, { id: menuId, name: 'Brunch', placeIds: [] });
    await saveSection(w.owner, { id: sectionId, menuId, name: 'Eggs', layout: 'list' });
    await saveItem(w.owner, { id: newId(), sectionId, item: dish('Benedict', 1200) });
    expect(await refusalOf(publishMenus(w.owner))).toBe('CONFIG_INVALID');
    const serving = { weekly: { sat: [{ from: '10:00', to: '15:00' }], sun: [] } };
    await saveMenu(w.owner, {
      id: menuId,
      name: 'Brunch',
      placeIds: [w.place.id],
      serving,
      taxRate: 500,
      serviceRate: 1250,
    });
    await publishMenus(w.owner);
    const live = await guestMenu(w.place.menuKey);
    const brunch = live?.menu.menu.menus[0];
    expect(brunch?.serving).toEqual(serving);
    expect([brunch?.taxRate, brunch?.serviceRate]).toEqual([500, 1250]);
    // Rates left out of a later save keep what is there.
    await saveMenu(w.owner, { id: menuId, name: 'Brunch!', placeIds: [w.place.id] });
    const draft = await readMenuDraft(w.owner);
    expect(draft.menus[0]?.taxRate).toBe(500);
  });

  it('refuses the 31st menu', async () => {
    const w = await menuWorkspace();
    for (let index = 0; index < 30; index += 1) {
      await saveMenu(w.owner, { id: newId(), name: `Menu ${String(index)}`, placeIds: [] });
    }
    expect(await refusalOf(saveMenu(w.owner, { id: newId(), name: 'One more', placeIds: [] }))).toBe('LIMIT_REACHED');
  });

  it('refuses a plain member, and everything once Menu is removed; the guest page goes too (AC-6504)', async () => {
    const w = await menuWorkspace();
    const { sectionId } = await dinner(w);
    // Publish refuses a menu it would show broken: nothing placed, or a dish with no price or price note.
    expect(await refusalOf(publishMenus(w.owner))).toBe('CONFIG_INVALID');
    await saveItem(w.owner, { id: newId(), sectionId, item: dish('Oysters', null) });
    expect(await refusalOf(publishMenus(w.owner))).toBe('CONFIG_INVALID');
    const draft = await readMenuDraft(w.owner);
    const oysters = draft.items.find((item) => item.name === 'Oysters');
    if (oysters === undefined) throw new Error('No oysters.');
    await saveItem(w.owner, { id: oysters.id, item: dish('Oysters', null, { priceNote: 'Market price' }) });
    await publishMenus(w.owner);
    expect(await refusalOf(readMenuDraft(w.member))).toBe('FORBIDDEN');
    expect(await refusalOf(saveMenu(w.member, { id: newId(), name: 'X', placeIds: [] }))).toBe('FORBIDDEN');
    expect(PERMISSIONS['hospitality.manage'].message).toBeTruthy();
    expect(await guestMenu(w.place.menuKey)).toBeDefined();
    await removeApp(w.owner, { app: 'menu' });
    expect(await refusalOf(readMenuDraft(w.owner))).toBe('APP_NOT_INSTALLED');
    expect(await guestMenu(w.place.menuKey)).toBeUndefined();
  });

  it('never reads another workspace’s place by a key, and refuses a place of another workspace', async () => {
    const a = await menuWorkspace();
    const b = await menuWorkspace();
    expect(await refusalOf(saveMenu(a.owner, { id: newId(), name: 'X', placeIds: [b.place.id] }))).toBe('NOT_FOUND');
    const entry = await enterMenuPage({ db }, b.place.menuKey);
    expect(entry?.workspaceId).toBe(b.workspaceId);
    expect(await enterMenuPage({ db }, 'not-a-key')).toBeUndefined();
  });
});
