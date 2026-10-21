// The meetings store against a fake API answered by hand: the first page read when held, More adding the next,
// one held list per question, a failed next page kept with what is shown, and a reload starting again.
import type { MeetingListItem, MeetingListPage } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMeetingsStore, type MeetingsApi } from './meetings.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const event = (n: number): MeetingListItem => ({
  kind: 'event',
  event: {
    id: `0199a6f2-0000-7000-8000-${String(n).padStart(12, '0')}`,
    connectionId: '0199a6f2-0000-7000-8000-0000000000c1',
    calendarId: '0199a6f2-0000-7000-8000-0000000000a1',
    title: `Meeting ${String(n)}`,
    startsAt: `2026-10-2${String(n)}T09:00:00.000Z`,
    endsAt: `2026-10-2${String(n)}T10:00:00.000Z`,
    allDay: false,
    status: 'confirmed',
  },
  attendees: [],
  attendeeCount: 0,
});

function setup(pages: Record<string, MeetingListPage>) {
  const asked: (string | undefined)[] = [];
  const gate = { fail: false };
  const api: MeetingsApi = {
    page: (input) => {
      asked.push(input.cursor);
      if (gate.fail) return Promise.reject(new Error('down'));
      return Promise.resolve(pages[input.cursor ?? 'first'] ?? { items: [] });
    },
  };
  return { store: createMeetingsStore({ api, onReturn: () => () => undefined }), asked, gate };
}

const titles = (state: ReturnType<ReturnType<typeof setup>['store']['list']>['getSnapshot']) => {
  const shown = state();
  return shown.status === 'ready'
    ? shown.items.map((item) => (item.kind === 'event' ? item.event.title : item.booking.pageTitle))
    : [];
};

describe('meetings store', () => {
  it('reads the first page when held, and More adds the next until the last', async () => {
    const { store, asked } = setup({
      first: { items: [event(1)], nextCursor: 'c1' },
      c1: { items: [event(2)] },
    });
    const list = store.list('acme', { when: 'upcoming', source: 'all' });
    expect(store.list('acme', { when: 'upcoming', source: 'all' })).toBe(list);
    list.retain();
    await flush();
    expect(titles(list.getSnapshot)).toEqual(['Meeting 1']);
    expect(list.getSnapshot()).toMatchObject({ hasMore: true });
    list.loadMore();
    expect(list.getSnapshot()).toMatchObject({ isLoadingMore: true });
    await flush();
    expect(titles(list.getSnapshot)).toEqual(['Meeting 1', 'Meeting 2']);
    expect(list.getSnapshot()).toMatchObject({ hasMore: false, isLoadingMore: false });
    list.loadMore();
    expect(asked).toEqual([undefined, 'c1']);
  });

  it('keeps what it shows when the next page fails, and a reload starts again', async () => {
    const { store, gate } = setup({ first: { items: [event(1)], nextCursor: 'c1' } });
    const list = store.list('acme', { when: 'upcoming', source: 'calendar', calendarIds: ['b', 'a'] });
    list.retain();
    await flush();
    gate.fail = true;
    list.loadMore();
    await flush();
    expect(list.getSnapshot()).toMatchObject({ status: 'ready', moreFailed: true });
    expect(titles(list.getSnapshot)).toEqual(['Meeting 1']);
    gate.fail = false;
    store.reloadAll('acme');
    await flush();
    expect(list.getSnapshot()).toMatchObject({ moreFailed: false, hasMore: true });
  });
});
