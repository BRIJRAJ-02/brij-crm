// The bookings QA lane's sync check (4 November 2026): what the owner sees on Bookings after a visitor books on the
// public page. B-17 is fixed (see apps/web/e2e/BOOKINGS-QA.md).
import { describe, expect, it } from 'vitest';
import type { BookingListItem } from '@crm/contracts';
import { createLiveRouter } from '../live/router.ts';
import { FRESH_EVERY_MS, keepFresh } from './fresh.ts';
import { BOOKINGS_EVENT_GAP_MS, BOOKINGS_EVENT_SPREAD_MS, followBookings } from './live.ts';
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
    now: () => now,
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
  // updates connected, an owner watching Bookings sees a visitor's new booking within a couple of seconds, without
  // leaving the page, and the list stays on screen while it reads.
  function setup() {
    const clock = manualClock();
    let reads = 0;
    const answers: ((rows: readonly BookingListItem[]) => void)[] = [];
    let isVisible = true;
    const store = createBookingsStore({
      api: {
        listAll: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve([])
            : new Promise<readonly BookingListItem[]>((resolve) => {
                answers.push(resolve);
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
    const router = createLiveRouter();
    followBookings(
      router,
      (workspace) => {
        store.refreshHeld(workspace);
      },
      { later: clock.later, random: () => 0.5, now: clock.now, isVisible: () => isVisible },
    );
    const event = (workspace: string, seq: number) => {
      router.dispatch(workspace, { kind: 'bookings', seq, at: '2027-01-04T09:00:00.000Z' });
    };
    return {
      clock,
      store,
      event,
      reads: () => reads,
      answer: (rows: readonly BookingListItem[]) => answers.shift()?.(rows),
      hide: () => {
        isVisible = false;
      },
    };
  }
  const settle = async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  };
  const row = (id: string) => ({ id }) as unknown as BookingListItem;

  it('with live updates connected, a bookings event reads the open list again in place', async () => {
    const t = setup();
    const list = t.store.view('ws', 'upcoming');
    const release = list.retain();
    await list.ready();
    // A burst of events reads once, a random 0 to 2 seconds on.
    t.event('ws', 2);
    t.event('ws', 3);
    expect(t.reads()).toBe(1);
    t.clock.advance(BOOKINGS_EVENT_SPREAD_MS);
    expect(t.reads()).toBe(2);
    // In place: the list stays shown while it reads, then takes the answer.
    expect(list.getSnapshot().status).toBe('ready');
    t.answer([row('b1')]);
    await settle();
    const shown = list.getSnapshot();
    expect(shown.status === 'ready' ? shown.bookings.map((each) => each.id) : []).toEqual(['b1']);
    // Another workspace's event reads nothing here.
    t.event('other', 1);
    t.clock.advance(BOOKINGS_EVENT_GAP_MS);
    expect(t.reads()).toBe(2);
    release();
  });

  it('a change while a read is out reads once more after it, so the read that began before it never wins', async () => {
    const t = setup();
    const list = t.store.view('ws', 'upcoming');
    const release = list.retain();
    await list.ready();
    t.event('ws', 2);
    t.clock.advance(BOOKINGS_EVENT_SPREAD_MS);
    expect(t.reads()).toBe(2);
    // A second booking while that read is out: its read waits for the gap, then for the read out.
    t.event('ws', 3);
    t.clock.advance(BOOKINGS_EVENT_GAP_MS);
    expect(t.reads()).toBe(2);
    t.answer([row('b1')]);
    await settle();
    expect(t.reads()).toBe(3);
    t.answer([row('b1'), row('b2')]);
    await settle();
    const shown = list.getSnapshot();
    expect(shown.status === 'ready' ? shown.bookings.map((each) => each.id) : []).toEqual(['b1', 'b2']);
    release();
  });

  it('steady traffic reads at most once a gap, and a hidden tab reads nothing until it shows', async () => {
    const t = setup();
    const list = t.store.view('ws', 'upcoming');
    const release = list.retain();
    await list.ready();
    t.event('ws', 2);
    t.clock.advance(BOOKINGS_EVENT_SPREAD_MS);
    t.answer([]);
    await settle();
    expect(t.reads()).toBe(2);
    // Events every half second for the gap: one trailing read.
    for (let seq = 3; seq < 3 + BOOKINGS_EVENT_GAP_MS / 500; seq += 1) {
      t.event('ws', seq);
      t.clock.advance(500);
    }
    t.clock.advance(BOOKINGS_EVENT_GAP_MS);
    expect(t.reads()).toBe(3);
    t.answer([]);
    await settle();
    t.hide();
    t.event('ws', 99);
    t.clock.advance(BOOKINGS_EVENT_GAP_MS + BOOKINGS_EVENT_SPREAD_MS);
    expect(t.reads()).toBe(3);
    release();
  });
});
