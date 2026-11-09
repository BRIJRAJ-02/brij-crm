// Online booking in Chromium (spec 0066 B7 lite): checklabs' sheet, opened from the Reservations page's bar, in its
// order and with its defaults (Accept online bookings, Time zone, Service hours, Slot interval and Turn time, Min lead
// and Booking window, Min and Max party, Max covers per slot), then ours; one form with one Save settings at its foot,
// which sends the numbers as typed and, with Accept online bookings on, publishes; turning it off asks first. axe is
// clean in light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set, each is photographed.
import '@crm/ui/styles.css';
import type {
  BusinessView,
  HospitalityHeld,
  HospitalityHeldState,
  PlaceFloor,
  ServiceDayView,
  TableRules,
  TableSetupView,
  TablesStore,
} from '@crm/data';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ReservationsScreen } from './ReservationsScreen.tsx';
import type { ReservationsSearch } from './search.ts';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const PLACE = '01900000-0000-7000-8000-000000000001';
const ZONE = 'Europe/London';
const TODAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: ZONE,
}).format(new Date());

const BUSINESS: BusinessView = {
  canEdit: true,
  profile: {
    id: '0192f0c8-0000-7000-8000-00000000b001',
    name: 'Somewhere Nowhere',
    kind: 'restaurant',
    links: [],
    currency: 'GBP',
  },
  places: [
    {
      id: PLACE,
      name: 'Soho',
      country: 'GB',
      timeZone: ZONE,
      locale: 'en-GB',
      hours: {
        weekly: {
          tue: [
            { from: '12:00', to: '15:00' },
            { from: '18:00', to: '23:00' },
          ],
          wed: [{ from: '18:00', to: '23:00' }],
          fri: [{ from: '18:00', to: '02:00' }],
        },
        exceptions: [],
      },
      resourceCount: 6,
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
  ],
};

/** Checklabs' defaults: 30 minute slots, 90 minute turn, 120 minutes' lead, 60 days ahead, parties of 1 to 8. */
const RULES: TableRules = {
  minutes: 90,
  holds: [
    { size: 3, minutes: 105 },
    { size: 5, minutes: 120 },
    { size: 7, minutes: 150 },
  ],
  partyMin: 1,
  partyMax: 8,
  stepMinutes: 30,
  noticeMinutes: 120,
  windowDays: 60,
  changeCutoffMinutes: 120,
  cancelCutoffMinutes: 120,
  online: false,
};

const setupOf = (online: boolean): TableSetupView => ({
  placeId: PLACE,
  rules: { ...RULES, online },
  saved: online,
  steps: [
    { step: 'hours', done: true },
    { step: 'tables', done: true },
    { step: 'rules', done: true },
  ],
  ready: true,
  publicKey: 'AbCdEfGhIjKlMnOp',
  notifyMe: true,
});

const DAY: ServiceDayView = {
  date: TODAY,
  zone: ZONE,
  visits: [],
  covers: { booked: 0, seated: 0, toCome: 0 },
  truncated: false,
};

const FLOOR: PlaceFloor = { placeId: PLACE, areas: [], resources: [] };

function heldOf<Value>(value: Value): HospitalityHeld<Value> {
  const state: HospitalityHeldState<Value> = { status: 'ready', value, isSaving: false };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
}

/** A held copy that can change under the sheet, as another manager's save changes it. */
function changingHeld<Value>(value: Value) {
  let state: HospitalityHeldState<Value> = { status: 'ready', value, isSaving: false };
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
  const change = (next: Value) => {
    state = { status: 'ready', value: next, isSaving: false };
    for (const listener of listeners) listener();
  };
  return { held, change };
}

/** Publish refused as the real store refuses it: the rules shown at once, then back as they were, then the refusal. */
const NO_TABLES: TableSetupView = {
  ...setupOf(false),
  ready: false,
  steps: [
    { step: 'hours', done: true },
    { step: 'tables', done: false, fix: 'Add a table guests can book online.' },
    { step: 'rules', done: true },
  ],
};

function storesOf(online: boolean, refusing = false) {
  const saved: TableRules[] = [];
  const notified: boolean[] = [];
  const business = heldOf(BUSINESS);
  const floor = heldOf(FLOOR);
  const day = heldOf(DAY);
  const { held: setup, change: changeSetup } = changingHeld(setupOf(online));
  const tables = {
    places: () => business,
    floor: () => floor,
    day: () => day,
    setup: () => setup,
    saveSetup: async (_slug: string, _place: string, rules: TableRules) => {
      saved.push(rules);
      if (!refusing) return undefined;
      changeSetup({ ...NO_TABLES, rules });
      await new Promise((resolve) => setTimeout(resolve, 0));
      changeSetup(NO_TABLES);
      return { code: 'CONFLICT', message: 'Add a table guests can book online.' };
    },
    setNotify: (_slug: string, _place: string, on: boolean) => {
      notified.push(on);
      return Promise.resolve(undefined);
    },
  } as unknown as TablesStore;
  return { tables, saved, notified, changeSetup };
}

const toasts = { toast: () => '', dismiss: () => undefined } as never;

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** Waits for the sheet's entrance (the scrim's fade, the drawer's slide) to end, so axe reads the colours it rests on. */
async function settled() {
  await Promise.all(
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)),
  );
}

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  // A drawer slides in on the drawer curve: the shot waits for it to land.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png` });
}

function Page({ tables }: { readonly tables: TablesStore }) {
  const [search, setSearch] = useState<ReservationsSearch>({});
  return <ReservationsScreen slug="acme" tables={tables} toasts={toasts} search={search} onSearch={setSearch} />;
}

/** The page at `width`, with Online booking open from the bar (from More on a narrow one). */
async function open(width: number, online = false, refusing = false) {
  await page.viewport(width, width < 600 ? 844 : 900);
  const stores = storesOf(online, refusing);
  shown = await renderInApp(() => <Page tables={stores.tables} />, {
    data: {},
    pattern: '/w/$slug/reservations',
    at: '/w/acme/reservations',
    permissions: ['hospitality.manage', 'hospitality.service'],
  });
  await expect.element(page.getByRole('heading', { name: 'Day calendar' })).toBeInTheDocument();
  if (width >= 1152) await userEvent.click(page.getByRole('button', { name: 'Online booking' }));
  else {
    await userEvent.click(page.getByRole('button', { name: 'More', exact: true }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Online booking' }));
  }
  const sheet = page.getByRole('dialog', { name: 'Online booking' });
  await expect.element(sheet.getByRole('switch', { name: /Accept online bookings/ })).toBeInTheDocument();
  return { ...stores, sheet };
}

describe('Online booking (checklabs’ sheet)', () => {
  it('reads in checklabs’ order with its defaults, and its one Save settings sends the lead in minutes', async () => {
    const { saved, sheet } = await open(1280);
    const order = ['Accept online bookings', 'Time zone', 'Service hours', 'Slot interval', 'Turn time', 'Min lead'];
    const text = sheet.element().textContent;
    const at = order.map((label) => text.indexOf(label));
    expect(at.every((each) => each >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    await expect.element(sheet.getByText(/London/).first()).toBeVisible();
    await expect.element(sheet.getByText('Closed').first()).toBeVisible();
    // One form, one save: the sheet's foot holds it, nothing else saves.
    expect(sheet.getByRole('button', { name: 'Save settings' }).elements()).toHaveLength(1);
    await expect.element(sheet.getByRole('textbox', { name: 'Min lead' })).toHaveValue('120');
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Min lead' }), '45');
    await userEvent.click(sheet.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ noticeMinutes: 45, stepMinutes: 30, minutes: 90, online: false });
    // Saved, the sheet closes.
    await expect.element(page.getByRole('dialog', { name: 'Online booking' })).not.toBeInTheDocument();
  });

  it('publishes with Accept online bookings on, in the same save, and stays open on the page’s link', async () => {
    const { saved, sheet, changeSetup } = await open(1280);
    await userEvent.click(sheet.getByText('Accept online bookings', { exact: true }));
    await expect.element(sheet.getByRole('switch', { name: /Accept online bookings/ })).toBeChecked();
    // Nothing is sent until Save settings.
    expect(saved).toHaveLength(0);
    await userEvent.click(sheet.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ online: true });
    changeSetup(setupOf(true));
    await expect.element(sheet.getByText('Your page is live')).toBeVisible();
    const field = sheet.getByRole('textbox', { name: 'Your page' });
    await expect.element(field).toBeVisible();
    expect((field.element() as HTMLInputElement).value).toMatch(/\/r\/AbCdEfGhIjKlMnOp$/);
  });

  it('never sends back what another manager changed meanwhile, only what was changed here', async () => {
    const { saved, sheet, changeSetup } = await open(1280, true);
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Max covers per slot' }), '20');
    // Meanwhile another manager takes the page offline.
    changeSetup(setupOf(false));
    await userEvent.click(sheet.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ coversCap: 20, online: false });
  });

  it('asks before turning online booking off, and saves only once asked', async () => {
    const { saved, sheet } = await open(1280, true);
    // Live: the page's link leads the sheet.
    await expect.element(sheet.getByText('Your page is live')).toBeVisible();
    await userEvent.click(sheet.getByText('Accept online bookings', { exact: true }));
    await userEvent.click(sheet.getByRole('button', { name: 'Save settings' }));
    const ask = page.getByRole('dialog', { name: 'Stop taking reservations online?' });
    await expect.element(ask).toBeVisible();
    expect(saved).toHaveLength(0);
    await userEvent.click(ask.getByRole('button', { name: 'Stop taking reservations' }));
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ online: false });
  });

  it('keeps the reader’s new reservation emails in the same save', async () => {
    const { saved, notified, sheet } = await open(1280, true);
    await userEvent.click(sheet.getByText('Email me new reservations', { exact: true }));
    await userEvent.click(sheet.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => notified).toEqual([false]);
    // The rules were already saved and unchanged: nothing else is sent.
    expect(saved).toHaveLength(0);
  });

  it('keeps what was typed when Publish is refused, and asks before Fix it leaves it', async () => {
    const { sheet, changeSetup } = await open(1280, false, true);
    changeSetup(NO_TABLES);
    const accept = sheet.getByRole('switch', { name: /Accept online bookings/ });
    await userEvent.click(sheet.getByText('Accept online bookings', { exact: true }));
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Min lead' }), '45');
    await userEvent.click(sheet.getByRole('button', { name: 'Save settings' }));
    // Refused, the rules go back in the store, but the form is what the person typed, and says why it wasn't saved.
    await expect.element(sheet.getByRole('link', { name: 'Fix it' }).nth(1)).toBeVisible();
    await expect.element(accept).toBeChecked();
    await expect.element(sheet.getByRole('textbox', { name: 'Min lead' })).toHaveValue('45');
    await userEvent.click(sheet.getByRole('link', { name: 'Fix it' }).first());
    const ask = page.getByRole('alertdialog', { name: 'Leave without saving?' });
    await expect.element(ask).toBeVisible();
    await userEvent.click(ask.getByRole('button', { name: 'Keep editing' }));
    await expect.element(accept).toBeChecked();
    expect(shown?.router.state.location.pathname).toBe('/w/acme/reservations');
  });

  it('refuses a min party over the max, at the field', async () => {
    const { saved, sheet } = await open(1280);
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Min party' }), '10');
    await userEvent.click(sheet.getByRole('button', { name: 'Save settings' }));
    await expect.element(sheet.getByText('Min party can’t be more than max party.')).toBeVisible();
    expect(saved).toHaveLength(0);
  });

  for (const width of [1280, 390]) {
    it(`passes axe in light and dark at ${String(width)}px`, async () => {
      await open(width);
      await settled();
      for (const theme of THEMES) {
        applyTheme(theme);
        expect(await axeViolations()).toEqual([]);
        await shoot('online-booking', theme, width);
      }
    });
  }
});
