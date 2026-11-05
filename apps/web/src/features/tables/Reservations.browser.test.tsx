// The Reservations page in Chromium (spec 0066 B7 lite, after checklabs' Reservations page): the chosen day alone on
// the day calendar, from 10:00, its line counting the bookings and covers; the bookings list with each guest's phone
// under the name, the source as a badge and Confirm inline on a booking not yet confirmed; "No bookings on …" on an
// empty day; a booking's detail opened from its row; New booking offering only the tables that seat the party; Walk in
// as a sheet with two guests picked and the name there at once; Online booking in the bar for those who set the apps
// up. axe is clean in light and dark at a desktop's and a phone's width, the sheets too, with reduced motion and
// without. With VITE_SHOT_DIR set, each is photographed.
import '@crm/ui/styles.css';
import type {
  BusinessView,
  FreeTablesView,
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  PlaceFloor,
  ServiceDayView,
  StaffBooking,
  TableRules,
  TableSetupView,
  TablesStore,
} from '@crm/data';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { addDays, instantAt } from '../bookings/week.ts';
import { ReservationsScreen } from './ReservationsScreen.tsx';
import type { ReservationsSearch } from './search.ts';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const ZONE = 'Europe/London';
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PLACE = id(1);
const TERRACE = id(2);
const INSIDE = id(3);
const TODAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: ZONE,
}).format(new Date());
const at = (hour: number, minute = 0) => instantAt(TODAY, hour * 60 + minute, ZONE).toISOString();

const BUSINESS: BusinessView = {
  canEdit: true,
  profile: { name: 'Somewhere Nowhere', kind: 'restaurant', links: [], currency: 'GBP' },
  places: [
    {
      id: PLACE,
      name: 'Soho',
      country: 'GB',
      timeZone: ZONE,
      locale: 'en-GB',
      hours: { weekly: {}, exceptions: [] },
      resourceCount: 4,
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
  ],
};

const table = (n: number, label: string, min: number, max: number, areaId?: string) => ({
  id: id(10 + n),
  kind: 'table' as const,
  label,
  ...(areaId === undefined ? {} : { areaId }),
  minCapacity: min,
  maxCapacity: max,
  online: true,
  joins: [],
  position: n,
  archived: false,
});

const FLOOR: PlaceFloor = {
  placeId: PLACE,
  areas: [
    { id: TERRACE, name: 'Terrace', position: 0 },
    { id: INSIDE, name: 'Inside', position: 1 },
  ],
  resources: [
    table(1, 'T1', 1, 2, TERRACE),
    table(2, 'T2', 2, 4, TERRACE),
    table(3, 'T3', 2, 4, INSIDE),
    table(4, 'T4', 4, 8, INSIDE),
  ],
};

const visit = (
  n: number,
  name: string,
  start: string,
  end: string,
  party: number,
  extra: Partial<ServiceDayView['visits'][number]> = {},
): ServiceDayView['visits'][number] => ({
  id: id(100 + n),
  start,
  end,
  name,
  party,
  status: 'booked',
  resourceIds: [],
  lookupCode: `ABCD${String(n).padStart(4, '0')}`,
  source: 'online',
  ...extra,
});

const DAY: ServiceDayView = {
  date: TODAY,
  zone: ZONE,
  visits: [
    visit(1, 'Ada Lovelace', at(12), at(13, 30), 2, { resourceIds: [id(11)], status: 'confirmed' }),
    visit(2, 'Grace Hopper', at(13), at(14, 30), 4, {
      resourceIds: [id(12)],
      phone: '07700 900123',
      email: 'grace@example.com',
      note: 'Window seat, cake at nine',
      occasion: 'birthday',
    }),
    visit(3, 'Lin Wei', at(19), at(20, 30), 6, { resourceIds: [id(14)], source: 'desk', status: 'confirmed' }),
    visit(4, 'Sam Patel', at(19, 30), at(21), 2, { resourceIds: [id(13)], source: 'walk_in', status: 'started' }),
    visit(5, 'Maya Ortiz', at(20), at(21, 30), 3, { status: 'cancelled', resourceIds: [id(12)] }),
  ],
  covers: { booked: 14, seated: 2, toCome: 12 },
  truncated: false,
};

const RULES: TableRules = {
  minutes: 90,
  holds: [],
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

const FREE = {
  tables: [
    { resourceIds: [id(12)], label: 'T2', seats: 4 },
    { resourceIds: [id(13)], label: 'T3', seats: 4 },
  ],
  holdMinutes: 90,
} as unknown as FreeTablesView;

function heldOf<Value>(value: Value): HospitalityHeld<Value> {
  const state: HospitalityHeldState<Value> = { status: 'ready', value, isSaving: false };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
}

/** Each day's view, made once: a held view must hand back the same snapshot on every read. */
const days = new Map<string, HospitalityHeld<ServiceDayView>>();
const dayOf = (date: string) => {
  const known = days.get(date);
  if (known !== undefined) return known;
  const made = heldOf<ServiceDayView>(
    date === TODAY
      ? DAY
      : { date, zone: ZONE, visits: [], covers: { booked: 0, seated: 0, toCome: 0 }, truncated: false },
  );
  days.set(date, made);
  return made;
};

interface WalkInSent {
  readonly party: number;
  readonly resourceIds: readonly string[];
  readonly name?: string;
}

function storesOf() {
  const booked: StaffBooking[] = [];
  const walkIns: WalkInSent[] = [];
  const business = heldOf(BUSINESS);
  const floor = heldOf(FLOOR);
  const setup = heldOf(SETUP);
  const hospitality = { business: () => business, floor: () => floor } as unknown as HospitalityStore;
  const tables = {
    day: (_slug: string, _place: string, date: string) => dayOf(date),
    setup: () => setup,
    setStatus: () => Promise.resolve(undefined),
    book: (_slug: string, _place: string, _date: string, booking: StaffBooking) => {
      booked.push(booking);
      return Promise.resolve(undefined);
    },
    freeTables: () => Promise.resolve(FREE),
    walkIn: (_slug: string, _place: string, _date: string, input: WalkInSent) => {
      walkIns.push(input);
      return Promise.resolve(undefined);
    },
  } as unknown as TablesStore;
  return { hospitality, tables, booked, walkIns };
}

const toasts = { toast: () => '', dismiss: () => undefined } as never;

let shown: InApp | undefined;
afterEach(async () => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });
});

/**
 * A target-size line whose every target is a button in a row that opens (a 26px button inside the row's own
 * target): the Table's nesting once it has a row action, as WebhooksScreen's test reads it.
 */
function nestedInRow(line: string): boolean {
  if (!line.startsWith('target-size')) return false;
  const ids = line.match(/#[\w-]+/g) ?? [];
  return (
    ids.length > 0 &&
    ids.every((each) => {
      const target = document.querySelector(each);
      return target?.closest('[role="gridcell"]') !== null && target?.closest('[role="row"]') !== null;
    })
  );
}

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  // A drawer slides in on the drawer curve: the shot waits for it to land.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png` });
}

/** The page as the route draws it: the day in its own state, as `?date=` holds it. */
function Page({ tables, hospitality }: { readonly tables: TablesStore; readonly hospitality: HospitalityStore }) {
  const [search, setSearch] = useState<ReservationsSearch>({});
  return (
    <ReservationsScreen
      slug="acme"
      tables={tables}
      hospitality={hospitality}
      toasts={toasts}
      search={search}
      onSearch={setSearch}
    />
  );
}

async function show(width: number, permissions: readonly string[] = ['hospitality.manage', 'hospitality.service']) {
  await page.viewport(width, width < 600 ? 844 : 900);
  const stores = storesOf();
  shown = await renderInApp(() => <Page tables={stores.tables} hospitality={stores.hospitality} />, {
    data: {},
    pattern: '/w/$slug/reservations',
    at: '/w/acme/reservations',
    permissions,
  });
  await expect.element(page.getByRole('heading', { name: 'Day calendar' })).toBeInTheDocument();
  return stores;
}

/** axe's violations on the page now, in the theme set, the table's nested row buttons aside. */
async function clean() {
  return (await axeViolations()).filter((line) => !nestedInRow(line));
}

/**
 * Waits for what is moving to come to rest (a sheet's entrance: the scrim's fade and the drawer's slide, 240ms), so
 * axe reads the colours the page settles on: read mid-slide, the sheet's labels failed colour contrast (the finding
 * of 5 November 2026, which read it as something animating for ever). Nothing on the page repeats for ever.
 */
async function settled() {
  await Promise.all(
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)),
  );
}

describe('Reservations (checklabs’ one page)', () => {
  it('draws the chosen day alone from 10:00, counting the bookings and covers on the calendar’s line', async () => {
    await show(1280);
    await expect.element(page.getByRole('heading', { level: 1, name: 'Reservations' })).toBeInTheDocument();
    await expect
      .element(page.getByText('4 on the calendar · 14 covers · 2 seated · 12 to come · pick a time to add a booking'))
      .toBeInTheDocument();
    const calendar = page.getByRole('region', { name: /^Day calendar, / });
    // One day, named by the bar: no head of days to pick from.
    expect(calendar.element().querySelectorAll('button[aria-pressed]')).toHaveLength(0);
    // The hours start at 10:00 and run to midnight: nine o'clock isn't drawn.
    const hours = [
      ...calendar.element().querySelectorAll<HTMLElement>('[aria-hidden="true"] > span[class*="hour"]'),
    ].map((each) => each.textContent);
    expect(hours).toHaveLength(14);
    expect(hours[0]).toMatch(/10/);
    // The cancelled booking stays on the list only.
    await expect.element(page.getByRole('button', { name: /^Grace Hopper, / })).toBeInTheDocument();
    expect(page.getByRole('button', { name: /^Maya Ortiz, / }).elements()).toHaveLength(0);
    // No Stats row: the covers are on the line.
    expect(page.getByText('Covers booked').elements()).toHaveLength(0);
  });

  it('lists each booking as checklabs’ row does: phone under the name, the source, Confirm inline', async () => {
    await show(1280);
    await expect.element(page.getByRole('heading', { name: 'Bookings · 5' })).toBeInTheDocument();
    const grace = page.getByRole('row', { name: /Grace Hopper/ });
    await expect.element(grace.getByText('07700 900123')).toBeVisible();
    // The note too, under the name as checklabs' row has it.
    await expect.element(grace.getByText(/Window seat, cake at nine/)).toBeVisible();
    await expect.element(grace.getByText('Online', { exact: true })).toBeVisible();
    // Not confirmed yet: Confirm sits beside Seat; a confirmed booking has Seat alone.
    await expect.element(grace.getByRole('button', { name: 'Confirm' })).toBeVisible();
    expect(
      page
        .getByRole('row', { name: /Ada Lovelace/ })
        .getByRole('button', { name: 'Confirm' })
        .elements(),
    ).toHaveLength(0);
    // A booking the host took reads Phone; one seated at the door, Walk in.
    await expect.element(page.getByRole('row', { name: /Lin Wei/ }).getByText('Phone', { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole('row', { name: /Sam Patel/ }).getByText('Walk in', { exact: true }))
      .toBeVisible();
  });

  it('keeps the day in the bar at a phone’s width, picks another there, and says when it has no bookings', async () => {
    await show(390);
    const today = page.getByRole('button', { name: /, pick a day$/ });
    await expect.element(today).toBeVisible();
    await userEvent.click(today);
    await userEvent.keyboard('{ArrowRight}{Enter}');
    const tomorrow = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${addDays(TODAY, 1)}T12:00:00.000Z`));
    await expect.element(page.getByRole('button', { name: `${tomorrow}, pick a day` })).toBeVisible();
    await expect.element(page.getByText(/^No bookings on .+\.$/)).toBeVisible();
  });

  it('keeps the day’s arrows still: Next twice from today shows the day after tomorrow', async () => {
    await show(1280);
    await userEvent.click(page.getByRole('button', { name: 'Next day' }));
    await userEvent.click(page.getByRole('button', { name: 'Next day' }));
    const label = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${addDays(TODAY, 2)}T12:00:00.000Z`));
    await expect.element(page.getByRole('button', { name: `${label}, pick a day` })).toBeVisible();
  });

  it('reads a past day only: no moves on its rows', async () => {
    await show(1280);
    await userEvent.click(page.getByRole('button', { name: 'Previous day' }));
    await expect.element(page.getByText(/^No bookings on .+\.$/)).toBeVisible();
    expect(page.getByRole('button', { name: 'New booking' }).elements()).toHaveLength(0);
  });

  it('puts Walk in by the list on a phone, where the host works', async () => {
    const { walkIns } = await show(390);
    await userEvent.click(page.getByRole('button', { name: 'Walk in' }));
    const sheet = page.getByRole('dialog', { name: 'Seat a walk in' });
    await userEvent.click(sheet.getByRole('button', { name: 'Seat now' }));
    await expect.poll(() => walkIns.length).toBe(1);
  });

  it('shows the details of a booking opened from its row', async () => {
    await show(1280);
    await userEvent.click(page.getByRole('rowheader', { name: /Grace Hopper/ }));
    const sheet = page.getByRole('dialog', { name: 'Grace Hopper' });
    await expect.element(sheet.getByText('Window seat, cake at nine')).toBeVisible();
    await expect.element(sheet.getByRole('link', { name: '07700 900123' })).toHaveAttribute('href', 'tel:07700900123');
    // The sheet's moves are buttons: No show, Cancel and Confirm beside Seat.
    await expect.element(sheet.getByRole('button', { name: 'Seat' })).toBeVisible();
    await expect.element(sheet.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await expect.element(sheet.getByRole('button', { name: 'No show' })).toBeVisible();
  });

  it('offers only the tables that seat the party, and books the one picked', async () => {
    const { booked } = await show(1280);
    // Tomorrow, so 19:00 is never already gone whenever the suite runs.
    await userEvent.click(page.getByRole('button', { name: 'Next day' }));
    await userEvent.click(page.getByRole('button', { name: 'New booking' }));
    const sheet = page.getByRole('dialog', { name: 'New booking' });
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Guest name' }), 'Jane Doe');
    await userEvent.click(sheet.getByText('6', { exact: true }));
    await userEvent.click(sheet.getByRole('button', { name: /Assign table/ }));
    // A party of 6: only T4 (4 to 8 seats) seats them alone, beside the engine's best fit.
    await expect.element(page.getByRole('option', { name: 'Best free table' })).toBeVisible();
    expect(
      page
        .getByRole('option')
        .elements()
        .map((each) => each.textContent),
    ).toEqual(['Best free table', 'T4 · 8 seats · Inside']);
    await userEvent.click(page.getByRole('option', { name: 'T4 · 8 seats · Inside' }));
    await userEvent.click(sheet.getByRole('button', { name: 'Create booking' }));
    await expect.poll(() => booked.length).toBe(1);
    expect(booked[0]).toMatchObject({
      name: 'Jane Doe',
      party: 6,
      resourceIds: [id(14)],
      start: instantAt(addDays(TODAY, 1), 19 * 60, ZONE).toISOString(),
    });
  });

  it('refuses to send a booking without a name', async () => {
    const { booked } = await show(1280);
    await userEvent.click(page.getByRole('button', { name: 'New booking' }));
    const sheet = page.getByRole('dialog', { name: 'New booking' });
    await userEvent.click(sheet.getByRole('button', { name: 'Create booking' }));
    await expect.element(sheet.getByText('Give the guest’s name.')).toBeVisible();
    expect(booked).toHaveLength(0);
  });

  it('seats a walk in from a sheet: two guests picked, the name there at once, the best table chosen', async () => {
    const { walkIns } = await show(1280);
    await userEvent.click(page.getByRole('button', { name: 'Walk in' }));
    const sheet = page.getByRole('dialog', { name: 'Seat a walk in' });
    await expect.element(sheet.getByRole('textbox', { name: /Guest name/ })).toBeVisible();
    await expect.element(sheet.getByRole('radio', { name: '2', exact: true })).toBeChecked();
    await expect.element(sheet.getByRole('radio', { name: 'T2 · 4 seats' })).toBeChecked();
    await userEvent.click(sheet.getByRole('button', { name: 'Seat now' }));
    await expect.poll(() => walkIns.length).toBe(1);
    expect(walkIns[0]).toMatchObject({ party: 2, resourceIds: [id(12)] });
  });

  it('offers Online booking in the bar only to those who set the apps up', async () => {
    await show(1280);
    await expect.element(page.getByRole('button', { name: 'Online booking' })).toBeVisible();
    // Not live yet: the page's one line says so, with the way in.
    await expect.element(page.getByText('Guests can’t reserve online yet.')).toBeVisible();
    shown?.unmount();
    shown = undefined;
    await show(1280, ['hospitality.service']);
    expect(page.getByRole('button', { name: 'Online booking' }).elements()).toHaveLength(0);
    expect(page.getByText('Guests can’t reserve online yet.').elements()).toHaveLength(0);
  });

  for (const width of [1280, 390]) {
    it(`passes axe in light and dark at ${String(width)}px, the sheets too`, async () => {
      await show(width);
      for (const theme of THEMES) {
        applyTheme(theme);
        expect(await clean()).toEqual([]);
        await shoot('reservations', theme, width);
      }
      await userEvent.click(page.getByRole('button', { name: 'New booking' }));
      await expect.element(page.getByRole('dialog', { name: 'New booking' })).toBeVisible();
      await settled();
      for (const theme of THEMES) {
        applyTheme(theme);
        expect(await clean()).toEqual([]);
        await shoot('reservations-new-booking', theme, width);
      }
      await userEvent.keyboard('{Escape}');
      await userEvent.click(page.getByRole('rowheader', { name: /Grace Hopper/ }));
      await expect.element(page.getByRole('dialog', { name: 'Grace Hopper' })).toBeVisible();
      await settled();
      for (const theme of THEMES) {
        applyTheme(theme);
        expect(await clean()).toEqual([]);
        await shoot('reservations-detail', theme, width);
      }
    });
  }

  // The finding of 5 November 2026: the New booking sheet failed colour contrast while something on it was still
  // moving. With reduced motion and without, nothing on the open sheet animates for ever, and axe is clean.
  for (const motion of ['reduce', 'no-preference'] as const) {
    it(`holds New booking still and clean with prefers-reduced-motion: ${motion}`, async () => {
      await cdp().send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: motion }],
      });
      await show(1280);
      await userEvent.click(page.getByRole('button', { name: 'New booking' }));
      const sheet = page.getByRole('dialog', { name: 'New booking' });
      await expect.element(sheet).toBeVisible();
      const dialog = sheet.element();
      const endless = document
        .getAnimations()
        .filter((animation) => {
          const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          return target !== null && dialog.contains(target) && animation.effect?.getTiming().iterations === Infinity;
        })
        .map((animation) => (animation instanceof CSSAnimation ? animation.animationName : 'animation'));
      expect(endless).toEqual([]);
      // With reduced motion the sheet is simply there: nothing on it, or under it, moves.
      if (motion === 'reduce') {
        const moving = document.getAnimations().filter((animation) => {
          const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          return (
            animation.playState === 'running' && target !== null && (target.contains(dialog) || dialog.contains(target))
          );
        });
        expect(moving).toEqual([]);
      }
      await settled();
      for (const theme of THEMES) {
        applyTheme(theme);
        expect(await clean()).toEqual([]);
      }
    });
  }
});
