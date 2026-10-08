// Outbox rows as change events (spec 0007): every kind maps to its
// `ChangeEvent`, the wire shape never carries the job starter or `coarse:
// false`, and catch up's collapse merges, caps and keeps the last `seq`.
import { ChangeEvent } from '@crm/contracts';
import type { OutboxRow } from '@crm/db';
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, type AudienceEvent } from '../access/events.ts';
import { CHANGE_CAP } from '../engine/write.ts';
import { createCollapse } from './catch-up.ts';
import { liveEvent, outboxEvent, stubEvent, wireEvent } from './events.ts';

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const OBJECT = id(0xa);
const LIST = id(0x1a);
const at = '2026-10-08T09:00:00.000Z';

const row = (overrides: Partial<OutboxRow>): OutboxRow => ({
  seq: 1,
  kind: 'records',
  objectId: undefined,
  listId: undefined,
  recordIds: [],
  attributeIds: [],
  itemIds: [],
  coarse: false,
  mutationId: undefined,
  actorMemberId: undefined,
  at,
  replaced: undefined,
  ...overrides,
});

describe('outboxEvent', () => {
  it('maps every kind to a ChangeEvent the contract accepts, item ids under their own name', () => {
    const items = [id(1), id(2)];
    const records = [id(3)];
    const events = EVENT_KINDS.map((kind) =>
      outboxEvent(row({ kind, objectId: OBJECT, listId: LIST, itemIds: items, recordIds: records, mutationId: id(9) })),
    );
    for (const event of events) {
      expect(event).toBeDefined();
      expect(ChangeEvent.safeParse(event && wireEvent(event)).success).toBe(true);
    }
    expect(events.map((event) => event?.kind)).toEqual([...EVENT_KINDS]);
    expect(events[1]).toMatchObject({ kind: 'entries', listId: LIST, entryIds: items, recordIds: records });
    expect(events[3]).toMatchObject({ kind: 'views', viewIds: items });
    expect(events[4]).toMatchObject({ kind: 'notes', noteIds: items, recordIds: records });
    expect(events[5]).toMatchObject({ kind: 'tasks', taskIds: items, recordIds: records });
    expect(events[6]).toMatchObject({ kind: 'members', memberIds: items });
    expect(events[7]).toMatchObject({ kind: 'access', memberIds: items });
    expect(events[8]).toMatchObject({ kind: 'jobs', jobIds: items });
  });

  it('carries seq, at and the mutation id, and coarse only when true', () => {
    expect(outboxEvent(row({ seq: 7, objectId: OBJECT, recordIds: [id(3)], attributeIds: [id(4)] }))).toEqual({
      seq: 7,
      at,
      kind: 'records',
      objectId: OBJECT,
      recordIds: [id(3)],
      attributeIds: [id(4)],
    });
    expect(outboxEvent(row({ objectId: OBJECT, coarse: true, mutationId: id(9) }))).toMatchObject({
      coarse: true,
      mutationId: id(9),
    });
  });

  it('names a definitions row’s attributes only when the write did', () => {
    expect(outboxEvent(row({ kind: 'definitions', objectId: OBJECT }))).toEqual({
      seq: 1,
      at,
      kind: 'definitions',
      objectId: OBJECT,
    });
    expect(outboxEvent(row({ kind: 'definitions', objectId: OBJECT, attributeIds: [id(4)] }))).toMatchObject({
      attributeIds: [id(4)],
    });
  });

  it('carries what a records row replaced (spec 0006), which the relay publishes whole and catch up drops', () => {
    const replaced = {
      by: { type: 'member', id: id(6) },
      cells: [{ recordId: id(3), attributeId: id(4), versionId: id(5) }],
    };
    const stored = row({ objectId: OBJECT, recordIds: [id(3)], attributeIds: [id(4)], replaced } as Partial<OutboxRow>);
    const event = outboxEvent(stored);
    expect(event).toMatchObject({ kind: 'records', replaced });
    expect(ChangeEvent.safeParse(liveEvent(stored)).success).toBe(true);
    expect(liveEvent(stored)).toMatchObject({ replaced });
    const collapse = createCollapse();
    if (event !== undefined) collapse.add(event);
    expect(collapse.events()[0]).not.toHaveProperty('replaced');
  });

  it('has nothing for a row missing what its kind needs', () => {
    expect(outboxEvent(row({ kind: 'records' }))).toBeUndefined();
    expect(outboxEvent(row({ kind: 'entries', objectId: OBJECT }))).toBeUndefined();
  });

  it('keeps the job starter for the access filter, and the wire drops it', () => {
    const job = outboxEvent(row({ kind: 'jobs', itemIds: [id(1)], actorMemberId: id(5) }));
    expect(job).toMatchObject({ actorMemberId: id(5) });
    expect(job && wireEvent(job)).not.toHaveProperty('actorMemberId');
  });
});

describe('wireEvent and the stub', () => {
  it('drops coarse when false, as spec 0005’s browsers parse it', () => {
    const event: AudienceEvent = {
      seq: 1,
      at,
      kind: 'records',
      objectId: OBJECT,
      recordIds: [],
      attributeIds: [],
      coarse: false,
    };
    expect(wireEvent(event)).not.toHaveProperty('coarse');
    expect(wireEvent({ ...event, coarse: true })).toHaveProperty('coarse', true);
  });

  it('makes a stub that names nothing', () => {
    expect(stubEvent(4, at)).toEqual({ seq: 4, at, kind: 'restricted' });
    expect(ChangeEvent.safeParse(stubEvent(4, at)).success).toBe(true);
  });
});

describe('the collapse', () => {
  const records = (seq: number, recordIds: string[], extra: Partial<AudienceEvent> = {}): AudienceEvent =>
    ({
      seq,
      at: `2026-10-08T09:00:0${String(seq)}.000Z`,
      kind: 'records',
      objectId: OBJECT,
      recordIds,
      attributeIds: [id(4)],
      mutationId: id(9),
      ...extra,
    }) as AudienceEvent;

  it('merges one object’s events into one, with the last seq and at, and no mutation id', () => {
    const collapse = createCollapse();
    collapse.add(records(1, [id(1), id(2)]));
    collapse.add({ seq: 2, at, kind: 'definitions', objectId: OBJECT, attributeIds: [id(4)] });
    collapse.add(records(3, [id(2), id(3)]));
    expect(collapse.events()).toEqual([
      { seq: 2, at, kind: 'definitions', objectId: OBJECT, attributeIds: [id(4)] },
      {
        seq: 3,
        at: '2026-10-08T09:00:03.000Z',
        kind: 'records',
        objectId: OBJECT,
        recordIds: [id(1), id(2), id(3)],
        attributeIds: [id(4)],
      },
    ]);
  });

  it('keeps objects, lists and kinds apart', () => {
    const collapse = createCollapse();
    collapse.add(records(1, [id(1)]));
    collapse.add(records(2, [id(2)], { objectId: id(0xb) }));
    collapse.add({ seq: 3, at, kind: 'members', memberIds: [id(7)] });
    collapse.add({ seq: 4, at, kind: 'members', memberIds: [id(8)] });
    expect(collapse.events().map((event) => [event.kind, event.seq])).toEqual([
      ['records', 1],
      ['records', 2],
      ['members', 4],
    ]);
    expect(collapse.events()[2]).toMatchObject({ memberIds: [id(7), id(8)] });
  });

  it('goes coarse past the cap, or when a coarse event joins, and stays coarse', () => {
    const many = createCollapse();
    many.add(
      records(
        1,
        Array.from({ length: CHANGE_CAP }, (_, n) => id(1000 + n)),
      ),
    );
    expect(many.events()[0]).not.toHaveProperty('coarse');
    many.add(records(2, [id(1)]));
    many.add(records(3, [id(2)]));
    expect(many.events()).toEqual([
      expect.objectContaining({ seq: 3, recordIds: [], attributeIds: [id(4)], coarse: true }),
    ]);

    const joined = createCollapse();
    joined.add(records(1, [id(1)]));
    joined.add(records(2, [], { coarse: true }));
    joined.add(records(3, [id(3)]));
    expect(joined.events()).toEqual([expect.objectContaining({ seq: 3, recordIds: [], coarse: true })]);
  });

  it('refetches a whole definitions set when any merged row named none', () => {
    const collapse = createCollapse();
    collapse.add({ seq: 1, at, kind: 'definitions', objectId: OBJECT, attributeIds: [id(4)] });
    collapse.add({ seq: 2, at, kind: 'definitions', objectId: OBJECT });
    expect(collapse.events()).toEqual([{ seq: 2, at, kind: 'definitions', objectId: OBJECT }]);
  });
});

describe('liveEvent, what the relay publishes on workspace:<id>', () => {
  it('passes a records or definitions row whole, with its mutation id', () => {
    const records = row({ objectId: OBJECT, recordIds: [id(3)], attributeIds: [id(4)], mutationId: id(9) });
    expect(liveEvent(records)).toEqual(outboxEvent(records));
    const definitions = row({ kind: 'definitions', objectId: OBJECT, attributeIds: [id(4)] });
    expect(liveEvent(definitions)).toEqual(outboxEvent(definitions));
  });

  it('never names a job, its starter or its mutation id to the whole workspace', () => {
    const job = liveEvent(row({ kind: 'jobs', itemIds: [id(1)], actorMemberId: id(5), mutationId: id(9) }));
    expect(job).toEqual({ seq: 1, at, kind: 'jobs', jobIds: [], coarse: true });
  });

  it('names no private view or task it can’t judge, and sends the stub for a malformed row', () => {
    expect(liveEvent(row({ kind: 'views', objectId: OBJECT, itemIds: [id(1)] }))).toMatchObject({
      viewIds: [],
      coarse: true,
    });
    expect(liveEvent(row({ kind: 'tasks', itemIds: [id(1)], recordIds: [id(2)] }))).toMatchObject({
      taskIds: [],
      recordIds: [],
      coarse: true,
    });
    expect(liveEvent(row({ kind: 'records', seq: 4 }))).toEqual({ seq: 4, at, kind: 'restricted' });
  });
});
