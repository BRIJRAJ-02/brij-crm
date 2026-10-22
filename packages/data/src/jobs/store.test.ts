// The jobs store against a fake API answered by hand (spec 0008, AC-106,
// AC-119): live events refetch the named jobs, a coarse one the unfinished
// ones held, progress never goes backwards, and a job this browser started
// tells the app once when it ends.
import type { JobView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { purgeLeftOf } from './left.ts';
import { createJobsStore, JOB_POLL_FIRST_MS, JOB_POLL_MAX_MS, type JobsApi } from './store.ts';

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
  const notices: string[] = [];
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
    confirm: ({ jobId }) => {
      const found = server.get(jobId);
      if (found?.status !== 'ready') {
        return Promise.reject(
          Object.assign(new Error('That job waited too long.'), { name: 'DataError', code: 'JOB_EXPIRED' }),
        );
      }
      const { expiresAt: _expiresAt, ...rest } = found;
      const confirmed: JobView = { ...rest, status: 'queued' };
      server.set(jobId, confirmed);
      return Promise.resolve(confirmed);
    },
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
    notify: (notice) => notices.push(notice.message),
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
  return { store, gets, finished, watches, spreads, notices };
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

  it('tells the app about a followed job that had ended before it was read, once, and leaves nothing watching', async () => {
    const server = new Map<string, JobView>();
    const { store, finished, watches } = setup(server, []);
    const ended: JobView = { ...job(30, 'succeeded', 10), kind: 'records.export' };
    store.track('acme', ended, true);
    store.track('acme', ended, true);
    await flush();
    expect(finished.map((each) => each.id)).toEqual([ended.id]);
    expect(watches.open).toBe(0);
    // Held already from a list, before this tab followed it: the follow still tells the app, once.
    const listed: JobView = { ...job(32, 'succeeded', 10), kind: 'records.export' };
    store.track('acme', listed);
    store.track('acme', listed, true);
    expect(finished.map((each) => each.id)).toEqual([ended.id, listed.id]);
    // Without `tellEnded` (a bulk change of nothing), nobody waits on it.
    store.track('acme', { ...job(31, 'succeeded', 0), kind: 'records.bulk' });
    expect(finished).toHaveLength(2);
  });

  it('hears a job end that comes while its read is out, reading it again once that read lands', async () => {
    const server = new Map<string, JobView>();
    const { store, finished } = setup(server, []);
    const started = await store.startTest('acme', store.newId(), { items: 10 });
    // A read leaves while the job still runs; the job ends, and its event comes, before that read lands.
    store.changed('acme', event([started.id]));
    server.set(started.id, { ...started, status: 'succeeded', done: 10 });
    store.changed('acme', event([started.id]));
    await flush();
    await flush();
    expect(finished.map((each) => each.status)).toEqual(['succeeded']);
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

  it('confirms a waiting job at once, and puts it back with a toast and a fresh read when refused (AC-109)', async () => {
    const waiting: JobView = { ...job(7, 'ready'), expiresAt: '2026-10-12T10:00:00.000Z' };
    const late: JobView = { ...job(8, 'ready'), expiresAt: '2026-10-12T09:00:30.000Z' };
    const server = new Map([
      [waiting.id, waiting],
      [late.id, late],
    ]);
    const { store, gets, notices } = setup(server);
    const view = store.view('acme', 'all');
    view.retain();
    await view.ready();
    const landing = store.confirm('acme', waiting.id);
    // Shown queued before the server answers.
    expect(view.getSnapshot().jobs.find((shown) => shown.id === waiting.id)?.status).toBe('queued');
    expect(await landing).toBe(true);
    expect(view.getSnapshot().jobs.find((shown) => shown.id === waiting.id)).not.toHaveProperty('expiresAt');

    // The server ended it meanwhile: the confirm is refused, the row goes back and is read again.
    server.set(late.id, { ...late, status: 'cancelled', error: { code: 'JOB_EXPIRED', message: 'Expired.' } });
    expect(await store.confirm('acme', late.id)).toBe(false);
    expect(notices).toEqual(['That job waited too long.']);
    await flush();
    expect(gets).toContain(late.id);
    expect(view.getSnapshot().jobs.find((shown) => shown.id === late.id)?.status).toBe('cancelled');
  });
});

describe('following a job while live updates are paused or off (spec 0022)', () => {
  /** The jobs store with live updates paused, its timers and the live status in the test's hands. */
  function paused(server: Map<string, JobView>) {
    const gets: string[] = [];
    const finished: JobView[] = [];
    const timers: { ms: number; run: () => void; live: boolean }[] = [];
    const listeners = new Set<() => void>();
    let status: 'live' | 'paused' | 'off' = 'paused';
    let minted = 0;
    const store = createJobsStore({
      api: {
        list: () => Promise.resolve({ jobs: [] }),
        get: ({ jobId }) => {
          gets.push(jobId);
          const found = server.get(jobId);
          return found === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(found);
        },
        cancel: () => Promise.reject(new Error('not used')),
        confirm: () => Promise.reject(new Error('not used')),
        startTest: () => Promise.reject(new Error('not used')),
      },
      mintId: () => `0199a6f2-0000-7000-8000-${String((minted += 1)).padStart(12, '0')}`,
      mutations: createMutationLog(),
      notify: () => undefined,
      watch: () => () => undefined,
      memberOf: () => Promise.resolve(ME),
      spread: (_key, work) => {
        work();
      },
      onFinished: (_workspace, ended) => finished.push(ended),
      live: {
        status: () => status,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      later: (run, ms) => {
        const timer = { ms, run, live: true };
        timers.push(timer);
        return () => {
          timer.live = false;
        };
      },
      // The middle of the spread: each wait as it stands.
      random: () => 0.5,
    });
    const setLive = (next: 'live' | 'paused' | 'off') => {
      status = next;
      for (const listener of listeners) listener();
    };
    /** Runs the timer waiting now, as its wait ran out; answers how long it waited. */
    const next = () => {
      const timer = timers.find((each) => each.live);
      if (timer === undefined) return undefined;
      timer.live = false;
      timer.run();
      return timer.ms;
    };
    const waiting = () => timers.filter((timer) => timer.live).length;
    return { store, gets, finished, setLive, next, waiting };
  }

  it('reads it again on its own timer, waiting longer while it stays at one step, until it ends', async () => {
    const counting: JobView = { ...job(20, 'preparing'), cancellable: true };
    const server = new Map([[counting.id, counting]]);
    const { store, gets, finished, next, waiting } = paused(server);
    store.track('acme', counting);
    expect(next()).toBe(JOB_POLL_FIRST_MS);
    await flush();
    expect(gets).toEqual([counting.id]);
    // Counted meanwhile: the read after the next wait finds it, and the waits start again for the new step.
    server.set(counting.id, { ...counting, status: 'ready', total: 10 });
    expect(next()).toBe(JOB_POLL_FIRST_MS * 2);
    await flush();
    expect(next()).toBe(JOB_POLL_FIRST_MS * 4);
    await flush();
    expect(next()).toBe(JOB_POLL_FIRST_MS);
    await flush();
    // It ends: the read that finds it so stops the timer, and the app hears it once.
    server.set(counting.id, { ...counting, status: 'cancelled', total: 10 });
    next();
    await flush();
    expect(finished.map((each) => each.status)).toEqual(['cancelled']);
    expect(waiting()).toBe(0);
  });

  it('never waits longer than the longest wait between reads', () => {
    const running: JobView = job(21, 'running', 1);
    const { store, next } = paused(new Map([[running.id, running]]));
    store.track('acme', running);
    const waits = Array.from({ length: 8 }, () => next());
    expect(Math.max(...waits.map((ms) => ms ?? 0))).toBe(JOB_POLL_MAX_MS);
  });

  it('starts its waits again when live updates come back or pause, and while live reads only as a backstop', async () => {
    const running: JobView = job(22, 'running', 1);
    const server = new Map([[running.id, running]]);
    const { store, gets, setLive, next, waiting } = paused(server);
    store.track('acme', running);
    expect(waiting()).toBe(1);
    setLive('live');
    expect(waiting()).toBe(1);
    // Live: one catch up read after the first wait, then one at the longest wait each time.
    expect(next()).toBe(JOB_POLL_FIRST_MS);
    await flush();
    expect(next()).toBe(JOB_POLL_MAX_MS);
    await flush();
    expect(next()).toBe(JOB_POLL_MAX_MS);
    await flush();
    expect(gets).toEqual([running.id, running.id, running.id]);
    setLive('off');
    expect(waiting()).toBe(1);
    expect(next()).toBe(JOB_POLL_FIRST_MS);
  });

  it('hears a job that ended before its live event could reach this tab, by the catch up read', async () => {
    const exporting: JobView = { ...job(24, 'running'), kind: 'records.export' };
    const server = new Map([[exporting.id, exporting]]);
    const { store, finished, setLive, next, waiting } = paused(server);
    setLive('live');
    store.track('acme', exporting);
    // It ends at once and its event is lost (the workspace's subscription was not up yet).
    server.set(exporting.id, { ...exporting, status: 'succeeded', done: 10 });
    expect(next()).toBe(JOB_POLL_FIRST_MS);
    await flush();
    expect(finished.map((each) => each.status)).toEqual(['succeeded']);
    next();
    expect(waiting()).toBe(0);
  });
});

describe('what a purge job left in the trash (spec 0022, AC-538 as amended)', () => {
  it('reads `left` from the result, leaving out anything of another shape', () => {
    const purged = { ...job(30, 'succeeded', 10), kind: 'records.purge' };
    expect(purgeLeftOf(purged)).toEqual([]);
    expect(
      purgeLeftOf({
        ...purged,
        result: {
          left: [
            { objectId: 'people', count: 12 },
            { objectId: 'deals', count: 0 },
            { objectId: 7, count: 2 },
            { objectId: 'companies', count: 1.5 },
            'nonsense',
          ],
        },
      }),
    ).toEqual([{ objectId: 'people', count: 12 }]);
    expect(purgeLeftOf({ ...purged, result: { left: 'nonsense' } })).toEqual([]);
  });
});
