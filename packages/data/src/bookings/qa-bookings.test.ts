// The bookings QA lane's sync check (4 November 2026): what the owner sees on Bookings after a visitor books on the
// public page. A test marked BUG fails today on purpose (see apps/web/e2e/BOOKINGS-QA.md).
import { describe, expect, it } from 'vitest';
import { FRESH_EVERY_MS, keepFresh } from './fresh.ts';

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

  // BUG (B-17): bookings have no change event yet ("a `bookings` event kind is the follow-up", store.ts), and the
  // minute timer runs only while live updates are paused or off. So with live updates connected, an owner watching
  // Bookings (window focused, tab visible) never sees a visitor's new booking, move or cancel until they leave the
  // tab and come back. Fix (API + data): a `bookings` change event from the public book, move and cancel (the
  // outbox row core already writes for records), or until then keep the minute timer running while live too.
  it('BUG: with live updates connected, it shows within a couple of minutes without leaving the page', async () => {
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
        live: { status: () => 'live', subscribe: () => () => undefined },
        later: clock.later,
        random: () => 0.5,
      },
    );
    await Promise.resolve();
    clock.advance(2 * FRESH_EVERY_MS * 1.1);
    expect(reads).toBeGreaterThan(1);
  });
});
