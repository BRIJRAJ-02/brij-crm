// The meetings store against a fake API answered by hand: the first page read when held, More adding the next,
// one held list per question, a failed next page kept with what is shown, and a reload starting again. Kept current
// (owner ask A115): every minute while live updates are off, what is shown is read again from the top, keeping the
// pages More opened (at most `SHOWN_READ_MAX` rows), never beside another read of the list.
import type { MeetingListItem, MeetingListPage } from '@crm/contracts';
import { MEETINGS_PAGE_MAX } from '@crm/contracts/meeting-limits';
import { describe, expect, it } from 'vitest';
import { createMeetingsStore, SHOWN_READ_MAX, type MeetingsApi } from './meetings.ts';

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

  it('reads what is shown again every minute while live updates are off, keeping the pages More opened', async () => {
    const held = listOf(5, { pageSize: 2 });
    const list = held.store.list('acme', { when: 'upcoming', source: 'all' });
    list.retain();
    await flush();
    list.loadMore();
    await flush();
    expect(titles(list.getSnapshot)).toEqual(['Meeting 1', 'Meeting 2', 'Meeting 3', 'Meeting 4']);
    // A meeting a calendar sync brought lands at the top; the minute passes.
    held.meetings.unshift(event(0));
    held.tick();
    await flush();
    expect(titles(list.getSnapshot)).toEqual(['Meeting 0', 'Meeting 1', 'Meeting 2', 'Meeting 3']);
    expect(list.getSnapshot()).toMatchObject({ hasMore: true, isLoadingMore: false });
    expect(held.asked).toEqual([
      { cursor: undefined, limit: 2 },
      { cursor: '2', limit: 2 },
      { cursor: undefined, limit: 4 },
    ]);
    // More carries on from what the read showed.
    list.loadMore();
    await flush();
    expect(titles(list.getSnapshot)).toEqual([0, 1, 2, 3, 4, 5].map((n) => `Meeting ${String(n)}`));
    expect(list.getSnapshot()).toMatchObject({ hasMore: false });
    expect(held.pending()).toBe(1);
  });

  it('reads at most SHOWN_READ_MAX rows of what is shown, in reads of the page maximum', async () => {
    const held = listOf(SHOWN_READ_MAX + 200, { pageSize: MEETINGS_PAGE_MAX });
    const list = held.store.list('acme', { when: 'past', source: 'all' });
    list.retain();
    await flush();
    for (let page = 0; page < 6; page += 1) {
      list.loadMore();
      await flush();
    }
    const shown = list.getSnapshot();
    expect(shown.status === 'ready' ? shown.items.length : 0).toBe(SHOWN_READ_MAX + 200);
    held.asked.length = 0;
    held.tick();
    await flush();
    expect(held.asked.map((each) => each.limit)).toEqual([100, 100, 100, 100, 100]);
    const read = list.getSnapshot();
    expect(read.status === 'ready' ? read.items.length : 0).toBe(SHOWN_READ_MAX);
    expect(read).toMatchObject({ hasMore: true });
  });

  it('never reads what is shown beside a next page that is out, and drops a next page once a read from the top landed', async () => {
    const held = listOf(6, { pageSize: 2 });
    const list = held.store.list('acme', { when: 'upcoming', source: 'all' });
    list.retain();
    await flush();
    // More is out when the minute passes: the timed read waits for it instead of reading beside it.
    held.gate.held = true;
    list.loadMore();
    held.tick();
    expect(held.asked).toHaveLength(2);
    held.open();
    await flush();
    expect(titles(list.getSnapshot)).toEqual(['Meeting 1', 'Meeting 2', 'Meeting 3', 'Meeting 4']);
    expect(held.pending()).toBe(1);
    // Now a timed read is out when More is pressed: the read lands first, so that next page is dropped.
    held.tick();
    list.loadMore();
    expect(held.asked).toHaveLength(4);
    held.open(0);
    await flush();
    held.open();
    await flush();
    expect(titles(list.getSnapshot)).toEqual(['Meeting 1', 'Meeting 2', 'Meeting 3', 'Meeting 4']);
    expect(list.getSnapshot()).toMatchObject({ hasMore: true, isLoadingMore: false, moreFailed: false });
  });

  it('refreshHeld reads only the held lists of the workspace, at once', async () => {
    const held = listOf(3, { pageSize: 2 });
    const shown = held.store.list('acme', { when: 'upcoming', source: 'all' });
    held.store.list('acme', { when: 'past', source: 'all' });
    const release = shown.retain();
    await flush();
    expect(held.asked).toHaveLength(1);
    held.store.refreshHeld('acme');
    held.store.refreshHeld('other');
    await flush();
    expect(held.asked).toHaveLength(2);
    release();
    held.store.refreshHeld('acme');
    await flush();
    expect(held.asked).toHaveLength(2);
    expect(held.pending()).toBe(0);
  });
});

/**
 * A list of `count` meetings answered a page at a time by position, as the API's cursor does, live updates off, and
 * the minute's timer fired by hand (`tick`). With `gate.held`, each page waits until `open` lets it (the first out,
 * or the one at `index`) answer.
 */
function listOf(count: number, options: { readonly pageSize: number }) {
  const meetings = Array.from({ length: count }, (_, n) => event(n + 1));
  const asked: { readonly cursor: string | undefined; readonly limit: number }[] = [];
  const gate = { held: false };
  const waiting: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const api: MeetingsApi = {
    page: (input) => {
      asked.push({ cursor: input.cursor, limit: input.limit });
      const answer = () => {
        const start = input.cursor === undefined ? 0 : Number(input.cursor);
        const end = start + input.limit;
        return { items: meetings.slice(start, end), ...(end < meetings.length ? { nextCursor: String(end) } : {}) };
      };
      if (!gate.held) return Promise.resolve(answer());
      return new Promise<MeetingListPage>((resolve) => {
        waiting.push(() => {
          resolve(answer());
        });
      });
    },
  };
  const store = createMeetingsStore({
    api,
    pageSize: options.pageSize,
    onReturn: () => () => undefined,
    isVisible: () => true,
    live: { status: () => 'off', subscribe: () => () => undefined },
    later: (run) => {
      timers.push(run);
      return () => {
        const at = timers.indexOf(run);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    random: () => 0.5,
  });
  return {
    store,
    meetings,
    asked,
    gate,
    tick: () => timers.shift()?.(),
    pending: () => timers.length,
    open: (index = 0) => {
      const [release] = waiting.splice(index, 1);
      release?.();
    },
  };
}
