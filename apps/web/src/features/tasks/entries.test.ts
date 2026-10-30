import type { RecordRefDisplay, TaskView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { withLinks } from '../records/timeline.ts';
import { isTaskParam } from '../records/params.ts';
import { chipOrder, memberDisplay, tabCount, toTaskEntry } from './entries.ts';

const acme: RecordRefDisplay = { objectId: 'o1', recordId: 'r1', name: 'Acme', kind: 'company' };
const ada: RecordRefDisplay = { objectId: 'o2', recordId: 'r2', name: 'Ada', kind: 'person' };
const members = [{ id: 'm1', name: 'Grace Hopper', email: 'grace@example.com' }];
const task: TaskView = {
  id: '0199a6f2-0000-7000-8000-000000000001',
  title: 'Call back',
  description: '',
  isDone: false,
  dueOn: '2026-10-20',
  assigneeMemberId: 'm1',
  records: [acme, ada],
  recordCount: 2,
  canChange: true,
  createdAt: '2026-10-12T09:00:00.000Z',
  createdBy: { type: 'member', id: 'm1' },
  updatedAt: '2026-10-12T09:00:00.000Z',
};

describe('tasks as the list draws them (spec 0019)', () => {
  it('shows the first record that isn’t the page’s, and the page’s record when it is the only one', () => {
    expect(chipOrder([acme, ada], 'r1').map((record) => record.name)).toEqual(['Ada', 'Acme']);
    expect(chipOrder([acme], 'r1').map((record) => record.name)).toEqual(['Acme']);
    expect(chipOrder([acme, ada]).map((record) => record.name)).toEqual(['Acme', 'Ada']);
  });

  it('names the assignee from the members, and a removed one as Former member', () => {
    expect(memberDisplay(members, 'm1').name).toBe('Grace Hopper');
    expect(memberDisplay(members, 'gone').name).toBe('Former member');
  });

  it('maps a task to its entry, read only with the reason when the reader may not change it', () => {
    expect(toTaskEntry(task, members, 'r1')).toMatchObject({
      title: 'Call back',
      dueOn: '2026-10-20',
      assignee: { name: 'Grace Hopper' },
      recordCount: 2,
    });
    expect(toTaskEntry(task, members).readOnlyReason).toBeUndefined();
    expect(toTaskEntry({ ...task, canChange: false }, members).readOnlyReason).toBe(
      'You can view this task but not change it.',
    );
  });

  it('carries a capped count as a floor, and reads ?task= as a uuid or new only', () => {
    expect(tabCount({ count: 10_000, atLeast: true })).toEqual({
      count: 10_000,
      countMax: 10_000,
      isCountAtLeast: true,
    });
    expect(tabCount(undefined)).toEqual({});
    // No open tasks shows no count at all, never a "0".
    expect(tabCount({ count: 0, atLeast: false })).toEqual({});
    expect(tabCount({ count: 2, atLeast: false })).toEqual({ count: 2, countMax: 10_000, isCountAtLeast: false });
    expect(isTaskParam('new')).toBe(true);
    expect(isTaskParam(task.id)).toBe(true);
    expect(isTaskParam('nope')).toBe(false);
    expect(isTaskParam(3)).toBe(false);
  });

  it('links a task entry in the timeline to its dialog', () => {
    const entry = {
      id: `task:${task.id}:added`,
      at: '2026-10-12T09:00:00.000Z',
      actor: { type: 'member' as const, id: 'm1', name: 'Grace Hopper' },
      kind: 'task' as const,
      itemId: task.id,
      title: 'Call back',
      isDone: false,
    };
    expect(
      withLinks(
        entry,
        () => undefined,
        (id) => `/page?task=${id}`,
      ),
    ).toMatchObject({
      href: `/page?task=${task.id}`,
    });
  });
});
