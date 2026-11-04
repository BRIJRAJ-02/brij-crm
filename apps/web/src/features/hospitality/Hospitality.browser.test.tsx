// The Hospitality setup in Chromium (spec 0065, H0), over a fake store that changes as the real one shows a change:
// Settings › Apps asks for Menu before Menu QR and installs both; Settings › Business lists each place with today's
// hours; a place's page draws a late Friday as running into the next morning; a place's tables add "T7 to T16" in one go and take a table offline at once. axe is clean in
// light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set, each screen is also photographed there.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import type {
  AppsView,
  BusinessView,
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  PlaceFloor,
} from '@crm/data';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { AppsScreen } from './AppsScreen.tsx';
import { BusinessScreen } from './BusinessScreen.tsx';
import { QrScreen } from '../menu-qr/QrScreen.tsx';
import { FloorScreen } from './FloorScreen.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const PLACE = '01900000-0000-7000-8000-000000000001';

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

const APPS: AppsView = {
  available: true,
  canManage: true,
  hasBusiness: true,
  apps: [
    { app: 'menu', installed: true, installedAt: '2026-11-01T10:00:00.000Z' },
    { app: 'menu_qr', installed: false },
    { app: 'table_seating', installed: false },
  ],
};

const BUSINESS: BusinessView = {
  canEdit: true,
  profile: {
    name: 'Somewhere Nowhere',
    kind: 'restaurant',
    description: 'Small plates, natural wine, late nights.',
    phone: '+44 20 7946 0000',
    links: [],
    currency: 'GBP',
  },
  places: [
    {
      id: PLACE,
      name: 'Soho',
      addressLine: '12 Greek Street',
      city: 'London',
      postcode: 'W1D 4DL',
      country: 'GB',
      timeZone: 'Europe/London',
      locale: 'en-GB',
      hours: {
        weekly: {
          tue: [
            { from: '12:00', to: '15:00', name: 'Lunch' },
            { from: '18:00', to: '23:00', name: 'Dinner' },
          ],
          wed: [{ from: '18:00', to: '23:00' }],
          thu: [{ from: '18:00', to: '23:00' }],
          fri: [{ from: '18:00', to: '02:00' }],
          sat: [{ from: '18:00', to: '02:00' }],
        },
        exceptions: [{ date: '2026-12-25', closed: true, note: 'Christmas' }],
      },
      resourceCount: 6,
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
  ],
};

const table = (index: number, area?: string) => ({
  id: `0190000${String(index)}-0000-7000-8000-000000000000`,
  kind: 'table' as const,
  label: `T${String(index)}`,
  ...(area === undefined ? {} : { areaId: area }),
  minCapacity: 2,
  maxCapacity: index > 4 ? 6 : 4,
  online: index !== 3,
  joins: [],
  position: index - 1,
  archived: false,
});

const TERRACE = '01900000-0000-7000-8000-0000000000aa';
const FLOOR: PlaceFloor = {
  placeId: PLACE,
  areas: [
    { id: TERRACE, name: 'Terrace', position: 0 },
    { id: '01900000-0000-7000-8000-0000000000bb', name: 'Inside', position: 1 },
  ],
  resources: [table(1, TERRACE), table(2, TERRACE), table(3), table(4), table(5), table(6)],
};

/** A held copy that a test changes by hand, as the real store's holder shows a change. */
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
  const set = (next: (value: Value) => Value) => {
    if (state.status !== 'ready') return;
    state = { status: 'ready', value: next(state.value), isSaving: false };
    for (const listener of listeners) listener();
  };
  return { held, set };
}

/** A store holding one workspace's apps, business and one floor, recording the writes. */
function storeOf() {
  const calls: string[] = [];
  const apps = heldOf(APPS);
  const business = heldOf(BUSINESS);
  const floor = heldOf(FLOOR);
  const done = () => Promise.resolve(undefined);
  const store = {
    newId: () => '01900002-0000-7000-8000-000000000001',
    apps: () => apps.held,
    business: () => business.held,
    floor: () => floor.held,
    // Each live table's code, as the QR codes answer reads (spec 0065, H2).
    qrCodes: () =>
      heldOf({
        placeId: PLACE,
        placeName: 'Soho',
        menuKey: 'AbCdEfGhIjKlMnOp',
        menuState: 'live' as const,
        tables: FLOOR.resources.map((each, index) => ({
          id: each.id,
          label: each.label,
          code: `C0DE${String(index)}abcdefghijklmnopq`,
          scans: index * 3,
        })),
      }).held,
    regenerateTableCode: done,
    install: (_slug: string, app: string, options: { withNeeded?: boolean } = {}) => {
      calls.push(`install:${app}:${String(options.withNeeded === true)}`);
      apps.set((view) => ({
        ...view,
        apps: view.apps.map((each) =>
          each.app === app || (options.withNeeded === true && each.app === 'menu')
            ? { ...each, installed: true }
            : each,
        ),
      }));
      return done();
    },
    remove: (_slug: string, app: string) => {
      apps.set((view) => ({
        ...view,
        apps: view.apps.map((each) => (each.app === app ? { ...each, installed: false } : each)),
      }));
      return done();
    },
    addResources: (_slug: string, _place: string, input: { readonly labels: readonly string[] }) => {
      calls.push(`add:${input.labels.join(',')}`);
      floor.set((view) => ({
        ...view,
        resources: [
          ...view.resources,
          ...input.labels.map((label, index) => ({
            ...table(7 + index),
            id: `01900009-0000-7000-8000-${String(index).padStart(12, '0')}`,
            label,
            position: view.resources.length + index,
          })),
        ],
      }));
      return done();
    },
    updateResource: (_slug: string, _place: string, resourceId: string, change: { readonly online?: boolean }) => {
      calls.push(`online:${String(change.online)}`);
      floor.set((view) => ({
        ...view,
        resources: view.resources.map((each) =>
          each.id === resourceId && change.online !== undefined ? { ...each, online: change.online } : each,
        ),
      }));
      return done();
    },
    updatePlace: done,
    saveBusiness: done,
    createPlace: done,
    moveResource: done,
    archiveResource: done,
    restoreResource: done,
    deleteResource: done,
    saveArea: done,
    deleteArea: done,
  } as unknown as HospitalityStore;
  return { store, calls };
}

const toasts = { toast: () => undefined } as never;

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png`, fullPage: true } as never);
}

describe('Settings › Apps', () => {
  it('installs Menu QR in one press while Menu is in', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf();
    shown = await renderInApp(() => <AppsScreen store={store} slug="acme" workspace={undefined} toasts={toasts} />, {
      data: {},
      pattern: '/w/$slug/settings/apps',
      at: '/w/acme/settings/apps',
    });
    await expect.element(page.getByRole('heading', { name: 'Menu QR' })).toBeInTheDocument();
    // Menu is in already, so Menu QR's Install asks nothing more.
    await userEvent.click(page.getByRole('button', { name: 'Install Menu QR', exact: true }));
    await expect.poll(() => calls).toEqual(['install:menu_qr:false']);
  });

  it('asks for Menu when Menu QR is installed alone', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf();
    await store.remove('acme', 'menu');
    shown = await renderInApp(() => <AppsScreen store={store} slug="acme" workspace={undefined} toasts={toasts} />, {
      data: {},
      pattern: '/w/$slug/settings/apps',
      at: '/w/acme/settings/apps',
    });
    await userEvent.click(page.getByRole('button', { name: 'Install Menu QR', exact: true }));
    await expect.element(page.getByRole('heading', { name: 'Menu QR needs Menu' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Install both' }));
    await expect.poll(() => calls).toEqual(['install:menu_qr:true']);
  });
});

describe('Settings › Business and a place’s tables', () => {
  it('lists each place as a row that opens its page', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf();
    shown = await renderInApp(() => <BusinessScreen store={store} slug="acme" toasts={toasts} />, {
      data: {},
      pattern: '/w/$slug/settings/business',
      at: '/w/acme/settings/business',
    });
    await expect.element(page.getByRole('rowheader', { name: 'Soho' })).toBeInTheDocument();
    await expect.element(page.getByText('6 tables')).toBeInTheDocument();
  });

  it('reads a late Friday as running into the next morning', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf();
    shown = await renderInApp(
      () => <FloorScreen store={store} slug="acme" place={BUSINESS.places[0] as never} toasts={toasts} />,
      {
        data: {},
        pattern: '/w/$slug/settings/business/places/$placeId',
        at: `/w/acme/settings/business/places/${PLACE}`,
      },
    );
    await expect.element(page.getByRole('heading', { name: 'Opening hours' })).toBeInTheDocument();
    // Friday's end, past midnight, shows the time alone in its field; the list says "next day" beside it.
    await expect.poll(() => document.body.textContent).toMatch(/2:00\s?am/i);
  });

  it('draws a place’s page without React warning of a key used twice', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf();
    const warnings: string[] = [];
    const was = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      shown = await renderInApp(
        () => <FloorScreen store={store} slug="acme" place={BUSINESS.places[0] as never} toasts={toasts} />,
        {
          data: {},
          pattern: '/w/$slug/settings/business/places/$placeId',
          at: `/w/acme/settings/business/places/${PLACE}`,
        },
      );
      await expect.element(page.getByRole('heading', { name: 'Opening hours' })).toBeInTheDocument();
    } finally {
      console.error = was;
    }
    expect(warnings.filter((warning) => warning.includes('same key'))).toEqual([]);
  });

  it('adds T7 to T16 in one go, and takes a table offline at once', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf();
    shown = await renderInApp(
      () => <FloorScreen store={store} slug="acme" place={BUSINESS.places[0] as never} toasts={toasts} />,
      {
        data: {},
        pattern: '/w/$slug/settings/business/places/$placeId',
        at: `/w/acme/settings/business/places/${PLACE}`,
      },
    );
    // The switch's label takes the press, as a pointer meets it.
    const online = page.getByRole('switch', { name: 'T1 takes online bookings' }).element().closest('label');
    if (online === null) throw new Error('No switch.');
    await userEvent.click(online);
    await expect.element(page.getByRole('switch', { name: 'T1 takes online bookings' })).not.toBeChecked();
    await userEvent.click(page.getByRole('button', { name: 'Add tables' }).first());
    await expect.element(page.getByText('Adds 10: T7 to T16')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Add 10 tables' }));
    await expect.poll(() => calls.at(-1)).toBe('add:T7,T8,T9,T10,T11,T12,T13,T14,T15,T16');
    await expect.element(page.getByText('T16', { exact: true })).toBeInTheDocument();
  });
});

describe('axe and the pictures', () => {
  for (const theme of THEMES) {
    for (const width of [1280, 390]) {
      it(`is clean in ${theme} at ${String(width)}`, async () => {
        await page.viewport(width, 900);
        applyTheme(theme);
        const { store } = storeOf();
        const screens = [
          ['apps', 'Menu QR', () => <AppsScreen store={store} slug="acme" workspace={undefined} toasts={toasts} />],
          ['business', 'Places', () => <BusinessScreen store={store} slug="acme" toasts={toasts} />],
          [
            'tables',
            'Areas',
            () => <FloorScreen store={store} slug="acme" place={BUSINESS.places[0] as never} toasts={toasts} />,
          ],
        ] as const;
        for (const [name, heading, screen] of screens) {
          shown = await renderInApp(screen, { data: {}, pattern: '/w/$slug/settings/x', at: '/w/acme/settings/x' });
          await expect.element(page.getByRole('heading', { name: heading })).toBeInTheDocument();
          await shoot(name, theme, width);
          expect(await axeViolations(), name).toEqual([]);
          shown.unmount();
          shown = undefined;
        }
      });
    }
  }
});

// Pictures with something open (only with VITE_SHOT_DIR): Add tables, a table's row menu, and the remove Modal, in a
// window tall enough to hold the whole page.
describe.skipIf(SHOT_DIR === undefined || SHOT_DIR === '')('the pictures with something open', () => {
  for (const theme of THEMES) {
    for (const width of [1280, 390]) {
      it(`opens Add tables, a row menu and Remove in ${theme} at ${String(width)}`, async () => {
        await page.viewport(width, 2000);
        applyTheme(theme);
        const { store } = storeOf();
        shown = await renderInApp(
          () => <FloorScreen store={store} slug="acme" place={BUSINESS.places[0] as never} toasts={toasts} />,
          { data: {}, pattern: '/w/$slug/settings/x', at: '/w/acme/settings/x' },
        );
        await expect.element(page.getByRole('heading', { name: 'Areas' })).toBeInTheDocument();
        await shoot('place', theme, width);
        await userEvent.click(page.getByRole('button', { name: 'Add tables' }).first());
        await expect.element(page.getByRole('dialog')).toBeVisible();
        await new Promise((resolve) => setTimeout(resolve, 400));
        await shoot('add-tables', theme, width);
        await userEvent.keyboard('{Escape}');
        await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
        await userEvent.click(page.getByRole('button', { name: 'T2 actions' }));
        await expect.element(page.getByRole('menu')).toBeVisible();
        await new Promise((resolve) => setTimeout(resolve, 400));
        await shoot('row-menu', theme, width);
        await userEvent.keyboard('{Escape}');
        shown.unmount();
        shown = await renderInApp(
          () => <AppsScreen store={store} slug="acme" workspace={undefined} toasts={toasts} />,
          { data: {}, pattern: '/w/$slug/settings/x', at: '/w/acme/settings/x' },
        );
        await userEvent.click(page.getByRole('button', { name: 'Remove' }));
        await expect.element(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toBeVisible();
        await new Promise((resolve) => setTimeout(resolve, 400));
        await shoot('remove-app', theme, width);
        await userEvent.keyboard('{Escape}');
      });
    }
  }
});

describe('Tables, after checklabs’ Tables page', () => {
  it('groups the tables by area under the area pills, each with its seats, code and scans', async () => {
    for (const theme of THEMES) {
      for (const width of [1280, 390]) {
        await page.viewport(width, 1100);
        shown?.unmount();
        const { store } = storeOf();
        shown = await renderInApp(() => <QrScreen slug="acme" hospitality={store} look={{}} toasts={toasts} />, {
          data: {},
          pattern: '/w/$slug/qr',
          at: '/w/acme/qr',
        });
        applyTheme(theme);
        await expect.element(page.getByRole('heading', { name: 'Tables', level: 1 })).toBeInTheDocument();
        await expect.element(page.getByRole('radio', { name: 'All (6)' })).toBeInTheDocument();
        await expect.element(page.getByRole('heading', { name: 'Terrace' })).toBeInTheDocument();
        await expect.element(page.getByRole('heading', { name: 'No area' })).toBeInTheDocument();
        expect(await axeViolations()).toEqual([]);
        await shoot('tables', theme, width);
      }
    }
    // An area pill shows that area alone.
    await userEvent.click(page.getByRole('radio', { name: 'Terrace (2)' }));
    await expect.element(page.getByRole('heading', { name: 'No area' })).not.toBeInTheDocument();
  });
});
