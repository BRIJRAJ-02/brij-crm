// Settings › Calendars laid out in Chromium (Q54): an account's calendar table keeps each column's width, and at
// 390 it scrolls sideways in its own frame, so no header sits over another and no long name runs under its "Logs
// to CRM" badge; the arrow keys reach every checkbox; axe is clean in light and dark at 390 and 1440. The page's
// words (the off and empty states, Where bookings go, the limit, a stopped account) render as written.
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

/** The account's table. */
const table = () => page.getByRole('grid', { name: strings.calendarsIn('ada@acme.dev') });

/** Every checkbox in the table, by its name. */
const CHECKBOXES = CALENDARS.flatMap((each) => [strings.checkFor(each.name), strings.showOn(each.name)]);

describe('Settings › Calendars at 390 and 1440', () => {
  for (const width of [390, 1440] as const) {
    for (const theme of THEMES) {
      it(`keeps the headers, names and badges apart at ${String(width)} in ${theme}, and axe is clean`, async () => {
        await page.viewport(width, 900);
        applyTheme(theme);
        shown = await renderCalendars();
        await expect.element(table()).toBeVisible();
        const grid = table().element();

        // The header cells side by side, none over the next.
        const headers = [...grid.querySelectorAll('[role="columnheader"]')].map((cell) => cell.getBoundingClientRect());
        expect(headers).toHaveLength(4);
        for (const [index, box] of headers.entries()) {
          const next = headers[index + 1];
          if (next !== undefined)
            expect(box.right, `header ${String(index)} runs into the next`).toBeLessThanOrEqual(next.left + 0.5);
        }
        // "Check for conflicts" reads whole: its header is at least as wide as its words.
        const conflicts = [...grid.querySelectorAll('[role="columnheader"]')].find(
          (cell) => cell.textContent === strings.conflictsColumn,
        );
        expect(conflicts?.scrollWidth).toBeLessThanOrEqual((conflicts?.clientWidth ?? 0) + 1);

        // The long name ends (cut with an ellipsis if it must) before its badge starts.
        const badge = table().getByText(strings.logsBadge).element().getBoundingClientRect();
        const name = table().getByText(LONG_NAME, { exact: true }).element().getBoundingClientRect();
        expect(overlaps(name, badge), 'the name runs under its badge').toBe(false);
        expect(name.right).toBeLessThanOrEqual(badge.left + 0.5);
        // Each checkbox sits inside its own column.
        for (const label of CHECKBOXES) {
          const box = page.getByRole('checkbox', { name: label }).element().getBoundingClientRect();
          expect(overlaps(box, badge), `${label} under the badge`).toBe(false);
          expect(overlaps(box, name), `${label} under the name`).toBe(false);
        }
        // The page never scrolls sideways. At 390 each column keeps its width and the table's own frame scrolls;
        // at 1440 it fits.
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        const frame = grid.parentElement;
        if (width === 390) expect(frame?.scrollWidth ?? 0).toBeGreaterThan(frame?.clientWidth ?? 0);
        else expect(frame?.scrollWidth).toBe(frame?.clientWidth);

        expect(await axeViolations()).toEqual([]);
      });
    }
  }

  it('reaches every checkbox with the arrow keys, at 390', async () => {
    await page.viewport(390, 900);
    shown = await renderCalendars();
    await expect.element(table()).toBeVisible();
    // Into the table on its first row's name cell, then along each row and down, the way a keyboard user goes.
    const firstRow = table().element().querySelector<HTMLElement>('[role="row"][data-key]');
    (firstRow?.querySelector<HTMLElement>('[role="rowheader"]') ?? firstRow)?.focus();
    const boxes = CHECKBOXES.map((label) => ({ label, box: page.getByRole('checkbox', { name: label }).element() }));
    const reached = new Set<string>();
    const path: string[] = [];
    const frame = table().element().parentElement?.getBoundingClientRect();
    const note = () => {
      const active = document.activeElement;
      path.push(`${active?.tagName ?? ''}[${active?.getAttribute('role') ?? ''}]`);
      for (const { label, box } of boxes) {
        if (active !== box) continue;
        reached.add(label);
        // Scrolled into the frame's view, never left past its edge.
        const at = box.getBoundingClientRect();
        expect(at.left, `${label} past the start`).toBeGreaterThanOrEqual((frame?.left ?? 0) - 1);
        expect(at.right, `${label} past the end`).toBeLessThanOrEqual((frame?.right ?? 0) + 1);
      }
    };
    for (const [row] of CALENDARS.entries()) {
      const forward = row % 2 === 0 ? '{ArrowRight}' : '{ArrowLeft}';
      for (let step = 0; step < 4; step += 1) {
        await userEvent.keyboard(forward);
        note();
      }
      await userEvent.keyboard('{ArrowDown}');
      note();
    }
    for (const label of CHECKBOXES) expect([...reached], `${label} by keyboard: ${path.join(' ')}`).toContain(label);
  });
});

describe('Settings › Calendars’ words', () => {
  it('says calendar sync is off, and that booking pages still use your hours', async () => {
    shown = await renderCalendars({ enabled: false, connections: [] });
    await expect.element(page.getByText(strings.offTitle)).toBeVisible();
    await expect.element(page.getByText(strings.offText)).toBeVisible();
    expect(strings.offTitle).toBe('Calendar sync is off');
  });

  it('says what connecting does while nothing is connected', async () => {
    shown = await renderCalendars({ connections: [] });
    await expect
      .element(
        page.getByText(
          'Connect your calendar so bookings avoid your busy times and your meetings show on the people you meet.',
        ),
      )
      .toBeVisible();
  });

  it('names Where bookings go, the accounts limit, a stopped account and the workspace section', async () => {
    // Three accounts, the most allowed, the first stopped syncing.
    const others = ['b2', 'b3'].map((id, index) => ({
      ...connection,
      id: `0190f0f0-0000-7000-8000-0000000000${id}`,
      accountEmail: `ada${String(index + 2)}@acme.dev`,
    }));
    shown = await renderCalendars({ connections: [{ ...connection, status: 'expired' }, ...others], max: 3 });
    await expect.element(page.getByRole('button', { name: 'About Where bookings go' })).toBeVisible();
    await expect
      .element(page.getByText('You’ve connected 3 accounts, the most you can. Disconnect one to add another.'))
      .toBeVisible();
    await expect.element(page.getByText('Needs reconnecting')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'For everyone in the workspace' })).toBeVisible();
    await expect.element(page.getByText('Applies to every member’s synced meetings.')).toBeVisible();
    expect([strings.status.revoked, strings.status.failed]).toEqual(['Access removed', 'Stopped syncing']);
  });
});
