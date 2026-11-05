// The Service screen in Chromium (spec 0066 B7 lite, after checklabs' reservations page): today's bookings on the day
// calendar and in the bookings list, a booking's detail opened from its row, and New booking offering only the
// tables that seat the party, sending the table picked. axe is clean in light and dark at a desktop's and a phone's
// width. With VITE_SHOT_DIR set, each is photographed.
import '@crm/ui/styles.css';
import type {
  BusinessView,
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  PlaceFloor,
  ServiceDayView,
  StaffBooking,
  TablesStore,
} from '@crm/data';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { instantAt } from '../bookings/week.ts';
import { ServiceScreen } from './ServiceScreen.tsx';

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
    visit(3, 'Lin Wei', at(19), at(20, 30), 6, { resourceIds: [id(14)], source: 'desk' }),
    visit(4, 'Sam Patel', at(19, 30), at(21), 2, { resourceIds: [id(13)] }),
    visit(5, 'Maya Ortiz', at(20), at(21, 30), 3, { status: 'cancelled', resourceIds: [id(12)] }),
  ],
  covers: { booked: 14, seated: 0, toCome: 14 },
  truncated: false,
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
  const booked: StaffBooking[] = [];
  const hospitality = {
    business: () => heldOf(BUSINESS),
    floor: () => heldOf(FLOOR),
  } as unknown as HospitalityStore;
  const tables = {
    day: () => heldOf(DAY),
    setStatus: () => Promise.resolve(undefined),
    book: (_slug: string, _place: string, _date: string, booking: StaffBooking) => {
      booked.push(booking);
      return Promise.resolve(undefined);
    },
  } as unknown as TablesStore;
  return { hospitality, tables, booked };
}

const toasts = { toast: () => '', dismiss: () => undefined } as never;

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
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

async function show(width: number) {
  await page.viewport(width, width < 600 ? 844 : 900);
  const { hospitality, tables, booked } = storesOf();
  shown = await renderInApp(
    () => <ServiceScreen slug="acme" tables={tables} hospitality={hospitality} toasts={toasts} />,
    { data: {}, pattern: '/w/$slug/service', at: '/w/acme/service' },
  );
  await expect.element(page.getByRole('heading', { name: 'Day calendar' })).toBeInTheDocument();
  return booked;
}

describe('Service (checklabs’ reservations page)', () => {
  it('shows the day calendar without cancelled bookings, the bookings list, and a booking’s detail', async () => {
    await show(1280);
    await expect.element(page.getByText('4 bookings · pick a time to add one')).toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Bookings · 5' })).toBeInTheDocument();
    // A block is named by its guest and times; the cancelled booking stays on the list only.
    await expect.element(page.getByRole('button', { name: /^Grace Hopper, / })).toBeInTheDocument();
    expect(page.getByRole('button', { name: /^Maya Ortiz, / }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole('rowheader', { name: /Grace Hopper/ }));
    const sheet = page.getByRole('dialog', { name: 'Grace Hopper' });
    await expect.element(sheet.getByText('Window seat, cake at nine')).toBeVisible();
    await expect.element(sheet.getByRole('link', { name: '07700 900123' })).toHaveAttribute('href', 'tel:07700900123');
    await expect.element(sheet.getByRole('button', { name: 'Seat' })).toBeVisible();
  });

  it('offers only the tables that seat the party, and books the one picked', async () => {
    const booked = await show(1280);
    await userEvent.click(page.getByRole('button', { name: 'New booking' }));
    const sheet = page.getByRole('dialog', { name: 'New booking' });
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Guest name' }), 'Jane Doe');
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Party size' }), '6');
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
    expect(booked[0]).toMatchObject({ name: 'Jane Doe', party: 6, resourceIds: [id(14)], start: at(19) });
  });

  it('refuses to send a booking without a name', async () => {
    const booked = await show(1280);
    await userEvent.click(page.getByRole('button', { name: 'New booking' }));
    const sheet = page.getByRole('dialog', { name: 'New booking' });
    await userEvent.click(sheet.getByRole('button', { name: 'Create booking' }));
    await expect.element(sheet.getByText('Give the guest’s name.')).toBeVisible();
    expect(booked).toHaveLength(0);
  });

  for (const width of [1280, 390]) {
    it(`passes axe in light and dark at ${String(width)}px, the New booking sheet too`, async () => {
      await show(width);
      for (const theme of THEMES) {
        applyTheme(theme);
        expect((await axeViolations()).filter((line) => !nestedInRow(line))).toEqual([]);
        await shoot('service', theme, width);
      }
      await userEvent.click(page.getByRole('button', { name: 'New booking' }));
      await expect.element(page.getByRole('dialog', { name: 'New booking' })).toBeVisible();
      for (const theme of THEMES) {
        applyTheme(theme);
        expect((await axeViolations()).filter((line) => !nestedInRow(line))).toEqual([]);
        await shoot('service-new-booking', theme, width);
      }
      await userEvent.keyboard('{Escape}');
      await userEvent.click(page.getByRole('rowheader', { name: /Grace Hopper/ }));
      await expect.element(page.getByRole('dialog', { name: 'Grace Hopper' })).toBeVisible();
      for (const theme of THEMES) {
        applyTheme(theme);
        expect((await axeViolations()).filter((line) => !nestedInRow(line))).toEqual([]);
        await shoot('service-detail', theme, width);
      }
    });
  }
});
