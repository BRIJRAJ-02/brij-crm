// The Menu app in Chromium (spec 0065, H1): the Menus editor over a fake store (the setup checklist before the first
// Publish, a section's dishes with Sold out, Publish refused with the dish named, the phone preview drawing the
// draft), and the guest menu (MenuList in the Warm look) with a dish's sheet open, a proper dialog closed by Escape.
// axe is clean in light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set, each is photographed.
import '@crm/ui/styles.css';
import type { HospitalityHeld, HospitalityHeldState, MenuDraft, MenuStore, PublicMenu } from '@crm/data';
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
  const store = {
    newId: () => id(99),
    property: () => undefined,
    draft: () => heldOf(draft),
    setSoldOut: done('soldOut'),
    publish: done('publish'),
    discard: done('discard'),
    saveMenu: done('saveMenu'),
    saveSection: done('saveSection'),
    placeItem: done('placeItem'),
    saveGroup: done('saveGroup'),
    saveItem: done('saveItem'),
  } as unknown as MenuStore;
  return { store, calls };
}

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
    // The first publish is checklabs' "Publish & go live", through the review.
    await userEvent.click(page.getByRole('button', { name: 'Publish & go live' }));
    const review = page.getByRole('dialog', { name: 'Review and publish' });
    await expect.element(review.getByText(/Give Oysters a price or a price note/)).toBeVisible();
    await expect.element(review.getByRole('button', { name: 'Publish & go live' })).toBeDisabled();
  });

  it('publishes drafts from the split button at once, its chevron sharing, and keeps Discard and Delete in ⋯', async () => {
    await page.viewport(1280, 900);
    const live: MenuDraft = { ...DRAFT, publishedAt: '2026-11-01T10:00:00.000Z' };
    const { store, calls } = storeOf(live);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{}} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    await userEvent.click(page.getByRole('button', { name: 'Publish · 3 drafts' }));
    await expect.poll(() => calls.includes('publish')).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'Share menu' }));
    await expect.element(page.getByRole('menuitem', { name: 'Open in new tab' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Show QR code' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(page.getByRole('button', { name: 'More', exact: true }));
    await expect.element(page.getByRole('menuitem', { name: 'Discard changes' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Delete menu' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    // Nothing left to publish: the main half is View.
    shown.unmount();
    shown = await renderInApp(
      () => (
        <MenusScreen
          view={{}}
          store={storeOf({ ...live, changes: 0 }).store}
          slug="acme"
          toasts={toasts}
          business={BUSINESS}
        />
      ),
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' },
    );
    await expect.element(page.getByRole('button', { name: 'View', exact: true })).toBeInTheDocument();
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

  it('makes a new option group from an item’s drawer and comes back with it picked', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{ tab: 'dishes' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=dishes' },
    );
    await userEvent.click(page.getByRole('button', { name: 'New item' }).first());
    const sheet = page.getByRole('dialog', { name: 'Item' });
    await expect.element(sheet.getByPlaceholder('e.g. Grilled Salmon')).toBeVisible();
    await expect.element(sheet.getByRole('switch', { name: /Available/ })).toBeChecked();
    await userEvent.click(sheet.getByRole('button', { name: 'New option group' }));
    const group = page.getByRole('dialog', { name: 'New option group' });
    await userEvent.fill(group.getByLabelText('Name', { exact: true }), 'Milk');
    await userEvent.fill(group.getByRole('textbox', { name: /^Option 1/ }), 'Oat');
    await userEvent.click(group.getByRole('button', { name: 'Save group' }));
    await expect.poll(() => calls.includes('saveGroup')).toBe(true);
    await expect.element(group).not.toBeInTheDocument();
    await expect.element(sheet).toBeVisible();
  });

  it('asks before a drawer with changes closes, and keeps what was typed on Keep editing', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf(DRAFT);
    shown?.unmount();
    shown = await renderInApp(
      () => <MenusScreen view={{ tab: 'options' }} store={store} slug="acme" toasts={toasts} business={BUSINESS} />,
      { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus?tab=options' },
    );
    await expect.element(page.getByText('Choices guests can pick. Required groups need a pick.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'New group' }).first());
    const drawer = page.getByRole('dialog', { name: 'New option group' });
    await expect.element(drawer).toBeVisible();
    // Save with nothing named: the problems show inline, nothing is sent.
    await userEvent.click(drawer.getByRole('button', { name: 'Save group' }));
    await expect.element(drawer.getByText('Name the group, such as Milk.')).toBeVisible();
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
