// Bookings settings › Calendars laid out in Chromium: no long name runs under its "Logs to CRM" badge or its switch,
// the page never scrolls sideways, Tab reaches every switch, and axe is clean in light and dark at 390 and 1440. The
// page's words (the off and empty states, the connect popup, Add new bookings to, the limit, a stopped account) render
// as written.
// The library's stylesheet first, as main.tsx loads it, so the layout and colours measured are the app's.
import '@crm/ui/styles.css';
import type {
  CalendarConnectionView,
  CalendarItem,
  CalendarListState,
  CalendarsHeld,
  CalendarSettingsHeld,
  CalendarSettingsState,
  CalendarState,
  CalendarView,
  DataLayer,
} from '@crm/data';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { CalendarScreen } from './CalendarScreen.tsx';
import { strings } from './calendar-strings.ts';

const ACCOUNT = '0190f0f0-0000-7000-8000-0000000000b1';

/** A writable calendar of the account, changed by `more`. */
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

/** Forty characters: the longest name the table must hold without running under its badge. */
const LONG_NAME = 'Quarterly planning and client onboarding';

/** Three calendars, each in use: the main one, a long named one logging to the CRM, and one checked for conflicts. */
const CALENDARS: readonly CalendarItem[] = [
  calendar('c1', 'Work', { isPrimary: true, checkConflicts: true, showInWeek: true, isDestination: true }),
  calendar('c2', LONG_NAME, { hue: 'green', sync: true, checkConflicts: true }),
  calendar('c3', 'Team', { hue: 'purple', showInWeek: true }),
];

const connection: CalendarConnectionView = {
  id: ACCOUNT,
  provider: 'google',
  accountEmail: 'ada@acme.dev',
  status: 'connected',
  sharing: 'shared',
  isDefault: true,
  // Five minutes ago, whenever the test runs.
  lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  createdAt: '2026-10-20T09:00:00Z',
};

/** A store that holds one value and never changes. */
function held<T>(value: T) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => value,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

/** The page over these connections and calendars, for an owner (who gets the workspace section). */
async function renderCalendars({
  enabled = true,
  connections = [connection],
  max = 3,
  calendars = CALENDARS,
}: {
  readonly enabled?: boolean;
  readonly connections?: readonly CalendarConnectionView[];
  readonly max?: number;
  readonly calendars?: readonly CalendarItem[];
} = {}): Promise<InApp> {
  const state: CalendarState = {
    status: 'ready',
    enabled,
    providers: enabled ? ['google'] : [],
    max,
    connections: [...connections],
  };
  const list: CalendarListState = {
    status: 'ready',
    enabled,
    providers: enabled ? ['google'] : [],
    max,
    accounts: connections.map((each) => ({ ...each, calendars: [...calendars] })),
  };
  const settingsState: CalendarSettingsState = { status: 'ready', canManage: true, createUnknownPeople: false };
  const view = held(state) as CalendarView;
  const data = {
    calendar: {
      view: () => view,
      calendars: () => held(list) as CalendarsHeld<CalendarListState>,
      settings: () => held(settingsState) as CalendarSettingsHeld,
      updateCalendar: () => Promise.resolve(true),
      setDestination: () => Promise.resolve(true),
    },
  } as unknown as DataLayer;
  return renderInApp(() => <CalendarScreen data={data} slug="acme" view={view} onResultSeen={() => undefined} />, {
    data,
    pattern: '/w/$slug/settings/scheduling/calendars',
    at: '/w/acme/settings/scheduling/calendars',
  });
}

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** True when two boxes share any area. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The account's calendars, under its address. */
const group = () => page.getByRole('group', { name: 'ada@acme.dev' });

/** Every switch on the page's calendar rows, by its name. */
const SWITCHES = CALENDARS.map((each) => strings.checkFor(each.name));

describe('Settings › Calendars at 390 and 1440', () => {
  for (const width of [390, 1440] as const) {
    for (const theme of THEMES) {
      it(`keeps the names, badges and switches apart at ${String(width)} in ${theme}, and axe is clean`, async () => {
        await page.viewport(width, 900);
        applyTheme(theme);
        shown = await renderCalendars();
        await expect.element(group()).toBeVisible();

        // The long name ends (cut with an ellipsis if it must) before its badge starts.
        const badge = group().getByText(strings.logsBadge).element().getBoundingClientRect();
        const name = group().getByText(LONG_NAME, { exact: true }).element().getBoundingClientRect();
        expect(overlaps(name, badge), 'the name runs under its badge').toBe(false);
        // Each switch sits clear of the name and the badge.
        for (const label of SWITCHES) {
          const box = page.getByRole('switch', { name: label }).element().getBoundingClientRect();
          expect(overlaps(box, badge), `${label} under the badge`).toBe(false);
          expect(overlaps(box, name), `${label} under the name`).toBe(false);
        }
        // The page never scrolls sideways.
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);

        expect(await axeViolations()).toEqual([]);
      });
    }
  }

  it('reaches every switch and its menu with Tab, at 390', async () => {
    await page.viewport(390, 900);
    shown = await renderCalendars();
    await expect.element(group()).toBeVisible();
    const boxes = SWITCHES.map((label) => ({ label, box: page.getByRole('switch', { name: label }).element() }));
    const reached = new Set<string>();
    (document.activeElement as HTMLElement | null)?.blur();
    for (let step = 0; step < 40 && reached.size < boxes.length; step += 1) {
      await userEvent.keyboard('{Tab}');
      for (const { label, box } of boxes) if (document.activeElement === box) reached.add(label);
    }
    for (const label of SWITCHES) expect([...reached]).toContain(label);
  });
});

describe('Settings › Calendars’ words', () => {
  it('says calendar sync is off, and that booking pages still use your hours', async () => {
    shown = await renderCalendars({ enabled: false, connections: [] });
    await expect.element(page.getByText(strings.offTitle)).toBeVisible();
    await expect.element(page.getByText(strings.offText)).toBeVisible();
    expect(strings.offTitle).toBe('Calendar sync is off');
    // The same words when a connect comes back to find it off.
    expect(strings.problems.off.title).toBe(strings.offTitle);
  });

  it('offers one Connect calendar while nothing is connected, which opens the popup of providers that are on', async () => {
    shown = await renderCalendars({ connections: [] });
    await expect.element(page.getByText(strings.emptyTitle)).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: strings.connect }));
    await expect.element(page.getByRole('dialog', { name: strings.connectTitle })).toBeVisible();
    // The fake has Google on only: a row per provider that is on.
    await expect.element(page.getByRole('button', { name: strings.connectWith(strings.google) })).toBeVisible();
    expect(page.getByRole('button', { name: strings.connectWith(strings.outlook) }).elements()).toEqual([]);
    expect(page.getByText(/Apple/).elements()).toEqual([]);
  });

  it('names Add new bookings to, the accounts limit, a stopped account and the workspace section', async () => {
    // Three accounts, the most allowed, the first stopped syncing.
    const others = ['b2', 'b3'].map((id, index) => ({
      ...connection,
      id: `0190f0f0-0000-7000-8000-0000000000${id}`,
      accountEmail: `ada${String(index + 2)}@acme.dev`,
    }));
    shown = await renderCalendars({ connections: [{ ...connection, status: 'expired' }, ...others], max: 3 });
    await expect.element(page.getByRole('heading', { name: 'Add new bookings to' })).toBeVisible();
    await expect.element(page.getByText('3 of 3 connected. Disconnect one to add another.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: strings.connect })).toBeDisabled();
    await expect.element(page.getByText('Needs reconnecting')).toBeVisible();
    // On the stopped account's row (the app frame's banner offers one too).
    await expect.element(page.getByRole('button', { name: strings.reconnect, exact: true }).last()).toBeVisible();
    // Its calendars say why nothing on them is checked.
    await expect.element(page.getByText(strings.reconnectToCheck).first()).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Workspace' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'About Add people from meetings' })).toBeVisible();
    // No "sync" in the page's own words (the app frame's banner keeps its own).
    expect([...Object.values(strings.status), strings.updated, strings.notUpdatedYet].join(' ')).not.toMatch(/sync/i);
  });
});
