// The reservation settings in Chromium (spec 0066 B7 lite), in checklabs' Online booking order with its defaults:
// Accept online bookings, Time zone, Service hours, Slot interval and Turn time, Min lead and Booking window, Min and
// Max party, Max covers per slot; Save settings sends the numbers as typed, minutes for the lead. axe is clean in
// light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set, each is photographed.
import '@crm/ui/styles.css';
import type {
  BusinessView,
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  TableRules,
  TableSetupView,
  TablesStore,
} from '@crm/data';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ReservationsScreen } from './ReservationsScreen.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const PLACE = '01900000-0000-7000-8000-000000000001';

const BUSINESS: BusinessView = {
  canEdit: true,
  profile: { name: 'Somewhere Nowhere', kind: 'restaurant', links: [], currency: 'GBP' },
  places: [
    {
      id: PLACE,
      name: 'Soho',
      country: 'GB',
      timeZone: 'Europe/London',
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

const SETUP: TableSetupView = {
  placeId: PLACE,
  rules: RULES,
  saved: false,
  steps: [
    { step: 'hours', done: true },
    { step: 'tables', done: true },
    { step: 'rules', done: true },
  ],
  ready: true,
  publicKey: 'AbCdEfGhIjKlMnOp',
  notifyMe: true,
};

function heldOf<Value>(value: Value): HospitalityHeld<Value> {
  const state: HospitalityHeldState<Value> = { status: 'ready', value, isSaving: false };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
}

function storesOf() {
  const saved: TableRules[] = [];
  const hospitality = { business: () => heldOf(BUSINESS) } as unknown as HospitalityStore;
  const tables = {
    setup: () => heldOf(SETUP),
    saveSetup: (_slug: string, _place: string, rules: TableRules) => {
      saved.push(rules);
      return Promise.resolve(undefined);
    },
    setNotify: () => Promise.resolve(undefined),
  } as unknown as TablesStore;
  return { hospitality, tables, saved };
}

const toasts = { toast: () => '', dismiss: () => undefined } as never;

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png` });
}

async function show(width: number) {
  await page.viewport(width, width < 600 ? 844 : 900);
  const stores = storesOf();
  shown = await renderInApp(
    () => (
      <ReservationsScreen slug="acme" tables={stores.tables} hospitality={stores.hospitality} toasts={toasts} />
    ),
    { data: {}, pattern: '/w/$slug/reservations', at: '/w/acme/reservations' },
  );
  await expect.element(page.getByRole('switch', { name: /Accept online bookings/ })).toBeInTheDocument();
  return stores.saved;
}

describe('Reservation settings (checklabs’ Online booking)', () => {
  it('reads in checklabs’ order with its defaults, and saves the lead in minutes', async () => {
    const saved = await show(1280);
    const order = ['Accept online bookings', 'Time zone', 'Service hours', 'Slot interval', 'Turn time', 'Min lead'];
    const text = document.body.innerText;
    const at = order.map((label) => text.indexOf(label));
    expect(at.every((each) => each >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    await expect.element(page.getByText('Europe/London')).toBeVisible();
    await expect.element(page.getByText('No bookings').first()).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Min lead' })).toHaveValue('120');
    await userEvent.fill(page.getByRole('textbox', { name: 'Min lead' }), '45');
    await userEvent.click(page.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ noticeMinutes: 45, stepMinutes: 30, minutes: 90, online: false });
  });

  it('refuses a min party over the max, at the field', async () => {
    const saved = await show(1280);
    await userEvent.fill(page.getByRole('textbox', { name: 'Min party' }), '10');
    await userEvent.click(page.getByRole('button', { name: 'Save settings' }));
    await expect.element(page.getByText('Min party can’t be more than max party.')).toBeVisible();
    expect(saved).toHaveLength(0);
  });

  for (const width of [1280, 390]) {
    it(`passes axe in light and dark at ${String(width)}px`, async () => {
      await show(width);
      for (const theme of THEMES) {
        applyTheme(theme);
        expect(await axeViolations()).toEqual([]);
        await shoot('reservations', theme, width);
      }
    });
  }
});
