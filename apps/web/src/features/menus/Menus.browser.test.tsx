// The Menu app in Chromium (spec 0065, H1): the Menus editor over a fake store (the setup checklist before the first
// Publish, a section's dishes with Sold out, Publish refused with the dish named, the phone preview drawing the
// draft), and the guest menu (MenuList in the Warm look) with a dish's sheet open, a proper dialog closed by Escape.
// axe is clean in light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set, each is photographed.
import '@crm/ui/app.css';
import type {
  DataError,
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  ItemFields,
  MenuDraft,
  MenuStore,
  PublicMenu,
} from '@crm/data';
import { MENU_LOOK_PROPERTIES, WARM_PRESET } from '@crm/data/menu';
import { BookingFoot, MenuList } from '@crm/ui/public-menu';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { MenusScreen } from './MenusScreen.tsx';
import { previewMenu } from './preview.ts';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;

/** A stand in photo per dish: a warm gradient drawn as SVG, so the shots prove the photo rows and grid. */
const PHOTO_HUES = ['#d9a26b', '#8fae6b', '#c9704f', '#b89a7a', '#7f9fb0'];
const photoHref = (photoId: string) => {
  const hue = PHOTO_HUES[Number.parseInt(photoId.slice(-2), 16) % PHOTO_HUES.length] ?? '#d9a26b';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff6e8"/><stop offset="1" stop-color="${hue}"/></radialGradient></defs><rect width="400" height="400" fill="#efe7dc"/><circle cx="200" cy="210" r="130" fill="url(#g)"/><ellipse cx="200" cy="300" rx="150" ry="28" fill="#00000014"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PLACE = id(1);
const MENU = id(2);
const STARTERS = id(3);
const MAINS = id(4);

const item = (
  n: number,
  name: string,
  extra: Partial<MenuDraft['items'][number]> = {},
): MenuDraft['items'][number] => ({
  id: id(n),
  name,
  diet: [],
  allergens: [],
  featured: false,
  soldOut: false,
  sizes: [],
  groupIds: [],
  ...extra,
});

const DRAFT: MenuDraft = {
  currency: 'GBP',
  look: { preset: 'warm', heading: 'device', body: 'device', radius: 'soft' },
  lookAccents: {},
  places: [{ id: PLACE, name: 'Soho', menuKey: 'AbCdEfGhIjKlMnOp', timeZone: 'Europe/London', locale: 'en-GB' }],
  menus: [
    {
      id: MENU,
      name: 'Dinner',
      placeIds: [PLACE],
      position: 0,
      taxRate: 0,
      serviceRate: 1250,
      note: 'Prices include VAT. 12.5% service is added.',
    },
  ],
  sections: [
    {
      id: STARTERS,
      menuId: MENU,
      name: 'Small plates',
      layout: 'list',
      position: 0,
      itemIds: [id(10), id(11), id(12)],
    },
    { id: MAINS, menuId: MENU, name: 'Mains', layout: 'grid', position: 1, itemIds: [id(13), id(14), id(15)] },
  ],
  items: [
    item(10, 'Burrata, blood orange, chilli', {
      description: 'Puglian burrata with blood orange, Calabrian chilli oil and basil.',
      priceMinor: 1150,
      diet: ['vegetarian'],
      allergens: [{ code: 'milk', level: 'contains' }],
      featured: true,
      photo: { id: id(50), version: '0123456789ab' },
    }),
    item(11, 'Charred hispi cabbage', {
      description: 'Miso butter, crispy shallots.',
      priceMinor: 900,
      diet: ['vegan', 'gluten_free'],
      allergens: [{ code: 'soya', level: 'contains' }],
      photo: { id: id(51), version: '0123456789ab' },
    }),
    item(12, 'Oysters', {
      priceNote: 'Market price',
      soldOut: true,
      allergens: [{ code: 'molluscs', level: 'contains' }],
    }),
    item(13, 'Wood fired bream', {
      description: 'Salsa verde, charred lemon, new potatoes.',
      sizes: [
        { id: id(30), name: 'Half', priceMinor: 1400 },
        { id: id(31), name: 'Whole', priceMinor: 2600 },
      ],
      groupIds: [id(40)],
      allergens: [{ code: 'fish', level: 'contains' }],
      photo: { id: id(52), version: '0123456789ab' },
    }),
    item(14, 'Grilled hispi, whole', { priceMinor: 1800, photo: { id: id(53), version: '0123456789ab' } }),
    item(15, 'Lamb shoulder for two', { priceMinor: 4200, photo: { id: id(54), version: '0123456789ab' } }),
  ],
  groups: [
    {
      id: id(40),
      name: 'Sides',
      rule: 'up_to',
      max: 2,
      options: [
        { id: id(41), name: 'Fries', priceDeltaMinor: 450 },
        { id: id(42), name: 'Green salad', priceDeltaMinor: 400 },
      ],
    },
  ],
  changes: 3,
  photos: 0,
  hidden: false,
  canEdit: true,
};

function heldOf<Value>(first: Value) {
  const state: HospitalityHeldState<Value> = { status: 'ready', value: first, isSaving: false };
  const held: HospitalityHeld<Value> = {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
  return held;
}

/** A store holding one draft; Publish refuses as the server would when a dish has no price. */
function storeOf(draft: MenuDraft) {
  const calls: string[] = [];
  const done = (name: string) => () => {
    calls.push(name);
    return Promise.resolve(undefined);
  };
  const saved: ItemFields[] = [];
  let lastId = 99;
  const store = {
    newId: () => id((lastId += 1)),
    property: () => undefined,
    draft: () => heldOf(draft),
    setSoldOut: done('soldOut'),
    publish: done('publish'),
    discard: done('discard'),
    saveMenu: done('saveMenu'),
    saveSection: done('saveSection'),
    placeItem: done('placeItem'),
    saveGroup: done('saveGroup'),
    saveItem: (_workspace: string, _id: string, fields: ItemFields, sectionId?: string) => {
      calls.push(sectionId === undefined ? 'saveItem' : `saveItem in ${sectionId}`);
      saved.push(fields);
      return Promise.resolve(undefined);
    },
  } as unknown as MenuStore;
  return { store, calls, saved };
}

/** Waits for what is sliding in: axe reads no background behind a drawer mid slide. */
const settled = () =>
  Promise.allSettled(
    document
      .getAnimations()
      .filter((each) => each.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
      .map((each) => each.finished),
  );

/** A field's name as its label gives it. */
const labelOf = (element: Element | null): string =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? (element.labels?.[0]?.textContent ?? '')
    : '';

const toasts = { toast: () => undefined } as never;
const BUSINESS = {
  name: 'Somewhere Nowhere',
  hours: {
    [PLACE]: {
      weekly: {
        mon: [{ from: '12:00', to: '23:00' }],
        tue: [{ from: '12:00', to: '23:00' }],
        wed: [{ from: '12:00', to: '23:00' }],
        thu: [{ from: '12:00', to: '23:00' }],
        fri: [{ from: '12:00', to: '23:00' }],
        sat: [{ from: '10:00', to: '23:00' }],
        sun: [{ from: '10:00', to: '22:00' }],
      },
      exceptions: [],
    },
  },
};

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
  document.getElementById('menu-look-test')?.remove();
});

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png` });
}

/** The Warm look as the menu's look.css sets it (the test stands in for the stylesheet the shell links). */
function wearWarm() {
  const block = (mode: 'light' | 'dark') =>
    (Object.keys(MENU_LOOK_PROPERTIES) as (keyof typeof MENU_LOOK_PROPERTIES)[])
      .map((name) => `${MENU_LOOK_PROPERTIES[name]}:${WARM_PRESET[mode][name]}`)
      .join(';');
  const style = document.createElement('style');
  style.id = 'menu-look-test';
  style.textContent = `:root{${block('light')}} :root[data-theme='dark']{${block('dark')}}`;
  document.head.append(style);
}

describe('the Menus editor', () => {
  it('opens on the setup checklist, shows each dish with Sold out, and names the dish Publish would refuse', async () => {
    await page.viewport(1280, 900);
    const unpriced: MenuDraft = {
      ...DRAFT,
      changes: 1,
      items: DRAFT.items.map((each) => (each.id === id(12) ? { ...each, priceNote: undefined } : each)),
    };
    const { store } = storeOf(unpriced);
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      {
        data: {},
        pattern: '/w/$slug/menus',
        at: '/w/acme/menus',
      },
    );
    // With the hours, a menu and dishes in, the checklist folds to its one step left, Publish, with Review.
    await expect.element(page.getByText('One setup step left: Publish it')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Review/ }).first()).toBeInTheDocument();
    // The item Publish would refuse says so on its row, and on the Items tab, before Publish is pressed.
    await expect.element(page.getByText('No price').first()).toBeVisible();
    // Sold out is a quick button on an item's row and in its ⋯ on Structure; the Items tab keeps the switch.
    await expect.element(page.getByRole('button', { name: 'More for Oysters' }).first()).toBeInTheDocument();
    // The first publish is the bar's Publish (spec 0074, AC-7407), through the review and its checks.
    await expect.element(page.getByText('Not published yet')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Publish', exact: true }));
    const review = page.getByRole('dialog', { name: 'Review and publish' });
    await expect.element(review.getByText(/Give Oysters a price, then publish/)).toBeVisible();
    await expect.element(review.getByRole('button', { name: 'Publish & go live' })).toBeDisabled();
  });

  it('ends a first publish on the share sheet: "Your menu is live", with the link and its code (spec 0074, AC-7405)', async () => {
    const { store, calls } = storeOf(DRAFT);
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    await userEvent.click(page.getByRole('button', { name: 'Publish', exact: true }));
    const review = page.getByRole('dialog', { name: 'Review and publish' });
    await userEvent.click(review.getByRole('button', { name: 'Publish & go live' }));
    await expect.poll(() => calls.includes('publish')).toBe(true);
    const sheet = page.getByRole('dialog', { name: 'Your menu is live' });
    await expect.element(sheet.getByRole('img', { name: 'QR code for Soho menu' })).toBeInTheDocument();
    await expect
      .element(sheet.getByRole('link', { name: 'WhatsApp' }))
      .toHaveAttribute('href', expect.stringContaining(encodeURIComponent('Our menu:')));
    await expect.element(sheet.getByRole('button', { name: 'Done' })).toHaveFocus();
  });

  it('keeps focus off the page after a first publish: on the bar, where Publish was (spec 0074, AC-7428)', async () => {
    // The draft turns live when Publish lands, as the real store's does, so the bar's Publish goes.
    const listeners = new Set<() => void>();
    let state: HospitalityHeldState<MenuDraft> = { status: 'ready', value: DRAFT, isSaving: false };
    const held: HospitalityHeld<MenuDraft> = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain: () => () => undefined,
      retry: () => undefined,
    };
    const { store } = storeOf(DRAFT);
    const turning = {
      ...store,
      draft: () => held,
      publish: () => {
        state = {
          status: 'ready',
          value: { ...DRAFT, publishedAt: '2026-11-13T10:00:00.000Z', changes: 0 },
          isSaving: false,
        };
        for (const listener of listeners) listener();
        return Promise.resolve(undefined);
      },
    } as MenuStore;
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={turning} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    await userEvent.click(page.getByRole('button', { name: 'Publish', exact: true }));
    const review = page.getByRole('dialog', { name: 'Review and publish' });
    await userEvent.click(review.getByRole('button', { name: 'Publish & go live' }));
    const sheet = page.getByRole('dialog', { name: 'Your menu is live' });
    await expect.element(sheet.getByRole('button', { name: 'Done' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
    // Publish went with the publish; focus is on the bar's own status line, never the page body.
    await expect.poll(() => document.activeElement === document.body).toBe(false);
    await expect.element(page.getByRole('region', { name: 'Publish' }).getByRole('status')).toHaveFocus();
  });

  it('publishes drafts from the bar at once, shares from the header, and asks before Discard draft', async () => {
    await page.viewport(1280, 900);
    const live: MenuDraft = { ...DRAFT, publishedAt: '2026-11-01T10:00:00.000Z' };
    const { store, calls } = storeOf(live);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    // The bar says what guests don't see yet; a later publish goes at once and says Published (spec 0074, AC-7407).
    await expect.element(page.getByText('3 changes not published')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Publish', exact: true }));
    await expect.poll(() => calls.includes('publish')).toBe(true);
    // Share opens the one share sheet (AC-7405): the link and its code, Open guest menu among its ways.
    await userEvent.click(page.getByRole('button', { name: 'Share', exact: true }));
    const sheet = page.getByRole('dialog', { name: 'Share your menu' });
    await expect.element(sheet.getByRole('img', { name: 'QR code for Soho menu' })).toBeInTheDocument();
    await expect.element(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect
      .element(sheet.getByRole('link', { name: 'Open guest menu' }))
      .toHaveAttribute('href', expect.stringContaining('/m/AbCdEfGhIjKlMnOp'));
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }));
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
    // View opens the guest menu in a new tab.
    await expect
      .element(page.getByRole('link', { name: 'Open in new tab' }))
      .toHaveAttribute('href', expect.stringContaining('/m/AbCdEfGhIjKlMnOp'));
    // Discard draft asks first, the action on its danger button (AC-7408); ⋯ keeps Delete and no Discard.
    await userEvent.click(page.getByRole('button', { name: 'Discard draft' }));
    const ask = page.getByRole('alertdialog', { name: 'Discard your unpublished changes?' });
    await expect
      .element(ask.getByRole('button', { name: 'Discard draft' }))
      .toHaveAttribute('data-variant', 'danger-solid');
    await userEvent.click(ask.getByRole('button', { name: 'Discard draft' }));
    await expect.poll(() => calls.includes('discard')).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'More', exact: true }));
    expect(page.getByRole('menuitem', { name: 'Discard changes' }).query()).toBeNull();
    await expect.element(page.getByRole('menuitem', { name: 'Delete menu' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('says a hidden menu is hidden in the bar, never that guests see it', async () => {
    const hidden: MenuDraft = { ...DRAFT, publishedAt: '2026-11-01T10:00:00.000Z', changes: 0, hidden: true };
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={storeOf(hidden).store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    await expect.element(page.getByText('Hidden: guests see that the menu isn’t available')).toBeVisible();
    expect(page.getByText('Live: guests see this page').query()).toBeNull();
  });

  it('lists every item in the menu’s order with Available, folds a section, and searches both', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{ tab: 'dishes' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=dishes' },
    );
    await expect.element(page.getByRole('heading', { name: 'All items' })).toBeInTheDocument();
    await expect.element(page.getByText('5 available')).toBeInTheDocument();
    await expect.element(page.getByRole('columnheader', { name: 'Available' })).toBeVisible();
    const names = page
      .getByRole('rowheader')
      .elements()
      .map((cell) => cell.textContent);
    expect(names.slice(0, 2)).toEqual(['Burrata, blood orange, chilli', 'Charred hispi cabbage']);
    await expect.element(page.getByRole('row', { name: /Wood fired bream/ }).getByText('Mains')).toBeVisible();
    await userEvent.fill(page.getByRole('searchbox', { name: 'Search sections and items' }), 'bream');
    await expect.element(page.getByRole('rowheader', { name: /Burrata/ })).not.toBeInTheDocument();
    shown.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    // A section with no sub sections counts its items alone.
    await expect.element(page.getByText('3 items', { exact: true }).first()).toBeInTheDocument();
    // The price on its own column (sizes as a range), the sizes' count and the allergens on the quiet line.
    await expect.element(page.getByText('£14.00–£26.00').first()).toBeInTheDocument();
    await expect.element(page.getByText('2 sizes · Fish').first()).toBeInTheDocument();
    const fold = page.getByRole('button', { name: 'Small plates', exact: true });
    await expect.element(fold).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByLabelText('Items in Small plates')).toBeVisible();
    await userEvent.click(fold);
    // Folded, the section draws its head alone (the phone preview beside it still reads the whole menu).
    await expect.element(page.getByLabelText('Items in Small plates')).not.toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Edit Mains' })).toBeInTheDocument();
  });

  it('keeps every quiet control reachable: Mark sold out is on the row and in ⋯, with Undo, and Edit in the section’s ⋯', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    // Sold out reads by the name; the quick switch flips it at once.
    await expect.element(page.getByText('Sold out').first()).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Mark Oysters available' }));
    await expect.poll(() => calls.includes('soldOut')).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'More for Small plates' }));
    await expect.element(page.getByRole('menuitem', { name: 'Edit section' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Show as a photo grid' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(page.getByRole('button', { name: 'More for Burrata, blood orange, chilli' }));
    await expect.element(page.getByRole('menuitem', { name: 'Mark sold out' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('offers no Move while a search shows only part of the menu, since its positions aren’t the menu’s', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    await userEvent.click(page.getByRole('button', { name: 'More for Charred hispi cabbage' }));
    await expect.element(page.getByRole('menuitem', { name: 'Move down' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.fill(page.getByRole('searchbox', { name: 'Search sections and items' }), 'hispi');
    await expect
      .element(page.getByRole('button', { name: 'More for Burrata, blood orange, chilli' }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'More for Charred hispi cabbage' }));
    await expect.element(page.getByRole('menuitem', { name: 'Mark sold out' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: /^Move/ }).elements()).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(page.getByRole('button', { name: 'More for Small plates' }));
    await expect.element(page.getByRole('menuitem', { name: 'Edit section' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: /^Move/ }).elements()).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
  });

  it('makes a new add-on from an item’s drawer and comes back with it picked', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{ tab: 'dishes' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=dishes' },
    );
    await userEvent.click(page.getByRole('button', { name: 'New item' }).first());
    const sheet = page.getByRole('dialog', { name: 'New item' });
    await expect.element(sheet.getByPlaceholder('e.g. Grilled Salmon')).toBeVisible();
    await expect.element(sheet.getByRole('switch', { name: /Available/ })).toBeChecked();
    await userEvent.click(sheet.getByRole('button', { name: /Add-ons/ }));
    await userEvent.click(page.getByRole('option', { name: 'New add-on' }));
    const group = page.getByRole('dialog', { name: 'New add-on' });
    await userEvent.fill(group.getByLabelText('Name', { exact: true }), 'Milk');
    await userEvent.fill(group.getByRole('textbox', { name: /^Option 1/ }), 'Oat');
    await userEvent.click(group.getByRole('button', { name: 'Save add-on' }));
    await expect.poll(() => calls.includes('saveGroup')).toBe(true);
    await expect.element(group).not.toBeInTheDocument();
    await expect.element(sheet).toBeVisible();
    await expect.poll(() => document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
  });

  /** Opens the sheet of a new item on the Items tab. */
  async function openNewItem() {
    const { store, calls, saved } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{ tab: 'dishes' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=dishes' },
    );
    await userEvent.click(page.getByRole('button', { name: 'New item' }).first());
    // Named for what is typed, so found by what it holds.
    return { sheet: page.getByRole('dialog').filter({ hasText: 'Add another' }), calls, saved };
  }

  it('goes through the fields a person fills for every item by Tab alone, starting in Name', async () => {
    await page.viewport(1280, 900);
    await openNewItem();
    const focusedName = () => labelOf(document.activeElement);
    await expect.poll(focusedName).toBe('Name');
    await userEvent.tab();
    expect(focusedName()).toBe('Description');
    // How it is priced first, one stop, then the price, one stop for the photo, and into the allergens.
    await userEvent.tab();
    expect(document.activeElement?.closest('[role="radiogroup"]')?.textContent).toContain('One price');
    await userEvent.tab();
    // Named for screen readers alone: Pricing above it already says what it is.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Price');
    await userEvent.tab();
    expect(document.activeElement?.textContent).toContain('Add photo');
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('None');
  });

  it('holds one way of pricing: only the kind chosen is saved', async () => {
    await page.viewport(1280, 900);
    const { sheet, saved } = await openNewItem();
    await userEvent.fill(sheet.getByLabelText('Name', { exact: true }), 'Oysters');
    await userEvent.fill(sheet.getByLabelText('Price', { exact: true }), '9.50');
    // The first size takes the price typed; sizes take over the box.
    await userEvent.click(sheet.getByText('Sizes', { exact: true }));
    await expect.element(sheet.getByLabelText('Size 1 price (GBP)')).toHaveValue('9.50');
    await userEvent.click(sheet.getByText('Other', { exact: true }));
    await userEvent.fill(sheet.getByLabelText('Instead of a price', { exact: true }), 'Market price');
    await userEvent.click(sheet.getByRole('button', { name: 'Save item' }));
    await expect.poll(() => saved.at(-1)).toMatchObject({ priceMinor: null, priceNote: 'Market price', sizes: [] });
  });

  it('keeps allergens at one level, says what is chosen, and warns of a mark they rule out', async () => {
    await page.viewport(1280, 900);
    const { sheet, saved } = await openNewItem();
    await userEvent.fill(sheet.getByLabelText('Name', { exact: true }), 'Burrata');
    const contains = sheet.getByRole('button', { name: /Contains allergens/ });
    const may = sheet.getByRole('button', { name: /May contain allergens/ });
    await expect.element(contains).toHaveTextContent('None');
    // Milk may be in it, then is known to be: it moves.
    await userEvent.click(may);
    await userEvent.click(page.getByRole('option', { name: 'Milk' }));
    await userEvent.keyboard('{Escape}');
    await expect.element(may).toHaveTextContent('Milk');
    await userEvent.click(contains);
    await userEvent.click(page.getByRole('option', { name: 'Milk' }));
    await userEvent.click(page.getByRole('option', { name: 'Soya' }));
    await userEvent.keyboard('{Escape}');
    await expect.element(contains).toHaveTextContent('Milk, Soya');
    // The list says which one it is, and one search takes the next and the next, by everyday words too.
    await userEvent.click(contains);
    await expect.element(page.getByRole('listbox').getByText('Contains allergens')).toBeVisible();
    await userEvent.keyboard('egg');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('dairy');
    await expect.element(page.getByRole('option', { name: 'Milk' })).toBeVisible();
    expect(page.getByRole('option', { name: 'Soya' }).elements()).toHaveLength(0);
    // Milk is chosen already: the search found it, and nothing more is pressed, so the choice stands. (Two Enters
    // here toggled it off and on locally, but on a slower machine the search cleared between them.)
    await userEvent.keyboard('{Escape}');
    await expect.element(contains).toHaveTextContent('Eggs, Milk, Soya');
    // A letter on the closed field changes nothing.
    contains.element().focus();
    await userEvent.keyboard('c');
    await expect.element(contains).toHaveTextContent('Eggs, Milk, Soya');
    await userEvent.click(contains);
    await userEvent.click(page.getByRole('option', { name: 'Eggs' }));
    await userEvent.keyboard('{Escape}');
    await expect.element(may).toHaveTextContent('None');
    // In the other list it says where it is, and can't be picked.
    await userEvent.click(may);
    const milk = page.getByRole('option', { name: /Milk/ });
    await expect.poll(() => milk.element().textContent).toContain('Already in Contains');
    await expect.element(milk).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(sheet.getByRole('button', { name: /Dietary/ }));
    await userEvent.click(page.getByRole('option', { name: 'Vegan' }));
    await userEvent.keyboard('{Escape}');
    await expect.element(sheet.getByText('Marked Vegan, but contains milk.')).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: /Spice level/ }));
    await userEvent.click(page.getByRole('option', { name: 'Spicy', exact: true }));
    await userEvent.click(sheet.getByRole('button', { name: 'Save item' }));
    await expect
      .poll(() => saved.at(-1))
      .toMatchObject({
        diet: ['vegan', 'spicy_2'],
        allergens: [
          { code: 'milk', level: 'contains' },
          { code: 'soya', level: 'contains' },
        ],
      });
    // Five lists opened and closed in one walk: on a busy CI runner it ran out of the default test time (9 Nov 2026).
  }, 40_000);

  it('saves and starts the next with Add another, focus back in Name', async () => {
    await page.viewport(1280, 900);
    const { sheet, saved } = await openNewItem();
    await userEvent.click(sheet.getByText('Add another'));
    await userEvent.fill(sheet.getByLabelText('Name', { exact: true }), 'Soup');
    await expect.element(sheet.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await userEvent.fill(sheet.getByLabelText('Price', { exact: true }), '6');
    await userEvent.click(sheet.getByRole('button', { name: 'Save item' }));
    await expect.poll(() => saved.length).toBe(1);
    const next = page.getByRole('dialog', { name: 'New item' });
    await expect.element(next.getByLabelText('Name', { exact: true })).toHaveValue('');
    await expect.element(next.getByLabelText('Price', { exact: true })).toHaveValue('');
    await expect.poll(() => labelOf(document.activeElement)).toBe('Name');
    // Nothing typed yet and nothing to cancel, so it closes without asking.
    await userEvent.click(next.getByRole('button', { name: 'Close' }).last());
    await expect.element(next).not.toBeInTheDocument();
  });

  it('says where a new item goes when it was made outside a section', async () => {
    await page.viewport(1280, 900);
    const { sheet, calls } = await openNewItem();
    await userEvent.fill(sheet.getByLabelText('Name', { exact: true }), 'Soup');
    await userEvent.click(sheet.getByRole('button', { name: /Section/ }));
    await userEvent.click(page.getByRole('option', { name: 'Mains' }));
    await userEvent.click(sheet.getByRole('button', { name: 'Save item' }));
    await expect.poll(() => calls.at(-1)).toBe(`saveItem in ${MAINS}`);
  });

  it('goes to the first problem on Save, and a refused save keeps the form as typed', async () => {
    await page.viewport(1280, 900);
    const { store, saved } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => (
        <MenusScreen
          view={{ tab: 'dishes' }}
          store={{
            ...store,
            saveItem: () => Promise.resolve({ code: 'REFUSED', message: 'Refused.' } as unknown as DataError),
          }}
          slug="acme"
          toasts={toasts}
          business={BUSINESS}
        />
      ),
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=dishes' },
    );
    await userEvent.click(page.getByRole('button', { name: 'New item' }).first());
    const sheet = page.getByRole('dialog').filter({ hasText: 'Add another' });
    await userEvent.fill(sheet.getByLabelText('Price', { exact: true }), 'abc');
    await userEvent.click(sheet.getByRole('button', { name: 'Save item' }));
    await expect.element(sheet.getByText('Use a price such as 9.50.')).toBeVisible();
    await expect.poll(() => labelOf(document.activeElement)).toBe('Name');
    await userEvent.fill(sheet.getByLabelText('Price', { exact: true }), '9');
    await expect.element(sheet.getByText('Use a price such as 9.50.')).not.toBeInTheDocument();
    await userEvent.fill(sheet.getByLabelText('Name', { exact: true }), 'Soup');
    await userEvent.click(sheet.getByRole('button', { name: 'Save item' }));
    const titled = page.getByRole('dialog', { name: 'Soup' });
    await expect.element(titled.getByLabelText('Price', { exact: true })).toHaveValue('9');
    expect(saved).toHaveLength(0);
  });

  it('is clean in both themes with an item filled and a list open, on a desktop and a phone', async () => {
    for (const width of [1280, 390]) {
      await page.viewport(width, 844);
      for (const theme of THEMES) {
        applyTheme(theme);
        const { store } = storeOf(DRAFT);
        shown?.unmount();
        shown = await renderInApp(
          () => <MenusScreen view={{ tab: 'dishes' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
          { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=dishes' },
        );
        await userEvent.click(page.getByText('Wood fired bream').first());
        const sheet = page.getByRole('dialog', { name: 'Wood fired bream' });
        await expect.element(sheet.getByLabelText('Size 1', { exact: true })).toHaveValue('Half');
        await settled();
        expect(await axeViolations()).toEqual([]);
        await userEvent.click(sheet.getByRole('button', { name: /May contain allergens/ }));
        await expect.element(page.getByRole('option', { name: /Fish/ })).toBeVisible();
        await settled();
        await shoot('item-sheet-list', theme, width);
        expect(await axeViolations()).toEqual([]);
        await userEvent.keyboard('{Escape}');
      }
    }
    resetTheme();
  }, 90_000);

  it('reads an item for someone who can’t edit: values shown, nothing to choose but Available', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf({ ...DRAFT, canEdit: false });
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{ tab: 'dishes' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=dishes' },
    );
    await userEvent.click(page.getByText('Wood fired bream').first());
    const sheet = page.getByRole('dialog', { name: 'Wood fired bream' });
    await expect.element(sheet.getByLabelText('Size 1', { exact: true })).toHaveValue('Half');
    await expect.element(sheet.getByRole('group', { name: 'Contains allergens' })).toHaveTextContent('Fish');
    expect(sheet.getByRole('radio').elements()).toHaveLength(0);
    expect(sheet.getByRole('button', { name: 'Save item' }).elements()).toHaveLength(0);
    await expect.element(sheet.getByRole('switch', { name: /Available/ })).toBeEnabled();
    await settled();
    expect(await axeViolations()).toEqual([]);
  });

  it('asks before a drawer with changes closes, and keeps what was typed on Keep editing', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{ tab: 'options' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=options' },
    );
    await expect.element(page.getByText('Choices guests can pick. Required ones need a pick.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'New add-on' }).first());
    const drawer = page.getByRole('dialog', { name: 'New add-on' });
    await expect.element(drawer).toBeVisible();
    // Save with nothing named: the problems show inline, nothing is sent.
    await userEvent.click(drawer.getByRole('button', { name: 'Save add-on' }));
    await expect.element(drawer.getByText('Name the add-on, such as Milk.')).toBeVisible();
    await userEvent.fill(drawer.getByLabelText('Name', { exact: true }), 'Milk');
    await userEvent.click(drawer.getByRole('button', { name: 'Cancel' }));
    await expect.element(page.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Keep editing' }));
    await expect.element(drawer.getByLabelText('Name', { exact: true })).toHaveValue('Milk');
  });

  it('is clean in both themes at a desktop’s and a phone’s width', async () => {
    const { store } = storeOf(DRAFT);
    for (const width of [1280, 390]) {
      for (const theme of THEMES) {
        await page.viewport(width, 900);
        shown?.unmount();
        shown = await renderInApp(
          () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
          {
            data: {},
            pattern: '/w/$slug/menus',
            at: '/w/acme/menus',
          },
        );
        applyTheme(theme);
        await expect.element(page.getByRole('heading', { level: 1, name: 'Menus' })).toBeInTheDocument();
        // The publish bar's words fade in (spec 0074): axe reads their contrast once they have.
        await settled();
        expect(await axeViolations()).toEqual([]);
        await shoot('editor', theme, width);
      }
    }
  });
});

describe('the guest menu', () => {
  const guest = (): PublicMenu => ({
    ...previewMenu(DRAFT, DRAFT.places[0] ?? (undefined as never), {
      businessName: 'Somewhere Nowhere',
      hours: BUSINESS.hours[PLACE],
    }),
    soldOut: [id(12)],
  });

  it('reads in the Warm look, its dish sheet a dialog that Escape closes, clean in both themes', async () => {
    for (const width of [1280, 390]) {
      for (const theme of THEMES) {
        await page.viewport(width, 900);
        shown?.unmount();
        wearWarm();
        shown = await renderInApp(
          () => (
            <MenuList
              menu={guest()}
              photoHref={photoHref}
              picks={[]}
              onPicksChange={() => undefined}
              foot={<BookingFoot page="menu" />}
            />
          ),
          { data: {}, pattern: '/m/$key', at: '/m/AbCdEfGhIjKlMnOp' },
        );
        applyTheme(theme);
        await expect.element(page.getByRole('heading', { level: 1, name: 'Dinner' })).toBeInTheDocument();
        await expect.element(page.getByRole('button', { name: /Oysters/ }).getByText('Sold out')).toBeVisible();
        expect(await axeViolations()).toEqual([]);
        await shoot('guest', theme, width);
        // The sections are pills, one at a time (checklabs'): the bream is under Mains.
        await userEvent.click(page.getByRole('tab', { name: 'Mains' }));
        await userEvent.click(page.getByRole('button', { name: /^Wood fired bream/ }));
        const sheet = page.getByRole('dialog', { name: 'Wood fired bream' });
        await expect.element(sheet).toBeVisible();
        await expect.element(sheet.getByRole('heading', { name: 'Allergens' })).toBeVisible();
        await expect.element(sheet.getByText('fish', { exact: true })).toBeVisible();
        // By keyboard, as a guest using one would: the size group holds Half, and the arrow moves to Whole.
        (sheet.getByRole('radio', { name: /Half/ }).element() as HTMLElement).focus();
        await userEvent.keyboard('{ArrowDown}');
        await expect.element(sheet.getByRole('button', { name: /Add to selection · £26.00/ })).toBeVisible();
        expect(await axeViolations()).toEqual([]);
        await shoot('guest-sheet', theme, width);
        await userEvent.keyboard('{Escape}');
        await expect.element(sheet).not.toBeInTheDocument();
      }
    }
  });
});

describe('Copy to another business, in the editor (spec 0065 H7, AC-6591)', () => {
  /** The suite's store as the editor reads it: three businesses, the first shown. */
  const hospitalityOf = () => {
    const ready = <Value,>(value: Value): HospitalityHeld<Value> => {
      const state: HospitalityHeldState<Value> = { status: 'ready', value, isSaving: false };
      return {
        subscribe: () => () => undefined,
        getSnapshot: () => state,
        retain: () => () => undefined,
        retry: () => undefined,
      };
    };
    return {
      properties: () =>
        ready({
          canManage: true,
          properties: [
            { id: id(201), name: 'Harbour Café', kind: 'cafe', currency: 'GBP', position: 0, holds: 3 },
            { id: id(202), name: 'Late Bar', kind: 'bar', currency: 'EUR', position: 1, holds: 1 },
          ],
        }),
      choice: () => ready<string | undefined>(undefined),
      requestChoice: () => Promise.resolve(true),
    } as unknown as HospitalityStore;
  };

  it('opens from ⋯ over the editor, warns of the other currency, and is clean in both themes at both widths', async () => {
    const live: MenuDraft = { ...DRAFT, publishedAt: '2026-11-01T10:00:00.000Z' };
    const { store } = storeOf(live);
    const hospitality = hospitalityOf();
    for (const width of [1280, 390]) {
      for (const theme of THEMES) {
        await page.viewport(width, 900);
        shown?.unmount();
        shown = await renderInApp(
          () => (
            <MenusScreen
              view={{}}
              store={store}
              hospitality={hospitality}
              slug="acme"
              toasts={toasts}
              business={BUSINESS}
            />
          ),
          { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
        );
        applyTheme(theme);
        await userEvent.click(page.getByRole('button', { name: 'More', exact: true }));
        await userEvent.click(page.getByRole('menuitem', { name: 'Copy to another business' }));
        await expect.element(page.getByText(/Prices are in GBP here and EUR there/)).toBeVisible();
        const ending = document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY);
        await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)));
        expect(await axeViolations()).toEqual([]);
        await shoot('copy-in-editor', theme, width);
      }
    }
  });
});
