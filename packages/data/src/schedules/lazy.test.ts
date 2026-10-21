// The lazy door to the schedules store (spec 0035): a view answers at once, loading, and speaks for the store's
// own once it arrives; a hold taken meanwhile reaches it.
import { describe, expect, it, vi } from 'vitest';
import { lazySchedules } from './lazy.ts';
import { createSchedulesStore } from './store.ts';

const ME = '0190f0f0-0000-7000-8000-00000000000a';

describe('lazySchedules', () => {
  it('loads the store on first use and hands the held view over', async () => {
    const list = vi.fn(() => Promise.resolve({ memberId: ME, schedules: [] }));
    const load = vi.fn(() =>
      Promise.resolve(
        createSchedulesStore({
          api: { list, create: vi.fn(), update: vi.fn(), setDefault: vi.fn(), duplicate: vi.fn(), remove: vi.fn() },
          mintId: () => ME,
        }),
      ),
    );
    const schedules = lazySchedules(load);
    const view = schedules.view('acme', undefined, 'UTC');
    expect(view.getSnapshot()).toEqual({ status: 'loading' });
    expect(schedules.view('acme', undefined, 'UTC')).toBe(view);
    const seen = vi.fn();
    view.subscribe(seen);
    const release = view.retain();
    await view.ready();
    expect(view.getSnapshot()).toEqual({ status: 'ready', memberId: ME, schedules: [] });
    expect(seen).toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    release();
  });
});
