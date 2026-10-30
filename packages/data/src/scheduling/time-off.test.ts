// Time off's held lists (spec 0037): a save lands in every list of that member, a delete shows at once and comes
// back with a toast when refused, entries sort upcoming soonest first, past latest first, a held list watches its
// workspace and reads again on a change, and each landed write tells the Team week and Bookings.
import type { TimeOffEntry, TimeOffList } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { Notice } from '../notice.ts';
import { createTimeOffStore, withEntry, type TimeOffApi } from './time-off.ts';

const SAM = '00000000-0000-7000-8000-000000000001';
const NOW = Date.parse('2026-11-01T00:00:00.000Z');

const entry = (id: string, from: string, to: string): TimeOffEntry => ({
  id,
  memberId: SAM,
  fromDate: from,
  toDate: to,
  timeZone: 'UTC',
  startsAt: `${from}T00:00:00.000Z`,
  endsAt: new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString(),
  reason: 'vacation',
  updatedAt: '2026-10-30T10:00:00.000Z',
});

const EMPTY: TimeOffList = { memberId: SAM, upcoming: [], past: [], canManage: true };
const listOf = (entries: readonly TimeOffEntry[]): TimeOffList =>
  entries.reduce((list, each) => withEntry(list, each, each.id, NOW), EMPTY);

function setup(initial: readonly TimeOffEntry[], refuseDelete = false) {
  const notices: Notice[] = [];
  const changed: string[] = [];
  const watching: string[] = [];
  let reads = 0;
  let shown = initial;
  const api: TimeOffApi = {
    list: () => {
      reads += 1;
      return Promise.resolve(listOf(shown));
    },
    create: (input) =>
      Promise.resolve({ entry: entry(input.id, input.fromDate, input.toDate), bookingsInside: [], moreInside: 0 }),
    update: (input) =>
      Promise.resolve({ entry: entry(input.id, input.fromDate, input.toDate), bookingsInside: [], moreInside: 0 }),
    remove: () =>
      refuseDelete
        ? Promise.reject(Object.assign(new Error('No.'), { code: 'FORBIDDEN', message: 'No.' }))
        : Promise.resolve(),
  };
  const store = createTimeOffStore({
    api,
    mintId: () => 'id',
    notify: (notice) => notices.push(notice),
    watch: (workspace) => {
      watching.push(workspace);
      return () => {
        watching.splice(watching.indexOf(workspace), 1);
      };
    },
    onChanged: (workspace) => changed.push(workspace),
    now: () => NOW,
  });
  return {
    store,
    notices,
    changed,
    watching,
    reads: () => reads,
    showNext: (next: readonly TimeOffEntry[]) => {
      shown = next;
    },
  };
}

describe('time off store', () => {
  it('sorts upcoming soonest first and past latest first', () => {
    const list = listOf([
      entry('b', '2026-12-01', '2026-12-02'),
      entry('a', '2026-11-03', '2026-11-07'),
      entry('p', '2026-10-01', '2026-10-02'),
    ]);
    expect(list.upcoming.map((each) => each.id)).toEqual(['a', 'b']);
    expect(list.past.map((each) => each.id)).toEqual(['p']);
  });

  it('lands a saved entry in the member’s held list', async () => {
    const { store } = setup([]);
    const held = store.held('acme');
    await held.ready();
    await store.create('acme', { id: 'new', fromDate: '2026-11-10', toDate: '2026-11-11', reason: 'sick' });
    const state = held.getSnapshot();
    expect(state.status === 'ready' ? state.list.upcoming.map((each) => each.id) : []).toEqual(['new']);
  });

  it('tells the Team week and Bookings once a write lands, and never on a refusal', async () => {
    const kept = entry('a', '2026-11-03', '2026-11-07');
    const { store, changed } = setup([kept], true);
    await store.held('acme').ready();
    await store.create('acme', { id: 'new', fromDate: '2026-11-10', toDate: '2026-11-11', reason: 'sick' });
    expect(changed).toEqual(['acme']);
    await store.remove('acme', kept);
    expect(changed).toEqual(['acme']);
  });

  it('watches its workspace while held, and reads again on a change only while held', async () => {
    const { store, watching, reads, showNext } = setup([]);
    const held = store.held('acme');
    const release = held.retain();
    await held.ready();
    expect(watching).toEqual(['acme']);
    const before = reads();
    showNext([entry('b', '2026-11-20', '2026-11-21')]);
    store.changed('acme');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads()).toBe(before + 1);
    const state = held.getSnapshot();
    expect(state.status === 'ready' ? state.list.upcoming.map((each) => each.id) : []).toEqual(['b']);
    release();
    expect(watching).toEqual([]);
    // Not held: nothing is read until a screen holds it again.
    store.changed('acme');
    store.changed('other');
    expect(reads()).toBe(before + 1);
  });

  it('removes at once and puts it back with a toast when refused', async () => {
    const kept = entry('a', '2026-11-03', '2026-11-07');
    const { store, notices } = setup([kept], true);
    const held = store.held('acme');
    await held.ready();
    const landed = store.remove('acme', kept);
    const during = held.getSnapshot();
    expect(during.status === 'ready' ? during.list.upcoming : undefined).toEqual([]);
    expect(await landed).toBe(false);
    const after = held.getSnapshot();
    expect(after.status === 'ready' ? after.list.upcoming.map((each) => each.id) : []).toEqual(['a']);
    expect(notices.map((notice) => notice.tone)).toEqual(['danger']);
  });
});
