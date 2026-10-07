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

/** What a screen sees: the record's id, object and values. */
const seen = (store: RecordStore<Person>, id: string) => {
  const row = store.get(id);
  if (row === undefined) return undefined;
  return { id: row.id, objectId: row.objectId, values: row.values };
};

describe('the plain record store', () => {
  const create = () => createPlainStore<Person>();
  const ada = person('r1', { name: 'Ada', city: 'London', role: 'Engineer' });

  const withAda = () => {
    const store = create();
    store.receive([ada]);
    return store;
  };

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
    const edit = store.edit('r3', { city: 'Austin' }, 'm3');
    kept.confirm(person('r3', { name: 'Edsger', city: null }));
    expect(seen(store, 'r3')?.values).toEqual({ name: 'Edsger', city: 'Austin' });
    edit.refuse();
    expect(seen(store, 'r3')?.values).toEqual({ name: 'Edsger', city: null });
  });

  it('drops removed records with their layers, and forgets everything on clear', () => {
    const store = withAda();
    store.receive([person('r2', { name: 'Grace' })]);
    store.edit('r1', { city: 'Paris' }, 'm1');
    store.remove(['r1']);
    expect(store.get('r1')).toBeUndefined();
    expect(store.pending().size).toBe(0);
    expect(seen(store, 'r2')?.values.name).toBe('Grace');
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('patches 50 records in one call with one notice', () => {
    const store = create();
    store.receive(
      Array.from({ length: 1000 }, (_, index) => person(`r${String(index)}`, { name: `P${String(index)}` })),
    );
    const heard: number[] = [];
    store.subscribe((ids) => heard.push(ids.size));
    store.receive(Array.from({ length: 50 }, (_, index) => person(`r${String(index * 20)}`, { name: 'patched' })));
    expect(heard).toEqual([50]);
    expect(seen(store, 'r980')?.values.name).toBe('patched');
  });
});
