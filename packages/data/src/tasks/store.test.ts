// The tasks store against a fake API answered by hand (spec 0019, AC-432 to
// AC-435): one copy of each task, optimistic creates and ticks with their
// rollback and Retry, the settle that moves a ticked task out of its open
// list, and the live rules for `tasks` and `records` events.
import type { RecordRefDisplay, TaskPage, TaskView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { createTasksStore, TASK_SETTLE_MS, type TaskListKey, type TasksApi } from './store.ts';

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

function setupWithGate(server: Map<string, TaskView>) {
  let gate: Promise<void> | undefined;
  let openGate: () => void = () => undefined;
  let createGate: Promise<void> | undefined;
  let openCreateGate: () => void = () => undefined;
  let refuseOnce: Error | undefined;
  const made = setup(server, {
    beforeUpdate: async () => {
      if (refuseOnce !== undefined) {
        const error = refuseOnce;
        refuseOnce = undefined;
        throw error;
      }
      await gate;
    },
    beforeCreate: async () => {
      await createGate;
    },
  });
  return {
    ...made,
    api: {
      open: () => {
        openGate();
      },
    },
    refuseNext: (error: Error) => {
      refuseOnce = error;
    },
    gateCreates: () => {
      createGate = new Promise<void>((resolve) => {
        openCreateGate = resolve;
      });
    },
    openCreates: () => {
      openCreateGate();
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    },
  };
}

function setup(
  server: Map<string, TaskView>,
  hooks: {
    readonly beforeUpdate?: () => Promise<void>;
    readonly beforeCreate?: () => Promise<void>;
    readonly list?: (page: { readonly cursor?: string }) => TaskPage;
  } = {},
) {
  const calls: string[] = [];
  const deleted = new Map<string, TaskView>();
  const timers: { work: () => void; ms: number; live: boolean }[] = [];
  const notices: { message: string; retry?: () => void }[] = [];
  const timelines: (readonly string[] | 'all')[] = [];
  const spreads: (() => void)[] = [];
  let refuse: Error | undefined;
  const listOf = (scope: TaskListKey, status: 'open' | 'done'): TaskPage => {
    const items = [...server.values()].filter(
      (each) =>
        each.isDone === (status === 'done') &&
        ('recordId' in scope
          ? each.records.some((record) => record.recordId === scope.recordId)
          : scope.mine === 'all' ||
            (scope.mine === 'assigned' ? each.assigneeMemberId === ME : each.createdBy.id === ME)),
    );
    return { items, total: { count: items.length, atLeast: false } };
  };
  const api: TasksApi = {
    list: ({ scope, status, cursor }) => {
      calls.push('mine' in scope ? `list ${scope.mine} ${status}` : `list ${status}`);
      try {
        return Promise.resolve(hooks.list?.(cursor === undefined ? {} : { cursor }) ?? listOf(scope, status));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    get: ({ ids }) => {
      calls.push(`get ${ids.join(',')}`);
      return Promise.resolve(ids.flatMap((id) => (server.has(id) ? [server.get(id) as TaskView] : [])));
    },
    create: async (input) => {
      calls.push(`create ${input.title}`);
      await hooks.beforeCreate?.();
      if (refuse !== undefined) return Promise.reject(refuse);
      const made = task(90, {
        id: input.id,
        title: input.title,
        records: input.recordIds?.includes(ACME) ? [acme] : [],
        ...(input.assigneeMemberId === undefined ? {} : { assigneeMemberId: input.assigneeMemberId }),
      });
      server.set(made.id, made);
      return Promise.resolve(made);
    },
    delete: ({ taskId }) => {
      calls.push(`delete ${taskId}`);
      const held = server.get(taskId);
      if (held === undefined) return Promise.reject(refused('NOT_FOUND', 'That task does not exist.'));
      server.delete(taskId);
      deleted.set(taskId, held);
      return Promise.resolve({ ok: true });
    },
    restore: ({ taskId }) => {
      calls.push(`restore ${taskId}`);
      const held = deleted.get(taskId);
      if (held === undefined) return Promise.reject(refused('NOT_FOUND', 'That task does not exist.'));
      deleted.delete(taskId);
      server.set(taskId, held);
      return Promise.resolve(held);
    },
    update: async (input) => {
      calls.push(`update ${JSON.stringify({ isDone: input.isDone, title: input.title })}`);
      await hooks.beforeUpdate?.();
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
      // A moment's wait (reads gathered for a frame) runs for real; the settle waits for `elapse`.
      if (ms === 0) {
        const real = setTimeout(work, 0);
        return () => {
          clearTimeout(real);
        };
      }
      const timer = { work, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    now: () => Date.parse('2026-10-12T10:00:00.000Z'),
    memberOf: () => Promise.resolve(ME),
    random: () => 0,
    primaryOf: () => Promise.resolve('name'),
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

  it('reads only what links a record of a job’s object on its coarse change, and nothing for another (spec 0022)', async () => {
    const one = task(1);
    const two = task(2, { records: [ada] });
    const server = new Map([one, two].map((each) => [each.id, each]));
    const { store, calls, spreads, elapse } = setup(server);
    const ofAcme = store.forRecord(WS, ACME, 'open', 'o1');
    ofAcme.retain();
    await ofAcme.ready();
    const ofAda = store.forRecord(WS, ADA, 'open', 'o2');
    ofAda.retain();
    await ofAda.ready();
    calls.splice(0);
    const coarse = (objectId: string) => {
      store.recordsChanged(WS, {
        seq: 5,
        at: '2026-10-12T10:00:00.000Z',
        kind: 'records',
        objectId,
        recordIds: [],
        attributeIds: [],
        coarse: true,
        fromJob: true,
      });
      for (const work of spreads.splice(0)) work();
    };
    coarse('o9');
    await elapse(TASK_SETTLE_MS);
    expect(calls).toEqual([]);
    coarse('o2');
    await flush();
    await elapse(TASK_SETTLE_MS);
    expect(calls).toContain(`get ${two.id}`);
    expect(calls).not.toContain(`get ${one.id}`);
    // Only Ada's list read its page again.
    expect(calls.filter((call) => call.startsWith('list'))).toEqual(['list open']);
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

  it('keeps a later change on screen when an earlier one’s answer lands, and drops only a refused layer', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store, api, hold } = setupWithGate(server);
    const sub = store.one(WS, one.id);
    sub.retain();
    await flush();
    hold();
    const tick = store.setDone(WS, one.id, true);
    const rename = store.update(WS, one.id, { title: 'Renamed' });
    expect(sub.getSnapshot().task).toMatchObject({ isDone: true, title: 'Renamed' });
    // The tick's answer lands first: the rename still shows on top of it.
    api.open();
    await tick;
    expect(sub.getSnapshot().task).toMatchObject({ isDone: true, title: 'Renamed' });
    await rename;
    expect(sub.getSnapshot().task).toMatchObject({ isDone: true, title: 'Renamed' });
  });

  it('puts back only the refused change, while a later one is still out', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store, refuseNext } = setupWithGate(server);
    const sub = store.one(WS, one.id);
    sub.retain();
    await flush();
    refuseNext(refused('FORBIDDEN', 'No.'));
    const tick = store.update(WS, one.id, { isDone: true });
    const rename = store.update(WS, one.id, { title: 'Renamed' });
    expect((await tick)?.code).toBe('FORBIDDEN');
    expect(sub.getSnapshot().task).toMatchObject({ isDone: false, title: 'Renamed' });
    expect(await rename).toBeUndefined();
    expect(sub.getSnapshot().task).toMatchObject({ isDone: false, title: 'Renamed' });
  });

  it('keeps a task still being created in its list through a settle', async () => {
    const server = new Map([task(1)].map((each) => [each.id, each]));
    const { store, gateCreates, openCreates, elapse } = setupWithGate(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    gateCreates();
    const id = store.newId();
    const landed = store.create(WS, { id, title: 'Pending', records: [acme] });
    // A teammate's event settles the list while the create is out: the new task stays first, still new.
    store.changed(WS, { seq: 9, at: '2026-10-12T10:00:00.000Z', kind: 'tasks', recordIds: [ACME], taskIds: [] });
    await elapse(TASK_SETTLE_MS);
    expect(titles(open.getSnapshot())).toEqual(['Pending', 'Task 1']);
    expect(open.getSnapshot().newIds.has(id)).toBe(true);
    openCreates();
    expect(await landed).toBe(true);
  });

  it('gathers a burst of events into one read, and reads a task again when named while its read is out', async () => {
    const one = task(1);
    const two = task(2);
    const server = new Map([one, two].map((each) => [each.id, each]));
    const { store, calls } = setupWithGate(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    const event = (taskIds: string[]) =>
      store.changed(WS, { seq: 9, at: '2026-10-12T10:00:00.000Z', kind: 'tasks', recordIds: [], taskIds });
    event([one.id]);
    event([two.id]);
    await flush();
    expect(calls.filter((call) => call.startsWith('get'))).toEqual([`get ${one.id},${two.id}`]);
  });

  it('reads a task again when a record it links is renamed', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store, calls } = setupWithGate(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    store.recordsChanged(WS, {
      seq: 3,
      at: '2026-10-12T10:00:00.000Z',
      kind: 'records',
      objectId: 'o1',
      recordIds: [ACME],
      attributeIds: ['name'],
    });
    await flush();
    expect(calls).toContain(`get ${one.id}`);
  });

  it('puts a list let go of back when a screen still holding it shows it again', async () => {
    const server = new Map([task(1)].map((each) => [each.id, each]));
    const { store, elapse, calls } = setupWithGate(server);
    const open = store.forRecord(WS, ACME, 'open');
    const release = open.retain();
    await open.ready();
    release();
    await elapse(30_000);
    // A new handle (the loader ran again) and the old one shown again: the old one goes back in the map.
    open.retain();
    await flush();
    expect(store.forRecord(WS, ACME, 'open')).toBe(open);
    expect(calls.filter((call) => call === 'list open')).toHaveLength(2);
  });

  it('reads a list’s first page when a screen first shows it, with no loader asking', async () => {
    const server = new Map([task(1, { isDone: true })].map((each) => [each.id, each]));
    const { store, calls } = setupWithGate(server);
    const done = store.forRecord(WS, ACME, 'done');
    done.retain();
    await flush();
    expect(calls).toContain('list done');
    expect(done.getSnapshot()).toMatchObject({ status: 'ready', loaded: 1, hasMore: false });
  });

  it('shows a task someone else made on the record before any settle, in its place', async () => {
    const early = task(1, { dueOn: '2026-10-01' });
    const late = task(2, { dueOn: '2026-12-01' });
    const server = new Map([early, late].map((each) => [each.id, each]));
    const { store, calls } = setupWithGate(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    const theirs = task(3, { title: 'Theirs', dueOn: '2026-11-01' });
    server.set(theirs.id, theirs);
    store.changed(WS, {
      seq: 9,
      at: '2026-10-12T10:00:00.000Z',
      kind: 'tasks',
      recordIds: [ACME],
      taskIds: [theirs.id],
    });
    await flush();
    expect(calls.filter((call) => call === 'list open')).toHaveLength(1);
    expect(titles(open.getSnapshot())).toEqual(['Task 1', 'Theirs', 'Task 2']);
  });

  it('rereads linked tasks for a rename only, not for every edit to a linked record', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store, calls } = setupWithGate(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    store.recordsChanged(WS, {
      seq: 3,
      at: '2026-10-12T10:00:00.000Z',
      kind: 'records',
      objectId: 'o1',
      recordIds: [ACME],
      attributeIds: ['stage'],
    });
    await flush();
    expect(calls.some((call) => call.startsWith('get'))).toBe(false);
  });

  it('tries a failed next page again by itself while shown, saying so once with Retry', async () => {
    const tasks = Array.from({ length: 52 }, (_, n) => task(n + 1));
    const server = new Map(tasks.map((each) => [each.id, each]));
    let fail = true;
    const { store, notices, elapse } = setup(server, {
      list: (page) => {
        if (page.cursor === undefined) {
          return { items: tasks.slice(0, 50), nextCursor: 'c1', total: { count: 52, atLeast: false } };
        }
        if (fail) throw refused('API_UNAVAILABLE', 'You’re offline.');
        return { items: tasks.slice(50) };
      },
    });
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    open.getSnapshot().source.onRangeChange({ start: 0, end: 50 });
    await flush();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.retry).toBeDefined();
    fail = false;
    await elapse(2_000);
    expect(open.getSnapshot().loaded).toBe(52);
    expect(notices).toHaveLength(1);
  });

  describe('My tasks (AC-436)', () => {
    const BEA = '0199a6f2-0000-7000-8000-000000000002';

    it('lists my assigned, created and all tasks, the same list for every screen', async () => {
      const server = new Map(
        [
          task(1, { assigneeMemberId: ME }),
          task(2, { assigneeMemberId: BEA }),
          task(3, { createdBy: { type: 'member', id: BEA }, assigneeMemberId: ME }),
        ].map((each) => [each.id, each]),
      );
      const { store, calls } = setup(server);
      const assigned = store.mine(WS, 'assigned', 'open');
      const created = store.mine(WS, 'created', 'open');
      const all = store.mine(WS, 'all', 'open');
      for (const list of [assigned, created, all]) {
        list.retain();
        await list.ready();
      }
      expect(titles(assigned.getSnapshot())).toEqual(['Task 1', 'Task 3']);
      expect(titles(created.getSnapshot())).toEqual(['Task 1', 'Task 2']);
      expect(titles(all.getSnapshot())).toEqual(['Task 1', 'Task 2', 'Task 3']);
      expect(store.mine(WS, 'assigned', 'open')).toBe(assigned);
      expect(calls).toEqual(['list assigned open', 'list created open', 'list all open']);
    });

    it('puts a new task first in the lists it belongs to, assigned only when it is mine', async () => {
      const server = new Map<string, TaskView>();
      const { store } = setup(server);
      const assigned = store.mine(WS, 'assigned', 'open');
      const all = store.mine(WS, 'all', 'open');
      for (const list of [assigned, all]) {
        list.retain();
        await list.ready();
      }
      await flush();
      void store.create(WS, { id: store.newId(), title: 'For Bea', assigneeMemberId: BEA });
      void store.create(WS, { id: store.newId(), title: 'For me', assigneeMemberId: ME });
      expect(titles(assigned.getSnapshot())).toEqual(['For me']);
      expect(titles(all.getSnapshot())).toEqual(['For me', 'For Bea']);
    });

    it('settles on a tick here and on any tasks event, a coarse one too', async () => {
      const one = task(1, { assigneeMemberId: ME, records: [] });
      const server = new Map([[one.id, one]]);
      const { store, calls, elapse } = setup(server);
      const assigned = store.mine(WS, 'assigned', 'open');
      assigned.retain();
      await assigned.ready();
      await store.setDone(WS, one.id, true);
      expect(titles(assigned.getSnapshot())).toEqual(['Task 1']);
      await elapse(TASK_SETTLE_MS);
      expect(titles(assigned.getSnapshot())).toEqual([]);
      const other = task(2, { assigneeMemberId: ME, records: [] });
      server.set(other.id, other);
      store.changed(WS, { seq: 9, at: '2026-10-12T10:00:00.000Z', kind: 'tasks', recordIds: [], taskIds: [other.id] });
      await flush();
      expect(titles(assigned.getSnapshot())).toEqual(['Task 2']);
      expect(calls.filter((call) => call === 'list assigned open')).toHaveLength(2);
    });

    it('reads a list nobody shows again when a screen shows it after a tasks event, and not before', async () => {
      const server = new Map<string, TaskView>();
      const { store, calls } = setup(server);
      const assigned = store.mine(WS, 'assigned', 'open');
      // Home read it, then let go of it before any task was made.
      const release = assigned.retain();
      await assigned.ready();
      release();
      const made = task(1, { assigneeMemberId: ME, records: [] });
      server.set(made.id, made);
      store.changed(WS, { seq: 9, at: '2026-10-12T10:00:00.000Z', kind: 'tasks', recordIds: [], taskIds: [made.id] });
      await flush();
      expect(calls.filter((call) => call === 'list assigned open')).toHaveLength(1);
      // Tasks shows it: it reads again rather than show the empty list it held.
      assigned.retain();
      await flush();
      expect(titles(assigned.getSnapshot())).toEqual(['Task 1']);
      expect(calls.filter((call) => call === 'list assigned open')).toHaveLength(2);
    });
  });

  it('deletes a task out of every list at once, and Undo brings it back (AC-445)', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    const sub = store.one(WS, one.id);
    sub.retain();
    const removing = store.remove(WS, one.id);
    expect(titles(open.getSnapshot())).toEqual([]);
    expect(sub.getSnapshot().status).not.toBe('ready');
    expect(await removing).toBeUndefined();
    expect(await store.restore(WS, one.id)).toBeUndefined();
    expect(titles(open.getSnapshot())).toEqual(['Task 1']);
  });

  it('puts a task back when its delete is refused, and answers why', async () => {
    const one = task(1);
    const server = new Map([[one.id, one]]);
    const { store } = setup(server);
    const open = store.forRecord(WS, ACME, 'open');
    open.retain();
    await open.ready();
    server.delete(one.id);
    const failure = await store.remove(WS, one.id);
    expect(failure?.code).toBe('NOT_FOUND');
  });
});
