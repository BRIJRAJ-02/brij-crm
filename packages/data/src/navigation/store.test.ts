import type { NavState } from '@crm/contracts';
import { EMPTY_NAV_UNIVERSE, type NavOperation, type NavUniverse } from '@crm/contracts/navigation';
import { describe, expect, it, vi } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { createNavStore, type NavApi } from './store.ts';

const ME = '01900000-0000-7000-8000-0000000000a1';
const OTHER = '01900000-0000-7000-8000-0000000000a2';
const PEOPLE = '01900000-0000-7000-8000-000000000001';
const DEALS = '01900000-0000-7000-8000-000000000003';
const universe: NavUniverse = { ...EMPTY_NAV_UNIVERSE, records: [PEOPLE, DEALS], scheduling: ['bookings', 'forms'] };

const state = (over: Partial<NavState> = {}): NavState => ({
  items: [],
  sections: { order: ['favourites', 'records', 'lists', 'scheduling'], folded: [] },
  rail: false,
  version: 0,
  favourites: [],
  top: [],
  scheduling: ['bookings', 'forms'],
  ...over,
});

/** A store over an API answered by hand: each change waits until the test settles it. */
function world(first: NavState = state()) {
  const gets: ((value: NavState) => void)[] = [];
  const changes: { op: NavOperation; settle: (version: number) => void; refuse: (message: string) => void }[] = [];
  let getsAsked = 0;
  const api: NavApi = {
    get: () => {
      getsAsked += 1;
      if (getsAsked === 1) return Promise.resolve(first);
      return new Promise((resolve) => gets.push(resolve));
    },
    change: (_workspace, op) =>
      new Promise((resolve, reject) => {
        changes.push({
          op,
          settle: (version) => {
            resolve({ version });
          },
          refuse: (message) => {
            reject(Object.assign(new Error(message), { code: 'NAV_LIMIT' }));
          },
        });
      }),
  };
  const refused: string[] = [];
  const retries: (() => void)[] = [];
  const store = createNavStore({
    api,
    mintId: (() => {
      let n = 0;
      return () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`;
    })(),
    mutations: createMutationLog(),
    watch: () => () => undefined,
    namesMe: (_workspace, ids) => Promise.resolve(ids.includes(ME)),
    onRefused: (error, retry) => {
      refused.push(error.message);
      retries.push(retry);
    },
  });
  return { store, gets, changes, refused, retries, asked: () => getsAsked };
}

const ready = (snapshot: ReturnType<ReturnType<typeof createNavStore>['snapshot']>) => {
  if (snapshot.status !== 'ready') throw new Error(`Not ready: ${snapshot.status}`);
  return snapshot.nav;
};

describe('the sidebar store', () => {
  it('shows a change at once, sends changes one at a time in order, and keeps them when they land (AC-937)', async () => {
    const w = world();
    await w.store.load('acme');
    w.store.change('acme', { op: 'fold', section: 'records', folded: true }, universe);
    w.store.change('acme', { op: 'rail', on: true }, universe);
    const shown = ready(w.store.snapshot('acme'));
    expect(shown.sections.folded).toEqual(['records']);
    expect(shown.rail).toBe(true);
    expect(w.changes.map((change) => change.op.op)).toEqual(['fold']);
    w.changes[0]?.settle(2);
    await vi.waitFor(() => {
      expect(w.changes).toHaveLength(2);
    });
    w.changes[1]?.settle(3);
    await vi.waitFor(() => {
      expect(ready(w.store.snapshot('acme')).version).toBe(3);
    });
    expect(ready(w.store.snapshot('acme'))).toMatchObject({ rail: true, sections: { folded: ['records'] } });
  });

  it('rolls a refused change back and offers Retry, which sends it again', async () => {
    const w = world();
    await w.store.load('acme');
    w.store.change('acme', { op: 'hide', kind: 'object', id: DEALS }, universe);
    expect(ready(w.store.snapshot('acme')).items).toEqual([
      { kind: 'object', id: PEOPLE },
      { kind: 'object', id: DEALS, hidden: true },
    ]);
    w.changes[0]?.refuse('Your sidebar holds as many items as it can.');
    await vi.waitFor(() => {
      // The fake rejects with a bare error, which the layer words as a passing failure.
      expect(w.refused).toHaveLength(1);
    });
    expect(ready(w.store.snapshot('acme')).items).toEqual([]);
    w.retries[0]?.();
    expect(w.changes).toHaveLength(2);
    expect(ready(w.store.snapshot('acme')).items).toContainEqual({ kind: 'object', id: DEALS, hidden: true });
  });

  it('rereads on a nav event naming this member, and never for another member’s', async () => {
    const w = world();
    await w.store.load('acme');
    w.store.navChanged('acme', { seq: 1, at: '2026-10-20T09:00:00.000Z', kind: 'nav', memberIds: [OTHER] });
    await Promise.resolve();
    await Promise.resolve();
    expect(w.asked()).toBe(1);
    w.store.navChanged('acme', { seq: 2, at: '2026-10-20T09:00:00.000Z', kind: 'nav', memberIds: [ME] });
    await vi.waitFor(() => {
      expect(w.asked()).toBe(2);
    });
    w.gets[0]?.(state({ rail: true, version: 5 }));
    await vi.waitFor(() => {
      expect(ready(w.store.snapshot('acme')).rail).toBe(true);
    });
  });

  it('never lets an older read replace a newer copy', async () => {
    const w = world(state({ version: 4, rail: true }));
    await w.store.load('acme');
    void w.store.reload('acme');
    w.gets[0]?.(state({ version: 3, rail: false }));
    await Promise.resolve();
    await Promise.resolve();
    expect(ready(w.store.snapshot('acme'))).toMatchObject({ version: 4, rail: true });
  });
});
