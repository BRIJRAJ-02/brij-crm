// The schedules store (spec 0035) against a fake API answered by hand: held
// lists, writes shown at once and put back on a refusal, the default mark
// moving, and a `schedules` event reading held lists again (AC-977).
import { describe, expect, it, vi } from 'vitest';
import type { BookingAvailability, ScheduleList, ScheduleView } from '@crm/contracts';
import { dataError } from '../errors.ts';
import { copyName, createSchedulesStore, sortSchedules, type SchedulesApi } from './store.ts';

const ME = '0190f0f0-0000-7000-8000-00000000000a';
const hours: BookingAvailability = {
  timeZone: 'UTC',
  weekly: { mon: [['09:00', '17:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  overrides: [],
};
const schedule = (id: string | null, name: string, isDefault = false): ScheduleView => ({
  id,
  memberId: ME,
  name,
  isDefault,
  availability: hours,
  pages: [],
  updatedAt: id === null ? null : '2026-10-20T10:00:00.000Z',
});

function setup(list: () => ScheduleList, overrides: Partial<SchedulesApi> = {}) {
  let minted = 0;
  const api: SchedulesApi = {
    list: vi.fn(() => Promise.resolve(list())),
    create: vi.fn(),
    update: vi.fn(),
    setDefault: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
  const store = createSchedulesStore({
    api,
    mintId: () => {
      minted += 1;
      return `0190f0f0-0000-7000-8000-00000000010${String(minted)}`;
    },
  });
  return { api, store };
}

const names = (state: ReturnType<ReturnType<typeof setup>['store']['view']>['getSnapshot']) => {
  const snapshot = state();
  return snapshot.status === 'ready' ? snapshot.schedules.map((each) => [each.name, each.isDefault]) : snapshot.status;
};

describe('the schedules store', () => {
  it('sorts the default first, then by name, and names copies as the server does', () => {
    expect(
      sortSchedules([schedule('b', 'beta'), schedule('a', 'Alpha'), schedule('c', 'zed', true)]).map(
        (each) => each.name,
      ),
    ).toEqual(['zed', 'Alpha', 'beta']);
    expect(copyName('Evenings', ['Evenings copy'])).toBe('Evenings copy 2');
    expect(copyName('x'.repeat(60), [])).toHaveLength(60);
  });

  it('shows a rename at once and puts it back on a refusal', async () => {
    const evenings = schedule('0190f0f0-0000-7000-8000-000000000001', 'Evenings');
    const { store } = setup(() => ({ memberId: ME, schedules: [schedule(null, 'Working hours', true), evenings] }), {
      update: () =>
        Promise.reject(Object.assign(new Error('Another schedule is called Late.'), { code: 'NAME_TAKEN' })),
    });
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    const pending = store.update('acme', evenings, { name: 'Late' });
    expect(names(view.getSnapshot)).toEqual([
      ['Working hours', true],
      ['Late', false],
    ]);
    await expect(pending).rejects.toBeDefined();
    expect(names(view.getSnapshot)).toEqual([
      ['Working hours', true],
      ['Evenings', false],
    ]);
  });

  it('moves the default mark at once, and a saved virtual default takes its place', async () => {
    const evenings = schedule('0190f0f0-0000-7000-8000-000000000001', 'Evenings');
    let served: ScheduleList = { memberId: ME, schedules: [schedule(null, 'Working hours', true), evenings] };
    const { store } = setup(() => served, {
      create: (input) => Promise.resolve({ ...schedule(input.id, input.name, true) }),
      setDefault: () => Promise.resolve({ ...evenings, isDefault: true }),
    });
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    const saved = await store.create('acme', ME, {
      name: 'Working hours',
      timeZone: 'UTC',
      availability: hours,
      isDefault: true,
    });
    expect(names(view.getSnapshot)).toEqual([
      ['Working hours', true],
      ['Evenings', false],
    ]);
    served = {
      memberId: ME,
      schedules: [
        { ...evenings, isDefault: true },
        { ...saved, isDefault: false },
      ],
    };
    const moving = store.setDefault('acme', evenings);
    expect(names(view.getSnapshot)).toEqual([
      ['Evenings', true],
      ['Working hours', false],
    ]);
    await moving;
  });

  it('drops a deleted schedule at once and brings it back on a refusal', async () => {
    const evenings = schedule('0190f0f0-0000-7000-8000-000000000001', 'Evenings');
    const { store } = setup(() => ({ memberId: ME, schedules: [schedule(null, 'Working hours', true), evenings] }), {
      remove: () => Promise.reject(new Error('No.')),
    });
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    const pending = store.remove('acme', evenings);
    expect(names(view.getSnapshot)).toEqual([['Working hours', true]]);
    await expect(pending).rejects.toBeDefined();
    expect(names(view.getSnapshot)).toEqual([
      ['Working hours', true],
      ['Evenings', false],
    ]);
  });

  it('reads held lists again on a schedules event, and leaves the rest for when they are held', async () => {
    const { api, store } = setup(() => ({ memberId: ME, schedules: [schedule(null, 'Working hours', true)] }));
    const view = store.view('acme', undefined, 'UTC');
    const release = view.retain();
    await view.ready();
    const reads = vi.mocked(api.list).mock.calls.length;
    store.changed('acme');
    expect(vi.mocked(api.list).mock.calls.length).toBe(reads + 1);
    release();
    store.changed('acme');
    expect(vi.mocked(api.list).mock.calls.length).toBe(reads + 1);
  });
});

describe('the schedules store, live and refused', () => {
  it('watches the workspace while a list is held, and stops when the last hold goes', () => {
    const stop = vi.fn();
    const watch = vi.fn(() => stop);
    const store = createSchedulesStore({
      api: {
        list: () => Promise.resolve({ memberId: ME, schedules: [] }),
        create: vi.fn(),
        update: vi.fn(),
        setDefault: vi.fn(),
        duplicate: vi.fn(),
        remove: vi.fn(),
      },
      mintId: () => ME,
      watch,
    });
    const view = store.view('acme', undefined, 'UTC');
    const first = view.retain();
    const second = view.retain();
    expect(watch).toHaveBeenCalledTimes(1);
    first();
    expect(stop).not.toHaveBeenCalled();
    second();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('reads the list again after a STALE refusal, so the next save names the newest version', async () => {
    const evenings = schedule('0190f0f0-0000-7000-8000-000000000001', 'Evenings');
    const { api, store } = setup(() => ({ memberId: ME, schedules: [evenings] }), {
      update: () => Promise.reject(dataError('STALE', 'Changed in another tab.')),
    });
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    const reads = vi.mocked(api.list).mock.calls.length;
    await expect(store.update('acme', evenings, { name: 'Late' })).rejects.toMatchObject({ code: 'STALE' });
    expect(vi.mocked(api.list).mock.calls.length).toBe(reads + 1);
  });
});

describe('the schedules store, made', () => {
  it('stores a new schedule under the id it is handed, so a screen knows it before it lands', async () => {
    const created = vi.fn((input: { readonly id: string; readonly name: string }) =>
      Promise.resolve(schedule(input.id, input.name, true)),
    );
    const { store } = setup(() => ({ memberId: ME, schedules: [schedule(null, 'Working hours', true)] }), {
      create: created,
    });
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    const id = '0190f0f0-0000-7000-8000-0000000000ff';
    const pending = store.create('acme', ME, { id, name: 'Working hours', timeZone: 'UTC', isDefault: true });
    // Shown at once under that id, the virtual default gone.
    const shown = view.getSnapshot();
    expect(shown.status === 'ready' ? shown.schedules.map((each) => each.id) : []).toEqual([id]);
    await pending;
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id }));
  });

  it('reads the list again once a schedule added beside the virtual default lands, which stored it too', async () => {
    const evenings = schedule('0190f0f0-0000-7000-8000-000000000001', 'Evenings');
    const working = schedule('0190f0f0-0000-7000-8000-000000000002', 'Working hours', true);
    let served: ScheduleList = { memberId: ME, schedules: [schedule(null, 'Working hours', true)] };
    const { api, store } = setup(() => served, {
      create: () => {
        served = { memberId: ME, schedules: [working, evenings] };
        return Promise.resolve(evenings);
      },
    });
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    const reads = vi.mocked(api.list).mock.calls.length;
    await store.create('acme', ME, { name: 'Evenings', timeZone: 'UTC' });
    await vi.waitFor(() => {
      expect(vi.mocked(api.list).mock.calls.length).toBe(reads + 1);
    });
    await vi.waitFor(() => {
      expect(names(view.getSnapshot)).toEqual([
        ['Working hours', true],
        ['Evenings', false],
      ]);
    });
    const shown = view.getSnapshot();
    expect(shown.status === 'ready' ? shown.schedules.every((each) => each.id !== null) : false).toBe(true);
  });
});

describe('the schedules store, kept up to date', () => {
  it('reads again when a schedules event comes while a read is under way, so the newer version shows (AC-977)', async () => {
    let answer: ((list: ScheduleList) => void) | undefined;
    const { api, store } = setup(() => ({ memberId: ME, schedules: [] }), {
      list: vi.fn(
        () =>
          new Promise<ScheduleList>((resolve) => {
            answer = resolve;
          }),
      ),
    });
    const view = store.view('acme', undefined, 'UTC');
    const release = view.retain();
    // The first read is out when another tab's save lands and its event arrives; its answer was read before it.
    const first = answer;
    store.changed('acme');
    first?.({ memberId: ME, schedules: [schedule('0190f0f0-0000-7000-8000-000000000001', 'Old')] });
    await vi.waitFor(() => {
      expect(vi.mocked(api.list).mock.calls.length).toBe(2);
    });
    answer?.({ memberId: ME, schedules: [schedule('0190f0f0-0000-7000-8000-000000000001', 'New')] });
    await vi.waitFor(() => {
      expect(names(view.getSnapshot)).toEqual([['New', false]]);
    });
    release();
  });

  it('reads again once the writes are in when a refusal lands after the list moved on', async () => {
    const working = schedule('0190f0f0-0000-7000-8000-000000000002', 'Working hours', true);
    let refuse: ((error: Error) => void) | undefined;
    let served: ScheduleList = { memberId: ME, schedules: [working] };
    const { api, store } = setup(() => served, {
      duplicate: vi
        .fn()
        .mockImplementationOnce((input: { readonly newId: string }) =>
          Promise.resolve(schedule(input.newId, 'Working hours copy')),
        )
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject: (error: Error) => void) => {
              refuse = reject;
            }),
        ),
    });
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    // Two copies at once: the second is refused after the first has landed and moved the list on.
    const first = store.duplicate('acme', working);
    const second = store.duplicate('acme', working);
    await first;
    served = {
      memberId: ME,
      schedules: [working, schedule('0190f0f0-0000-7000-8000-000000000003', 'Working hours copy')],
    };
    const reads = vi.mocked(api.list).mock.calls.length;
    refuse?.(Object.assign(new Error('You have 20 schedules.'), { code: 'SCHEDULE_LIMIT' }));
    await expect(second).rejects.toBeDefined();
    await vi.waitFor(() => {
      expect(vi.mocked(api.list).mock.calls.length).toBe(reads + 1);
    });
    await vi.waitFor(() => {
      expect(names(view.getSnapshot)).toEqual([
        ['Working hours', true],
        ['Working hours copy', false],
      ]);
    });
  });

  it('keeps the same state when a read changes nothing, so nothing re-renders', async () => {
    const { store } = setup(() => ({
      memberId: ME,
      schedules: [schedule('0190f0f0-0000-7000-8000-000000000001', 'Evenings')],
    }));
    const view = store.view('acme', undefined, 'UTC');
    await view.ready();
    const before = view.getSnapshot();
    const told = vi.fn();
    view.subscribe(told);
    view.reload();
    await vi.waitFor(() => {
      expect(view.getSnapshot()).toBe(before);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(told).not.toHaveBeenCalled();
  });
});
