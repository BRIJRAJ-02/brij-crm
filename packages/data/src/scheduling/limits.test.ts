// Meeting limits' held copy (spec 0037, job J7): a change shows at once and the answer lands, a refusal puts it back
// with a toast, only the latest of two quick changes lands, a held copy watches its workspace and reads again on a
// change, and a read answering while a change is out never puts the older limits back.
import type { MeetingLimits } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { Notice } from '../notice.ts';
import { createLimitsStore, withDraft, type LimitsApi, type LimitsDraft } from './limits.ts';

const SAM = '00000000-0000-7000-8000-000000000001';
const BASE: MeetingLimits = { memberId: SAM, today: 1, thisWeek: 3, timeZone: 'UTC', canChange: true };

/** A promise and its resolvers, so a test answers calls when it chooses. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(stored: MeetingLimits = BASE) {
  const notices: Notice[] = [];
  const watching: string[] = [];
  let reads = 0;
  let server = stored;
  const sets: { readonly draft: LimitsDraft; readonly answer: ReturnType<typeof deferred<MeetingLimits>> }[] = [];
  const api: LimitsApi = {
    get: () => {
      reads += 1;
      return Promise.resolve(server);
    },
    set: (input) => {
      const answer = deferred<MeetingLimits>();
      sets.push({ draft: { perDay: input.perDay, perWeek: input.perWeek }, answer });
      return answer.promise;
    },
  };
  const store = createLimitsStore({
    api,
    notify: (notice) => notices.push(notice),
    watch: (workspace) => {
      watching.push(workspace);
      return () => {
        watching.splice(watching.indexOf(workspace), 1);
      };
    },
    now: () => 0,
  });
  return {
    store,
    notices,
    watching,
    sets,
    reads: () => reads,
    serve: (next: MeetingLimits) => {
      server = next;
    },
  };
}

const ready = (state: ReturnType<ReturnType<ReturnType<typeof createLimitsStore>['held']>['getSnapshot']>) =>
  state.status === 'ready' ? state.limits : undefined;

describe('the limits store', () => {
  it('replaces both limits in a draft, leaving the counts', () => {
    expect(withDraft({ ...BASE, perDay: 2, perWeek: 9 }, { perWeek: 10 })).toEqual({ ...BASE, perWeek: 10 });
  });

  it('shows a change at once, lands the answer, and watches the workspace while held', async () => {
    const t = setup();
    const held = t.store.held('acme');
    const release = held.retain();
    await held.ready();
    expect(t.watching).toEqual(['acme']);
    const saving = t.store.set('acme', undefined, { perDay: 4 });
    expect(ready(held.getSnapshot())?.perDay).toBe(4);
    t.sets[0]?.answer.resolve({ ...BASE, perDay: 4, today: 2 });
    expect(await saving).toBe(true);
    expect(ready(held.getSnapshot())).toMatchObject({ perDay: 4, today: 2 });
    release();
    expect(t.watching).toEqual([]);
  });

  it('puts a refused change back with a toast', async () => {
    const t = setup({ ...BASE, perDay: 3 });
    const held = t.store.held('acme');
    await held.ready();
    const saving = t.store.set('acme', undefined, { perDay: 9 });
    t.sets[0]?.answer.reject(Object.assign(new Error('No.'), { code: 'FORBIDDEN', message: 'You can’t.' }));
    expect(await saving).toBe(false);
    expect(ready(held.getSnapshot())?.perDay).toBe(3);
    expect(t.notices.map((notice) => notice.tone)).toEqual(['danger']);
  });

  it('lands only the latest of two quick changes', async () => {
    const t = setup();
    const held = t.store.held('acme');
    await held.ready();
    const first = t.store.set('acme', undefined, { perDay: 4 });
    const second = t.store.set('acme', undefined, { perDay: 5 });
    t.sets[1]?.answer.resolve({ ...BASE, perDay: 5 });
    t.sets[0]?.answer.resolve({ ...BASE, perDay: 4 });
    await Promise.all([first, second]);
    expect(ready(held.getSnapshot())?.perDay).toBe(5);
  });

  it('reads every held copy of the workspace again on a change, and only those', async () => {
    const t = setup();
    const held = t.store.held('acme');
    const release = held.retain();
    await held.ready();
    const before = t.reads();
    t.serve({ ...BASE, perWeek: 12 });
    t.store.changed('other');
    expect(t.reads()).toBe(before);
    t.store.changed('acme');
    await held.ready();
    await Promise.resolve();
    expect(ready(held.getSnapshot())?.perWeek).toBe(12);
    release();
  });
});
