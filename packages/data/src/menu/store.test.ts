// The Menu store (spec 0065, H1) against a fake API answered by hand: an edit shows at once and counts a change, the
// server's draft replaces it, a refusal puts it back and comes back to the screen, and Sold out never counts a change.
import type { MenuDraft } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { openMenus, type MenuProcedures } from './store.ts';

const MENU = '01900000-0000-7000-8000-000000000001';
const SECTION = '01900000-0000-7000-8000-000000000002';
const ITEM = '01900000-0000-7000-8000-000000000003';
const DRAFT: MenuDraft = {
  currency: 'GBP',
  places: [],
  menus: [{ id: MENU, name: 'Dinner', placeIds: [], position: 0, taxRate: 0, serviceRate: 0 }],
  sections: [{ id: SECTION, menuId: MENU, name: 'Mains', layout: 'list', position: 0, itemIds: [ITEM] }],
  items: [
    {
      id: ITEM,
      name: 'Soup',
      priceMinor: 650,
      diet: [],
      allergens: [],
      featured: false,
      soldOut: false,
      sizes: [],
      groupIds: [],
    },
  ],
  groups: [],
  changes: 0,
  photos: 0,
  canEdit: true,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setUp(overrides: Partial<MenuProcedures>) {
  const notUsed = () => Promise.reject(new Error('Not used here.'));
  const api = new Proxy({} as MenuProcedures, {
    get: (_target, name: string) => (overrides as Record<string, unknown>)[name] ?? notUsed,
  });
  let id = 0;
  return openMenus({
    api,
    call: (run) => run({}),
    mintId: () => `id-${String((id += 1))}`,
    sendPhoto: () => Promise.reject(new Error('Not used here.')),
  });
}

const item = {
  name: 'Soup',
  priceMinor: 700,
  diet: [],
  allergens: [],
  kcal: null,
  featured: false,
  sizes: [],
  groupIds: [],
};

describe('the Menu store', () => {
  it('shows an edit at once with one more change, then takes the server’s draft', async () => {
    const answer = deferred<MenuDraft>();
    const store = setUp({ draft: () => Promise.resolve(DRAFT), saveItem: () => answer.promise });
    await store.readDraft('w');
    const saving = store.saveItem('w', ITEM, item);
    const shown = store.draft('w').getSnapshot();
    expect(shown.status === 'ready' && shown.value.items[0]?.priceMinor).toBe(700);
    expect(shown.status === 'ready' && shown.value.changes).toBe(1);
    answer.resolve({
      ...DRAFT,
      items: [{ ...DRAFT.items[0], priceMinor: 700 } as MenuDraft['items'][number]],
      changes: 1,
    });
    expect(await saving).toBeUndefined();
  });

  it('puts the copy back on a refusal and hands the refusal to the screen', async () => {
    const store = setUp({
      draft: () => Promise.resolve(DRAFT),
      saveItem: () => Promise.reject(Object.assign(new Error('Refused'), { code: 'NOT_FOUND', status: 404 })),
    });
    await store.readDraft('w');
    const refused = await store.saveItem('w', 'new-item', item, SECTION);
    expect(refused?.code).toBe('NOT_FOUND');
    const shown = store.draft('w').getSnapshot();
    expect(shown.status === 'ready' && shown.value.items.map((each) => each.id)).toEqual([ITEM]);
    expect(shown.status === 'ready' && shown.value.sections[0]?.itemIds).toEqual([ITEM]);
  });

  it('flips Sold out at once without counting a change (AC-6526)', async () => {
    const answer = deferred<MenuDraft>();
    const store = setUp({ draft: () => Promise.resolve(DRAFT), setSoldOut: () => answer.promise });
    await store.readDraft('w');
    void store.setSoldOut('w', ITEM, true);
    const shown = store.draft('w').getSnapshot();
    expect(shown.status === 'ready' && [shown.value.items[0]?.soldOut, shown.value.changes]).toEqual([true, 0]);
    answer.resolve(DRAFT);
  });

  it('places an item in a second section, and reorders within one', async () => {
    const store = setUp({
      draft: () => Promise.resolve(DRAFT),
      placeItem: () => new Promise(() => undefined),
    });
    await store.readDraft('w');
    void store.placeItem('w', ITEM, SECTION, false);
    const shown = store.draft('w').getSnapshot();
    expect(shown.status === 'ready' && shown.value.sections[0]?.itemIds).toEqual([]);
  });
});
