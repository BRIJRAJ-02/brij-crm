// The inbox store's Undo (foolproof audit, 5 November 2026): Mark all done answers the notifications it changed
// as they were, and `restore` puts each back exactly (read or not, done or not), at once and on the server.
import { NOTIFICATION_MARK_MAX, type NotificationView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import { createInboxStore, INBOX_MARK_BATCH, type InboxApi } from './store.ts';

const WS = 'acme';
const ACTOR = { type: 'member', id: '0199a6f2-0000-7000-8000-000000000002' } as const;

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

let next = 0;
const id = () => {
  next += 1;
  return `0199a6f2-0000-7000-8000-${String(next).padStart(12, '0')}`;
};

const item = (more: Partial<NotificationView> = {}): NotificationView => ({
  id: id(),
  kind: 'mention',
  actor: ACTOR,
  createdAt: '2026-11-04T10:00:00.000Z',
  excerpt: 'Hi',
  ...more,
});

/** A store over `rows` (the inbox tab), recording each mark sent. */
function storeOver(rows: readonly NotificationView[]) {
  const marks: { readonly ids: readonly string[]; readonly read?: boolean; readonly done?: boolean }[] = [];
  const api: InboxApi = {
    list: () => Promise.resolve({ items: [...rows] }),
    mark: ({ ids, read, done }) => {
      marks.push({ ids, ...(read === undefined ? {} : { read }), ...(done === undefined ? {} : { done }) });
      return Promise.resolve({ changed: ids.length });
    },
    markAllRead: () => Promise.resolve({ changed: rows.length }),
    settings: () => Promise.reject(new Error('unused')),
    setSettings: () => Promise.reject(new Error('unused')),
  };
  const store = createInboxStore({
    api,
    mintId: id,
    mutations: createMutationLog(),
    notify: () => undefined,
    watch: () => () => undefined,
    unread: { adjust: () => undefined, refresh: () => undefined },
    later: () => () => undefined,
  });
  return { store, marks };
}

describe('the inbox’s Undo', () => {
  it('sends at most the contract’s batch in one mark', () => {
    expect(INBOX_MARK_BATCH).toBe(NOTIFICATION_MARK_MAX);
  });

  it('Mark all done answers what it changed, and restore puts each back as it was', async () => {
    const unread = item();
    const read = item({ readAt: '2026-11-04T10:05:00.000Z' });
    const { store, marks } = storeOver([unread, read]);
    const list = store.list(WS, { status: 'inbox' });
    list.retain();
    await flush();

    const marked = await store.markAllRead(WS, 'inbox', undefined, true);
    expect(marked.error).toBeUndefined();
    expect(marked.before.map((each) => each.id).sort()).toEqual([unread.id, read.id].sort());
    // Done leaves the inbox at once.
    expect(list.getSnapshot().items).toEqual([]);

    expect(await store.restore(WS, marked.before)).toBeUndefined();
    // One mark per state to go back to: the unread one unread, the read one read, both back in the inbox.
    expect(marks).toEqual(
      expect.arrayContaining([
        { ids: [unread.id], read: false, done: false },
        { ids: [read.id], read: true, done: false },
      ]),
    );
    expect(marks).toHaveLength(2);
  });

  it('restores more than one batch in several marks', async () => {
    const many = Array.from({ length: INBOX_MARK_BATCH + 5 }, () => item());
    const { store, marks } = storeOver([]);
    await store.restore(WS, many);
    expect(marks.map((each) => each.ids.length)).toEqual([INBOX_MARK_BATCH, 5]);
  });

  it('the Done tab has nothing to mark done, and nothing to undo', async () => {
    const { store } = storeOver([]);
    expect(await store.markAllRead(WS, 'done', undefined, true)).toEqual({ before: [] });
  });
});
