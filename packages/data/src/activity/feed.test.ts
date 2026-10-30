// A record's timeline in the browser (spec 0017, milestone 2) against a fake
// API answered by hand: the mapping (changes, link entries, who did it),
// paging as the feed scrolls, the head refresh's coalescing (two reads a
// second at most), the merge by key, the gap reset, this tab's own writes,
// a definitions reset, and a change while nobody shows the feed.
import type { ActivityItem, AttributeDefinition, MemberSummary, RecordActivity } from '@crm/contracts';
import { activityKey } from '@crm/contracts/activity-keys';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_REFRESH_MS,
  createActivityFeeds,
  groupChanges,
  mergeHead,
  toActivityEntry,
  type ActivityEntryShape,
} from './feed.ts';

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
  const failures: string[] = [];
  const page = (_workspace: string, _recordId: string, cursor?: string): Promise<RecordActivity> => {
    calls.push(cursor);
    const failing = failures.shift();
    if (failing !== undefined) {
      return Promise.reject(Object.assign(new Error('refused'), { name: 'DataError', code: failing }));
    }
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
    /** The next calls fail with these codes, in order. */
    failNext: (...codes: string[]) => {
      failures.push(...codes);
    },
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
    // A task (spec 0019): its id, title, and whether this is its completion.
    const taskId = '0199a6f2-0000-7000-8000-0000000009aa';
    const { attributeId: _attribute, from: _from, to: _to, ...plain } = change(10);
    expect(
      toActivityEntry({ ...plain, kind: 'task', itemId: taskId, title: 'Call back', isDone: true }, context),
    ).toMatchObject({ kind: 'task', itemId: taskId, title: 'Call back', isDone: true });
    expect(toActivityEntry({ ...plain, kind: 'task', title: 'No id' }, context)).toBeUndefined();
    // A meeting (spec 0024): its time, attendees (a person's chip, a member named from the list, an address), link.
    const meetingId = '0199a6f2-0000-7000-8000-0000000009bb';
    const person = { objectId: OBJECT, recordId: RECORD, name: 'Bea', kind: 'person' as const };
    const meeting = {
      id: meetingId,
      title: 'Intro',
      startsAt: '2026-10-20T09:00:00.000Z',
      endsAt: '2026-10-20T09:30:00.000Z',
      allDay: false,
      status: 'confirmed' as const,
      isPrivate: false,
      detailsHidden: false,
      videoUrl: 'https://meet.google.com/x',
      attendees: [
        {
          email: 'ada@example.com',
          response: 'accepted' as const,
          isOrganizer: true,
          match: 'member' as const,
          memberId: ADA,
        },
        {
          email: 'bea@globex.com',
          response: 'tentative' as const,
          isOrganizer: false,
          match: 'linked' as const,
          person,
        },
        {
          email: 'new@initech.com',
          name: 'New',
          response: 'needs_action' as const,
          isOrganizer: false,
          match: 'unknown' as const,
        },
      ],
    };
    expect(toActivityEntry({ ...plain, kind: 'meeting', itemId: meetingId, title: 'Intro', meeting }, context)).toEqual(
      {
        id: plain.id,
        at: plain.at,
        actor: expect.anything() as unknown,
        kind: 'meeting',
        itemId: meetingId,
        title: 'Intro',
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        allDay: false,
        attendees: [
          {
            email: 'ada@example.com',
            display: { type: 'member', id: ADA, name: 'Ada Lovelace', email: 'ada@example.com' },
            response: 'accepted',
            match: 'member',
          },
          { email: 'bea@globex.com', display: person, response: 'tentative', match: 'linked' },
          { email: 'new@initech.com', name: 'New', response: 'needs_action', match: 'unknown' },
        ],
        videoUrl: 'https://meet.google.com/x',
        detailsHidden: false,
      },
    );
    expect(toActivityEntry({ ...plain, kind: 'meeting', itemId: meetingId }, context)).toBeUndefined();
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

describe('watching (spec 0017, AC-381)', () => {
  it('listens to the workspace while a screen shows the feed, and stops when none does', async () => {
    const watched: string[] = [];
    let stopped = 0;
    const feeds = createActivityFeeds({
      page: server([created]).page,
      members: () => Promise.resolve(MEMBERS),
      attributes: () => Promise.resolve(DEFINITIONS),
      watch: (workspace) => {
        watched.push(workspace);
        return () => {
          stopped += 1;
        };
      },
      later: clock().later,
    });
    const feed = feeds.forRecord(WS, RECORD, OBJECT);
    expect(watched).toEqual([]);
    const first = feed.retain();
    const second = feeds.recent(WS, RECORD, OBJECT).retain();
    await flush();
    expect(watched).toEqual([WS]);
    first();
    expect(stopped).toBe(0);
    second();
    expect(stopped).toBe(1);
  });
});

describe('starting again (spec 0017, 0017-activity.md)', () => {
  it('a definitions change and a resync read the first page afresh, keeping the entries shown until it lands', async () => {
    const { api, feeds, ids, feed, time } = setup([created, change(1), change(2)]);
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
    // Within half a second of the last read it waits for the cool down, as a change does.
    time.advance(ACTIVITY_REFRESH_MS);
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

describe('the reviews of milestone 2', () => {
  it('brings back a handle let go of before a screen retained it, and keeps it live', async () => {
    const api = server([created]);
    const time = clock();
    const feeds = createActivityFeeds({
      page: api.page,
      members: () => Promise.resolve(MEMBERS),
      attributes: () => Promise.resolve(DEFINITIONS),
      later: time.later,
      now: time.now,
    });
    const feed = feeds.forRecord(WS, RECORD, OBJECT);
    await flush();
    // A definitions change while the route was loading lets it go.
    feeds.definitionsChanged(WS, OBJECT);
    api.set([created, change(1)]);
    feed.retain();
    await flush();
    expect(feed.getSnapshot().entries.map((entry) => entry.id)).toEqual([change(1).id, created.id]);
    api.set([created, change(1), change(2)]);
    time.advance(ACTIVITY_REFRESH_MS);
    feeds.changed(WS, { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(feed.getSnapshot().entries[0]?.id).toBe(change(2).id);
  });

  it('never lets an older first page replace a newer one', async () => {
    const { api, feeds, ids, feed } = setup([created]);
    await flush();
    // Try again starts a first page that is held back; a change's read goes out after it and answers first.
    api.hold();
    feed.retry();
    api.release();
    api.set([created, change(1), change(2)]);
    feeds.changed(WS, { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(ids()[0]).toBe(change(2).id);
  });

  it('coalesces a burst of definition changes, and replaces what is held', async () => {
    const { api, feeds, ids, time } = setup([created, change(1), change(2)]);
    await flush();
    api.set([created, change(2)]);
    for (let index = 0; index < 10; index += 1) feeds.definitionsChanged(WS, OBJECT);
    await flush();
    time.advance(ACTIVITY_REFRESH_MS);
    await flush();
    expect(api.calls).toHaveLength(3);
    expect(ids()).toEqual([change(2).id, created.id]);
  });

  it('waits while the tab is hidden, and reads when it is shown again', async () => {
    let hidden = false;
    const api = server([created]);
    const feeds = createActivityFeeds({
      page: api.page,
      members: () => Promise.resolve(MEMBERS),
      attributes: () => Promise.resolve(DEFINITIONS),
      isHidden: () => hidden,
      later: clock().later,
    });
    const feed = feeds.forRecord(WS, RECORD, OBJECT);
    feed.retain();
    await flush();
    hidden = true;
    api.set([created, change(1)]);
    feeds.changed(WS, { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(api.calls).toHaveLength(1);
    hidden = false;
    feeds.shown();
    await flush();
    expect(api.calls).toHaveLength(2);
    expect(feed.getSnapshot().entries[0]?.id).toBe(change(1).id);
  });

  it('tries a failed page again, waiting longer each time, while the feed is shown', async () => {
    const items = [created, ...Array.from({ length: 60 }, (_, index) => change(index + 1))];
    const { api, feed, time } = setup(items);
    await flush();
    api.failNext('API_UNAVAILABLE', 'API_UNAVAILABLE');
    feed.getSnapshot().source.onRangeChange?.({ start: 40, end: 51 });
    await flush();
    expect(api.calls).toEqual([undefined, '50']);
    time.advance(2_000);
    await flush();
    expect(api.calls).toEqual([undefined, '50', '50']);
    time.advance(2_000);
    await flush();
    expect(api.calls).toHaveLength(3);
    time.advance(2_000);
    await flush();
    expect(api.calls).toHaveLength(4);
    expect(feed.getSnapshot().entries).toHaveLength(61);
  });

  it('drops what it showed when the record goes out of reach', async () => {
    const { api, feeds, feed, time } = setup([created, change(1)]);
    await flush();
    time.advance(ACTIVITY_REFRESH_MS);
    api.failNext('NOT_FOUND');
    feeds.changed(WS, { objectId: OBJECT, recordIds: [RECORD] });
    await flush();
    expect(feed.getSnapshot()).toMatchObject({ status: 'unavailable', entries: [] });
  });

  it('reads on past a page that drew nothing', async () => {
    const unknown = { ...change(9), attributeId: GONE };
    const { api, ids } = setup([created, change(1), unknown], 1);
    await flush();
    // The first page holds only the entry it can't draw; the next one comes without a scroll.
    expect(api.calls.slice(0, 2)).toEqual([undefined, '1']);
    expect(ids()[0]).toBe(change(1).id);
  });
});

describe('threads, the trash and grouped changes (the flow pass of 30 Oct 2026)', () => {
  const context = {
    members: [{ id: ADA, name: 'Ada Lovelace', email: 'ada@example.com' }] as unknown as readonly MemberSummary[],
    attributes: new Map(DEFINITIONS.map((each) => [each.id, each])),
  };
  const { attributeId: _attribute, from: _from, to: _to, ...plain } = change(1);

  it('names a thread’s mentions, and reads the trash entry', () => {
    const thread = '0199a6f2-0000-7000-8000-0000000009cc';
    expect(
      toActivityEntry(
        { ...plain, kind: 'comment', itemId: thread, excerpt: `<@${ADA}> and <@${GONE}>, see this` },
        context,
      ),
    ).toMatchObject({ kind: 'comment', itemId: thread, excerpt: '@Ada Lovelace and @Former member, see this' });
    expect(toActivityEntry({ ...plain, kind: 'deleted' }, context)).toMatchObject({ kind: 'deleted' });
  });

  it('groups one actor’s changes in the same second into one entry, and leaves the rest alone', () => {
    const entry = (id: string, at: string, actor = ADA): ActivityEntryShape => {
      const mapped = toActivityEntry({ ...change(2), id, at, actor: { type: 'member', id: actor } }, context);
      if (mapped === undefined) throw new Error('Not mapped.');
      return mapped;
    };
    const a = entry('a', '2026-10-08T10:00:01.900Z');
    const b = entry('b', '2026-10-08T10:00:01.100Z');
    const c = entry('c', '2026-10-08T10:00:01.050Z', GONE);
    const d = entry('d', '2026-10-08T10:00:00.900Z');
    const grouped = groupChanges([a, b, c, d]);
    expect(grouped.map((each) => each.kind)).toEqual(['changes', 'change', 'change']);
    expect(grouped[0]).toMatchObject({ id: 'changes:b', at: a.at, changes: [a, b] });
    expect(groupChanges([a])).toEqual([a]);
  });
});
