// The sidebar's business switcher in Chromium (spec 0065 H7, AC-6516, AC-6517): nothing with one business; from two,
// the business in use as the Business group's first row, opening a menu that switches. axe is clean in light and dark at
// a desktop's and a phone's width. With VITE_SHOT_DIR set, the open menu and the Businesses list are photographed there.
import '@crm/ui/styles.css';
import type {
  BusinessView,
  DataLayer,
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  PropertiesView,
} from '@crm/data';
import { NavItem, NavSection, Sidebar, createToasts } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { BusinessScreen } from './BusinessScreen.tsx';
import { BusinessSwitch } from './BusinessSwitch.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const FIRST = '0192f0c8-0000-7000-8000-00000000b001';
const SECOND = '0192f0c8-0000-7000-8000-00000000b002';

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** A held copy a test changes by hand. */
function heldOf<Value>(first: Value) {
  let state: HospitalityHeldState<Value> = { status: 'ready', value: first, isSaving: false };
  const listeners = new Set<() => void>();
  const held: HospitalityHeld<Value> = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
  const set = (value: Value) => {
    state = { status: 'ready', value, isSaving: false };
    for (const listener of listeners) listener();
  };
  return { held, set };
}

const BUSINESS: BusinessView = {
  canEdit: true,
  profile: { id: FIRST, name: 'Somewhere Nowhere', kind: 'restaurant', links: [], currency: 'GBP' },
  places: [],
};

/** A data layer whose hospitality store holds `count` businesses, recording each switch. */
function dataOf(count: 1 | 2) {
  const chosen: string[] = [];
  const properties = heldOf<PropertiesView>({
    canManage: true,
    properties: [
      { id: FIRST, name: 'Somewhere Nowhere', kind: 'restaurant', currency: 'GBP', position: 0, holds: 2 },
      ...(count === 2
        ? [{ id: SECOND, name: 'Late Bar', kind: 'bar' as const, currency: 'EUR', position: 1, holds: 0 }]
        : []),
    ],
  });
  const choice = heldOf<string | undefined>(undefined);
  const store = {
    newId: () => '01900002-0000-7000-8000-000000000001',
    properties: () => properties.held,
    choice: () => choice.held,
    choose: (_slug: string, id: string) => {
      chosen.push(id);
      choice.set(id);
    },
    business: () => heldOf(BUSINESS).held,
    apps: () => heldOf({ canManage: true, hasBusiness: true, apps: [] }).held,
  } as unknown as HospitalityStore;
  const data = { hospitality: { load: () => Promise.resolve(store) } } as unknown as DataLayer;
  return { data, store, chosen };
}

const toasts = createToasts();

/** The sidebar with its Business group, the switcher first. */
const sidebarWith = (data: DataLayer) => () => (
  <Sidebar workspace="Acme">
    <NavSection title="Business">
      <BusinessSwitch data={data} slug="acme" />
      <NavItem icon="utensils" href="/w/acme/menus">
        Menus
      </NavItem>
    </NavSection>
  </Sidebar>
);

async function shoot(name: string) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true } as never);
}

describe('the business switcher (AC-6516, AC-6517)', () => {
  it('draws nothing while there is one business', async () => {
    shown = await renderInApp(sidebarWith(dataOf(1).data), { data: {}, pattern: '/w/$slug', at: '/w/acme' });
    await expect.element(page.getByRole('link', { name: 'Menus' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Somewhere Nowhere/ })).not.toBeInTheDocument();
  });

  it('names the business in use from two, and switches from its menu', async () => {
    const { data, chosen } = dataOf(2);
    shown = await renderInApp(sidebarWith(data), { data: {}, pattern: '/w/$slug', at: '/w/acme' });
    await page.getByRole('button', { name: /Somewhere Nowhere/ }).click();
    await expect.element(page.getByRole('menuitemradio', { name: 'Late Bar' })).toBeVisible();
    await page.getByRole('menuitemradio', { name: 'Late Bar' }).click();
    expect(chosen).toEqual([SECOND]);
    await expect.element(page.getByRole('button', { name: /Late Bar/ })).toBeVisible();
  });
});

describe('axe and the pictures', () => {
  for (const theme of THEMES) {
    for (const width of [1280, 390]) {
      it(`is clean in ${theme} at ${String(width)} with the menu open, and Businesses listed`, async () => {
        await page.viewport(width, 1600);
        applyTheme(theme);
        const { data, store } = dataOf(2);
        shown = await renderInApp(sidebarWith(data), { data: {}, pattern: '/w/$slug', at: '/w/acme' });
        await page.getByRole('button', { name: /Somewhere Nowhere/ }).click();
        await expect.element(page.getByRole('menuitemradio', { name: 'Late Bar' })).toBeVisible();
        expect(await axeViolations()).toEqual([]);
        await shoot(`switcher-${theme}-${String(width)}`);
        shown.unmount();
        shown = await renderInApp(() => <BusinessScreen store={store} slug="acme" toasts={toasts} />, {
          data: {},
          pattern: '/w/$slug/settings/business',
          at: '/w/acme/settings/business',
        });
        await expect.element(page.getByRole('heading', { name: 'Businesses' })).toBeVisible();
        expect(await axeViolations()).toEqual([]);
        await shoot(`businesses-full-${theme}-${String(width)}`);
        await page.getByRole('button', { name: 'Add business' }).click();
        await expect.element(page.getByRole('dialog', { name: 'New business' })).toBeVisible();
        expect(await axeViolations()).toEqual([]);
        await shoot(`add-business-${theme}-${String(width)}`);
      });
    }
  }
});
