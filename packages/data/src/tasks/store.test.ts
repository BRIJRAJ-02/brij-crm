// The tasks store against a fake API answered by hand (spec 0019, AC-432 to
// AC-435): one copy of each task, optimistic creates and ticks with their
// rollback and Retry, the settle that moves a ticked task out of its open
// list, and the live rules for `tasks` and `records` events.
import type { RecordRefDisplay, TaskPage, TaskView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { createTasksStore, TASK_SETTLE_MS, type TasksApi } from './store.ts';

const WS = 'acme';
const ME = '0199a6f2-0000-7000-8000-000000000001';
const ACME = '0199a6f2-0000-7000-8000-0000000000a1';
const ADA = '0199a6f2-0000-7000-8000-0000000000a2';
const acme: RecordRefDisplay = { objectId: 'o1', recordId: ACME, name: 'Acme', kind: 'company' };
const ada: RecordRefDisplay = { objectId: 'o2', recordId: ADA, name: 'Ada', kind: 'person' };

const task = (n: number, extra: Partial<TaskView> = {}): TaskView => ({
  id: `0199a6f2-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
  title: `Task ${String(n)}`,
  isDone: false,
  records: [acme],
  recordCount: 1,
  canChange: true,
  createdAt: '2026-10-12T09:00:00.000Z',
  createdBy: { type: 'member', id: ME },
  updatedAt: '2026-10-12T09:00:00.000Z',
  ...extra,
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const refused = (code: string, message: string) => Object.assign(new Error(message), { name: 'DataError', code });

function setup(server: Map<string, TaskView>) {
  const calls: string[] = [];
  const timers: { work: () => void; ms: number; live: boolean }[] = [];
  const notices: { message: string; retry?: () => void }[] = [];
  const timelines: (readonly string[] | 'all')[] = [];
  const spreads: (() => void)[] = [];
  let refuse: Error | undefined;
  const listOf = (recordId: string, status: 'open' | 'done'): TaskPage => {
    const items = [...server.values()].filter(
      (each) => each.isDone === (status === 'done') && each.records.some((record) => record.recordId === recordId),
    );
    return { items, total: { count: items.length, atLeast: false } };
  };
  const api: TasksApi = {
    list: ({ recordId, status }) => {
      calls.push(`list ${status}`);
      return Promise.resolve(listOf(recordId, status));
    },
    get: ({ ids }) => {
      calls.push(`get ${ids.join(',')}`);
      return Promise.resolve(ids.flatMap((id) => (server.has(id) ? [server.get(id) as TaskView] : [])));
    },
    create: (input) => {
      calls.push(`create ${input.title}`);
      if (refuse !== undefined) return Promise.reject(refuse);
      const made = task(90, {
        id: input.id,
        title: input.title,
        records: input.recordIds?.includes(ACME) ? [acme] : [],
      });
      server.set(made.id, made);
      return Promise.resolve(made);
    },
    update: (input) => {
      calls.push(`update ${JSON.stringify({ isDone: input.isDone, title: input.title })}`);
      if (refuse !== undefined) return Promise.reject(refuse);
      const held = server.get(input.taskId);
      if (held === undefined) return Promise.reject(refused('NOT_FOUND', 'That task does not exist.'));
      const next = {
        ...held,
        ...(input.isDone === undefined ? {} : { isDone: input.isDone }),
        ...(input.title === undefined ? {} : { title: input.title }),
      };
      server.set(next.id, next);
      return Promise.resolve(next);
    },
  };
  let minted = 0;
  const store = createTasksStore({
    api,
    mintId: () => `0199a6f2-0000-7000-8000-${String((minted += 1)).padStart(12, '0')}`,
    mutations: createMutationLog(),
    notify: (notice) =>
      notices.push({ message: notice.message, ...(notice.action ? { retry: notice.action.onAction } : {}) }),
    watch: () => () => undefined,
    spread: (_key, work) => spreads.push(work),
    timelines: (_workspace, ids) => timelines.push(ids),
    later: (work, ms) => {
      const timer = { work, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    now: () => Date.parse('2026-10-12T10:00:00.000Z'),
    memberOf: () => Promise.resolve(ME),
  });
  /** Runs every live timer of `ms`, as if that long passed. */
  const elapse = async (ms: number) => {
    for (const timer of timers.splice(0)) if (timer.live && timer.ms === ms) timer.work();
    await flush();
  };
  return {
    store,
    calls,
    notices,
    timelines,
    spreads,
    elapse,
    refuseWith: (error: Error | undefined) => {
      refuse = error;
    },
  };
}

const titles = (state: { source: { count: number; getItem: (index: number) => TaskView | undefined } }) =>
  Array.from({ length: state.source.count }, (_, index) => state.source.getItem(index)?.title);

describe('the tasks store (spec 0019)', () => {
  it('lists a record’s open tasks with its count, from one copy of each task', async () => {
    const server = new Map([task(1), task(2)].map((each) => [each.id, each]));
    const { store } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    expect(open.getSnapshot()).toMatchObject({ status: 'ready', total: { count: 2, atLeast: false } });
    expect(titles(open.getSnapshot())).toEqual(['Task 1', 'Task 2']);
    expect(store.forRecord(WS, ACME, 'open')).toBe(open);
  });

  it('creates a task first and marked new at once, and settles 1.5 s after it lands (AC-432)', async () => {
    const server = new Map([task(1)].map((each) => [each.id, each]));
    const { store, calls, elapse, timelines } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    const id = store.newId();
    const landed = store.create(WS, { id, title: '  Call back ', records: [acme] });
    expect(titles(open.getSnapshot())).toEqual(['Call back', 'Task 1']);
    expect(open.getSnapshot().newIds.has(id)).toBe(true);
    expect(open.getSnapshot().total?.count).toBe(2);
    expect(await landed).toBe(true);
    expect(timelines).toContainEqual([ACME]);
    await elapse(TASK_SETTLE_MS);
    expect(calls.filter((call) => call === 'list open')).toHaveLength(2);
    expect(open.getSnapshot().newIds.size).toBe(0);
  });

  it('takes a refused create away and raises a toast whose Retry sends the same id', async () => {
    const server = new Map<string, TaskView>();
    const { store, notices, refuseWith, calls } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    refuseWith(refused('FORBIDDEN', "You can't link a task to a record you can't change."));
    const id = store.newId();
    expect(await store.create(WS, { id, title: 'Nope', records: [acme] })).toBe(false);
    expect(open.getSnapshot().source.count).toBe(0);
    expect(notices[0]?.message).toBe("The task wasn’t created. You can't link a task to a record you can't change.");
    refuseWith(undefined);
    notices[0]?.retry?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.filter((call) => call === 'create Nope')).toHaveLength(2);
    expect(server.has(id)).toBe(true);
  });

  it('keeps a ticked task in its open list struck through until the list settles, then lets it go (AC-433)', async () => {
    const one = task(1);
    const server = new Map([one, task(2)].map((each) => [each.id, each]));
    const { store, elapse } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    expect(await store.setDone(WS, one.id, true)).toBe(true);
    expect(open.getSnapshot().source.getItem(0)).toMatchObject({ id: one.id, isDone: true });
    expect(open.getSnapshot().source.count).toBe(2);
    await elapse(TASK_SETTLE_MS);
    expect(titles(open.getSnapshot())).toEqual(['Task 2']);
  });

  it('rolls a refused tick back with a toast and Retry, and answers a dialog’s refusal instead', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store, notices, refuseWith } = setup(server);
    const sub = store.one(WS, one.id);
    sub.retain();
    await flush();
    refuseWith(refused('FORBIDDEN', 'You can view this task but not change it.'));
    const ticking = store.setDone(WS, one.id, true);
    expect(sub.getSnapshot().task?.isDone).toBe(true);
    expect(await ticking).toBe(false);
    expect(sub.getSnapshot().task?.isDone).toBe(false);
    expect(notices[0]).toMatchObject({ message: 'The task wasn’t updated. You can view this task but not change it.' });
    const failure = await store.update(WS, one.id, { title: 'Renamed' });
    expect(failure?.code).toBe('FORBIDDEN');
    expect(sub.getSnapshot().task?.title).toBe('Task 1');
    expect(notices).toHaveLength(1);
  });

  it('sends one task’s changes in the order they were made', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store, calls } = setup(server);
    const sub = store.one(WS, one.id);
    sub.retain();
    await flush();
    await Promise.all([
      store.setDone(WS, one.id, true),
      store.setDone(WS, one.id, false),
      store.update(WS, one.id, { title: 'Last' }),
    ]);
    expect(calls.filter((call) => call.startsWith('update'))).toEqual([
      'update {"isDone":true}',
      'update {"isDone":false}',
      'update {"title":"Last"}',
    ]);
    expect(sub.getSnapshot().task).toMatchObject({ isDone: false, title: 'Last' });
  });

  it('reads named tasks again on a tasks event, drops the ones gone, and settles the named records’ lists', async () => {
    const one = task(1);
    const two = task(2);
    const server = new Map([one, two].map((each) => [each.id, each]));
    const { store, calls, elapse, timelines } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    server.set(one.id, { ...one, title: 'Renamed elsewhere' });
    server.delete(two.id);
    store.changed(WS, {
      seq: 9,
      at: '2026-10-12T10:00:00.000Z',
      kind: 'tasks',
      recordIds: [ACME],
      taskIds: [one.id, two.id],
    });
    await flush();
    expect(calls).toContain(`get ${one.id},${two.id}`);
    expect(titles(open.getSnapshot())).toEqual(['Renamed elsewhere']);
    expect(timelines).toContainEqual([ACME]);
    await elapse(TASK_SETTLE_MS);
    expect(calls.filter((call) => call === 'list open')).toHaveLength(2);
  });

  it('spreads a coarse event, then reads every task held again', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store, calls, spreads } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    store.changed(WS, {
      seq: 9,
      at: '2026-10-12T10:00:00.000Z',
      kind: 'tasks',
      recordIds: [],
      taskIds: [],
      coarse: true,
    });
    expect(calls.some((call) => call.startsWith('get'))).toBe(false);
    spreads.forEach((work) => work());
    await flush();
    expect(calls).toContain(`get ${one.id}`);
  });

  it('reads tasks linking a record that went to the trash, and its own list becomes unavailable (AC-446)', async () => {
    const one = task(1, { records: [acme, ada], recordCount: 2 });
    const server = new Map([[one.id, one]]);
    const { store, calls } = setup(server);
    const open = store.forRecord(WS, ADA, 'open');
    open.retain();
    await open.ready();
    server.set(one.id, { ...one, records: [ada], recordCount: 1 });
    store.recordsChanged(WS, {
      seq: 3,
      at: '2026-10-12T10:00:00.000Z',
      kind: 'records',
      objectId: 'o1',
      recordIds: [ACME],
      attributeIds: [],
      deletedIds: [ACME],
    });
    await flush();
    expect(calls).toContain(`get ${one.id}`);
    expect(open.getSnapshot().source.getItem(0)?.recordCount).toBe(1);
  });
});
