import type { NavState } from '@crm/contracts';
import { EMPTY_NAV_UNIVERSE, type NavOperation, type NavUniverse } from '@crm/contracts/navigation';
import { describe, expect, it, vi } from 'vitest';
import { dataError } from '../errors.ts';
import { createMutationLog } from '../live/mutations.ts';
import { createNavStore, type NavApi } from './store.ts';

const ME = '01900000-0000-7000-8000-0000000000a1';
const OTHER = '01900000-0000-7000-8000-0000000000a2';
const PEOPLE = '01900000-0000-7000-8000-000000000001';
const DEALS = '01900000-0000-7000-8000-000000000003';
const universe: NavUniverse = { ...EMPTY_NAV_UNIVERSE, records: [PEOPLE, DEALS], scheduling: ['bookings', 'captures'] };

const state = (over: Partial<NavState> = {}): NavState => ({
  items: [],
  sections: { order: ['favourites', 'records', 'lists', 'scheduling'], folded: [] },
  rail: false,
  version: 0,
  favourites: [],
  top: [],
  scheduling: ['bookings', 'captures'],
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
  const unavailable: string[] = [];
  const retries: (() => void)[] = [];
  const watching = { opened: 0, released: 0 };
  const timers: (() => void)[] = [];
  const store = createNavStore({
    api,
    mintId: (() => {
      let n = 0;
      return () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`;
    })(),
    mutations: createMutationLog(),
    watch: () => {
      watching.opened += 1;
      return () => {
        watching.released += 1;
      };
    },
    namesMe: (_workspace, ids) => Promise.resolve(ids.includes(ME)),
    onRefused: (error, retry) => {
      refused.push(error.message);
      if (retry !== undefined) retries.push(retry);
    },
    onUnavailable: (error, retry) => {
      unavailable.push(error.message);
      retries.push(retry);
    },
    setTimeout: (run) => {
      timers.push(run);
    },
  });
  return { store, gets, changes, refused, unavailable, retries, watching, timers, asked: () => getsAsked };
}

const ready = (snapshot: ReturnType<ReturnType<typeof createNavStore>['snapshot']>) => {
  if (snapshot.status !== 'ready') throw new Error(`Not ready: ${snapshot.status}`);
  return snapshot.nav;
};

describe('the sidebar store', () => {
  it('shows a change at once, sends changes one at a time in order, and keeps them when they land (AC-937)', async () => {
    const w = world();
    await w.store.load('acme');
    void w.store.change('acme', { op: 'fold', section: 'records', folded: true }, universe);
    void w.store.change('acme', { op: 'rail', on: true }, universe);
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
    void w.store.change('acme', { op: 'hide', kind: 'object', id: DEALS }, universe);
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

  it('still notices a favourite that dropped out of a read, so its restore brings it back (AC-939)', async () => {
    const ADA = '01900000-0000-7000-8000-0000000000b1';
    const favourite = {
      kind: 'record' as const,
      id: ADA,
      label: 'Ada Byron',
      objectId: PEOPLE,
      objectSlug: 'people',
      objectName: 'People',
      objectSingularName: 'Person',
      icon: 'user' as const,
      hue: 'green' as const,
    };
    const starred = { kind: 'record' as const, id: ADA, pinned: true };
    const w = world(state({ version: 2, items: [starred], favourites: [favourite] }));
    await w.store.load('acme');
    const restored = { kind: 'record' as const, ids: [ADA], objectId: PEOPLE, coarse: false };
    expect(w.store.touchesFavourites('acme', restored)).toBe(true);
    // Trashed: the next read leaves it out, by name and id.
    void w.store.reload('acme');
    w.gets[0]?.(state({ version: 2 }));
    await vi.waitFor(() => {
      expect(ready(w.store.snapshot('acme')).favourites).toEqual([]);
    });
    // Its restore still names something the sidebar waits for; another record's change doesn't.
    expect(w.store.touchesFavourites('acme', restored)).toBe(true);
    expect(w.store.touchesFavourites('acme', { ...restored, ids: [DEALS] })).toBe(false);
    // A coarse change on another object, or one naming no object, doesn't wake it (it may be gone for good).
    expect(w.store.touchesFavourites('acme', { ...restored, ids: [], coarse: true, objectId: undefined })).toBe(false);
    expect(w.store.touchesFavourites('acme', { ...restored, ids: [], coarse: true })).toBe(true);
    // This tab's own restore of it reads at once; one of another record doesn't.
    expect(w.store.touchedHere('acme', [ADA])).toBe(true);
    expect(w.store.touchedHere('acme', [DEALS])).toBe(false);
    // Back in a read, then unstarred: nothing is waited for any more.
    void w.store.reload('acme');
    w.gets[1]?.(state({ version: 2, items: [starred], favourites: [favourite] }));
    await vi.waitFor(() => {
      expect(ready(w.store.snapshot('acme')).favourites).toHaveLength(1);
    });
    void w.store.change('acme', { op: 'unstar', kind: 'record', id: ADA }, universe);
    w.changes[0]?.settle(3);
    await vi.waitFor(() => {
      expect(ready(w.store.snapshot('acme')).favourites).toEqual([]);
    });
    expect(w.store.touchesFavourites('acme', restored)).toBe(false);
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

  it('says once that a sidebar couldn’t be read, tries again when held, and recovers once a change lands', async () => {
    const answers: ((value: NavState | Error) => void)[] = [];
    const settles: ((version: number) => void)[] = [];
    const unavailable: string[] = [];
    const retries: (() => void)[] = [];
    const store = createNavStore({
      api: {
        get: () =>
          new Promise((resolve, reject) => {
            answers.push((value) => {
              if (value instanceof Error) reject(value);
              else resolve(value);
            });
          }),
        change: () =>
          new Promise((resolve) => {
            settles.push((version) => {
              resolve({ version });
            });
          }),
      },
      mintId: () => '01900000-0000-7000-8000-000000000099',
      mutations: createMutationLog(),
      watch: () => () => undefined,
      namesMe: () => Promise.resolve(false),
      onRefused: () => undefined,
      onUnavailable: (error, retry) => {
        unavailable.push(error.message);
        retries.push(retry);
      },
    });
    const loading = store.load('acme');
    answers[0]?.(new Error('The server is down.'));
    await expect(loading).rejects.toBeDefined();
    expect(store.snapshot('acme').status).toBe('error');
    expect(unavailable).toHaveLength(1);
    // Held again (the next page): read again, and a second failure says nothing new.
    store.retain('acme')();
    expect(answers).toHaveLength(2);
    answers[1]?.(new Error('Still down.'));
    await vi.waitFor(() => {
      expect(store.snapshot('acme').status).toBe('error');
    });
    expect(unavailable).toHaveLength(1);
    // A change made meanwhile lands, so the server answers: the sidebar is read, and shows the change.
    void store.change('acme', { op: 'rail', on: true }, universe);
    settles[0]?.(1);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(3);
    });
    answers[2]?.(state({ rail: true, version: 1 }));
    await vi.waitFor(() => {
      expect(ready(store.snapshot('acme')).rail).toBe(true);
    });
    // With the sidebar held, a read that fails changes nothing and says nothing.
    void store.reload('acme').catch(() => undefined);
    answers[3]?.(new Error('Down once more.'));
    await Promise.resolve();
    expect(unavailable).toHaveLength(1);
    expect(ready(store.snapshot('acme')).rail).toBe(true);
  });

  it('says nothing of a workspace that isn’t there or a session that ended: their screens say it', async () => {
    const unavailable: string[] = [];
    const store = createNavStore({
      api: {
        get: () => Promise.reject(dataError('NOT_FOUND', 'That workspace doesn’t exist.')),
        change: () => Promise.resolve({ version: 1 }),
      },
      mintId: () => '01900000-0000-7000-8000-000000000098',
      mutations: createMutationLog(),
      watch: () => () => undefined,
      namesMe: () => Promise.resolve(false),
      onRefused: () => undefined,
      onUnavailable: (error) => {
        unavailable.push(error.message);
      },
    });
    await expect(store.load('gone')).rejects.toBeDefined();
    expect(store.snapshot('gone').status).toBe('error');
    expect(unavailable).toEqual([]);
  });

  it('reads once more when the member’s change comes in while a read is out, so the newer one shows (AC-937)', async () => {
    const w = world();
    await w.store.load('acme');
    const event = (seq: number) => ({ seq, at: '2026-10-20T09:00:00.000Z', kind: 'nav' as const, memberIds: [ME] });
    w.store.navChanged('acme', event(1));
    await vi.waitFor(() => {
      expect(w.asked()).toBe(2);
    });
    w.store.navChanged('acme', event(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(w.asked()).toBe(2);
    w.gets[0]?.(state({ version: 2, sections: { order: ['records'], folded: ['records'] } }));
    await vi.waitFor(() => {
      expect(w.asked()).toBe(3);
    });
    w.gets[1]?.(state({ version: 3, rail: true }));
    await vi.waitFor(() => {
      expect(ready(w.store.snapshot('acme'))).toMatchObject({ version: 3, rail: true });
    });
  });

  it('reads again when another tab’s change landed between its base and this answer', async () => {
    const w = world(state({ version: 5 }));
    await w.store.load('acme');
    void w.store.change('acme', { op: 'rail', on: true }, universe);
    w.changes[0]?.settle(7);
    await vi.waitFor(() => {
      expect(w.asked()).toBe(2);
    });
    w.gets[0]?.(state({ version: 7, rail: true, sections: { order: ['records'], folded: ['records'] } }));
    await vi.waitFor(() => {
      expect(ready(w.store.snapshot('acme')).sections.folded).toEqual(['records']);
    });
  });

  it('offers no Retry for a refusal that would only repeat, and a late Retry changes nothing after a newer choice', async () => {
    const w = world();
    await w.store.load('acme');
    void w.store.change('acme', { op: 'star', kind: 'record', id: DEALS }, universe);
    // The fake's bare error reads as a passing failure: Retry is offered.
    w.changes[0]?.refuse('Busy.');
    await vi.waitFor(() => {
      expect(w.retries).toHaveLength(1);
    });
    // A newer choice, then the old Retry: nothing more is sent.
    void w.store.change('acme', { op: 'rail', on: true }, universe);
    w.retries[0]?.();
    expect(w.changes).toHaveLength(2);
  });

  it('keeps watching through a page change, and lets the live connection go only once nobody holds it a while', () => {
    const w = world();
    const release = w.store.retain('acme');
    release();
    const again = w.store.retain('acme');
    expect(w.watching).toEqual({ opened: 1, released: 0 });
    // The first release's delayed let go finds a screen holding it again.
    for (const run of w.timers.splice(0)) run();
    expect(w.watching.released).toBe(0);
    again();
    for (const run of w.timers.splice(0)) run();
    expect(w.watching).toEqual({ opened: 1, released: 1 });
  });

  it('changes nothing with an answer that comes after a sign out', async () => {
    const w = world();
    await w.store.load('acme');
    void w.store.change('acme', { op: 'rail', on: true }, universe);
    w.store.clear();
    w.changes[0]?.refuse('Signed out.');
    await Promise.resolve();
    await Promise.resolve();
    expect(w.refused).toEqual([]);
    expect(w.store.snapshot('acme').status).toBe('loading');
  });

  it('answers a change that lands, and one refused and said by its screen, with no toast for that one', async () => {
    const w = world();
    await w.store.load('acme');
    const landed = w.store.change('acme', { op: 'rail', on: true }, universe);
    w.changes[0]?.settle(1);
    await expect(landed).resolves.toBeUndefined();
    const refused = w.store.change('acme', { op: 'reset' }, universe, { isSaidHere: true });
    await vi.waitFor(() => {
      expect(w.changes).toHaveLength(2);
    });
    w.changes[1]?.refuse('Busy.');
    await expect(refused).rejects.toBeInstanceOf(Error);
    expect(w.refused).toEqual([]);
  });
});
