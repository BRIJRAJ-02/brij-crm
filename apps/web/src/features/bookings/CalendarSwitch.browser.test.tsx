// The Bookings week's calendar switch in Chromium: All calendars, then each connected calendar by its name in its
// colour (no Bookings segment: bookings always show); hidden with one calendar or none; past five segments the rest
// fold into More, which names the chosen one; the choice is kept per workspace in this browser, and a kept calendar
// counts only once the calendars are read, it is still there and the switch shows.
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

/** The switch and the choice it makes, as the week reads it. */
function Harness({ calendars }: { readonly calendars: readonly SwitchCalendar[] | undefined }) {
  const { choice, choose } = useCalendarChoice('acme', calendars);
  return (
    <>
      <CalendarSwitch calendars={calendars ?? []} choice={choice} onChoose={choose} />
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
  it('starts on All calendars, folds past five segments into More, and keeps a choice from there', async () => {
    await render(FIVE);
    await expect.element(page.getByRole('radio', { name: 'All calendars' })).toBeChecked();
    expect(page.getByRole('radio').all()).toHaveLength(4);
    await expect.element(page.getByRole('radio', { name: 'Bookings' })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: '2 more calendars' }));
    await userEvent.click(page.getByRole('menuitemradio', { name: /Gym/ }));
    await expect.element(page.getByText('Showing gym')).toBeInTheDocument();
    // The segments stay put; More names the chosen calendar.
    await expect.element(page.getByRole('button', { name: 'Gym' })).toBeInTheDocument();
    expect(page.getByRole('radio').all()).toHaveLength(4);
    expect(globalThis.localStorage.getItem(KEY)).toBe('gym');
  });

  it('moves with the arrow keys', async () => {
    await render(FIVE.slice(0, 2));
    await userEvent.click(page.getByText('All calendars'));
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(page.getByText('Showing work')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(page.getByText('Showing home')).toBeInTheDocument();
  });

  it('hides itself with one calendar or none, and then shows everything', async () => {
    globalThis.localStorage.setItem(KEY, 'work');
    await render(FIVE.slice(0, 1));
    await expect.element(page.getByText('Showing all')).toBeInTheDocument();
    expect(page.getByRole('radiogroup').all()).toHaveLength(0);
    shown?.unmount();
    await render([]);
    await expect.element(page.getByText('Showing all')).toBeInTheDocument();
    expect(page.getByRole('radiogroup').all()).toHaveLength(0);
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
