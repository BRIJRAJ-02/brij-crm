// The record picker's search (spec 0014): the pause, the abort, and answers kept.
import type { SearchResult } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createRecordSearch, SEARCH_DELAY_MS } from './search.ts';

const result = (name: string): SearchResult => ({
  ref: { objectId: 'o', recordId: `id-${name}`, name, kind: 'person' },
  linked: false,
});

function setup() {
  const asked: { query: string; signal: AbortSignal; answer: (results: SearchResult[]) => void; fail: () => void }[] =
    [];
  const timers: { ms: number; run: () => void; live: boolean }[] = [];
  const search = createRecordSearch({
    run: (query, signal) =>
      new Promise((resolve, reject) => {
        asked.push({ query, signal, answer: resolve, fail: () => reject(new Error('down')) });
      }),
    later: (run, ms) => {
      const timer = { ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  const elapse = () => {
    for (const timer of timers.splice(0)) if (timer.live) timer.run();
  };
  return { search, asked, timers, elapse };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRecordSearch', () => {
  it('waits 150 ms after the last key, sending only the last query', async () => {
    const { search, asked, timers, elapse } = setup();
    search.ask('a');
    search.ask('ad');
    expect(timers.filter((timer) => timer.live).map((timer) => timer.ms)).toEqual([SEARCH_DELAY_MS]);
    expect(search.getSnapshot()).toEqual({ query: 'ad', status: 'loading', results: [] });
    elapse();
    expect(asked.map((each) => each.query)).toEqual(['ad']);
    asked[0]?.answer([result('Ada')]);
    await settle();
    expect(search.getSnapshot()).toMatchObject({ query: 'ad', status: 'ready' });
    expect(search.resultOf('id-Ada')?.ref.name).toBe('Ada');
  });

  it('aborts the request out when the person types on, and answers a kept query at once', async () => {
    const { search, asked, elapse } = setup();
    search.ask('');
    elapse();
    asked[0]?.answer([result('Bo')]);
    await settle();
    search.ask('ad');
    elapse();
    search.ask('ada');
    expect(asked[1]?.signal.aborted).toBe(true);
    search.ask('');
    expect(search.getSnapshot()).toMatchObject({ query: '', status: 'ready', results: [result('Bo')] });
  });

  it('says it failed, asks nothing more for that query, and asks again once the person types on', async () => {
    const { search, asked, elapse } = setup();
    search.ask('x');
    elapse();
    asked[0]?.fail();
    await settle();
    expect(search.getSnapshot().status).toBe('error');
    search.ask('x');
    elapse();
    expect(asked).toHaveLength(1);
    search.ask('xy');
    elapse();
    expect(asked).toHaveLength(2);
  });
});
