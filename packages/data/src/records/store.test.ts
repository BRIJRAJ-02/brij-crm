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

/** A server row with each cell's version and the record's `updatedAt`, as RecordView carries them. */
const versioned = (
  id: string,
  values: Record<string, unknown>,
  versions: Record<string, string>,
  updatedAt: string,
): Person => ({ id, objectId: 'people', values, versions, updatedAt });

/** A uuid v7 shaped version whose time part is `ms`, so a greater `ms` is a later write. */
const v = (ms: number) => `0199a6f2-${ms.toString(16).padStart(4, '0')}-7000-8000-000000000000`;

/** What a screen sees: the record's id, object and values. */
const seen = (store: RecordStore<Person>, id: string) => {
  const row = store.get(id);
  if (row === undefined) return undefined;
  return { id: row.id, objectId: row.objectId, values: row.values };
};

describe('the plain record store', () => {
  const create = () => createPlainStore<Person>();
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

  describe('orders copies of a record by each cell’s version', () => {
    const at = (second: number) => `2026-10-08T09:00:${String(second).padStart(2, '0')}.000Z`;
    const london = versioned('r1', { name: 'Ada', city: 'London' }, { name: v(1), city: v(1) }, at(1));

    it('keeps the later of two edits when their answers arrive out of order', () => {
      const store = holding([london]);
      const first = store.edit('r1', { city: 'Paris' }, 'm1');
      const second = store.edit('r1', { city: 'Rome' }, 'm2');
      // The server wrote Paris (version 2), then Rome (version 3); Rome's answer arrives first.
      second.confirm(versioned('r1', { name: 'Ada', city: 'Rome' }, { name: v(1), city: v(3) }, at(3)));
      expect(seen(store, 'r1')?.values.city).toBe('Rome');
      first.confirm(versioned('r1', { name: 'Ada', city: 'Paris' }, { name: v(1), city: v(2) }, at(2)));
      expect(seen(store, 'r1')?.values.city).toBe('Rome');
      expect(store.get('r1')?.versions?.city).toBe(v(3));
    });

    it('never lets a block sent before a confirmation, arriving after it, put the old value back', () => {
      const store = holding([london]);
      const edit = store.edit('r1', { city: 'Paris' }, 'm1');
      edit.confirm(versioned('r1', { name: 'Ada', city: 'Paris' }, { name: v(1), city: v(2) }, at(2)));
      // A window's block, read before the write, lands now.
      store.receive([london]);
      expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada', city: 'Paris' });
    });

    it('takes the newer cells from an older copy, and keeps the newer ones it holds', () => {
      const store = holding([]);
      store.hold(['r1']);
      // Ours: the name changed at 3; theirs (read earlier overall) has a city written at 4 by someone else.
      store.receive([versioned('r1', { name: 'Ada L', city: 'London' }, { name: v(3), city: v(1) }, at(3))]);
      store.receive([versioned('r1', { name: 'Ada', city: 'Oslo' }, { name: v(1), city: v(4) }, at(2))]);
      expect(seen(store, 'r1')?.values).toEqual({ name: 'Ada L', city: 'Oslo' });
    });

    it('lets a newer copy clear a cell that has no version left (a reference with no current link)', () => {
      const store = holding([]);
      store.hold(['r1']);
      store.receive([versioned('r1', { name: 'Ada', company: { id: 'c1' } }, { name: v(1), company: v(2) }, at(2))]);
      store.receive([versioned('r1', { name: 'Ada', company: null }, { name: v(1) }, at(3))]);
      expect(seen(store, 'r1')?.values.company).toBeNull();
    });

    it('keeps a cell an older copy has no version for', () => {
      const store = holding([]);
      store.hold(['r1']);
      store.receive([versioned('r1', { name: 'Ada', city: 'Paris' }, { name: v(1), city: v(2) }, at(2))]);
      store.receive([versioned('r1', { name: 'Ada', city: null }, { name: v(1) }, at(1))]);
      expect(seen(store, 'r1')?.values.city).toBe('Paris');
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
