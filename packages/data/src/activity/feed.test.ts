// A record's timeline in the browser (spec 0017, milestone 2) against a fake
// API answered by hand: the mapping (changes, link entries, who did it),
// paging as the feed scrolls, the head refresh's coalescing (two reads a
// second at most), the merge by key, the gap reset, this tab's own writes,
// a definitions reset, and a change while nobody shows the feed.
import type { ActivityItem, AttributeDefinition, MemberSummary, RecordActivity } from '@crm/contracts';
import { activityKey } from '@crm/contracts/activity-keys';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_REFRESH_MS, createActivityFeeds, mergeHead, toActivityEntry } from './feed.ts';

const WS = 'acme';
const RECORD = '0199a6f2-0000-7000-8000-0000000000aa';
const OBJECT = '0199a6f2-0000-7000-8000-0000000000bb';
const ADA = '0199a6f2-0000-7000-8000-000000000001';
const GONE = '0199a6f2-0000-7000-8000-000000000009';
const TITLE = '0199a6f2-0000-7000-8000-0000000000c1';
const TEAM = '0199a6f2-0000-7000-8000-0000000000c2';
const COMPANY = '0199a6f2-0000-7000-8000-0000000000c3';

const MEMBERS: readonly MemberSummary[] = [{ id: ADA, name: 'Ada Lovelace', email: 'ada@example.com' }];

const definition = (id: string, title: string, type: AttributeDefinition['type'], isMulti = false) =>
  ({
    id,
    objectId: OBJECT,
    apiSlug: title.toLowerCase(),
    title,
    type,
    isMulti,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    config: {},
    position: 0,
  }) as unknown as AttributeDefinition;

const DEFINITIONS = [
  definition(TITLE, 'Job title', 'text'),
  definition(TEAM, 'Team', 'record_reference', true),
  definition(COMPANY, 'Company', 'record_reference'),
];

/** The moment of entry `n`: later entries are newer. */
const at = (n: number) =>
  `2026-10-08T10:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000001Z`;

/** A value change numbered `n`, by Ada. */
const change = (n: number, to = `T${String(n)}`): ActivityItem => ({
  id: `value:${TITLE}:${String(n)}`,
  key: activityKey({ at: at(n), rank: 2, id: `value:${TITLE}:${String(n)}` }),
  at: `${at(n).slice(0, 23)}Z`,
  actor: { type: 'member', id: ADA },
  kind: 'change',
  attributeId: TITLE,
  from: null,
  to,
});

const display = (n: number) => ({
  objectId: OBJECT,
  recordId: `0199a6f2-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`,
  name: `P${String(n)}`,
  kind: 'person' as const,
});

const created: ActivityItem = {
  id: `created:${RECORD}`,
  key: activityKey({ at: at(0), rank: 9, id: `created:${RECORD}` }),
  at: `${at(0).slice(0, 23)}Z`,
  actor: { type: 'member', id: GONE },
  kind: 'created',
};

/** A server holding `items`, newest first, answering pages of `size` with an index as the cursor. */
function server(initial: readonly ActivityItem[], size = 50) {
  let items = [...initial];
  const calls: (string | undefined)[] = [];
  const pending: (() => void)[] = [];
  let held = false;
  const page = (_workspace: string, _recordId: string, cursor?: string): Promise<RecordActivity> => {
    calls.push(cursor);
    const sorted = [...items].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    const from = cursor === undefined ? 0 : Number(cursor);
    const entries = sorted.slice(from, from + size);
    const answer = {
      entries,
      ...(from + size < sorted.length ? { nextCursor: String(from + size) } : {}),
    };
    if (!held) return Promise.resolve(answer);
    return new Promise((resolve) => pending.push(() => resolve(answer)));
  };
  return {
    page,
    calls,
    set: (next: readonly ActivityItem[]) => {
      items = [...next];
    },
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      for (const run of pending.splice(0)) run();
    },
  };
}

/** A clock and timers run by hand. */
function clock() {
  let now = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  return {
    now: () => now,
    later: (run: () => void, ms: number) => {
      const timer = { at: now + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    advance: (ms: number) => {
      now += ms;
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue;
        if (timer.at <= now) timer.run();
        else timers.push(timer);
      }
    },
  };
}

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(items: readonly ActivityItem[], size?: number) {
  const api = server(items, size);
  const time = clock();
  const feeds = createActivityFeeds({
    page: api.page,
    members: () => Promise.resolve(MEMBERS),
    attributes: () => Promise.resolve(DEFINITIONS),
    later: time.later,
    now: time.now,
  });
  const feed = feeds.forRecord(WS, RECORD, OBJECT);
  const release = feed.retain();
  return { api, time, feeds, feed, release, ids: () => feed.getSnapshot().entries.map((entry) => entry.id) };
}

describe('mapping (spec 0017, AC-378, AC-379, AC-382)', () => {
  it('maps changes and link entries with their attribute, and names who did it', () => {
    const context = { members: MEMBERS, attributes: new Map(DEFINITIONS.map((each) => [each.id, each])) };
    const links: ActivityItem = {
      id: `links:${TEAM}:x`,
      key: activityKey({ at: at(5), rank: 1, id: `links:${TEAM}:x` }),
      at: `${at(5).slice(0, 23)}Z`,
      actor: { type: 'api_key', id: GONE },
      kind: 'links',
      attributeId: TEAM,
      added: [display(1), display(2), display(3)],
      addedCount: 100,
      removed: [],
      removedCount: 0,
    };
    expect(toActivityEntry(links, context)).toMatchObject({
      kind: 'links',
      actor: { type: 'api_key', name: 'An API key' },
      attribute: { id: TEAM, name: 'Team', type: 'record_reference' },
      added: [{ display: display(1) }, { display: display(2) }, { display: display(3) }],
      addedCount: 100,
      removedCount: 0,
    });
    const moved: ActivityItem = {
      ...change(6),
      id: `links:${COMPANY}:y`,
      attributeId: COMPANY,
      actor: { type: 'system', id: null },
      from: { objectId: OBJECT, recordId: display(1).recordId },
      to: null,
      fromRefs: [display(1)],
      toRefs: [],
    };
    expect(toActivityEntry(moved, context)).toMatchObject({
      kind: 'change',
      actor: { type: 'system', name: 'System' },
      fromDisplay: display(1),
      to: null,
    });
    expect(toActivityEntry(moved, context)).not.toHaveProperty('toDisplay');
    expect(toActivityEntry(created, context)).toMatchObject({ actor: { name: 'Former member' } });
    expect(toActivityEntry({ ...change(7), actor: { type: 'automation', id: GONE } }, context)?.actor.name).toBe(
      'An automation',
    );
    // An attribute the definitions don't hold (archived since), and a kind this client can't draw: left out.
    expect(toActivityEntry({ ...change(8), attributeId: GONE }, context)).toBeUndefined();
    expect(toActivityEntry({ ...change(9), kind: 'comment' }, context)).toBeUndefined();
  });
});

describe('paging as the feed scrolls (spec 0017, AC-380)', () => {
  it('reads the next page near the end, with one entry still loading past the loaded ones', async () => {
    const items = [created, ...Array.from({ length: 120 }, (_, index) => change(index + 1))];
    const { api, feed, ids } = setup(items);
    await flush();
    const first = feed.getSnapshot();
    expect(first.entries).toHaveLength(50);
    expect(first.source.count).toBe(51);
    expect(first.source.getItem(50)).toBeUndefined();
    first.source.onRangeChange?.({ start: 0, end: 20 });
    expect(api.calls).toEqual([undefined]);
    first.source.onRangeChange?.({ start: 30, end: 45 });
    first.source.onRangeChange?.({ start: 31, end: 46 });
    await flush();
    expect(api.calls).toEqual([undefined, '50']);
    feed.getSnapshot().source.onRangeChange?.({ start: 90, end: 100 });
    await flush();
    expect(ids()).toHaveLength(121);
    expect(feed.getSnapshot().hasMore).toBe(false);
    expect(feed.getSnapshot().source.count).toBe(121);
    expect(ids().at(-1)).toBe(created.id);
    expect(new Set(ids()).size).toBe(121);
  });
});

describe('the head refresh (spec 0017, AC-381)', () => {
  it('reads at once, then at most once more after 500 ms however many changes arrive', async () => {
    const { api, feeds, time } = setup([created, change(1)]);
    await flush();
    expect(api.calls).toHaveLength(1);
    for (let index = 0; index < 10; index += 1) feeds.changed(WS, { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(api.calls).toHaveLength(2);
    time.advance(ACTIVITY_REFRESH_MS);
    await flush();
    expect(api.calls).toHaveLength(3);
    time.advance(ACTIVITY_REFRESH_MS);
    await flush();
    expect(api.calls).toHaveLength(3);
    // Another record's change, and another object's coarse one, read nothing.
    feeds.changed(WS, { objectId: OBJECT, recordIds: [GONE] });
    feeds.changed(WS, { objectId: GONE, recordIds: [], coarse: true });
    feeds.changed('other', { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(api.calls).toHaveLength(3);
    // A coarse change of the record's object does.
    feeds.changed(WS, { objectId: OBJECT, recordIds: [], coarse: true });
    await flush();
    expect(api.calls).toHaveLength(4);
  });

  it('merges by key: a new entry on top, a changed one updated, and one gone from the first page left out', async () => {
    const { api, feeds, ids, feed } = setup([created, change(1), change(2), change(3)]);
    await flush();
    expect(ids()).toEqual([change(3).id, change(2).id, change(1).id, created.id]);
    api.set([created, change(1, 'Renamed'), change(3), change(4)]);
    feeds.changed(WS, { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(ids()).toEqual([change(4).id, change(3).id, change(1).id, created.id]);
    const updated = feed.getSnapshot().entries.find((entry) => entry.id === change(1).id);
    expect(updated).toMatchObject({ to: 'Renamed' });
  });

  it('keeps older pages behind a first page that overlaps them, and drops everything past a gap', () => {
    const held = (n: number) => ({ key: change(n).key, entry: { id: change(n).id } as never });
    const loaded = [held(9), held(8), held(7), held(6), held(5)];
    // The first page now reaches down to 7: 6 and 5 stay, with the old cursor.
    const overlap = mergeHead(loaded, 'tail', [held(10), held(9), held(8), held(7)], 'page');
    expect(overlap.held.map((each) => each.key)).toEqual([10, 9, 8, 7, 6, 5].map((n) => change(n).key));
    expect(overlap.cursor).toBe('tail');
    // More than a page arrived: everything held is older than the page's last entry, so only the page stays.
    const gap = mergeHead(loaded, 'tail', [held(14), held(13), held(12)], 'page');
    expect(gap.held.map((each) => each.key)).toEqual([14, 13, 12].map((n) => change(n).key));
    expect(gap.cursor).toBe('page');
    // A page with no cursor is the whole timeline.
    expect(mergeHead(loaded, 'tail', [held(9)], undefined)).toEqual({ held: [held(9)], cursor: undefined });
  });

  it('reads again when this tab writes, and waits for a screen when nobody shows the feed', async () => {
    const { api, feeds, release, feed, ids, time } = setup([created]);
    await flush();
    api.set([created, change(1)]);
    feeds.ownWrite(WS);
    await flush();
    expect(ids()).toEqual([change(1).id, created.id]);
    expect(api.calls).toHaveLength(2);
    release();
    api.set([created, change(1), change(2)]);
    feeds.changed(WS, { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(api.calls).toHaveLength(2);
    feed.retain();
    // Within half a second of the last read it waits for the cool down.
    time.advance(ACTIVITY_REFRESH_MS);
    await flush();
    expect(api.calls).toHaveLength(3);
    expect(ids()[0]).toBe(change(2).id);
  });
});

describe('starting again (spec 0017, 0017-activity.md)', () => {
  it('a definitions change and a resync read the first page afresh, keeping the entries shown until it lands', async () => {
    const { api, feeds, ids, feed } = setup([created, change(1), change(2)]);
    await flush();
    api.set([created, change(2)]);
    api.hold();
    feeds.definitionsChanged(WS, OBJECT);
    expect(ids()).toHaveLength(3);
    expect(feed.getSnapshot().status).toBe('ready');
    api.release();
    await flush();
    expect(ids()).toEqual([change(2).id, created.id]);
    // Another object's definitions leave it alone.
    feeds.definitionsChanged(WS, GONE);
    await flush();
    expect(api.calls).toHaveLength(2);
    feeds.resync(WS);
    await flush();
    expect(api.calls).toHaveLength(3);
  });

  it('shares the first page with Recent activity, cut to five', async () => {
    const { api, feeds } = setup([created, ...Array.from({ length: 8 }, (_, index) => change(index + 1))]);
    const recent = feeds.recent(WS, RECORD, OBJECT);
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(recent.getSnapshot().entries).toHaveLength(5);
    expect(recent.getSnapshot().source.count).toBe(5);
    expect(recent.getSnapshot().hasMore).toBe(true);
  });
});
