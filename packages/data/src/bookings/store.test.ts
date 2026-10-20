// The bookings store (spec 0025, AC-646): one list per workspace and tab, read
// when held and again when the person comes back to the page; a failed read
// after the first keeps the list; letting go stops listening.
import { describe, expect, it, vi } from 'vitest';
import type { BookingListItem } from '@crm/contracts';
import { createBookingsStore } from './store.ts';

const booking = (id: string): BookingListItem => ({
  id,
  pageId: '0199f0a0-0000-7000-8000-000000000001',
  pageTitle: 'Quick chat',
  location: { type: 'video' },
  hostMemberId: '0199f0a0-0000-7000-8000-000000000002',
  startsAt: '2026-11-02T09:00:00.000Z',
  endsAt: '2026-11-02T09:30:00.000Z',
  visitorName: 'Grace',
  visitorEmail: 'grace@example.org',
  visitorTimeZone: 'Europe/London',
  status: 'confirmed',
  guests: [],
  reschedules: 0,
  eventFailed: false,
  createdAt: '2026-11-01T00:00:00.000Z',
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const noList = () => Promise.resolve([]);
const noCalendar = () => Promise.resolve({ bookings: [], events: [], busy: [], blocks: [] });

describe('the bookings store', () => {
  it('reads when held, again on return, keeps the list on a later failure, and stops listening when let go', async () => {
    const answers: (readonly BookingListItem[] | Error)[] = [
      [booking('a')],
      [booking('a'), booking('b')],
      new Error('down'),
    ];
    const listAll = vi.fn(() => {
      const next = answers.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    let comeBack: (() => void) | undefined;
    const stopped = vi.fn();
    const store = createBookingsStore({
      api: { listAll, calendar: noCalendar },
      onReturn: (refresh) => {
        comeBack = refresh;
        return stopped;
      },
    });
    const view = store.view('acme', 'upcoming');
    expect(store.view('acme', 'upcoming')).toBe(view);
    expect(view.getSnapshot()).toEqual({ status: 'loading' });
    const release = view.retain();
    await settle();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', bookings: [{ id: 'a' }] });
    expect(listAll).toHaveBeenCalledWith({ workspace: 'acme', when: 'upcoming' });

    comeBack?.();
    await settle();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', bookings: [{ id: 'a' }, { id: 'b' }] });

    comeBack?.();
    await settle();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', bookings: [{ id: 'a' }, { id: 'b' }] });

    release();
    expect(stopped).toHaveBeenCalledOnce();
  });

  it('shows a first read’s failure, and reload tries again', async () => {
    const listAll = vi
      .fn<() => Promise<readonly BookingListItem[]>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([]);
    const store = createBookingsStore({ api: { listAll, calendar: noCalendar }, onReturn: () => () => undefined });
    const view = store.view('acme', 'past');
    await view.ready();
    expect(view.getSnapshot().status).toBe('error');
    view.reload();
    await settle();
    expect(view.getSnapshot()).toEqual({ status: 'ready', bookings: [] });
  });

  it('holds a range with its bookings and events, and reloadAll reads every held one of the workspace again', async () => {
    const calendar = vi.fn(() => Promise.resolve({ bookings: [booking('a')], events: [], busy: [], blocks: [] }));
    const listAll = vi.fn(() => Promise.resolve([booking('a')]));
    const store = createBookingsStore({ api: { listAll, calendar }, onReturn: () => () => undefined });
    const week = store.calendar('acme', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
    expect(store.calendar('acme', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z')).toBe(week);
    const release = week.retain();
    await settle();
    expect(week.getSnapshot()).toMatchObject({ status: 'ready', bookings: [{ id: 'a' }], events: [] });
    expect(calendar).toHaveBeenCalledWith({
      workspace: 'acme',
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-09T00:00:00.000Z',
    });
    store.view('acme', 'upcoming').retain();
    await settle();
    store.reloadAll('acme');
    store.reloadAll('other');
    await settle();
    expect(calendar).toHaveBeenCalledTimes(2);
    expect(listAll).toHaveBeenCalledTimes(2);
    release();
  });

  it('patches every ready range of the workspace at once, and puts each back on restore (spec 0027)', async () => {
    const turn = {
      key: 'b1',
      blockId: '01a154ac-ad7a-766e-85e9-46253892be47',
      kind: 'block' as const,
      repeat: 'once' as const,
      startsAt: '2026-11-02T10:00:00.000Z',
      endsAt: '2026-11-02T11:00:00.000Z',
    };
    const store = createBookingsStore({
      api: { listAll: noList, calendar: noCalendar },
      onReturn: () => () => undefined,
    });
    const week = store.calendar('acme', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
    const loading = store.calendar('acme', '2026-11-09T00:00:00.000Z', '2026-11-16T00:00:00.000Z');
    const other = store.calendar('other', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
    week.retain();
    other.retain();
    await settle();

    const restore = store.patchRanges('acme', (shown) => ({ ...shown, blocks: [...shown.blocks, turn] }));
    expect(week.getSnapshot()).toMatchObject({ status: 'ready', blocks: [turn] });
    expect(other.getSnapshot()).toMatchObject({ status: 'ready', blocks: [] });
    // A range still loading is left to its read.
    expect(loading.getSnapshot()).toEqual({ status: 'loading' });
    restore();
    expect(week.getSnapshot()).toMatchObject({ status: 'ready', blocks: [] });
  });

  it('shows one booking changed in every list and range at once, and puts it back', async () => {
    const store = createBookingsStore({
      api: {
        listAll: () => Promise.resolve([booking('a'), booking('b')]),
        calendar: () => Promise.resolve({ bookings: [booking('a')], events: [], busy: [], blocks: [] }),
      },
      onReturn: () => () => undefined,
    });
    const list = store.view('acme', 'upcoming');
    const range = store.calendar('acme', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
    list.retain();
    range.retain();
    await settle();
    const restore = store.patchBooking('acme', 'a', (each) => ({ ...each, status: 'cancelled' }));
    expect(list.getSnapshot()).toMatchObject({
      bookings: [
        { id: 'a', status: 'cancelled' },
        { id: 'b', status: 'confirmed' },
      ],
    });
    expect(range.getSnapshot()).toMatchObject({ bookings: [{ id: 'a', status: 'cancelled' }] });
    restore();
    expect(list.getSnapshot()).toMatchObject({ bookings: [{ id: 'a', status: 'confirmed' }, { id: 'b' }] });
    expect(range.getSnapshot()).toMatchObject({ bookings: [{ id: 'a', status: 'confirmed' }] });
  });
});
