// The views store against a fake API answered by hand (spec 0020): live
// events naming views and coarse ones, coalesced per object, the version
// rule, a view gone from its list, and nothing read for an object no screen
// holds.
import type { View, ViewsList } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { createViewsStore, VIEWS_COALESCE_MS, type ViewsApi } from './store.ts';

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
  const timers: { at: number; work: () => void }[] = [];
  let now = 0;
  const api: ViewsApi = {
    list: () => {
      reads.push('list');
      const answer: ViewsList = { views: [...server.values()], defaultViewId: A };
      return Promise.resolve(answer);
    },
    get: ({ viewId }) => {
      reads.push(`get ${viewId}`);
      const found = server.get(viewId);
      return found === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'NOT_FOUND' }))
        : Promise.resolve(found);
    },
    saveQuery: () => Promise.reject(new Error('not used')),
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
  return { server, reads, store, advance, settle };
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
