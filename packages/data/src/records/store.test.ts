// The layering rule (spec 0005, writes), on the record store: a base per
// record, optimistic layers on top, a confirmation replaces the base, and a
// layer goes only with its own answer.
import { describe, expect, it } from 'vitest';
import { createPlainStore } from './plain-store.ts';
import type { RecordBody, RecordStore } from './store.ts';

interface Person extends RecordBody {
  readonly objectId: string;
}

const person = (id: string, values: Record<string, unknown>): Person => ({ id, objectId: 'people', values });

/** A server row at `revision`, with each cell's version, as RecordView carries them. */
const revised = (
  id: string,
  values: Record<string, unknown>,
  revision: number,
  versions: Record<string, string>,
): Person => ({ id, objectId: 'people', values, revision, versions });

/** A uuid v7 shaped version whose time part is `ms`, so a greater `ms` is a later write. */
const v = (ms: number) => `0199a6f2-${ms.toString(16).padStart(4, '0')}-7000-8000-000000000000`;

/** What a screen sees: the record's id, object and values. */
const seen = (store: RecordStore<Person>, id: string) => {
  const row = store.get(id);
  if (row === undefined) return undefined;
  return { id: row.id, objectId: row.objectId, values: row.values };
};

describe('the plain record store', () => {
  // Bodies nothing holds go at once here; the 30 second stay has its own tests below.
  const create = () => createPlainStore<Person>({ unheldMs: 0 });
  const ada = person('r1', { name: 'Ada', city: 'London', role: 'Engineer' });

  /** A store holding `rows`, as a window holds the rows of its blocks. */
  const holding = (rows: readonly Person[]) => {
    const store = create();
    store.receive(rows, { hold: true });
    return store;
  };
  const withAda = () => holding([ada]);

  it('holds server rows by id and hands out the same object until it changes', () => {
    const store = withAda();
    expect(seen(store, 'r1')).toEqual(ada);
    expect(store.get('r1')).toBe(store.get('r1'));
    expect(store.size()).toBe(1);
  });

  it('shows an edit at once and tells listeners which record changed', () => {
    const store = withAda();
    const heard: string[][] = [];
    store.subscribe((ids) => heard.push([...ids]));
    store.edit('r1', { city: 'Paris' }, 'm1');
    expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'Paris', role: 'Engineer' });
    expect(heard).toEqual([['r1']]);
    expect(store.pending()).toEqual(new Set(['r1']));
  });

  it('restores exactly on a refusal', () => {
    const store = withAda();
    const before = seen(store, 'r1');
    const layer = store.edit('r1', { city: 'Paris', name: 'Ada L' }, 'm1');
    layer.refuse();
    expect(seen(store, 'r1')).toEqual(before);
    expect(store.pending().size).toBe(0);
  });

  it('makes the confirmed row the base and drops the layer', () => {
    const store = withAda();
    const layer = store.edit('r1', { city: 'Paris' }, 'm1');
    layer.confirm(person('r1', { name: 'Ada', city: 'Paris', role: 'Engineer', updatedBy: 'me' }));
    expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'Paris', role: 'Engineer', updatedBy: 'me' });
    expect(store.pending().size).toBe(0);
  });

  it('keeps a second edit to the same cell showing when the first is confirmed', () => {
    const store = withAda();
    const first = store.edit('r1', { city: 'Paris' }, 'm1');
    store.edit('r1', { city: 'Rome' }, 'm2');
    first.confirm(person('r1', { name: 'Ada', city: 'Paris', role: 'Engineer' }));
    expect(seen(store, 'r1')?.values.city).toBe('Rome');
  });

  it('keeps a second edit to another cell showing when the first is confirmed, on the new base', () => {
    const store = withAda();
    const first = store.edit('r1', { city: 'Paris' }, 'm1');
    store.edit('r1', { role: 'Lead' }, 'm2');
    // The server also changed the name in the meantime; the confirmation carries it.
    first.confirm(person('r1', { name: 'Ada Lovelace', city: 'Paris', role: 'Engineer' }));
    expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada Lovelace', city: 'Paris', role: 'Lead' });
  });

  it('takes back only the refused edit when a later one on the same record is still in flight', () => {
    const store = withAda();
    const first = store.edit('r1', { city: 'Paris' }, 'm1');
    const second = store.edit('r1', { role: 'Lead' }, 'm2');
    first.refuse();
    expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'London', role: 'Lead' });
    second.refuse();
    expect(seen(store, 'r1')).toEqual(ada);
  });

  it('shows the later of two quick edits to one cell, whichever answer comes first', () => {
    const store = withAda();
    const first = store.edit('r1', { city: 'Paris' }, 'm1');
    const second = store.edit('r1', { city: 'Rome' }, 'm2');
    second.confirm(person('r1', { name: 'Ada', city: 'Rome', role: 'Engineer' }));
    // The older edit is still out, but its value never shows over the newer confirmed one.
    expect(seen(store, 'r1')?.values.city).toBe('Rome');
    first.refuse();
    expect(seen(store, 'r1')?.values.city).toBe('Rome');
  });

  it('puts an event’s refetch under a pending edit, so the edit stays and other cells update', () => {
    const store = withAda();
    const layer = store.edit('r1', { city: 'Paris' }, 'm1');
    store.receive([person('r1', { name: 'Ada', city: 'Berlin', role: 'CTO' })]);
    expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'Paris', role: 'CTO' });
    layer.refuse();
    expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'Berlin', role: 'CTO' });
  });

  it('ignores a second answer to the same layer', () => {
    const store = withAda();
    const layer = store.edit('r1', { city: 'Paris' }, 'm1');
    layer.confirm(person('r1', { name: 'Ada', city: 'Paris', role: 'Engineer' }));
    store.receive([person('r1', { name: 'Ada', city: 'Oslo', role: 'Engineer' })]);
    layer.refuse();
    layer.confirm(person('r1', { name: 'Ada', city: 'Paris', role: 'Engineer' }));
    expect(seen(store, 'r1')?.values.city).toBe('Oslo');
  });

  it('shows a created draft at once, removes it on a refusal, and keeps the server row on success', () => {
    const store = withAda();
    const refused = store.create(person('r2', { name: 'Grace' }), 'm1');
    expect(seen(store, 'r2')?.values).toEqual({ name: 'Grace' });
    refused.refuse();
    expect(store.get('r2')).toBeUndefined();
    const kept = store.create(person('r3', { name: 'Edsger' }), 'm2');
    store.hold(['r3']);
    const edit = store.edit('r3', { city: 'Austin' }, 'm3');
    kept.confirm(person('r3', { name: 'Edsger', city: null }));
    expect(seen(store, 'r3')?.values).toEqual({ name: 'Edsger', city: 'Austin' });
    edit.refuse();
    expect(seen(store, 'r3')?.values).toEqual({ name: 'Edsger', city: null });
  });

  it('drops removed records with their layers, and forgets everything on clear', () => {
    const store = withAda();
    store.receive([person('r2', { name: 'Grace' })], { hold: true });
    store.edit('r1', { city: 'Paris' }, 'm1');
    store.remove(['r1']);
    expect(store.get('r1')).toBeUndefined();
    expect(store.pending().size).toBe(0);
    expect(seen(store, 'r2')?.values.name).toBe('Grace');
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('patches 50 records in one call with one notice', () => {
    const store = holding(
      Array.from({ length: 1000 }, (_, index) => person(`r${String(index)}`, { name: `P${String(index)}` })),
    );
    const heard: number[] = [];
    store.subscribe((ids) => heard.push(ids.size));
    store.receive(Array.from({ length: 50 }, (_, index) => person(`r${String(index * 20)}`, { name: 'patched' })));
    expect(heard).toEqual([50]);
    expect(seen(store, 'r980')?.values.name).toBe('patched');
  });

  describe('orders copies of a record by its revision (spec 0006, AC-44)', () => {
    const london = revised('r1', { name: 'Ada', city: 'London' }, 5, { name: v(1), city: v(1) });

    it('keeps a refetch at revision 7 when a confirmation at revision 6 arrives after it', () => {
      const store = holding([london]);
      const edit = store.edit('r1', { city: 'Paris' }, 'm1');
      // Someone renamed her after this tab's write landed; the refetch came back first.
      store.receive([revised('r1', { name: 'Ada L', city: 'Paris' }, 7, { name: v(3), city: v(2) })]);
      edit.confirm(revised('r1', { name: 'Ada', city: 'Paris' }, 6, { name: v(1), city: v(2) }));
      expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada L', city: 'Paris' });
      expect(store.get('r1')?.revision).toBe(7);
    });

    it('never lets a block read before a write, arriving after its answer, put the old value back', () => {
      const store = holding([london]);
      const edit = store.edit('r1', { city: 'Paris' }, 'm1');
      edit.confirm(revised('r1', { name: 'Ada', city: 'Paris' }, 6, { name: v(1), city: v(2) }));
      store.receive([london]);
      expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'Paris' });
      expect(store.base('r1')?.versions?.city).toBe(v(2));
    });

    it('replaces on an equal revision (a far side link change moves none)', () => {
      const store = holding([revised('r1', { name: 'Ada', company: { id: 'c1' } }, 2, { company: v(2) })]);
      store.receive([revised('r1', { name: 'Ada', company: null }, 2, {})]);
      expect(seen(store, 'r1')?.values.company).toBeNull();
      expect(store.get('r1')?.versions).toEqual({});
    });

    it('keeps a multi link cell’s links and total from the same read', () => {
      const links = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `c${String(index)}` }));
      const store = holding([{ ...revised('r1', { team: links(20) }, 3, { team: v(3) }), linkTotals: { team: 4980 } }]);
      // An older read with a different total: ignored whole.
      store.receive([{ ...revised('r1', { team: links(20) }, 2, { team: v(2) }), linkTotals: { team: 12 } }]);
      expect(store.get('r1')?.linkTotals).toEqual({ team: 4980 });
      // A newer read whose cell was not cut: no total left over from the older one.
      store.receive([revised('r1', { team: links(3) }, 4, { team: v(4) })]);
      expect(store.get('r1')?.values.team).toEqual(links(3));
      expect(store.get('r1')?.linkTotals ?? {}).toEqual({});
    });

    it('keeps the attributes a newer read didn’t carry: a body is the union of its reads', () => {
      const store = holding([london]);
      store.receive([revised('r1', { name: 'Ada L' }, 6, { name: v(3) })]);
      expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada L', city: 'London' });
      expect(store.get('r1')?.versions).toEqual({ name: v(3), city: v(1) });
    });

    it('takes from an older read only the attributes it never held (a column shown while a write landed)', () => {
      const store = holding([london]);
      store.receive([revised('r1', { name: 'Ada', city: 'Old', phone: '555' }, 4, { city: v(0), phone: v(2) })]);
      expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'London', phone: '555' });
      expect(store.get('r1')?.revision).toBe(5);
    });

    it('answers the base under a pending edit, never the layer', () => {
      const store = holding([london]);
      store.edit('r1', { city: 'Paris' }, 'm1');
      expect(store.get('r1')?.values.city).toBe('Paris');
      expect(store.base('r1')?.values.city).toBe('London');
    });
  });

  describe('holds only what something refers to', () => {
    it('keeps no row nobody holds', () => {
      const store = create();
      store.receive([ada]);
      expect(store.get('r1')).toBeUndefined();
      expect(store.size()).toBe(0);
    });

    it('evicts a record when its last hold goes, and not before', () => {
      const store = withAda();
      store.hold(['r1']);
      store.release(['r1']);
      expect(seen(store, 'r1')).toEqual(ada);
      store.release(['r1']);
      expect(store.get('r1')).toBeUndefined();
      expect(store.size()).toBe(0);
    });

    it('keeps a record with a pending edit after its last hold goes, then evicts it with the answer', () => {
      const store = withAda();
      const edit = store.edit('r1', { city: 'Paris' }, 'm1');
      store.release(['r1']);
      expect(seen(store, 'r1')?.values.city).toBe('Paris');
      edit.confirm(person('r1', { name: 'Ada', city: 'Paris', role: 'Engineer' }));
      expect(store.size()).toBe(0);
    });

    it('keeps a confirmed create only while something holds it', () => {
      const store = create();
      const held = store.create(person('r2', { name: 'Grace' }), 'm1');
      store.hold(['r2']);
      held.confirm(person('r2', { name: 'Grace' }));
      expect(seen(store, 'r2')?.values.name).toBe('Grace');
      const loose = store.create(person('r3', { name: 'Edsger' }), 'm2');
      loose.confirm(person('r3', { name: 'Edsger' }));
      expect(store.get('r3')).toBeUndefined();
    });

    it('keeps a body nothing holds for 30 seconds, then drops it; past 2,000 such bodies the oldest go first', () => {
      let time = 0;
      const timers: { at: number; run: () => void; live: boolean }[] = [];
      const store = createPlainStore<Person>({
        now: () => time,
        maxUnheld: 3,
        later: (run, ms) => {
          const timer = { at: time + ms, run, live: true };
          timers.push(timer);
          return () => {
            timer.live = false;
          };
        },
      });
      const tick = (ms: number) => {
        time += ms;
        for (const timer of timers.filter((each) => each.live && each.at <= time)) {
          timer.live = false;
          timer.run();
        }
      };
      store.receive([person('a', {}), person('b', {})], { hold: true });
      store.release(['a']);
      tick(20_000);
      // Held again within its 30 seconds: it stays for good.
      store.hold(['a']);
      store.release(['b']);
      tick(15_000);
      expect(store.get('a')).toBeDefined();
      expect(store.get('b')).toBeDefined();
      tick(15_000);
      expect(store.get('b')).toBeUndefined();
      expect(store.get('a')).toBeDefined();
      // A fourth body let go pushes the oldest out at once.
      store.receive(
        ['c', 'd', 'e', 'f'].map((id) => person(id, {})),
        { hold: true },
      );
      store.release(['c']);
      tick(1);
      store.release(['d', 'e', 'f']);
      expect(store.get('c')).toBeUndefined();
      expect(['d', 'e', 'f'].map((id) => store.get(id) !== undefined)).toEqual([true, true, true]);
    });

    it('drops a refused create together with the edits made on its draft', () => {
      const store = create();
      const created = store.create(person('r2', { name: 'Grace' }), 'm1');
      store.hold(['r2']);
      const edit = store.edit('r2', { city: 'Austin' }, 'm2');
      created.refuse();
      expect(store.get('r2')).toBeUndefined();
      expect(store.pending().size).toBe(0);
      // The edit's own late answer changes nothing.
      edit.confirm(person('r2', { name: 'Grace', city: 'Austin' }));
      expect(store.get('r2')).toBeUndefined();
    });
  });

  describe('keeps the same object for a row that didn’t change', () => {
    it('neither replaces nor announces a received row with the same data', () => {
      const store = holding([{ ...ada, versions: { name: 'v1' } }]);
      const before = store.get('r1');
      const heard: string[][] = [];
      store.subscribe((ids) => heard.push([...ids]));
      store.receive([{ ...ada, values: { ...ada.values }, versions: { name: 'v1' } }]);
      expect(store.get('r1')).toBe(before);
      expect(heard).toEqual([]);
    });

    it('keeps the shown row under a pending edit when the base comes back the same', () => {
      const store = withAda();
      store.edit('r1', { city: 'Paris' }, 'm1');
      const before = store.get('r1');
      const heard: string[][] = [];
      store.subscribe((ids) => heard.push([...ids]));
      store.receive([{ ...ada, values: { ...ada.values } }]);
      expect(store.get('r1')).toBe(before);
      expect(heard).toEqual([]);
    });
  });
});
