// New bookings as they arrive (B-12): the first read only learns, later reads hand on what is new, once.
import type { NotificationView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ARRIVAL_COALESCE_MS, createBookingArrivals, type BookingArrival } from './arrivals.ts';

const notice = (id: string, guest: string, status: 'confirmed' | 'cancelled' = 'confirmed'): NotificationView => ({
  id,
  kind: 'booking',
  actor: { type: 'booking', id },
  createdAt: '2026-11-04T10:00:00.000Z',
  bookingId: `0199a6f2-0000-7000-8000-0000000000${id.padStart(2, '0')}`,
  booking: { pageTitle: 'Intro call', guestName: guest, startsAt: '2026-11-05T10:00:00.000Z', status },
  excerpt: 'Intro call',
});

function harness(pages: (readonly NotificationView[])[]) {
  let timers: (() => void)[] = [];
  const refreshed: string[] = [];
  let watching = 0;
  let reads = 0;
  const arrivals = createBookingArrivals({
    read: () => {
      const page = pages[Math.min(reads, pages.length - 1)] ?? [];
      reads += 1;
      return Promise.resolve(page);
    },
    watch: () => {
      watching += 1;
      return () => {
        watching -= 1;
      };
    },
    refresh: (workspace) => refreshed.push(workspace),
    later: (work, ms) => {
      expect(ms).toBe(ARRIVAL_COALESCE_MS);
      timers.push(work);
      return () => {
        timers = timers.filter((each) => each !== work);
      };
    },
  });
  const flush = async () => {
    const due = timers;
    timers = [];
    for (const work of due) work();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { arrivals, flush, refreshed, watching: () => watching, reads: () => reads };
}

describe('booking arrivals', () => {
  it('learns what is there first, then hands on each new booking once, oldest first', async () => {
    const run = harness([[notice('1', 'Old')], [notice('3', 'Cy'), notice('2', 'Bea'), notice('1', 'Old')]]);
    const heard: BookingArrival[] = [];
    const stop = run.arrivals.listen('acme', (arrival) => heard.push(arrival));
    await run.flush();
    expect(heard).toEqual([]);
    run.arrivals.changed('acme');
    run.arrivals.changed('acme');
    await run.flush();
    expect(heard.map((each) => each.guestName)).toEqual(['Bea', 'Cy']);
    expect(run.refreshed).toEqual(['acme']);
    expect(run.reads()).toBe(2);
    run.arrivals.changed('acme');
    await run.flush();
    expect(heard).toHaveLength(2);
    stop();
    expect(run.watching()).toBe(0);
  });

  it('says nothing of a cancelled one, and reads nothing with no one listening', async () => {
    const run = harness([[], [notice('4', 'Gone', 'cancelled')]]);
    run.arrivals.changed('acme');
    await run.flush();
    expect(run.reads()).toBe(0);
    const heard: BookingArrival[] = [];
    run.arrivals.listen('acme', (arrival) => heard.push(arrival));
    await run.flush();
    run.arrivals.changed('acme');
    await run.flush();
    expect(heard).toEqual([]);
  });
});
