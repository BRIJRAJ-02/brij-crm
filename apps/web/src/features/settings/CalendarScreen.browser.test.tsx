// Settings › Calendars in Chromium: an account's calendars in use only (the owner, 23 October 2026: the others
// "don't show this anywhere"), in the table and in Add bookings to, with no fold of other calendars; one switched
// off keeps its row until the next visit, so it never moves out from under the pointer, and its toast says so.
import type {
  CalendarConnectionView,
  CalendarItem,
  CalendarListState,
  CalendarsHeld,
  CalendarSettingsHeld,
  CalendarState,
  CalendarView,
  DataLayer,
} from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { CalendarScreen } from './CalendarScreen.tsx';

const ACCOUNT = '0190f0f0-0000-7000-8000-0000000000b1';

/** A writable calendar of the account with nothing switched on, changed by `more`. */
const calendar = (id: string, name: string, more: Partial<CalendarItem> = {}): CalendarItem => ({
  id: `0190f0f0-0000-7000-8000-0000000000${id}`,
  connectionId: ACCOUNT,
  name,
  hue: 'blue',
  accessRole: 'owner',
  isPrimary: false,
  checkConflicts: false,
  showInWeek: false,
  sync: false,
  isDestination: false,
  canBeDestination: true,
  ...more,
});

/** Work (the main one, where bookings go), Team (checked for conflicts), and two Google lists that aren't in use. */
const CALENDARS: readonly CalendarItem[] = [
  calendar('c1', 'Work', { isPrimary: true, checkConflicts: true, showInWeek: true, sync: true, isDestination: true }),
  calendar('c2', 'Team', { checkConflicts: true }),
  calendar('c3', 'Birthdays', { accessRole: 'reader', canBeDestination: false }),
  calendar('c4', 'Shared', { accessRole: 'writer' }),
];

const connection: CalendarConnectionView = {
  id: ACCOUNT,
  provider: 'google',
  accountEmail: 'ada@acme.dev',
  status: 'connected',
  sharing: 'shared',
  isDefault: true,
  createdAt: '2026-10-20T09:00:00Z',
};

const connections: CalendarState = {
  status: 'ready',
  enabled: true,
  providers: ['google'],
  max: 3,
  connections: [connection],
};

/** The account's calendars as the data layer holds them, which a test changes as the store would after a save. */
function listOf(calendars: readonly CalendarItem[]) {
  let snapshot: CalendarListState = {
    status: 'ready',
    enabled: true,
    providers: ['google'],
    max: 3,
    accounts: [{ ...connection, calendars: [...calendars] }],
  };
  const listeners = new Set<() => void>();
  const held: CalendarsHeld<CalendarListState> = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    reload: () => undefined,
  };
  const change = (next: readonly CalendarItem[]) => {
    if (snapshot.status !== 'ready') return;
    const [account] = snapshot.accounts;
    if (account === undefined) return;
    snapshot = { ...snapshot, accounts: [{ ...account, calendars: [...next] }] };
    for (const listener of listeners) listener();
  };
  return { held, change };
}

const view: CalendarView = {
  subscribe: () => () => undefined,
  getSnapshot: () => connections,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};

const settingsLoading = { status: 'loading' as const };
const settings: CalendarSettingsHeld = {
  subscribe: () => () => undefined,
  getSnapshot: () => settingsLoading,
  retain: () => () => undefined,
};

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The page over `held`, with the data layer's calendar writes as mocks. */
async function renderCalendars(held: CalendarsHeld<CalendarListState>) {
  const updateCalendar = vi.fn(() => Promise.resolve(true));
  const data = {
    calendar: {
      view: () => view,
      calendars: () => held,
      settings: () => settings,
      updateCalendar,
      setDestination: vi.fn(() => Promise.resolve(true)),
    },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => <CalendarScreen data={data} slug="acme" view={view} onResultSeen={() => undefined} />,
    { data, pattern: '/w/$slug/settings/scheduling/calendars', at: '/w/acme/settings/scheduling/calendars' },
  );
  return { updateCalendar };
}

describe('Settings › Calendars', () => {
  it('shows only the calendars in use, with no fold of the others', async () => {
    const { held } = listOf(CALENDARS);
    await renderCalendars(held);
    await expect.element(page.getByRole('grid', { name: 'Calendars in ada@acme.dev' })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Check Work for conflicts' })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Check Team for conflicts' })).toBeVisible();
    expect(page.getByText('Birthdays').elements()).toEqual([]);
    expect(page.getByText('Shared').elements()).toEqual([]);
    expect(page.getByText(/Other calendars/).elements()).toEqual([]);
    // Add bookings to offers the ones in use that take bookings: Shared could, but isn't in use.
    await userEvent.click(page.getByRole('button', { name: /Add bookings to/ }));
    const options = page.getByRole('option');
    expect(options.elements().map((option) => option.textContent)).toEqual(['Work', 'Team']);
  });

  it('keeps a calendar switched off on its row until the next visit', async () => {
    const { held, change } = listOf(CALENDARS);
    const { updateCalendar } = await renderCalendars(held);
    // From the keyboard: the box drawn over the input takes the pointer.
    page.getByRole('checkbox', { name: 'Check Team for conflicts' }).element().focus();
    await userEvent.keyboard(' ');
    expect(updateCalendar).toHaveBeenCalledWith('acme', CALENDARS[1]?.id, { checkConflicts: false });
    const off = CALENDARS.map((each) => (each.name === 'Team' ? { ...each, checkConflicts: false } : each));
    change(off);
    await expect.element(page.getByRole('checkbox', { name: 'Check Team for conflicts' })).not.toBeChecked();
    // Its toast says so, with Undo.
    await expect
      .element(
        page.getByText('Team is no longer checked for conflicts. Team won’t be listed once you leave this page.'),
      )
      .toBeVisible();
    // The next visit: Team is no longer in use, so it no longer shows.
    shown?.unmount();
    await renderCalendars(listOf(off).held);
    await expect.element(page.getByRole('checkbox', { name: 'Check Work for conflicts' })).toBeVisible();
    expect(page.getByText('Team').elements()).toEqual([]);
  });
});
