// The timeline's order and its cursor (spec 0017): keys order newest first,
// then by rank, then by id; the cursor schema refuses anything but its three
// fields.
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_RANKS,
  ActivityCursor,
  ActivityItem,
  activityKey,
  compareActivityKeys,
  parseActivityKey,
  RecordActivityInput,
} from './activity.ts';

const key = (at: string, rank: number, id: string) => activityKey({ at, rank, id });

describe('compareActivityKeys', () => {
  it('orders by moment descending, then rank ascending, then id ascending', () => {
    const keys = [
      key('2026-10-08T10:00:00.000001Z', ACTIVITY_RANKS.created, 'created:a'),
      key('2026-10-08T10:00:00.000002Z', ACTIVITY_RANKS.change, 'value:b'),
      key('2026-10-08T10:00:00.000001Z', ACTIVITY_RANKS.links, 'links:z'),
      key('2026-10-08T10:00:00.000001Z', ACTIVITY_RANKS.change, 'value:b'),
      key('2026-10-08T10:00:00.000001Z', ACTIVITY_RANKS.change, 'value:a'),
    ];
    expect([...keys].sort(compareActivityKeys)).toEqual([
      key('2026-10-08T10:00:00.000002Z', 2, 'value:b'),
      key('2026-10-08T10:00:00.000001Z', 1, 'links:z'),
      key('2026-10-08T10:00:00.000001Z', 2, 'value:a'),
      key('2026-10-08T10:00:00.000001Z', 2, 'value:b'),
      key('2026-10-08T10:00:00.000001Z', 9, 'created:a'),
    ]);
  });

  it('keeps ids holding the separator whole', () => {
    const parts = { at: '2026-10-08T10:00:00.000000Z', rank: 1, id: 'links:a:2026|x' };
    expect(parseActivityKey(activityKey(parts))).toEqual(parts);
    expect(parseActivityKey('nothing')).toBeUndefined();
  });
});

describe('the activity schemas', () => {
  it('takes a cursor of exactly its three fields, with microseconds', () => {
    const cursor = { at: '2026-10-08T10:00:00.123456Z', rank: 9, id: 'created:x' };
    expect(ActivityCursor.safeParse(cursor).success).toBe(true);
    expect(ActivityCursor.safeParse({ ...cursor, extra: 1 }).success).toBe(false);
    expect(ActivityCursor.safeParse({ ...cursor, rank: 10 }).success).toBe(false);
    expect(ActivityCursor.safeParse({ ...cursor, at: '2026-10-08' }).success).toBe(false);
  });

  it('pages 1 to 50 entries, with a cursor of at most 512 characters', () => {
    const base = { workspace: 'acme', recordId: '01a12cf1-eecd-7b0b-8368-53c57d1cc5c8' };
    expect(RecordActivityInput.safeParse({ ...base, limit: 50 }).success).toBe(true);
    expect(RecordActivityInput.safeParse({ ...base, limit: 51 }).success).toBe(false);
    expect(RecordActivityInput.safeParse({ ...base, cursor: 'x'.repeat(513) }).success).toBe(false);
  });

  it('reads a creation entry', () => {
    const entry = {
      id: 'created:x',
      key: key('2026-10-08T10:00:00.123456Z', 9, 'created:x'),
      at: '2026-10-08T10:00:00.123Z',
      actor: { type: 'system', id: null },
      kind: 'created',
    };
    expect(ActivityItem.parse(entry)).toEqual(entry);
  });
});
