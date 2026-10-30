// The calculations store on its own (the CRM flow pass): the trailing wait
// and its 5 second cap under steady changes, one read in flight per entry, an
// unheld entry that only notes it is stale, and an entry dropped once nobody
// has held it for a while.
import { describe, expect, it } from 'vitest';
import type { AggregateAnswers, AggregateQuestion } from './aggregate-source.ts';
import { createAggregateStore, normalQuestion } from './aggregates.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const asked: { question: AggregateQuestion; answer: (answers: AggregateAnswers) => void; signal: AbortSignal }[] = [];
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  let clock = 0;
  const store = createAggregateStore({
    ask: (_workspace, question, signal) =>
      new Promise((resolve) => {
        asked.push({ question, answer: resolve, signal });
      }),
    later: (run, ms) => {
      const timer = { at: clock + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    now: () => clock,
    canonical: (value) => JSON.stringify(value),
    filterAttributes: (filter) =>
      (filter?.conditions ?? []).flatMap((condition) => ('attributeId' in condition ? [condition.attributeId] : [])),
    keepMs: 30_000,
  });
  /** Moves the clock on `ms`, running each timer as it comes due. */
  const tick = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.live && timer.at <= end).sort((x, y) => x.at - y.at)[0];
      if (due === undefined) break;
      due.live = false;
      clock = due.at;
      due.run();
    }
    clock = end;
  };
  return { store, asked, tick };
}

const question: AggregateQuestion = {
  objectId: 'deals',
  asks: [{ attributeId: 'amount', fn: 'sum' }],
  filter: { conjunction: 'and', conditions: [{ attributeId: 'stage', operator: 'is_not_empty' }] },
};

describe('the calculations store', () => {
  it('keys a question by its asks sorted and each once, an empty filter as none', () => {
    expect(
      normalQuestion({
        objectId: 'o',
        filter: { conjunction: 'and', conditions: [] },
        asks: [
          { attributeId: 'b', fn: 'sum' },
          { attributeId: 'a', fn: 'max' },
          { attributeId: 'b', fn: 'sum' },
        ],
      }),
    ).toEqual({
      objectId: 'o',
      asks: [
        { attributeId: 'a', fn: 'max' },
        { attributeId: 'b', fn: 'sum' },
      ],
    });
  });

  it('reads at most 5 s after the first of steady changes, and one read at a time', async () => {
    const { store, asked, tick } = setup();
    const release = store.source('w', question).retain();
    expect(asked).toHaveLength(1);
    asked[0]?.answer(new Map());
    await settle();
    // A change every second never lets the 1.5 s wait run out; the 5 s cap reads anyway.
    for (let n = 0; n < 6; n += 1) {
      store.touched('w', 'deals', ['stage'], false);
      tick(1000);
    }
    expect(asked).toHaveLength(2);
    // A change while that read is out waits for it, then reads once more.
    store.touched('w', 'deals', ['amount'], false);
    tick(1500);
    expect(asked).toHaveLength(2);
    asked[1]?.answer(new Map());
    await settle();
    expect(asked).toHaveLength(3);
    // Another object's change, or an attribute nothing depends on, moves nothing.
    asked[2]?.answer(new Map());
    await settle();
    store.touched('w', 'people', ['amount'], true);
    store.touched('w', 'deals', ['title'], false);
    tick(10_000);
    expect(asked).toHaveLength(3);
    release();
  });

  it('only notes a change while unheld, reads when held again, and drops an entry 30 s after the last screen', async () => {
    const { store, asked, tick } = setup();
    const source = store.source('w', question);
    source.retain()();
    asked[0]?.answer(new Map([['amount:sum', { amounts: [{ value: '1' }] }]]));
    await settle();
    store.touched('w', 'deals', undefined, true);
    tick(5000);
    expect(asked).toHaveLength(1);
    const release = source.retain();
    expect(asked).toHaveLength(2);
    // The answers shown stay while the newer read is out.
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', isRefreshing: true });
    release();
    tick(30_000);
    expect(store.size()).toBe(0);
    expect(asked[1]?.signal.aborted).toBe(true);
  });
});
