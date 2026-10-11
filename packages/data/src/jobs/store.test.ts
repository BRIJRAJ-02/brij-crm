// The jobs store against a fake API answered by hand (spec 0008, AC-106,
// AC-119): live events refetch the named jobs, a coarse one the unfinished
// ones held, progress never goes backwards, and a job this browser started
// tells the app once when it ends.
import type { JobView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { createJobsStore, type JobsApi } from './store.ts';

const ME = '0199a6f2-0000-7000-8000-000000000001';
const OTHER = '0199a6f2-0000-7000-8000-000000000002';

const job = (n: number, status: JobView['status'], done = 0, by = ME): JobView => ({
  id: `0199a6f2-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
  kind: 'dev.simulate',
  label: 'Test job',
  status,
  total: 10,
  done,
  refused: 0,
  skipped: 0,
  startedBy: { type: 'member', memberId: by },
  createdAt: `2026-10-12T09:00:${String(n).padStart(2, '0')}.000Z`,
  cancellable: status === 'queued' || status === 'running',
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(server: Map<string, JobView>, listed: readonly JobView[] = [...server.values()]) {
  const gets: string[] = [];
  const finished: JobView[] = [];
  const watches = { open: 0, opened: 0 };
  const spreads: (() => void)[] = [];
  const api: JobsApi = {
    list: () => Promise.resolve({ jobs: [...listed] }),
    get: ({ jobId }) => {
      gets.push(jobId);
      const found = server.get(jobId);
      return found === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { name: 'DataError', code: 'NOT_FOUND' }))
        : Promise.resolve(found);
    },
    cancel: () => Promise.reject(new Error('not used')),
    startTest: ({ id }) => {
      const made = { ...job(99, 'queued'), id };
      server.set(id, made);
      return Promise.resolve(made);
    },
  };
  let minted = 0;
  const store = createJobsStore({
    api,
    mintId: () => `0199a6f2-0000-7000-8000-${String((minted += 1)).padStart(12, '0')}`,
    mutations: createMutationLog(),
    notify: () => undefined,
    watch: () => {
      watches.open += 1;
      watches.opened += 1;
      return () => {
        watches.open -= 1;
      };
    },
    memberOf: () => Promise.resolve(ME),
    spread: (_key, work) => spreads.push(work),
    onFinished: (_workspace, ended) => finished.push(ended),
  });
  return { store, gets, finished, watches, spreads };
}

const event = (jobIds: readonly string[], coarse = false) => ({
  seq: 1,
  at: '2026-10-12T09:01:00.000Z',
  kind: 'jobs' as const,
  jobIds: [...jobIds],
  ...(coarse ? { coarse: true } : {}),
});

describe('the jobs store', () => {
  it('refetches a named job a shown view holds, and never lets progress go backwards', async () => {
    const one = job(1, 'running', 3);
    const server = new Map([[one.id, one]]);
    const { store } = setup(server);
    const view = store.view('acme', 'mine');
    const release = view.retain();
    await view.ready();
    server.set(one.id, job(1, 'running', 7));
    store.changed('acme', event([one.id]));
    await flush();
    expect(view.getSnapshot().jobs[0]?.done).toBe(7);
    // A late, older read changes nothing.
    server.set(one.id, job(1, 'running', 5));
    store.changed('acme', event([one.id]));
    await flush();
    expect(view.getSnapshot().jobs[0]?.done).toBe(7);
    release();
  });

  it('adds a new job to `all`, and to `mine` only when the person started it', async () => {
    const server = new Map<string, JobView>();
    const { store } = setup(server, []);
    const mine = store.view('acme', 'mine');
    const all = store.view('acme', 'all');
    const releases = [mine.retain(), all.retain()];
    await Promise.all([mine.ready(), all.ready()]);
    const theirs = job(2, 'queued', 0, OTHER);
    const own = job(3, 'queued');
    server.set(theirs.id, theirs);
    server.set(own.id, own);
    store.changed('acme', event([theirs.id, own.id]));
    await flush();
    await flush();
    expect(all.getSnapshot().jobs.map((each) => each.id)).toEqual([own.id, theirs.id]);
    expect(mine.getSnapshot().jobs.map((each) => each.id)).toEqual([own.id]);
    for (const release of releases) release();
  });

  it('rereads the unfinished jobs held on a coarse event, once, after its spread', async () => {
    const running = job(4, 'running', 1);
    const done = job(5, 'succeeded', 10);
    const server = new Map([
      [running.id, running],
      [done.id, done],
    ]);
    const { store, gets, spreads } = setup(server);
    const view = store.view('acme', 'all');
    view.retain();
    await view.ready();
    store.changed('acme', event([], true));
    expect(gets).toEqual([]);
    expect(spreads).toHaveLength(1);
    spreads[0]?.();
    await flush();
    expect(gets).toEqual([running.id]);
  });

  it('tells the app once when a job this browser started ends, and stops watching for it', async () => {
    const server = new Map<string, JobView>();
    const { store, finished, watches } = setup(server, []);
    const started = await store.startTest('acme', store.newId(), { items: 10 });
    expect(watches.open).toBe(1);
    server.set(started.id, { ...started, status: 'succeeded', done: 10 });
    store.changed('acme', event([started.id]));
    await flush();
    store.changed('acme', event([started.id]));
    await flush();
    expect(finished.map((each) => each.status)).toEqual(['succeeded']);
    expect(watches.open).toBe(0);
  });

  it('drops a job the server no longer shows (NOT_FOUND)', async () => {
    const one = job(6, 'queued');
    const server = new Map([[one.id, one]]);
    const { store } = setup(server);
    const view = store.view('acme', 'all');
    view.retain();
    await view.ready();
    server.delete(one.id);
    store.changed('acme', event([one.id]));
    await flush();
    expect(view.getSnapshot().jobs).toEqual([]);
  });
});
