// The Access tab's store (spec 0032): a change shows at once and the answer lands; another admin's change (a live
// `access` event) reads every held object again; a read that began before a write landed is asked again; a refusal
// reads the object again and rejects.
import type { ObjectAccess, SetObjectAccessResult } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { createRulesStore, type RulesStoreDeps } from './rules-store.ts';

const MEMBERS = { type: 'role', role: 'member' } as const;

const accessOf = (level: 'none' | 'read' | 'write'): ObjectAccess => ({
  objectId: 'deals',
  fields: [],
  subjects: [
    {
      subject: MEMBERS,
      level,
      records: 'all',
      defaultLevel: 'write',
      isDefault: level === 'write',
      fields: {},
      people: 3,
    },
  ],
});

const resultOf = (access: ObjectAccess): SetObjectAccessResult => ({
  access,
  impact: { people: 0, views: 0, forms: 0 },
});

const levelOf = (access: ObjectAccess | undefined) => access?.subjects[0]?.level;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A store over calls answered by hand, its timer run on demand. */
function setup(overrides: Partial<RulesStoreDeps> = {}) {
  let server = accessOf('write');
  const gets: ((value: ObjectAccess) => void)[] = [];
  const timers: (() => void)[] = [];
  let watched = 0;
  const store = createRulesStore({
    get: () =>
      new Promise((resolve) => {
        gets.push(resolve);
      }),
    put: (_workspace, _objectId, _subject, rule) => {
      server = accessOf(rule?.level ?? 'write');
      return Promise.resolve(resultOf(server));
    },
    watch: () => {
      watched += 1;
      return () => {
        watched -= 1;
      };
    },
    later: (run) => {
      timers.push(run);
      return () => undefined;
    },
    ...overrides,
  });
  return {
    store,
    gets,
    answerGets: () => {
      for (const answer of gets.splice(0)) answer(server);
    },
    setServer: (next: ObjectAccess) => {
      server = next;
    },
    runTimers: () => {
      for (const run of timers.splice(0)) run();
    },
    watched: () => watched,
  };
}

describe('the Access tab store', () => {
  it('shows what the route read at once, reads it behind, and watches while held', async () => {
    const { store, answerGets, watched } = setup();
    const source = store.view('acme', 'deals', accessOf('read'));
    expect(levelOf(source.getSnapshot().access)).toBe('read');
    const release = source.retain();
    expect(watched()).toBe(1);
    answerGets();
    await flush();
    expect(levelOf(source.getSnapshot().access)).toBe('write');
    release();
    expect(watched()).toBe(0);
  });

  it('shows a change at once and puts the answer in place; a read begun before it is asked again', async () => {
    const { store, gets, answerGets } = setup();
    const source = store.view('acme', 'deals', accessOf('write'));
    source.retain();
    const change = store.set('acme', 'deals', MEMBERS, { level: 'read', records: 'all' }, () => accessOf('read'));
    expect(levelOf(source.getSnapshot().access)).toBe('read');
    await change;
    // The read the retain sent began before the write: its answer is dropped and it asks again.
    answerGets();
    await flush();
    expect(gets).toHaveLength(1);
    answerGets();
    await flush();
    expect(levelOf(source.getSnapshot().access)).toBe('read');
  });

  it('reads every held object of the workspace again on another admin’s change, once a burst', async () => {
    const { store, gets, answerGets, setServer, runTimers } = setup();
    const source = store.view('acme', 'deals', accessOf('write'));
    source.retain();
    answerGets();
    await flush();
    setServer(accessOf('none'));
    store.changed('acme');
    store.changed('acme');
    store.changed('other');
    runTimers();
    expect(gets).toHaveLength(1);
    answerGets();
    await flush();
    expect(levelOf(source.getSnapshot().access)).toBe('none');
  });

  it('stays the object’s source when a screen lets go and holds it again (a remount)', async () => {
    const { store, answerGets } = setup();
    const source = store.view('acme', 'deals', accessOf('write'));
    source.retain()();
    source.retain();
    answerGets();
    await flush();
    await store.set('acme', 'deals', MEMBERS, { level: 'read', records: 'all' }, () => accessOf('read'));
    expect(levelOf(source.getSnapshot().access)).toBe('read');
    expect(store.view('acme', 'deals')).toBe(source);
  });

  it('rejects a refusal and reads the object again', async () => {
    const refusal = dataError('FORBIDDEN', 'Only owners and admins can change access.');
    const { store, gets } = setup({ put: () => Promise.reject(refusal) });
    const source = store.view('acme', 'deals', accessOf('write'));
    source.retain();
    gets.splice(0);
    await expect(
      store.set('acme', 'deals', MEMBERS, { level: 'none', records: 'all' }, () => accessOf('none')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(gets).toHaveLength(1);
  });
});
