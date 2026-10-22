// Home's section registry and its sections' pure rules (spec 0041): who gets
// which section, the runs they are laid out in, the greeting, the due run of
// My tasks, the latest captures, and today against the next meeting.
import type { FormSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { todayAndNext, type AgendaItem } from './agenda.ts';
import { latestCaptures } from './captures.ts';
import { duePrefix } from './due.ts';
import { dayPartOf, firstNameOf, hourIn } from './greeting.ts';
import { sectionRuns, visibleSections, withHidden, type HomeContext } from './registry.ts';

const CONTEXT: HomeContext = {
  slug: 'acme',
  objects: [],
  members: [],
  meId: undefined,
  permissions: ['forms.manage'],
  tasks: undefined,
  invitations: undefined,
};

const SECTIONS = [
  { id: 'setup', width: 'full', isVisible: () => true, isHideable: true },
  { id: 'today', width: 'half', isVisible: () => true },
  { id: 'tasks', width: 'half', isVisible: () => true },
  {
    id: 'captures',
    width: 'half',
    isVisible: ({ permissions }: HomeContext) => permissions.includes('forms.manage'),
  },
  { id: 'metrics', width: 'full', isVisible: () => true },
  { id: 'team', width: 'half', isVisible: () => false },
] as const;

describe('the section registry', () => {
  it('keeps the order, leaves out what the member may not get, and what they put away', () => {
    expect(visibleSections(SECTIONS, CONTEXT, []).map((each) => each.id)).toEqual([
      'setup',
      'today',
      'tasks',
      'captures',
      'metrics',
    ]);
    expect(visibleSections(SECTIONS, { ...CONTEXT, permissions: [] }, ['setup']).map((each) => each.id)).toEqual([
      'today',
      'tasks',
      'metrics',
    ]);
  });

  it('never hides a section its entry doesn’t let the member put away', () => {
    expect(visibleSections(SECTIONS, CONTEXT, ['today']).map((each) => each.id)).toContain('today');
  });

  it('lays full sections out alone and runs of half ones together', () => {
    const runs = sectionRuns(visibleSections(SECTIONS, CONTEXT, []));
    expect(runs.map((run) => [run.width, run.sections.map((each) => each.id)])).toEqual([
      ['full', ['setup']],
      ['half', ['today', 'tasks', 'captures']],
      ['full', ['metrics']],
    ]);
  });

  it('adds a key to the hidden list once', () => {
    expect(withHidden([], 'setup')).toEqual(['setup']);
    expect(withHidden(['setup'], 'setup')).toEqual(['setup']);
  });
});

describe('the greeting', () => {
  it('reads the hour in the member’s own zone', () => {
    const at = new Date('2026-10-22T06:30:00Z');
    expect(hourIn(at, 'Asia/Kolkata')).toBe(12);
    expect(hourIn(at, 'America/New_York')).toBe(2);
    expect(dayPartOf(hourIn(at, 'Asia/Kolkata'))).toBe('afternoon');
    expect(dayPartOf(2)).toBe('morning');
    expect(dayPartOf(18)).toBe('evening');
  });

  it('greets by the first word of the name, or by nothing', () => {
    expect(firstNameOf('  Ada  Lovelace ')).toBe('Ada');
    expect(firstNameOf('')).toBeUndefined();
    expect(firstNameOf(undefined)).toBeUndefined();
  });
});

describe('My tasks’ due run', () => {
  const list = [{ dueOn: '2026-10-20' }, { dueOn: '2026-10-22' }, { dueOn: '2026-10-23' }, {}];
  const getItem = (index: number) => list[index];

  it('counts the tasks due today or before, from the top', () => {
    expect(duePrefix(getItem, list.length, '2026-10-22', 10)).toBe(2);
    expect(duePrefix(getItem, list.length, '2026-10-19', 10)).toBe(0);
  });

  it('reads at most one past the limit, and stops where nothing is loaded', () => {
    expect(duePrefix(getItem, list.length, '2026-12-01', 1)).toBe(2);
    expect(duePrefix(() => undefined, 50, '2026-12-01', 10)).toBe(0);
  });
});

describe('New captures', () => {
  const form = (id: string, lastSubmissionAt?: string): FormSummary => ({
    id,
    name: id,
    status: 'live',
    publicKey: id,
    submissionsThisMonth: 1,
    spamCount: 0,
    submissionCount: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ...(lastSubmissionAt === undefined ? {} : { lastSubmissionAt }),
  });

  it('lists the forms with a submission, newest first, at most the limit', () => {
    const forms = [
      form('a', '2026-10-20T10:00:00Z'),
      form('b'),
      form('c', '2026-10-21T10:00:00Z'),
      form('d', '2026-10-19T10:00:00Z'),
    ];
    expect(latestCaptures(forms, 2).map((each) => each.id)).toEqual(['c', 'a']);
  });
});

describe('Today and the next meeting', () => {
  const item = (id: string, startsAt: string, allDay = false): AgendaItem => ({
    id,
    kind: 'event',
    startsAt,
    endsAt: startsAt,
    allDay,
    title: id,
  });

  it('splits at the day’s end, and takes the earliest later meeting by start alone', () => {
    const today = '2026-10-22';
    const tomorrow = new Date(2026, 9, 23, 9).toISOString();
    const later = new Date(2026, 9, 25, 0).toISOString();
    const now = new Date(2026, 9, 22, 15).toISOString();
    const split = todayAndNext([item('later', later, true), item('now', now), item('tomorrow', tomorrow)], today);
    expect(split.today.map((each) => each.id)).toEqual(['now']);
    expect(split.next?.id).toBe('tomorrow');
  });
});
