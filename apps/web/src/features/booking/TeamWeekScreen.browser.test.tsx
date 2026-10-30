// Bookings › Roster, the Team week, in Chromium (spec 0037, AC-1289 to AC-1294, AC-1300, AC-1445): the arrow keys
// move between labelled cells, Enter opens a cell's editor and Esc closes it back onto the cell, a change for one date
// goes to the store, the editor opens whole (both times in view), a See only row has no buttons, Copy this week to
// next week asks first, and no axe violations in either theme. With VITE_ROSTER_SHOTS set it saves the screen at 390 and 1280 wide, light and dark, grid and editor.
import '@crm/ui/styles.css';
import type { DataLayer, TeamWeek, TeamWeekHeld, TeamWeekRow, TeamWeekState, VisibleMember } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { TeamWeekScreen } from './TeamWeekScreen.tsx';

const MONDAY = '2026-11-02';
const ME = '00000000-0000-7000-8000-000000000001';
const SAM = '00000000-0000-7000-8000-000000000002';
const PRIYA = '00000000-0000-7000-8000-000000000003';
const NINE: [string, string] = ['09:00', '17:00'];
const dates = [0, 1, 2, 3, 4, 5, 6].map((index) => `2026-11-0${String(2 + index)}`);

function row(memberId: string, name: string, over: Partial<TeamWeekRow> = {}, days?: TeamWeekRow['days']): TeamWeekRow {
  return {
    memberId,
    name,
    timeZone: 'Europe/London',
    offsetMinutes: 0,
    days:
      days ??
      dates.map((date, index) => ({
        date,
        ranges: index < 5 ? [NINE] : [],
        usual: index < 5 ? [NINE] : [],
        source: 'usual' as const,
      })),
    weekMinutes: 5 * 480,
    otherSchedules: 0,
    canChange: true,
    schedule: { id: `${memberId.slice(0, 30)}aaaaaa`, updatedAt: '2026-10-01T00:00:00.000Z' },
    ...over,
  };
}

const samDays = dates.map((date, index) => ({
  date,
  ranges: index === 1 ? ([['10:00', '14:00']] as [string, string][]) : index < 5 ? [NINE] : [],
  usual: index < 5 ? [NINE] : [],
  source: index === 1 ? ('override' as const) : ('usual' as const),
}));
const priyaDays = dates.map((date, index) => ({
  date,
  ranges: index < 5 ? [NINE] : [],
  usual: index < 5 ? [NINE] : [],
  source: 'usual' as const,
  ...(index === 2 || index === 3 ? { away: {} } : {}),
}));

const WEEK: TeamWeek = {
  weekStart: MONDAY,
  thisWeek: MONDAY,
  earliest: '2026-09-07',
  latest: '2027-11-01',
  rows: [
    row(ME, 'Ada Lovelace'),
    row(
      SAM,
      'Sam Lee',
      { offsetMinutes: 330, timeZone: 'Asia/Kolkata', weekMinutes: 4 * 480 + 240, otherSchedules: 2 },
      samDays,
    ),
    row(PRIYA, 'Priya Shah', { canChange: false, weekMinutes: 3 * 480 }, priyaDays),
  ],
  footer: dates.map((date, index) => ({
    date,
    working: index < 5 ? (index === 2 || index === 3 ? 2 : 3) : 0,
    // Each working person's own hours added up: 3 × 8 h, 2 × 8 h while Priya is away.
    minutes: index < 5 ? (index === 2 || index === 3 ? 960 : 1440) : 0,
  })),
};

const MEMBERS: VisibleMember[] = [
  { id: ME, name: 'Ada Lovelace', canManage: true, canChangeHours: true },
  { id: SAM, name: 'Sam Lee', canManage: true, canChangeHours: true },
  { id: PRIYA, name: 'Priya Shah', canManage: false, canChangeHours: false },
];

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** Everyone's calendar works (spec 0037): the chips stay quiet. */
const allConnected = {
  held: (_workspace: string, memberId: string) => {
    const state = { status: 'ready' as const, health: { memberId, status: 'connected' as const }, asked: false };
    return { subscribe: () => () => undefined, getSnapshot: () => state, retain: () => () => undefined };
  },
  ask: () => Promise.resolve(true),
};

function fake(week: TeamWeek = WEEK) {
  const state: TeamWeekState = { status: 'ready', week, more: 'idle' };
  const held: TeamWeekHeld = {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
    more: () => undefined,
  };
  const teamWeek = {
    held: () => held,
    weekOf: () => MONDAY,
    setDay: vi.fn(() => Promise.resolve(true)),
    copyWeek: vi.fn(() => Promise.resolve(1)),
    setUsualHours: vi.fn(() => Promise.resolve(2)),
  };
  const data = { scheduling: { loaded: () => ({ teamWeek, health: allConnected }) } } as unknown as DataLayer;
  return { data, teamWeek };
}

async function render(week: TeamWeek = WEEK) {
  const made = fake(week);
  shown = await renderInApp(
    () => (
      <TeamWeekScreen data={made.data} slug="acme" week={MONDAY} search="" zone="Europe/London" members={MEMBERS} />
    ),
    { data: made.data, pattern: '/w/$slug/bookings/roster', at: '/w/acme/bookings/roster' },
  );
  return made;
}

const SAM_TUESDAY = 'Tuesday 3 November, Sam Lee: 10:00 am to 2:00 pm, this date only';

describe('the Team week', () => {
  it('names every cell, shows the offset only where it differs, and counts the footer', async () => {
    await render();
    await expect.element(page.getByRole('grid', { name: /^Roster, / })).toBeVisible();
    await expect.element(page.getByRole('button', { name: SAM_TUESDAY })).toBeVisible();
    await expect.element(page.getByText('36 h · UTC+5:30')).toBeVisible();
    await expect.element(page.getByText('2 other schedules')).toBeVisible();
    // See only: Priya's cells are text, with Away read out.
    expect(document.querySelectorAll('button[aria-label*="Priya Shah"]')).toHaveLength(0);
    await expect.element(page.getByText('Wednesday 4 November, Priya Shah: Away')).toBeInTheDocument();
    await expect.element(page.getByText('Monday 2 November: 3 people working, 24 h added up')).toBeInTheDocument();
  });

  it('says under each day how many the workspace link can book, only while there is one', async () => {
    await render({
      ...WEEK,
      link: { pageId: '01900000-0000-7000-8000-0000000000aa', title: 'Talk to us' },
      footer: WEEK.footer.map((total, index) => ({ ...total, linked: index < 5 ? 2 : 0 })),
    });
    await expect.element(page.getByText('2 bookable').first()).toBeInTheDocument();
    await expect
      .element(page.getByText('Monday 2 November: 3 people working, 24 h added up. Talk to us can book 2 people'))
      .toBeInTheDocument();
    shown?.unmount();
    await render();
    await expect.element(page.getByRole('grid', { name: /^Roster, / })).toBeVisible();
    expect(page.getByText('2 bookable').elements()).toHaveLength(0);
  });

  it('moves by the arrow keys, opens a cell with Enter, closes with Esc, and saves a day off', async () => {
    const { teamWeek } = await render();
    const tuesday = page.getByRole('button', { name: SAM_TUESDAY }).element() as HTMLElement;
    // Tab from the strip's last control enters the grid on its first row. Right walks Ada's cell (her name, her
    // menu) into her days; Down goes to Sam's same day.
    (page.getByRole('button', { name: 'Set usual hours', exact: true }).element() as HTMLElement).focus();
    await userEvent.tab();
    const label = () => document.activeElement?.getAttribute('aria-label') ?? '';
    for (let step = 0; step < 6 && !label().startsWith('Monday 2 November, Ada'); step += 1) {
      await userEvent.keyboard('{ArrowRight}');
    }
    expect(label()).toBe('Monday 2 November, Ada Lovelace: 9:00 am to 5:00 pm');
    await userEvent.keyboard('{ArrowRight}');
    expect(label()).toBe('Tuesday 3 November, Ada Lovelace: 9:00 am to 5:00 pm');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(tuesday);
    // Priya's cells are text (See only): the cell itself takes focus, and reads its whole label.
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell');
    expect(document.activeElement?.textContent).toContain('Tuesday 3 November, Priya Shah: 9:00 am to 5:00 pm');
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(tuesday);
    await userEvent.keyboard('{Enter}');
    const editor = page.getByRole('dialog', { name: 'Sam Lee, Tuesday 3 November' });
    await expect.element(editor).toBeVisible();
    // Whose day it is, over the editor; and both of its times whole inside it, never cut off at its edge.
    await expect.element(editor.getByText('Tue 3 · Sam Lee')).toBeVisible();
    const box = (editor.element() as HTMLElement).getBoundingClientRect();
    const until = (
      editor.getByRole('button', { name: /Tue 3 until/ }).element() as HTMLElement
    ).getBoundingClientRect();
    expect(until.width).toBeGreaterThan(0);
    expect(until.right).toBeLessThanOrEqual(box.right);
    // The cell keeps a ring while its editor is open.
    expect(tuesday.hasAttribute('data-open')).toBe(true);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.activeElement).toBe(tuesday);
    await userEvent.keyboard('{Enter}');
    // Save waits for a change; the day's switch turns it off, and Save sends it.
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    (page.getByRole('switch', { name: 'Working' }).element() as HTMLElement).click();
    await page.getByRole('button', { name: 'Save' }).click();
    expect(teamWeek.setDay).toHaveBeenCalledWith('acme', expect.objectContaining({ memberId: SAM }), dates[1], 'off');
  });

  it('asks before copying a week to the next', async () => {
    const { teamWeek } = await render();
    await page.getByRole('button', { name: 'Actions for Sam Lee' }).click();
    await page.getByRole('menuitem', { name: 'Copy to next week' }).click();
    const confirm = page.getByRole('dialog', { name: 'Copy Sam Lee’s week to next week?' });
    await expect.element(confirm).toBeVisible();
    expect(teamWeek.copyWeek).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    expect(teamWeek.copyWeek).toHaveBeenCalledWith('acme', {
      memberIds: [SAM],
      fromWeekStart: MONDAY,
      toWeekStart: '2026-11-09',
    });
  });

  it('copies everyone the reader may change from the toolbar, after asking', async () => {
    const { teamWeek } = await render();
    await page.getByRole('button', { name: 'Copy week' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Copy this week to next week?' })).toBeVisible();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    expect(teamWeek.copyWeek).toHaveBeenCalledWith('acme', {
      memberIds: [ME, SAM],
      fromWeekStart: MONDAY,
      toWeekStart: '2026-11-09',
    });
  });

  it.each(THEMES)('has no axe violations in %s', async (theme) => {
    await render();
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it.runIf(import.meta.env.VITE_ROSTER_SHOTS === '1')(
    'saves screenshots at 390, 1440 and 1920, light and dark',
    async () => {
      // Beside this file (Vite serves nothing outside the project); the lane moves them to its scratchpad.
      const dir = 'roster-shots';
      for (const width of [390, 1440, 1920]) {
        for (const theme of THEMES) {
          await page.viewport(width, 900);
          await render();
          applyTheme(theme);
          await new Promise((resolve) => setTimeout(resolve, 300));
          await page.screenshot({ path: `${dir}/week-${String(width)}-${theme}.png` });
          await page.getByRole('button', { name: SAM_TUESDAY }).click();
          await expect.element(page.getByRole('dialog', { name: 'Sam Lee, Tuesday 3 November' })).toBeVisible();
          await new Promise((resolve) => setTimeout(resolve, 400));
          await page.screenshot({ path: `${dir}/cell-${String(width)}-${theme}.png` });
          await userEvent.keyboard('{Escape}');
          await page.getByRole('button', { name: 'Set usual hours', exact: true }).click();
          await new Promise((resolve) => setTimeout(resolve, 400));
          await page.screenshot({ path: `${dir}/usual-${String(width)}-${theme}.png` });
          shown?.unmount();
          shown = undefined;
          resetTheme();
        }
      }
    },
  );
});
