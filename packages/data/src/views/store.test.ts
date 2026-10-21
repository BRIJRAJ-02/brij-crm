// The views store against a fake API answered by hand (spec 0020): live
// events naming views and coarse ones, coalesced per object, the version
// rule, a view gone from its list, and nothing read for an object no screen
// holds.
import type { View, ViewsList } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { toDataError, type DataError } from '../errors.ts';
import { createViewsStore, LAYOUT_SAVE_MS, MARK_OPENED_MS, VIEWS_COALESCE_MS, type ViewsApi } from './store.ts';

const OBJECT = '0199a6f2-0000-7000-8000-000000000001';
const A = '0199a6f2-0000-7000-8000-0000000000a1';
const B = '0199a6f2-0000-7000-8000-0000000000b1';

const view = (id: string, version: number): View => ({
  id,
  objectId: OBJECT,
  name: id === A ? 'All people' : 'Mine',
  kind: 'table',
  visibility: id === A ? 'workspace' : 'private',
  position: 0,
  isDefault: id === A,
  isLocked: false,
  version,
  config: { columns: [], showNewAttributes: true, pinnedCount: 1, sorts: [] },
  queryVersion: version,
});

/** A store on a server whose views are `server`, with timers run by hand and a log of the reads. */
function harness() {
  const server = new Map<string, View>([
    [A, view(A, 1)],
    [B, view(B, 1)],
  ]);
  const reads: string[] = [];
  const writes: string[] = [];
  const refused: DataError[] = [];
  const timers: { at: number; work: () => void }[] = [];
  let now = 0;
  /** How the next layout save answers: the saved view, or a refusal. */
  const layout = { refuse: false };
  /** While set, list reads wait for it: a read still on its way. */
  const lists: { held?: Promise<void> } = {};
  const api: ViewsApi = {
    list: async () => {
      reads.push('list');
      await lists.held;
      const answer: ViewsList = { views: [...server.values()], defaultViewId: A };
      return answer;
    },
    get: ({ viewId }) => {
      reads.push(`get ${viewId}`);
      const found = server.get(viewId);
      return found === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'NOT_FOUND' }))
        : Promise.resolve(found);
    },
    saveQuery: () => Promise.reject(new Error('not used')),
    create: (input) => {
      writes.push(`create ${input.id}`);
      const made: View = { ...view(input.id, 1), name: input.name, visibility: input.visibility, isDefault: false };
      server.set(input.id, made);
      return Promise.resolve(made);
    },
    update: () => Promise.reject(new Error('not used')),
    setLayout: (input) => {
      writes.push(`layout ${String(input.layout.pinnedCount)}`);
      if (layout.refuse) {
        return Promise.reject(Object.assign(new Error('This view is locked.'), { code: 'FORBIDDEN' }));
      }
      const held = server.get(input.viewId) ?? view(input.viewId, 1);
      const saved: View = {
        ...held,
        version: held.version + 1,
        config: { ...held.config, columns: input.layout.columns, pinnedCount: input.layout.pinnedCount },
      };
      server.set(input.viewId, saved);
      return Promise.resolve(saved);
    },
    move: () => Promise.reject(new Error('not used')),
    setLocked: () => Promise.reject(new Error('not used')),
    setDefault: () => Promise.reject(new Error('not used')),
    remove: (input) => {
      writes.push(`delete ${input.viewId}`);
      server.delete(input.viewId);
      return Promise.resolve({ deleted: true });
    },
    markOpened: (input) => {
      writes.push(`opened ${input.viewId}`);
      return Promise.resolve();
    },
  };
  const store = createViewsStore({
    api,
    mintId: () => '0199a6f2-0000-7000-8000-00000000ffff',
    mutations: createMutationLog(),
    watch: () => () => undefined,
    random: () => 0.5,
    after: (ms, work) => {
      const timer = { at: now + ms, work };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    now: () => now,
    onLayoutRefused: (error) => {
      refused.push(toDataError(error));
    },
  });
  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= now).sort((x, y) => x.at - y.at)[0];
      if (due === undefined) break;
      timers.splice(timers.indexOf(due), 1);
      due.work();
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Holds list reads until the answer is called. */
  const holdLists = () => {
    const { promise, resolve } = Promise.withResolvers<undefined>();
    lists.held = promise.then(() => {
      delete lists.held;
    });
    return () => {
      resolve(undefined);
    };
  };
  return { server, reads, writes, refused, layout, store, advance, settle, holdLists };
}

const event = (viewIds: readonly string[], coarse = false) => ({
  seq: 1,
  at: '2026-10-15T09:00:00.000Z',
  kind: 'views' as const,
  objectId: OBJECT,
  viewIds: [...viewIds],
  ...(coarse ? { coarse } : {}),
});

describe('the views store', () => {
  it('reads the list and the named bodies it holds on a named event, at once', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    const body = h.store.get('acme', A);
    list.retain();
    body.retain();
    await list.ready();
    await body.ready();
    h.reads.length = 0;
    h.server.set(A, view(A, 2));
    h.store.changed('acme', event([A]));
    await h.settle();
    expect(h.reads).toEqual(['list', `get ${A}`]);
    expect(body.getSnapshot().view?.version).toBe(2);
  });

  it('on a coarse event reads only the bodies whose version moved, and marks one gone from the list not found', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    const a = h.store.get('acme', A);
    const b = h.store.get('acme', B);
    for (const source of [list, a, b]) source.retain();
    await Promise.all([list.ready(), a.ready(), b.ready()]);
    h.reads.length = 0;
    h.server.set(A, view(A, 3));
    h.server.delete(B);
    h.store.changed('acme', event([], true));
    await h.settle();
    expect(h.reads).toEqual(['list', `get ${A}`]);
    expect(a.getSnapshot().view?.version).toBe(3);
    expect(b.getSnapshot().status).toBe('not-found');
  });

  it('coalesces a burst per object: one read at once, one more after the window and the jitter', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    list.retain();
    await list.ready();
    h.reads.length = 0;
    for (let at = 0; at < 5; at += 1) h.store.changed('acme', event([], true));
    await h.settle();
    expect(h.reads).toEqual(['list']);
    await h.advance(VIEWS_COALESCE_MS);
    expect(h.reads).toEqual(['list']);
    await h.advance(1000);
    expect(h.reads).toEqual(['list', 'list']);
  });

  it('reads nothing for an object no screen holds, and reads it again when one does', async () => {
    const h = harness();
    h.store.changed('acme', event([A]));
    await h.settle();
    expect(h.reads).toEqual([]);
    // Past the coalescing window, so the next change is handled at once.
    await h.advance(VIEWS_COALESCE_MS);
    const list = h.store.list('acme', OBJECT);
    await list.ready();
    h.reads.length = 0;
    h.store.changed('acme', event([], true));
    await h.settle();
    expect(h.reads).toEqual([]);
    // Held again: the change it missed is read now.
    list.retain();
    await h.settle();
    expect(h.reads).toEqual(['list']);
  });

  it('lands only the latest read, and reads again after a failure', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    list.retain();
    const first = list.retry();
    const second = list.retry();
    await Promise.all([first, second]);
    expect(list.getSnapshot().status).toBe('ready');
  });

  it('never replaces a body with an older read', async () => {
    const h = harness();
    const body = h.store.get('acme', A);
    h.server.set(A, view(A, 5));
    await body.ready();
    h.server.set(A, view(A, 4));
    await body.retry();
    expect(body.getSnapshot().view?.version).toBe(5);
  });
});

describe('the views store’s writes (milestone 2)', () => {
  const columns = (pinnedCount: number) => ({ columns: [{ attributeId: A }], pinnedCount });

  it('shows a layout change at once, sends at most one save per 500 ms with the latest, then shows the server’s', async () => {
    const h = harness();
    const body = h.store.get('acme', A);
    body.retain();
    await body.ready();
    h.store.setLayout('acme', A, columns(2));
    expect(body.getSnapshot().view?.config.pinnedCount).toBe(2);
    h.store.setLayout('acme', A, columns(3));
    h.store.setLayout('acme', A, columns(4));
    await h.settle();
    expect(h.writes).toEqual(['layout 2']);
    expect(body.getSnapshot().view?.config.pinnedCount).toBe(4);
    await h.advance(LAYOUT_SAVE_MS);
    await h.settle();
    expect(h.writes).toEqual(['layout 2', 'layout 4']);
    expect(body.getSnapshot().view).toMatchObject({ version: 3, config: { pinnedCount: 4 } });
  });

  it('puts the server’s layout back on a refusal and says why', async () => {
    const h = harness();
    const body = h.store.get('acme', A);
    body.retain();
    await body.ready();
    h.layout.refuse = true;
    h.store.setLayout('acme', A, columns(3));
    expect(body.getSnapshot().view?.config.pinnedCount).toBe(3);
    await h.settle();
    expect(body.getSnapshot().view?.config.pinnedCount).toBe(1);
    expect(h.refused).toHaveLength(1);
  });

  it('keeps a locked view’s layout in this tab only, sends nothing, and drops it when asked', async () => {
    const h = harness();
    const body = h.store.get('acme', A);
    body.retain();
    await body.ready();
    h.store.setLayout('acme', A, columns(2), { isLocal: true });
    await h.advance(LAYOUT_SAVE_MS);
    expect(h.writes).toEqual([]);
    expect(body.getSnapshot()).toMatchObject({ isLayoutLocal: true, view: { config: { pinnedCount: 2 } } });
    h.store.dropLocalLayout('acme', A);
    expect(body.getSnapshot().isLayoutLocal).toBeUndefined();
    expect(body.getSnapshot().view?.config.pinnedCount).toBe(1);
  });

  it('keeps a live reread’s newer view under a pending layout', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    const body = h.store.get('acme', A);
    list.retain();
    body.retain();
    await Promise.all([list.ready(), body.ready()]);
    h.store.setLayout('acme', A, columns(2), { isLocal: true });
    h.server.set(A, { ...view(A, 2), name: 'Renamed' });
    h.store.changed('acme', event([A]));
    await h.settle();
    expect(body.getSnapshot().view).toMatchObject({ name: 'Renamed', config: { pinnedCount: 2 } });
  });

  it('makes a view and reads the held list again; deletes one and marks it not found', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    list.retain();
    await list.ready();
    const id = '0199a6f2-0000-7000-8000-0000000000c1';
    const made = await h.store.create('acme', {
      id,
      objectId: OBJECT,
      name: 'Pilots',
      kind: 'table',
      visibility: 'workspace',
      config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
    });
    await h.settle();
    expect(made.name).toBe('Pilots');
    expect(list.getSnapshot().views.map((each) => each.id)).toContain(id);
    const body = h.store.get('acme', id);
    expect(body.getSnapshot().view?.name).toBe('Pilots');
    await h.store.remove('acme', OBJECT, id);
    await h.settle();
    expect(body.getSnapshot().status).toBe('not-found');
    expect(list.getSnapshot().views.map((each) => each.id)).not.toContain(id);
  });

  it('lets go of a deleted view in the held list at once, before the list is read again', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    list.retain();
    await list.ready();
    const id = '0199a6f2-0000-7000-8000-0000000000c2';
    await h.store.create('acme', {
      id,
      objectId: OBJECT,
      name: 'Pipeline',
      kind: 'table',
      visibility: 'workspace',
      config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
    });
    await h.settle();
    h.store.get('acme', id).retain();
    await h.settle();
    h.store.markOpened('acme', id);
    expect(list.getSnapshot().lastOpenedViewId).toBe(id);
    // The list's read after the delete is still on its way when the object's address reads the list.
    const release = h.holdLists();
    await h.store.remove('acme', OBJECT, id);
    expect(list.getSnapshot().views.map((each) => each.id)).not.toContain(id);
    expect(list.getSnapshot().lastOpenedViewId).toBeUndefined();
    release();
    await h.settle();
    expect(list.getSnapshot().views.map((each) => each.id)).not.toContain(id);
  });

  it('marks a view opened at most once per 10 seconds', async () => {
    const h = harness();
    h.store.markOpened('acme', A);
    h.store.markOpened('acme', A);
    await h.advance(MARK_OPENED_MS - 1);
    h.store.markOpened('acme', A);
    await h.advance(1);
    h.store.markOpened('acme', A);
    expect(h.writes).toEqual([`opened ${A}`, `opened ${A}`]);
  });

  it('marks the view switched back to, and the held list lands on the last one opened', async () => {
    const h = harness();
    const list = h.store.list('acme', OBJECT);
    list.retain();
    await list.ready();
    await h.store.get('acme', A).ready();
    await h.store.get('acme', B).ready();
    h.store.markOpened('acme', A);
    h.store.markOpened('acme', B);
    h.store.markOpened('acme', A);
    expect(h.writes).toEqual([`opened ${A}`, `opened ${B}`, `opened ${A}`]);
    h.store.markOpened('acme', B);
    expect(list.getSnapshot().lastOpenedViewId).toBe(B);
  });
});
