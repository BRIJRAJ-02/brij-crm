// Settings › Calendars' table at a phone's width and a desktop's, in light and dark (Q54, 23 October 2026): at
// 390 the header "Calendar" drew over "Check for conflicts" and a long name ran into its "Logs to CRM" badge.
// The table now keeps each column's width and scrolls sideways in its own frame: nothing overlaps, the page never
// scrolls sideways, the arrow keys reach every checkbox, and axe finds nothing. Sync is off on QA, so a connected
// Google account is a fixture here: three calendars, one with a 40 character name, two logging to the CRM.
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
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { CalendarScreen } from './CalendarScreen.tsx';
import { strings } from './calendar-strings.ts';

const ACCOUNT = '0190f0f0-0000-7000-8000-0000000000b1';

/** Forty characters, the longest name the owner's QA calendars came close to. */
const LONG_NAME = 'Customer calls and quarterly reviews EMEA';

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

/** Every one in use, so each shows whatever rule picks the calendars an account lists. */
const CALENDARS: readonly CalendarItem[] = [
  calendar('c1', 'Work', { isPrimary: true, checkConflicts: true, showInWeek: true, isDestination: true }),
  calendar('c2', LONG_NAME, { hue: 'green', checkConflicts: true, sync: true }),
  calendar('c3', 'Team', { hue: 'purple', showInWeek: true, sync: true }),
];

const connection: CalendarConnectionView = {
  id: ACCOUNT,
  provider: 'google',
  accountEmail: 'ada.lovelace@analytical-engines.dev',
  status: 'connected',
  sharing: 'shared',
  isDefault: true,
  createdAt: '2026-10-20T09:00:00Z',
  lastSyncedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
};

const connections: CalendarState = {
  status: 'ready',
  enabled: true,
  providers: ['google'],
  max: 3,
  connections: [connection],
};

const list: CalendarListState = {
  status: 'ready',
  enabled: true,
  providers: ['google'],
  max: 3,
  accounts: [{ ...connection, calendars: [...CALENDARS] }],
};

/** A store's view of one snapshot that never changes. */
function held<T>(snapshot: T) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

const calendars: CalendarsHeld<CalendarListState> = held(list);
/** An owner: the workspace section shows too, with its own copy. */
const settings: CalendarSettingsHeld = held<CalendarSettingsState>({
  status: 'ready',
  canManage: true,
  createUnknownPeople: false,
});

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  delete document.documentElement.dataset.theme;
});

/** The page at `width` in `theme`, over the account's connections (`state`, the connected account by default). */
async function renderCalendars(width: number, theme: 'light' | 'dark', state: CalendarState = connections) {
  await page.viewport(width, 800);
  document.documentElement.dataset.theme = theme;
  const view: CalendarView = held(state);
  const data = {
    calendar: {
      view: () => view,
      calendars: () => calendars,
      settings: () => settings,
      updateCalendar: vi.fn(() => Promise.resolve(true)),
      setDestination: vi.fn(() => Promise.resolve(true)),
    },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => <CalendarScreen data={data} slug="acme" view={view} onResultSeen={() => undefined} />,
    { data, pattern: '/w/$slug/settings/scheduling/calendars', at: '/w/acme/settings/scheduling/calendars' },
  );
}

/** Where an element's own text draws (not its box, which a cut off cell keeps narrow while the text runs on). */
function textBox(element: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}

/** Half a pixel either way: subpixel layout rounds. */
const EPSILON = 0.5;

/** The account's calendar table, once it shows. */
async function grid(): Promise<HTMLElement> {
  const table = page.getByRole('grid', { name: strings.calendarsIn(connection.accountEmail) });
  await expect.element(table).toBeVisible();
  return table.element() as HTMLElement;
}

/** Theme changes start colour transitions; finish them so axe reads the final colours. */
function settleTransitions() {
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) animation.finish();
  }
}

/** The page's WCAG A and AA violations, as `rule: elements` lines. */
async function violations(): Promise<string[]> {
  settleTransitions();
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    resultTypes: ['violations'],
  });
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

describe.each([
  [390, 'light'],
  [390, 'dark'],
  [1440, 'light'],
  [1440, 'dark'],
] as const)('Settings › Calendars at %i, %s', (width, theme) => {
  it('draws the header labels apart, each name clear of its badge, and never scrolls the page sideways', async () => {
    await renderCalendars(width, theme);
    const table = await grid();
    const headers = [...table.querySelectorAll('[role="columnheader"]')];
    expect(headers.map((header) => header.textContent)).toEqual([
      strings.calendarColumn,
      strings.conflictsColumn,
      strings.weekColumn,
      strings.optionsColumn,
    ]);
    // Each shown header's label draws inside its own cell, so no label runs over the next one (Options' label is
    // for screen readers only).
    const labelled = headers.filter((header) => header.textContent !== strings.optionsColumn);
    for (const header of labelled) {
      const cell = header.getBoundingClientRect();
      const text = textBox(header);
      expect(text.left, `${header.textContent} starts inside its cell`).toBeGreaterThanOrEqual(cell.left - EPSILON);
      expect(text.right, `${header.textContent} ends inside its cell`).toBeLessThanOrEqual(cell.right + EPSILON);
    }
    for (const [index, header] of labelled.slice(0, -1).entries()) {
      const next = labelled[index + 1];
      if (next === undefined) continue;
      expect(textBox(header).right, `${header.textContent} ends before ${next.textContent}`).toBeLessThanOrEqual(
        textBox(next).left + EPSILON,
      );
    }
    // Each name sits clear of its "Logs to CRM" badge.
    const rows = [...table.querySelectorAll('[role="row"]')].slice(1);
    expect(rows).toHaveLength(CALENDARS.length);
    for (const row of rows) {
      const name = row.querySelector('[role="rowheader"]');
      if (name === null) throw new Error('A calendar row has no row header');
      const badge = [...name.querySelectorAll('*')].find((each) => each.textContent === strings.logsBadge);
      const nameText = [...name.querySelectorAll('*')].find(
        (each) => each.children.length === 0 && CALENDARS.some((item) => item.name === each.textContent),
      );
      if (nameText === undefined) throw new Error('A calendar row has no name');
      const nameBox = nameText.getBoundingClientRect();
      if (badge !== undefined) {
        expect(nameBox.right, `${nameText.textContent} ends before its badge`).toBeLessThanOrEqual(
          badge.getBoundingClientRect().left + EPSILON,
        );
      }
      // The whole name shows, never cut short: a phone scrolls to it instead.
      expect(nameText.scrollWidth, `${nameText.textContent} shows whole`).toBeLessThanOrEqual(nameText.clientWidth);
    }
    // A table wider than the phone scrolls in its own frame, never the page.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it('reaches every checkbox with the arrow keys, each scrolled into view', async () => {
    await renderCalendars(width, theme);
    const table = await grid();
    const boxes = [...table.querySelectorAll('input[type="checkbox"]')];
    expect(boxes).toHaveLength(CALENDARS.length * 2);
    const frame = table.parentElement;
    if (frame === null) throw new Error('The table has no frame');
    const reached = new Set<Element>();
    // From the account's menu, the last stop before the table, Tab goes in on the first row; then the arrows walk
    // each row to its end and back along the next (a press past an end stays put).
    page
      .getByRole('button', { name: strings.rowActions(connection.accountEmail) })
      .element()
      .focus();
    await userEvent.keyboard('{Tab}');
    for (const [index] of CALENDARS.entries()) {
      for (let step = 0; step < 6; step += 1) {
        await userEvent.keyboard(index % 2 === 0 ? '{ArrowRight}' : '{ArrowLeft}');
        const focused = document.activeElement;
        if (!(focused instanceof HTMLInputElement) || focused.type !== 'checkbox') continue;
        reached.add(focused);
        // Scrolled into the frame's view, not left behind its edge.
        const box = focused.getBoundingClientRect();
        const visible = frame.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(visible.left - EPSILON);
        expect(box.right).toBeLessThanOrEqual(visible.right + EPSILON);
      }
      await userEvent.keyboard('{ArrowDown}');
    }
    expect(boxes.filter((box) => !reached.has(box))).toEqual([]);
  });

  it('passes axe', async () => {
    await renderCalendars(width, theme);
    await grid();
    expect(await violations()).toEqual([]);
  });
});

/** A connection of the member's in `status`. */
const connectionIn = (id: string, status: CalendarConnectionView['status']): CalendarConnectionView => ({
  ...connection,
  id: `0190f0f0-0000-7000-8000-0000000000${id}`,
  accountEmail: `${status}@acme.dev`,
  status,
});

describe('Settings › Calendars’ words', () => {
  it('says what the workspace setting is for, and where bookings go', async () => {
    await renderCalendars(1440, 'light');
    await expect.element(page.getByRole('heading', { name: 'For everyone in the workspace' })).toBeVisible();
    await expect.element(page.getByText('Applies to every member’s synced meetings.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'About Where bookings go' })).toBeVisible();
  });

  it('says sync is off in plain words, with no one to ask', async () => {
    await renderCalendars(390, 'dark', { status: 'ready', enabled: false, providers: [], max: 3, connections: [] });
    await expect.element(page.getByText('Calendar sync is off')).toBeVisible();
    await expect
      .element(
        page.getByText('Connecting calendars isn’t available here yet. Your booking pages still use your hours.'),
      )
      .toBeVisible();
    expect(await violations()).toEqual([]);
  });

  it('says what connecting does, as a sentence', async () => {
    await renderCalendars(390, 'light', { ...connections, connections: [] });
    await expect
      .element(
        page.getByText(
          'Connect your calendar so bookings avoid your busy times and your meetings show on the people you meet.',
        ),
      )
      .toBeVisible();
    expect(await violations()).toEqual([]);
  });

  it('names each stopped account’s state plainly, and counts accounts at the limit', async () => {
    await renderCalendars(1440, 'light', {
      ...connections,
      connections: [connectionIn('e1', 'expired'), connectionIn('e2', 'revoked'), connectionIn('e3', 'failed')],
    });
    await expect.element(page.getByText('Needs reconnecting')).toBeVisible();
    await expect.element(page.getByText('Access removed')).toBeVisible();
    await expect.element(page.getByText('Stopped syncing')).toBeVisible();
    await expect
      .element(page.getByText('You’ve connected 3 accounts, the most you can. Disconnect one to add another.'))
      .toBeVisible();
  });
});
