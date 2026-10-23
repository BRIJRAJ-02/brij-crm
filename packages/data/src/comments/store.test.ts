// The comments store and the inbox against fake APIs answered by hand and a
// hand run clock (spec 0038): a thread shows oldest first, a new comment shows
// at once as sending and lands, a refusal takes it back for the composer, an
// edit or a reaction rolls back with a toast, a delete leaves a placeholder,
// resolve moves a thread and its counts, a live event rereads only the named
// threads of held records, and a link reveals a resolved thread. The inbox's
// marks show at once, move the unread count and roll back; the count reads
// once for a burst of events, and never once signed out.
import type { NotificationView, ThreadPage, ThreadView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { createInboxStore, type InboxApi } from '../inbox/store.ts';
import { createUnreadCounts, UNREAD_COALESCE_MS } from '../inbox/unread.ts';
import { createMutationLog } from '../live/mutations.ts';
import { createCommentsStore, type CommentsApi } from './store.ts';

const WS = 'acme';
const RECORD = '0199a6f2-0000-7000-8000-0000000000a1';
const ME = '0199a6f2-0000-7000-8000-000000000001';
const BEA = '0199a6f2-0000-7000-8000-000000000002';

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function clock() {
  const timers: { work: () => void; at: number; live: boolean }[] = [];
  let now = 0;
  return {
    later: (work: () => void, ms: number) => {
      const timer = { work, at: now + ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    async advance(ms: number) {
      now += ms;
      for (const timer of timers.filter((t) => t.live && t.at <= now)) {
        timer.live = false;
        timer.work();
      }
      await flush();
    },
  };
}

let seq = 0;
const id = () => {
  seq += 1;
  return `0199a6f2-0000-7000-8000-${String(seq).padStart(12, '0')}`;
};

const thread = (threadId: string, bodies: readonly string[], resolved = false): ThreadView => ({
  id: threadId,
  recordId: RECORD,
  earlierCount: 0,
  ...(resolved ? { resolvedAt: '2026-10-21T10:00:00.000Z', resolvedBy: { type: 'member' as const, id: BEA } } : {}),
  comments: bodies.map((body, index) => ({
    id: index === 0 ? threadId : `${threadId.slice(0, -3)}${String(900 + index)}`,
    threadId,
    isDeleted: false,
    body,
    createdBy: { type: 'member' as const, id: ME },
    createdAt: `2026-10-21T10:0${String(index)}:00.000Z`,
    version: 1,
    reactions: [],
    canEdit: true,
    canDelete: true,
  })),
});

function commentsSetup(seed: { open: ThreadView[]; resolved?: ThreadView[] }) {
  const time = clock();
  const notices: string[] = [];
  const open = [...seed.open];
  const resolved = [...(seed.resolved ?? [])];
  let refuse: string | undefined;
  const gets: (readonly string[])[] = [];
  const page = (threads: ThreadView[], withCounts: boolean): ThreadPage => ({
    threads: [...threads].reverse(),
    ...(withCounts ? { counts: { open: open.length, resolved: resolved.length } } : {}),
  });
  const fail = () => {
    if (refuse === undefined) return undefined;
    const message = refuse;
    refuse = undefined;
    return Promise.reject(dataError('FORBIDDEN', message));
  };
  const api: CommentsApi = {
    list: (input) => Promise.resolve(page(input.resolved === true ? resolved : open, input.resolved !== true)),
    get: (input) => {
      gets.push(input.threadIds);
      return Promise.resolve([...open, ...resolved].filter((t) => input.threadIds.includes(t.id)));
    },
    create: (input) =>
      fail() ??
      Promise.resolve(
        input.threadId === undefined
          ? thread(input.id, [input.body])
          : { ...thread(input.threadId, ['First', input.body]) },
      ),
    update: (input) => fail() ?? Promise.resolve(thread(input.commentId, [input.body])),
    delete: (input) => fail() ?? Promise.resolve({ threadId: input.commentId }),
    resolve: (input) => fail() ?? Promise.resolve(thread(input.threadId, ['Question'], input.resolved)),
    react: (input) => fail() ?? Promise.resolve(thread(input.commentId, ['Question'])),
    versions: () => Promise.resolve([]),
  };
  const store = createCommentsStore({
    api,
    mintId: id,
    mutations: createMutationLog(),
    notify: (notice) => notices.push(notice.message),
    watch: () => () => undefined,
    later: time.later,
    random: () => 0,
  });
  return {
    store,
    notices,
    time,
    gets,
    refuseNext: (message: string) => {
      refuse = message;
    },
    server: { open, resolved },
  };
}

describe('the comments store', () => {
  it('shows threads oldest first with their counts, and a new comment at once as sending', async () => {
    const first = id();
    const second = id();
    const t = commentsSetup({ open: [thread(first, ['One']), thread(second, ['Two'])] });
    const held = t.store.forRecord(WS, RECORD);
    held.retain();
    await flush();
    expect(held.getSnapshot().open.map((x) => x.id)).toEqual([first, second]);
    expect(held.getSnapshot().openCount).toBe(2);
    const sent = t.store.create(WS, RECORD, { body: 'Three', authorId: ME });
    const shown = held.getSnapshot().open.at(-1);
    expect(shown?.comments[0]).toMatchObject({ body: 'Three', isSending: true });
    expect(held.getSnapshot().openCount).toBe(3);
    expect(await sent).toBeUndefined();
    expect(held.getSnapshot().open.at(-1)?.comments[0]?.isSending).toBeUndefined();
  });

  it('takes a refused comment back for the composer, and puts a refused edit back with a toast', async () => {
    const first = id();
    const t = commentsSetup({ open: [thread(first, ['Question'])] });
    const held = t.store.forRecord(WS, RECORD);
    held.retain();
    await flush();
    t.refuseNext('No.');
    const refused = await t.store.create(WS, RECORD, { body: 'Nope', authorId: ME });
    expect(refused?.message).toBe('No.');
    expect(held.getSnapshot().open).toHaveLength(1);
    expect(held.getSnapshot().openCount).toBe(1);
    expect(t.notices).toEqual([]);
    t.refuseNext('Not yours.');
    const editing = t.store.edit(WS, RECORD, first, 'Changed');
    expect(held.getSnapshot().open[0]?.comments[0]?.body).toBe('Changed');
    await editing;
    expect(held.getSnapshot().open[0]?.comments[0]?.body).toBe('Question');
    expect(t.notices).toEqual(['Your edit wasn’t saved. Not yours.']);
  });

  it('leaves a placeholder for a deleted comment with live replies, and drops a thread with none', async () => {
    const first = id();
    const lonely = id();
    const t = commentsSetup({ open: [thread(first, ['Question', 'Answer']), thread(lonely, ['Alone'])] });
    const held = t.store.forRecord(WS, RECORD);
    held.retain();
    await flush();
    await t.store.remove(WS, RECORD, first);
    expect(held.getSnapshot().open[0]?.comments[0]).toMatchObject({ isDeleted: true, body: '' });
    await t.store.remove(WS, RECORD, lonely);
    expect(held.getSnapshot().open.map((x) => x.id)).toEqual([first]);
    expect(held.getSnapshot().openCount).toBe(1);
  });

  it('moves a resolved thread out of the open ones, and reveals it for a link', async () => {
    const first = id();
    const old = id();
    const t = commentsSetup({ open: [thread(first, ['Question'])], resolved: [thread(old, ['Done'], true)] });
    const held = t.store.forRecord(WS, RECORD);
    held.retain();
    await flush();
    expect(held.getSnapshot().resolvedCount).toBe(1);
    await t.store.resolve(WS, RECORD, first, true);
    expect(held.getSnapshot().open).toEqual([]);
    expect(held.getSnapshot().openCount).toBe(0);
    expect(held.getSnapshot().resolvedCount).toBe(2);
    expect(await held.reveal(old)).toBe('resolved');
    expect(held.getSnapshot().resolved?.map((x) => x.id)).toContain(old);
    expect(await held.reveal(id())).toBe('missing');
  });

  it('rereads only the named threads of held records on a live event, gathered once', async () => {
    const first = id();
    const t = commentsSetup({ open: [thread(first, ['Question'])] });
    const held = t.store.forRecord(WS, RECORD);
    held.retain();
    await flush();
    t.server.open[0] = thread(first, ['Question', 'A reply from Bea']);
    const event = {
      seq: 2,
      at: '2026-10-21T10:00:00.000Z',
      kind: 'comments' as const,
      recordIds: [RECORD],
      threadIds: [first],
    };
    t.store.changed(WS, event);
    t.store.changed(WS, { ...event, seq: 3 });
    t.store.changed(WS, { ...event, seq: 4, recordIds: ['0199a6f2-0000-7000-8000-0000000000ff'] });
    await t.time.advance(100);
    expect(t.gets).toEqual([[first]]);
    expect(held.getSnapshot().open[0]?.comments.map((c) => c.body)).toEqual(['Question', 'A reply from Bea']);
  });
});

const item = (notificationId: string, read = false): NotificationView => ({
  id: notificationId,
  kind: 'mention',
  actor: { type: 'member', id: BEA },
  createdAt: '2026-10-21T10:00:00.000Z',
  ...(read ? { readAt: '2026-10-21T10:01:00.000Z' } : {}),
  threadId: notificationId,
  commentId: notificationId,
  excerpt: 'Hello',
});

describe('the inbox and its count', () => {
  it('marks at once, moves the count, and rolls back with a toast on a refusal', async () => {
    const time = clock();
    const notices: string[] = [];
    const items = [item(id()), item(id())];
    let counts = 0;
    let refuse = false;
    const api: InboxApi = {
      list: () => Promise.resolve({ items }),
      mark: () => (refuse ? Promise.reject(dataError('NOT_FOUND', 'Gone.')) : Promise.resolve({ changed: 1 })),
      markAllRead: () => Promise.resolve({ changed: 2 }),
      settings: () =>
        Promise.resolve({
          emailMentions: true,
          emailReplies: false,
          emailAssignments: true,
          digest: false,
          version: 0,
        }),
      setSettings: () => Promise.reject(dataError('INPUT_INVALID', 'Bad.')),
    };
    const unread = createUnreadCounts({
      read: () => {
        counts += 1;
        return Promise.resolve({ count: 2, atLeast: false });
      },
      watch: () => () => undefined,
      later: time.later,
    });
    const source = unread.unread(WS);
    source.retain();
    await flush();
    expect(source.getSnapshot()).toBe(2);
    const store = createInboxStore({
      api,
      mintId: id,
      mutations: createMutationLog(),
      notify: (notice) => notices.push(notice.message),
      watch: () => () => undefined,
      unread,
      later: time.later,
    });
    const list = store.list(WS, { status: 'inbox' });
    list.retain();
    await flush();
    const [a] = list.getSnapshot().items;
    if (a === undefined) throw new Error('An item expected.');
    const marking = store.mark(WS, [a.id], { read: true });
    expect(list.getSnapshot().items[0]?.readAt).toBeDefined();
    expect(source.getSnapshot()).toBe(1);
    await marking;
    refuse = true;
    const unreadOnly = store.list(WS, { status: 'inbox', unreadOnly: true });
    unreadOnly.retain();
    await flush();
    await store.mark(WS, [a.id], { done: true });
    expect(list.getSnapshot().items.map((x) => x.id)).toContain(a.id);
    expect(notices).toEqual(['That change to your inbox wasn’t saved. Gone.']);
    // A burst of events reads the count once.
    const before = counts;
    unread.refresh(WS);
    unread.refresh(WS);
    unread.refresh(WS);
    await time.advance(UNREAD_COALESCE_MS);
    expect(counts - before).toBe(1);
  });

  it('rereads only the first page on an event, keeping the rows loaded below it', async () => {
    const time = clock();
    // Newest first: a later minute sorts first.
    const at = (minute: number, notificationId: string): NotificationView => ({
      ...item(notificationId),
      createdAt: `2026-10-21T10:${String(minute).padStart(2, '0')}:00.000Z`,
    });
    let rows = [at(50, id()), at(40, id()), at(30, id()), at(20, id())];
    const calls: (string | undefined)[] = [];
    const api: InboxApi = {
      list: (input) => {
        calls.push(input.cursor);
        const start = input.cursor === undefined ? 0 : Number(input.cursor);
        const page = rows.slice(start, start + 2);
        return Promise.resolve({
          items: page,
          ...(start + 2 < rows.length ? { nextCursor: String(start + 2) } : {}),
        });
      },
      mark: () => Promise.resolve({ changed: 1 }),
      markAllRead: () => Promise.resolve({ changed: 0 }),
      settings: () => Promise.reject(dataError('NOT_FOUND', 'Gone.')),
      setSettings: () => Promise.reject(dataError('NOT_FOUND', 'Gone.')),
    };
    const store = createInboxStore({
      api,
      mintId: id,
      mutations: createMutationLog(),
      notify: () => undefined,
      watch: () => () => undefined,
      unread: { adjust: () => undefined, refresh: () => undefined },
      later: time.later,
    });
    const list = store.list(WS, { status: 'inbox' });
    list.retain();
    await flush();
    list.loadMore();
    await flush();
    expect(list.getSnapshot().items).toHaveLength(4);
    // A new one arrives at the top.
    const fresh = at(59, id());
    rows = [fresh, ...rows];
    calls.length = 0;
    store.changed(WS, { kind: 'notifications', seq: 1, at: '2026-10-21T11:00:00.000Z', memberIds: [ME] });
    await time.advance(250);
    expect(calls).toEqual([undefined]);
    const shown = list.getSnapshot();
    expect(shown.items.map((x) => x.createdAt.slice(14, 16))).toEqual(['59', '50', '40', '30', '20']);
    expect(shown.hasMore).toBe(false);
  });

  it('shows 100 for more than 99, and nothing before the first answer', async () => {
    const time = clock();
    let answer = { count: 100, atLeast: true };
    const unread = createUnreadCounts({
      read: () => Promise.resolve(answer),
      watch: () => () => undefined,
      later: time.later,
    });
    const source = unread.unread(WS);
    expect(source.getSnapshot()).toBeUndefined();
    source.retain();
    await flush();
    expect(source.getSnapshot()).toBe(100);
    answer = { count: 0, atLeast: false };
    unread.refresh(WS);
    await time.advance(UNREAD_COALESCE_MS);
    expect(source.getSnapshot()).toBe(0);
  });

  it('asks for nothing once signed out, though the sidebar draws its badge again on its way to sign in', async () => {
    const time = clock();
    let reads = 0;
    let watching = 0;
    const unread = createUnreadCounts({
      read: () => {
        reads += 1;
        return Promise.resolve({ count: 2, atLeast: false });
      },
      watch: () => {
        watching += 1;
        return () => {
          watching -= 1;
        };
      },
      later: time.later,
    });
    const source = unread.unread(WS);
    const release = source.retain();
    await flush();
    expect(reads).toBe(1);
    expect(watching).toBe(1);
    unread.clear();
    // The same count comes back to a screen drawing again, so nothing new is held: no read, no listening, no event.
    expect(unread.unread(WS)).toBe(source);
    unread.refresh(WS);
    await time.advance(UNREAD_COALESCE_MS);
    expect(reads).toBe(1);
    expect(watching).toBe(0);
    // Once the screen lets go, the next session's screen gets a count of its own, which reads.
    release();
    const next = unread.unread(WS);
    expect(next).not.toBe(source);
    next.retain();
    await flush();
    expect(reads).toBe(2);
    expect(next.getSnapshot()).toBe(2);
  });
});
