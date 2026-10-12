// The hand parser (spec 0011, AC-200, AC-212): a records event keeps what a
// People table acts on, the stub and other kinds keep their seq, and anything
// malformed is dropped, as the browser's parser does.
import { describe, expect, it } from 'vitest';
import { parseLiveEvent } from './event.ts';

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const at = '2026-10-12T00:00:01.250Z';

describe('parseLiveEvent', () => {
  it('keeps a records event, its lifecycle ids defaulting to none', () => {
    const parsed = parseLiveEvent({
      seq: 3,
      at,
      kind: 'records',
      objectId: id(1),
      recordIds: [id(2)],
      attributeIds: [id(3)],
      createdIds: [id(2)],
      mutationId: id(9),
      replaced: { ignored: true },
    });
    expect(parsed).toEqual({
      kind: 'records',
      seq: 3,
      atMs: Date.parse(at),
      objectId: id(1),
      recordIds: [id(2)],
      attributeIds: [id(3)],
      createdIds: [id(2)],
      deletedIds: [],
      restoredIds: [],
      coarse: false,
      mutationId: id(9),
    });
  });

  it('keeps the stub without a mutation id, and another kind by its seq', () => {
    expect(parseLiveEvent({ seq: 4, at, kind: 'restricted', mutationId: id(9) })).toEqual({
      kind: 'restricted',
      seq: 4,
      atMs: Date.parse(at),
    });
    expect(parseLiveEvent({ seq: 5, at, kind: 'notes', mutationId: id(9) })).toEqual({
      kind: 'other',
      seq: 5,
      atMs: Date.parse(at),
      mutationId: id(9),
    });
  });

  it('drops what is malformed', () => {
    expect(parseLiveEvent(undefined)).toBeUndefined();
    expect(parseLiveEvent({ seq: 0, at, kind: 'restricted' })).toBeUndefined();
    expect(parseLiveEvent({ seq: 1, kind: 'restricted' })).toBeUndefined();
    expect(parseLiveEvent({ seq: 1, at: 'yesterday', kind: 'restricted' })).toBeUndefined();
    const records = { seq: 1, at, kind: 'records', objectId: id(1), recordIds: [], attributeIds: [] };
    expect(parseLiveEvent({ ...records, recordIds: 'x' })).toBeUndefined();
    expect(parseLiveEvent({ ...records, coarse: 'yes' })).toBeUndefined();
    expect(parseLiveEvent({ ...records, deletedIds: [1] })).toBeUndefined();
  });
});
