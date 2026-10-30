// The command menu's search in the data layer (spec 0039, AC-1077): the pause
// after the last key, the abort of the request before, kept answers, and the
// states the menu draws (loading, ready, error, and back to idle).
import type { GlobalSearchResults } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createGlobalSearch } from './global.ts';

/** A timer the test fires by hand, and the calls the search made with their signals. */
function harness() {
  const timers: { run: () => void; cancelled: boolean }[] = [];
  const calls: {
    query: string;
    signal: AbortSignal;
    resolve: (results: GlobalSearchResults) => void;
    reject: () => void;
  }[] = [];
  const search = createGlobalSearch({
    run: (query, signal) =>
      new Promise<GlobalSearchResults>((resolve, reject) => {
        calls.push({ query, signal, resolve, reject: () => reject(new Error('failed')) });
      }),
    later: (run) => {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
  };
  return { search, calls, fire };
}

const found = (name: string): GlobalSearchResults => ({
  records: [
    {
      ref: {
        objectId: '0199a6f2-0000-7000-8000-000000000001',
        recordId: '0199a6f2-0000-7000-8000-000000000002',
        name,
        kind: 'company',
      },
      match: 'prefix',
    },
  ],
  views: [],
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the command menu’s search', () => {
  it('waits for the pause, then asks once for the last query typed', async () => {
    const { search, calls, fire } = harness();
    search.ask('a');
    search.ask('ac');
    search.ask('acm');
    expect(search.getSnapshot()).toMatchObject({ query: 'acm', status: 'loading' });
    expect(calls).toHaveLength(0);
    fire();
    expect(calls.map((call) => call.query)).toEqual(['acm']);
    calls[0]?.resolve(found('Acme'));
    await settle();
    expect(search.getSnapshot()).toMatchObject({ query: 'acm', status: 'ready', records: [{ ref: { name: 'Acme' } }] });
  });

  it('aborts the request before when a newer query starts, and ignores its late answer', async () => {
    const { search, calls, fire } = harness();
    search.ask('acme');
    fire();
    search.ask('acmex');
    expect(calls[0]?.signal.aborted).toBe(true);
    fire();
    calls[0]?.resolve(found('Old'));
    calls[1]?.resolve(found('New'));
    await settle();
    expect(search.getSnapshot()).toMatchObject({ query: 'acmex', records: [{ ref: { name: 'New' } }] });
  });

  it('answers a query asked before at once, from what it kept', async () => {
    const { search, calls, fire } = harness();
    search.ask('acme');
    fire();
    calls[0]?.resolve(found('Acme'));
    await settle();
    search.ask('acmex');
    search.ask('acme');
    expect(search.getSnapshot()).toMatchObject({
      query: 'acme',
      status: 'ready',
      records: [{ ref: { name: 'Acme' } }],
    });
    fire();
    expect(calls).toHaveLength(1);
  });

  it('goes back to idle when cleared, and says so when a search fails, which a retry asks again', async () => {
    const { search, calls, fire } = harness();
    search.ask('acme');
    fire();
    calls[0]?.reject();
    await settle();
    expect(search.getSnapshot()).toMatchObject({ query: 'acme', status: 'error', records: [] });
    search.retry();
    fire();
    expect(calls).toHaveLength(2);
    search.ask('  ');
    expect(calls[1]?.signal.aborted).toBe(true);
    expect(search.getSnapshot()).toEqual({ query: '', status: 'idle', records: [], views: [], notes: [], tasks: [] });
  });

  it('tells its listeners, and stops what is out when disposed', () => {
    const { search, calls, fire } = harness();
    let heard = 0;
    const stop = search.subscribe(() => {
      heard += 1;
    });
    search.ask('acme');
    expect(heard).toBe(1);
    fire();
    search.dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
    stop();
    search.ask('beta');
    expect(heard).toBe(1);
  });
});

describe('when the server is busy or time has passed', () => {
  it('asks again after the wait a 429 names, twice at most, staying loading', async () => {
    const waits: number[] = [];
    const timers: (() => void)[] = [];
    let calls = 0;
    const search = createGlobalSearch({
      run: () => {
        calls += 1;
        return Promise.reject(Object.assign(new Error('busy'), { code: 'TOO_MANY_REQUESTS', retryAfterSeconds: 2 }));
      },
      later: (run, ms) => {
        waits.push(ms);
        timers.push(run);
        return () => undefined;
      },
      random: () => 0,
    });
    search.ask('acme');
    for (let n = 0; n < 3; n += 1) {
      timers.shift()?.();
      await settle();
    }
    expect(calls).toBe(3);
    expect(waits.slice(1)).toEqual([2000, 2000]);
    expect(search.getSnapshot().status).toBe('error');
  });

  it('asks again for a kept answer older than 30 seconds', async () => {
    let clock = 0;
    const timers: (() => void)[] = [];
    let calls = 0;
    const search = createGlobalSearch({
      run: () => {
        calls += 1;
        return Promise.resolve(found('Acme'));
      },
      later: (run) => {
        timers.push(run);
        return () => undefined;
      },
      now: () => clock,
    });
    search.ask('acme');
    timers.shift()?.();
    await settle();
    search.ask('beta');
    clock = 31_000;
    search.ask('acme');
    expect(search.getSnapshot().status).toBe('loading');
    timers.splice(0).forEach((run) => {
      run();
    });
    await settle();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
