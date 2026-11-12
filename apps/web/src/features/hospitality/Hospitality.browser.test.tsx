// The Hospitality setup in Chromium (spec 0065, H0), over a fake store that changes as the real one shows a change:
// Settings › Apps asks for Menu before Menu QR and turns both on, and asks before turning one off; Settings › Business lists each place with today's
// hours; a place's page draws a late Friday as running into the next morning; a place's tables add "T7 to T16" in one go and take a table offline at once. axe is clean in
// light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set, each screen is also photographed there.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/app.css';
import type {
  AppsView,
  BusinessView,
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  PlaceFloor,
  PropertiesView,
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
  canManage: true,
  hasBusiness: true,
  apps: [
    { app: 'menu', installed: true, installedAt: '2026-11-01T10:00:00.000Z' },
    { app: 'menu_qr', installed: false },
    { app: 'table_seating', installed: false },
    { app: 'appointments', installed: true },
    { app: 'events', installed: false },
  ],
};

const BUSINESS: BusinessView = {
  canEdit: true,
  profile: {
    id: '0192f0c8-0000-7000-8000-00000000b001',
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

const FIRST = '0192f0c8-0000-7000-8000-00000000b001';
const SECOND = '0192f0c8-0000-7000-8000-00000000b002';

/** The workspace's businesses (spec 0065 H7): the one, or a second with nothing in it yet. */
const businessesOf = (count: 1 | 2, canManage: boolean): PropertiesView => ({
  canManage,
  properties: [
    { id: FIRST, name: 'Somewhere Nowhere', kind: 'restaurant', currency: 'GBP', position: 0, holds: 1 },
    ...(count === 2
      ? [{ id: SECOND, name: 'Late Bar', kind: 'bar' as const, currency: 'EUR', position: 1, holds: 0 }]
      : []),
  ],
});

/** A store holding one workspace's apps, business and one floor, recording the writes. */
function storeOf(canManage = true, businesses: 1 | 2 = 1) {
  const calls: string[] = [];
  const apps = heldOf({ ...APPS, canManage });
  const properties = heldOf(businessesOf(businesses, canManage));
  const choice = heldOf<string | undefined>(undefined);
  let guard: (() => Promise<boolean>) | undefined;
  const business = heldOf(BUSINESS);
  const floor = heldOf(FLOOR);
  const done = () => Promise.resolve(undefined);
  const store = {
    newId: () => '01900002-0000-7000-8000-000000000001',
    apps: () => apps.held,
    business: () => business.held,
    properties: () => properties.held,
    choice: () => choice.held,
    choose: (_slug: string, id: string) => {
      calls.push(`choose:${id}`);
      choice.set(() => id);
    },
    // The real store asks the screen's guard first; this one keeps it and asks it the same way.
    guardChoice: (_slug: string, next: (() => Promise<boolean>) | undefined) => {
      guard = next;
    },
    dropGuard: (_slug: string, mine: () => Promise<boolean>) => {
      if (guard === mine) guard = undefined;
    },
    requestChoice: async (_slug: string, id: string) => {
      if (guard !== undefined && !(await guard())) return false;
      calls.push(`choose:${id}`);
      choice.set(() => id);
      return true;
    },
    createProperty: (_slug: string, input: { readonly name: string }) => {
      calls.push(`createProperty:${input.name}`);
      return done();
    },
    removeProperty: (_slug: string, id: string) => {
      calls.push(`removeProperty:${id}`);
      properties.set((view) => ({ ...view, properties: view.properties.filter((each) => each.id !== id) }));
      return done();
    },
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

/** The press a pointer gives a switch: on its label. */
async function pressSwitch(name: string) {
  const label = page.getByRole('switch', { name, exact: true }).element().closest('label');
  if (label === null) throw new Error('No switch.');
  await userEvent.click(label);
}

const openApps = (store: HospitalityStore) => {
  return renderInApp(() => <AppsScreen store={store} slug="acme" toasts={toasts} />, {
    data: {},
    pattern: '/w/$slug/settings/apps',
    at: '/w/acme/settings/apps',
  });
};

describe('Settings › Apps', () => {
  it('turns Menu QR on in one press while Menu is on', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf();
    shown = await openApps(store);
    await expect.element(page.getByRole('heading', { name: 'Menu QR' })).toBeInTheDocument();
    await pressSwitch('Menu QR');
    await expect.poll(() => calls).toEqual(['install:menu_qr:false']);
  });

  it('offers no switch on an app still on its way, and says nothing of installing', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf();
    shown = await openApps(store);
    await expect.element(page.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    await expect.element(page.getByRole('switch', { name: 'Events', exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole('switch', { name: 'Appointments', exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('On its way').first()).toBeVisible();
    expect(document.body.textContent).not.toMatch(/install/i);
  });

  it('asks for Menu when Menu QR is turned on alone', async () => {
    await page.viewport(1280, 900);
    const { store, calls } = storeOf();
    await store.remove('acme', 'menu');
    shown = await openApps(store);
    await pressSwitch('Menu QR');
    await expect.element(page.getByRole('heading', { name: 'Menu QR needs Menu' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Turn both on' }));
    await expect.poll(() => calls).toEqual(['install:menu_qr:true']);
  });

  it('asks before turning an app off', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf();
    shown = await openApps(store);
    await pressSwitch('Menu');
    await expect.element(page.getByRole('heading', { name: 'Turn off Menu?' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Turn off', exact: true }));
    await expect.element(page.getByRole('switch', { name: 'Menu', exact: true })).not.toBeChecked();
  });

  it('shows someone who can’t switch the apps a word for each, and no switch', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf(false);
    shown = await openApps(store);
    await expect.element(page.getByRole('heading', { name: 'Menu QR' })).toBeInTheDocument();
    await expect.element(page.getByRole('switch').first()).not.toBeInTheDocument();
    await expect.element(page.getByText('Only owners and admins can turn apps on or off.')).toBeVisible();
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

  it('offers an admin a second business, and lists two with the one shown marked, switching on a row', async () => {
    await page.viewport(1280, 900);
    const one = storeOf();
    shown = await renderInApp(() => <BusinessScreen store={one.store} slug="acme" toasts={toasts} />, {
      data: {},
      pattern: '/w/$slug/settings/business',
      at: '/w/acme/settings/business',
    });
    await expect.element(page.getByText('More than one business?')).toBeVisible();
    await page.getByRole('button', { name: 'Add business' }).click();
    await expect.element(page.getByRole('dialog', { name: 'New business' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    shown.unmount();
    const { store, calls } = storeOf(true, 2);
    shown = await renderInApp(() => <BusinessScreen store={store} slug="acme" toasts={toasts} />, {
      data: {},
      pattern: '/w/$slug/settings/business',
      at: '/w/acme/settings/business',
    });
    await expect.element(page.getByRole('rowheader', { name: /^Somewhere Nowhere\s*Showing$/ })).toBeVisible();
    // Only the empty second one can go, and it asks first.
    await expect.element(page.getByRole('button', { name: 'Remove Somewhere Nowhere' })).not.toBeInTheDocument();
    // Unsaved profile changes ask first: Keep editing stays, Discard and switch goes.
    await page.getByRole('textbox', { name: 'Phone' }).fill('+44 20 7946 0001');
    await page.getByRole('rowheader', { name: 'Late Bar' }).click();
    await expect.element(page.getByRole('button', { name: 'Keep editing' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    expect(calls).not.toContain(`choose:${SECOND}`);
    await page.getByRole('rowheader', { name: 'Late Bar' }).click();
    await page.getByRole('button', { name: 'Discard and switch' }).click();
    await expect.poll(() => calls).toContain(`choose:${SECOND}`);
    await expect.element(page.getByRole('rowheader', { name: /^Late Bar\s*Showing$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Late Bar' }).click();
    await page.getByRole('button', { name: 'Remove business' }).click();
    await expect.poll(() => calls).toContain(`removeProperty:${SECOND}`);
  });

  it('hides the businesses from a member who can’t add one while there is one', async () => {
    await page.viewport(1280, 900);
    const { store } = storeOf(false);
    shown = await renderInApp(() => <BusinessScreen store={store} slug="acme" toasts={toasts} />, {
      data: {},
      pattern: '/w/$slug/settings/business',
      at: '/w/acme/settings/business',
    });
    await expect.element(page.getByRole('rowheader', { name: 'Soho' })).toBeInTheDocument();
    await expect.element(page.getByText('More than one business?')).not.toBeInTheDocument();
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
        const many = storeOf(true, 2).store;
        const screens = [
          ['apps', 'Menu QR', () => <AppsScreen store={store} slug="acme" toasts={toasts} />],
          ['business', 'Places', () => <BusinessScreen store={store} slug="acme" toasts={toasts} />],
          // Two businesses (spec 0065 H7): the list, the one shown marked.
          ['businesses', 'Businesses', () => <BusinessScreen store={many} slug="acme" toasts={toasts} />],
          [
            'tables',
            'Zones',
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
        await expect.element(page.getByRole('heading', { name: 'Zones' })).toBeInTheDocument();
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
        shown = await renderInApp(() => <AppsScreen store={store} slug="acme" toasts={toasts} />, {
          data: {},
          pattern: '/w/$slug/settings/x',
          at: '/w/acme/settings/x',
        });
        await pressSwitch('Menu');
        await expect.element(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toBeVisible();
        await new Promise((resolve) => setTimeout(resolve, 400));
        await shoot('remove-app', theme, width);
        await userEvent.keyboard('{Escape}');
      });
    }
  }
});

describe('Tables, after checklabs’ Tables page', () => {
  it('groups the tables by zone under the zone chips, each with its seats and whole code', async () => {
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
        await expect.element(page.getByRole('radiogroup', { name: 'Zones' })).toBeInTheDocument();
        await expect.element(page.getByRole('radio', { name: 'All (6)' })).toBeInTheDocument();
        await expect.element(page.getByRole('heading', { name: 'Terrace', level: 2 })).toBeInTheDocument();
        await expect.element(page.getByRole('heading', { name: 'Unzoned' })).toBeInTheDocument();
        await expect.element(page.getByText('6 of 6 tables')).toBeInTheDocument();
        // The whole code, and the label as the table has it (never "Table 1").
        await expect.element(page.getByText('C0DE0abcdefghijklmnopq')).toBeInTheDocument();
        await expect.element(page.getByRole('rowheader', { name: 'T1', exact: true })).toBeInTheDocument();
        expect(await axeViolations()).toEqual([]);
        await shoot('tables', theme, width);
      }
    }
    // A zone chip shows that zone alone, and Print takes it.
    await userEvent.click(page.getByRole('radio', { name: 'Terrace (2)' }));
    await expect.element(page.getByRole('heading', { name: 'Unzoned' })).not.toBeInTheDocument();
    await expect.element(page.getByText('2 of 6 tables')).toBeInTheDocument();
    const terrace = [FLOOR.resources[0]?.id, FLOOR.resources[1]?.id].join('%2C');
    await expect
      .element(page.getByRole('link', { name: 'Print QR sheet' }))
      .toHaveAttribute('href', expect.stringContaining(`tables=${terrace}`));
    // A ticked row is what Print takes, and Clear lets it go.
    await userEvent.click(page.getByRole('checkbox', { name: 'Select T2' }), { force: true });
    await expect.element(page.getByText('2 of 6 tables · 1 selected')).toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Print QR sheet' }))
      .toHaveAttribute('href', expect.stringContaining(`tables=${FLOOR.resources[1]?.id ?? ''}`));
    await userEvent.click(page.getByRole('button', { name: 'Clear the selection' }));
    await expect.element(page.getByText('2 of 6 tables')).toBeInTheDocument();
  });

  it('adds one table in the drawer, or several, and edits one with its code to read', async () => {
    await page.viewport(1280, 1100);
    const { store, calls } = storeOf();
    shown = await renderInApp(() => <QrScreen slug="acme" hospitality={store} look={{}} toasts={toasts} />, {
      data: {},
      pattern: '/w/$slug/qr',
      at: '/w/acme/qr',
    });
    await userEvent.click(page.getByRole('button', { name: 'Add table' }));
    const drawer = page.getByRole('dialog', { name: 'Add table' });
    await expect.element(drawer.getByPlaceholder('e.g. T12, Bar 3, Patio A')).toBeVisible();
    await userEvent.fill(drawer.getByLabelText('Label'), 'T12');
    await userEvent.click(drawer.getByRole('button', { name: 'Create table' }));
    await expect.poll(() => calls.at(-1)).toBe('add:T12');
    await expect.element(drawer).not.toBeInTheDocument();
    // Several: today's run in the same drawer.
    await userEvent.click(page.getByRole('button', { name: 'Add table' }));
    const again = page.getByRole('dialog', { name: 'Add table' });
    await expect.element(again.getByText('Several', { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await userEvent.click(again.getByText('Several', { exact: true }));
    await expect.element(again.getByRole('button', { name: /^Create 10 tables$/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(again).not.toBeInTheDocument();
    // Edit: the label, seats and zone, with the code and link read only.
    await userEvent.click(page.getByRole('button', { name: 'Edit T1' }));
    const edit = page.getByRole('dialog', { name: 'Edit table' });
    await expect.element(edit.getByText('C0DE0abcdefghijklmnopq')).toBeVisible();
    await expect.element(edit.getByRole('button', { name: 'Save table' })).toBeVisible();
  });
});
