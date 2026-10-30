// The Team week store (spec 0037, job J6) against a fake API: a cell shows at once with its row's hours and the footer
// counted again, the answer's version lands on every held week, a refusal puts the cell back with a toast and a STALE
// one reads again, Show more appends a page, and a bulk write reads the held weeks again.
import { describe, expect, it, vi } from 'vitest';
import type { TeamWeek, TeamWeekRow } from '@crm/contracts';
import { footerOf, weekDates } from '@crm/contracts/roster';
import { createTeamWeekStore, dayWith, type TeamWeekApi } from './team-week.ts';

const MONDAY = '2026-11-02';
const NINE: [string, string] = ['09:00', '17:00'];

const row = (memberId: string, name: string): TeamWeekRow => {
  const days = weekDates(MONDAY).map((date, index) => ({
    date,
    ranges: index < 5 ? [NINE] : [],
    usual: index < 5 ? [NINE] : [],
    source: 'usual' as const,
  }));
  return {
    memberId,
    name,
    timeZone: 'UTC',
    offsetMinutes: 0,
    days,
    weekMinutes: 5 * 480,
    otherSchedules: 0,
    canChange: true,
    schedule: { id: `${memberId}-s`, updatedAt: '2026-10-01T00:00:00.000Z' },
  };
};

const weekOf = (rows: TeamWeekRow[], nextCursor?: string): TeamWeek => ({
  weekStart: MONDAY,
  thisWeek: MONDAY,
  earliest: '2026-09-07',
  latest: '2027-11-01',
  rows,
  footer: footerOf(weekDates(MONDAY), rows),
  ...(nextCursor === undefined ? {} : { nextCursor }),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(api: Partial<TeamWeekApi> = {}) {
  const notify = vi.fn();
  const read = vi.fn((input: { readonly cursor?: string }) =>
    Promise.resolve(
      input.cursor === undefined ? weekOf([row('a', 'Ana'), row('b', 'Ben')], 'next') : weekOf([row('c', 'Cy')]),
    ),
  );
  const store = createTeamWeekStore({
    api: {
      read,
      setDay: () => Promise.reject(new Error('not set')),
      copyWeek: () => Promise.resolve({ changed: 1 }),
      setUsualHours: () => Promise.resolve({ changed: 2 }),
      ...api,
    },
    notify,
    now: () => 0,
  });
  return { store, notify, read };
}

const ready = (state: ReturnType<ReturnType<typeof createTeamWeekStore>['held']>['getSnapshot']) => {
  const snapshot = state();
  if (snapshot.status !== 'ready') throw new Error(`not ready: ${snapshot.status}`);
  return snapshot.week;
};

describe('the Team week store', () => {
  it('turns a cell back to its usual hours from what it carries', () => {
    const day = {
      date: MONDAY,
      ranges: [['10:00', '14:00'] as [string, string]],
      usual: [NINE],
      source: 'override' as const,
    };
    expect(dayWith(day, 'usual')).toMatchObject({ ranges: [NINE], source: 'usual' });
    expect(dayWith(day, 'off')).toMatchObject({ ranges: [], source: 'override' });
  });

  it('shows a cell at once, counts again, and takes the answer’s version', async () => {
    let answer: (value: Awaited<ReturnType<TeamWeekApi['setDay']>>) => void = () => undefined;
    const { store } = setup({
      setDay: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const held = store.held('ws', MONDAY);
    held.retain();
    await held.ready();
    const landing = store.setDay('ws', row('a', 'Ana'), MONDAY, [['10:00', '12:00']]);
    const shown = ready(held.getSnapshot);
    expect(shown.rows[0]?.days[0]).toMatchObject({ ranges: [['10:00', '12:00']], source: 'override' });
    expect(shown.rows[0]?.weekMinutes).toBe(4 * 480 + 120);
    expect(shown.footer[0]).toEqual({ date: MONDAY, working: 2, minutes: 600 });
    answer({
      day: { date: MONDAY, ranges: [['10:00', '12:00']], usual: [NINE], source: 'override' },
      schedule: { id: 'a-s', updatedAt: '2026-11-01T00:00:00.000Z' },
    });
    expect(await landing).toBe(true);
    expect(ready(held.getSnapshot).rows[0]?.schedule.updatedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('puts a refused cell back with a toast, and reads again on STALE', async () => {
    const { store, notify, read } = setup({
      setDay: () => Promise.reject(Object.assign(new Error('Changed.'), { status: 409, code: 'STALE' })),
    });
    const held = store.held('ws', MONDAY);
    held.retain();
    await held.ready();
    expect(await store.setDay('ws', row('a', 'Ana'), MONDAY, 'off')).toBe(false);
    expect(ready(held.getSnapshot).rows[0]?.days[0]?.ranges).toEqual([NINE]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    await flush();
    expect(read.mock.calls.length).toBeGreaterThan(1);
  });

  it('appends the next page, and keeps it through a read again after a bulk write', async () => {
    const { store, read } = setup();
    const held = store.held('ws', MONDAY);
    held.retain();
    await held.ready();
    held.more();
    await flush();
    expect(ready(held.getSnapshot).rows.map((each) => each.name)).toEqual(['Ana', 'Ben', 'Cy']);
    expect(ready(held.getSnapshot).footer[0]?.working).toBe(3);
    read.mockClear();
    expect(await store.copyWeek('ws', { memberIds: ['a'], fromWeekStart: MONDAY, toWeekStart: '2026-11-09' })).toBe(1);
    await flush();
    await flush();
    // Both pages read again.
    expect(read).toHaveBeenCalledTimes(2);
    expect(ready(held.getSnapshot).rows).toHaveLength(3);
  });
});
