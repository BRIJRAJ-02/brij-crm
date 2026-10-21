// Home's Team today and metrics row, their pure parts (spec 0041): where a
// member stands at a moment, the row's order, the reader's week, and the
// figures as words.
import type { MemberView, TeamTodayItem } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { metricFigures, weekStartOf } from './metrics.ts';
import { standingOf, teamDaysOf } from './team.ts';

const item = (id: string, startsAt: string, endsAt: string, extra: Partial<TeamTodayItem> = {}): TeamTodayItem => ({
  id,
  kind: 'meeting',
  title: id,
  startsAt,
  endsAt,
  allDay: false,
  ...extra,
});

const at = (iso: string) => new Date(iso);

describe('standingOf', () => {
  const day = [
    item('standup', '2026-11-02T09:00:00Z', '2026-11-02T09:30:00Z'),
    item('review', '2026-11-02T09:30:00Z', '2026-11-02T10:00:00Z'),
    item('lunch', '2026-11-02T12:00:00Z', '2026-11-02T13:00:00Z', { kind: 'busy', title: undefined }),
    item('offsite', '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', { allDay: true }),
  ];

  it('is busy until the end of a run of back to back meetings, with the next one after it', () => {
    expect(standingOf(day, at('2026-11-02T09:10:00Z'))).toMatchObject({
      presence: 'busy',
      current: { id: 'standup' },
      until: '2026-11-02T10:00:00.000Z',
      next: { id: 'lunch' },
    });
  });

  it('is free now with the next meeting, and clear once the day is done; all day events never count', () => {
    expect(standingOf(day, at('2026-11-02T10:30:00Z'))).toMatchObject({ presence: 'free', next: { id: 'lunch' } });
    expect(standingOf(day, at('2026-11-02T14:00:00Z'))).toEqual({ presence: 'clear' });
    expect(standingOf([day[3] as TeamTodayItem], at('2026-11-02T10:00:00Z'))).toEqual({ presence: 'clear' });
  });

  it('keeps a Busy span without a title', () => {
    const standing = standingOf(day, at('2026-11-02T12:30:00Z'));
    expect(standing.presence).toBe('busy');
    expect(standing.current?.title).toBeUndefined();
  });
});

describe('teamDaysOf', () => {
  const member = (id: string, name: string): MemberView => ({
    id,
    name,
    email: `${name}@example.com`,
    role: 'member',
    joinedAt: '2026-10-01T00:00:00.000Z',
  });

  it('puts the reader first, then everyone by name, leaving out a member the list doesn’t hold', () => {
    const days = teamDaysOf(
      [
        { memberId: 'c', items: [] },
        { memberId: 'me', items: [] },
        { memberId: 'a', items: [] },
        { memberId: 'unknown', items: [] },
      ],
      [member('a', 'Zed'), member('c', 'Ada'), member('me', 'Me')],
      'me',
    );
    expect(days.map((day) => day.member.name)).toEqual(['Me', 'Ada', 'Zed']);
  });
});

describe('the metrics row', () => {
  it('starts the week on the reader’s Monday', () => {
    expect(new Date(weekStartOf('2026-11-04')).getDay()).toBe(1);
    expect(weekStartOf('2026-11-02')).toBe(new Date(2026, 10, 2).toISOString());
  });

  it('words the figures the reader may see, in order, with which way each moved', () => {
    const figures = metricFigures(
      {
        meetings: { thisWeek: 12, lastWeek: 8 },
        deals: { thisWeek: 1, lastWeek: 1 },
        won: { currency: 'USD', thisWeek: '1200.5000', lastWeek: '0', others: false },
        submissions: { thisWeek: 1234, lastWeek: 2000 },
      },
      'en-US',
    );
    expect(figures).toEqual([
      { id: 'meetings', value: '12', lastWeek: '8', trend: 'up' },
      { id: 'deals', value: '1', lastWeek: '1', trend: 'same' },
      { id: 'won', value: '$1,201', lastWeek: '$0', trend: 'up' },
      { id: 'submissions', value: '1,234', lastWeek: '2,000', trend: 'down' },
    ]);
  });

  it('shows an unknown currency code beside the amount', () => {
    const [won] = metricFigures({ won: { currency: 'XQZ1', thisWeek: '10', lastWeek: '0', others: false } }, 'en-US');
    expect(won?.value).toBe('10 XQZ1');
  });
});
