import { describe, expect, it } from 'vitest';
import { keepTicket, TICKET_REFRESH_MS, TICKET_SETTLE_MS } from './ticket.ts';

/** A clock the test moves, and a wait that moves it. */
function clock(start = 1_000_000) {
  let now = start;
  const waits: number[] = [];
  return {
    now: () => now,
    sleep: (ms: number) => {
      waits.push(ms);
      now += ms;
      return Promise.resolve();
    },
    move: (ms: number) => {
      now += ms;
    },
    waits,
  };
}

describe('the booking page’s fill ticket', () => {
  it('sends the page’s ticket once it is old enough, then fetches the next behind it', async () => {
    const time = clock();
    const answers = ['t1', 't2'];
    const keeper = keepTicket(() => Promise.resolve(answers.shift()), time);
    time.move(30_000);
    expect(await keeper.take()).toBe('t1');
    expect(time.waits).toEqual([]);
    // A second booking at once waits out the new ticket's fill time rather than being refused as too fast.
    expect(await keeper.take()).toBe('t2');
    expect(time.waits).toEqual([TICKET_SETTLE_MS]);
  });

  it('fetches again when the first fetch failed, or the ticket is near its day’s end', async () => {
    const time = clock();
    const answers: (string | undefined)[] = [undefined, 't2', 't3'];
    const keeper = keepTicket(() => Promise.resolve(answers.shift()), time);
    time.move(30_000);
    expect(await keeper.peek()).toBe('t2');
    time.move(TICKET_REFRESH_MS + 1);
    expect(await keeper.peek()).toBe('t3');
  });

  it('a chat turn shows the ticket without spending it', async () => {
    const time = clock();
    let fetched = 0;
    const keeper = keepTicket(() => {
      fetched += 1;
      return Promise.resolve(`t${String(fetched)}`);
    }, time);
    time.move(30_000);
    expect(await keeper.peek()).toBe('t1');
    expect(await keeper.peek()).toBe('t1');
    expect(fetched).toBe(1);
  });
});
