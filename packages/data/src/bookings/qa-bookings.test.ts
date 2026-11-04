// The bookings QA lane's sync check (4 November 2026): what the owner sees on Bookings after a visitor books on the
// public page. B-17 is fixed (see apps/web/e2e/BOOKINGS-QA.md).
import { describe, expect, it } from 'vitest';
import type { BookingListItem } from '@crm/contracts';
import { createLiveRouter } from '../live/router.ts';
import { FRESH_EVERY_MS, keepFresh } from './fresh.ts';
import { BOOKINGS_EVENT_WAIT_MS, followBookings } from './live.ts';
import { createBookingsStore } from './store.ts';

/** A clock the test turns by hand. */
function manualClock() {
  let timers: { at: number; run: () => void }[] = [];
  let now = 0;
  return {
    later: (run: () => void, ms: number) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((each) => each !== timer);
      };
    },
    advance: (ms: number) => {
      now += ms;
      const due = timers.filter((each) => each.at <= now);
      timers = timers.filter((each) => each.at > now);
      for (const each of due) each.run();
    },
  };
}

describe('a booking made on the public page reaches the owner’s open Bookings screen', () => {
  it('with live updates off, it shows within about a minute', async () => {
    const clock = manualClock();
    let reads = 0;
    keepFresh(
      () => {
        reads += 1;
        return Promise.resolve(true);
      },
      {
        onReturn: () => () => undefined,
        isVisible: () => true,
        live: { status: () => 'off', subscribe: () => () => undefined },
        later: clock.later,
        random: () => 0.5,
      },
    );
    await Promise.resolve();
    clock.advance(FRESH_EVERY_MS * 1.1);
    expect(reads).toBe(2);
  });

  // B-17 (fixed): a `bookings` change event comes from every public book, move and cancel (and a host's answer)
  // through the outbox and the relay, and the data layer reads Bookings' held reads again in place. So with live
  // updates connected, an owner watching Bookings sees a visitor's new booking within about a second, without leaving
  // the page, and the list stays on screen while it reads.
  it('with live updates connected, a bookings event reads the open list again in place', async () => {
    const clock = manualClock();
    let reads = 0;
    let answer: (rows: readonly BookingListItem[]) => void = () => undefined;
    const store = createBookingsStore({
      api: {
        listAll: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve([])
            : new Promise<readonly BookingListItem[]>((resolve) => {
                answer = resolve;
              });
        },
        calendar: () => Promise.reject(new Error('not read')),
      },
      onReturn: () => () => undefined,
      isVisible: () => true,
      live: { status: () => 'live', subscribe: () => () => undefined },
      later: clock.later,
      random: () => 0.5,
    });
    const list = store.view('ws', 'upcoming');
    const release = list.retain();
    await list.ready();
    const router = createLiveRouter();
    followBookings(
      router,
      (workspace) => {
        store.refreshHeld(workspace);
      },
      { later: clock.later, random: () => 0.5 },
    );
    // A burst of events reads once.
    router.dispatch('ws', { kind: 'bookings', seq: 2, at: '2027-01-04T09:00:00.000Z' });
    router.dispatch('ws', { kind: 'bookings', seq: 3, at: '2027-01-04T09:00:00.100Z' });
    expect(reads).toBe(1);
    clock.advance(BOOKINGS_EVENT_WAIT_MS.most);
    expect(reads).toBe(2);
    // In place: the list stays shown while it reads, then takes the answer.
    expect(list.getSnapshot().status).toBe('ready');
    answer([{ id: 'b1' } as unknown as BookingListItem]);
    await Promise.resolve();
    await Promise.resolve();
    const shown = list.getSnapshot();
    expect(shown.status === 'ready' ? shown.bookings.map((each) => each.id) : []).toEqual(['b1']);
    // Another workspace's event reads nothing here.
    router.dispatch('other', { kind: 'bookings', seq: 1, at: '2027-01-04T09:01:00.000Z' });
    clock.advance(BOOKINGS_EVENT_WAIT_MS.most);
    expect(reads).toBe(2);
    release();
  });
});
