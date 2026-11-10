// The Bookings week's calendar switch in Chromium: one All calendars ▾ Select, then each connected calendar by its
// name in its colour (no Bookings option: bookings always show); hidden with one calendar or none; two of one name
// say their account; the choice is kept per workspace in this browser, and a kept calendar counts only once the
// calendars are read, it is still there and the switch shows.
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { CalendarSwitch, useCalendarChoice, type SwitchCalendar } from './CalendarSwitch.tsx';

const KEY = 'crm.bookings.weekCalendar.acme';

const calendar = (id: string, name: string): SwitchCalendar => ({
  id,
  name,
  hue: 'green',
  account: `${id}@example.com`,
});

const FIVE = [
  calendar('work', 'Work'),
  calendar('home', 'Home'),
  calendar('team', 'Team'),
  calendar('gym', 'Gym'),
  calendar('trips', 'Trips'),
];

/** A calendar shown on the week: in use, so every picker lists it. */
const inUse = {
  connectionId: 'c1',
  accessRole: 'owner' as const,
  isPrimary: false,
  checkConflicts: false,
  showInWeek: true,
  sync: false,
  isDestination: false,
  canBeDestination: false,
};

/** The calendars' accounts, as the week passes them: each calendar in use, under its account's address. */
const accountsOf = (calendars: readonly SwitchCalendar[]) =>
  [...new Set(calendars.map((each) => each.account))].map((accountEmail) => ({
    accountEmail,
    calendars: calendars
      .filter((each) => each.account === accountEmail)
      .map((each) => ({ ...inUse, id: each.id, name: each.name, hue: each.hue })),
  }));

/** The switch and the choice it makes, as the week reads it. */
function Harness({ calendars }: { readonly calendars: readonly SwitchCalendar[] | undefined }) {
  const { choice, choose } = useCalendarChoice('acme', calendars);
  return (
    <>
      <CalendarSwitch
        accounts={accountsOf(calendars ?? [])}
        calendars={calendars ?? []}
        choice={choice}
        onChoose={choose}
      />
      <p>{`Showing ${choice}`}</p>
    </>
  );
}

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  globalThis.localStorage.removeItem(KEY);
});

const render = async (calendars: readonly SwitchCalendar[] | undefined) => {
  shown = await renderInApp(() => <Harness calendars={calendars} />, {
    data: {},
    pattern: '/w/$slug/bookings/calendar',
    at: '/w/acme/bookings/calendar',
  });
};

describe('the calendar switch', () => {
  it('starts on All calendars, lists every calendar in one Select, and keeps a choice from there', async () => {
    await render(FIVE);
    await userEvent.click(page.getByRole('button', { name: /All calendars/ }));
    expect(page.getByRole('option').all()).toHaveLength(6);
    await expect.element(page.getByRole('option', { name: /Bookings/ })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('option', { name: /Gym/ }));
    await expect.element(page.getByText('Showing gym')).toBeInTheDocument();
    // The trigger names the chosen calendar.
    await expect.element(page.getByRole('button', { name: /Gym/ })).toBeInTheDocument();
    expect(globalThis.localStorage.getItem(KEY)).toBe('gym');
  });

  it('lists an account with two calendars under its address, as every calendar picker does', async () => {
    await render([
      { ...calendar('work', 'Calendar'), account: 'ada@example.com' },
      { ...calendar('home', 'Home'), account: 'ada@example.com' },
    ]);
    await userEvent.click(page.getByRole('button', { name: /All calendars/ }));
    await expect.element(page.getByText('ada@example.com')).toBeVisible();
  });

  it('hides itself with one calendar or none, and then shows everything', async () => {
    globalThis.localStorage.setItem(KEY, 'work');
    await render(FIVE.slice(0, 1));
    await expect.element(page.getByText('Showing all')).toBeInTheDocument();
    expect(page.getByRole('button', { name: /All calendars/ }).all()).toHaveLength(0);
    shown?.unmount();
    await render([]);
    await expect.element(page.getByText('Showing all')).toBeInTheDocument();
    expect(page.getByRole('button', { name: /All calendars/ }).all()).toHaveLength(0);
  });

  it('reads a kept calendar that left the week, or one kept while the calendars load, as All calendars', async () => {
    globalThis.localStorage.setItem(KEY, 'gone');
    await render(FIVE);
    await expect.element(page.getByText('Showing all')).toBeInTheDocument();
    shown?.unmount();
    globalThis.localStorage.setItem(KEY, 'work');
    await render(undefined);
    await expect.element(page.getByText('Showing all')).toBeInTheDocument();
    shown?.unmount();
    // The old Bookings segment's kept choice.
    globalThis.localStorage.setItem(KEY, 'bookings');
    await render(FIVE);
    await expect.element(page.getByText('Showing all')).toBeInTheDocument();
  });
});
