// The inbox in Chromium (foolproof audit, 5 November 2026): one bulk action, Mark all done, and Undo on every move
// between Inbox and Done, which puts each notification back exactly as it was.
import type { DataError, DataLayer, InboxList, InboxListState, NotificationView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { InboxScreen } from './InboxScreen.tsx';

const MENTION: NotificationView = {
  id: '0199a6f2-0000-7000-8000-0000000000c1',
  kind: 'mention',
  actor: { type: 'member', id: '0199a6f2-0000-7000-8000-000000000002' },
  createdAt: '2026-11-04T10:00:00.000Z',
  excerpt: 'Can you look at Acme?',
};

const ready: InboxListState = { status: 'ready', items: [MENTION], hasMore: false, isLoadingMore: false };
const list: InboxList = {
  subscribe: () => () => undefined,
  getSnapshot: () => ready,
  retain: () => () => undefined,
  loadMore: () => undefined,
  retry: () => undefined,
};

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function renderInbox() {
  const mark = vi.fn((): Promise<DataError | undefined> => Promise.resolve(undefined));
  const markAllRead = vi.fn(() => Promise.resolve({ before: [MENTION] }));
  const restore = vi.fn((): Promise<DataError | undefined> => Promise.resolve(undefined));
  const data = {
    inbox: { mark, markAllRead, restore, unread: () => ({ subscribe: () => () => undefined, getSnapshot: () => 1 }) },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => <InboxScreen slug="acme" search={{}} list={list} objects={[]} members={[]} meId={undefined} />,
    { data, pattern: '/w/$slug/inbox', at: '/w/acme/inbox' },
  );
  return { mark, markAllRead, restore };
}

describe('the inbox', () => {
  it('has one bulk action, Mark all done, with Undo that puts each one back', async () => {
    const { markAllRead, restore } = await renderInbox();
    await expect.element(page.getByRole('button', { name: 'Mark all done' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Mark all as read' }).query()).toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'Mark all done' }));
    expect(markAllRead).toHaveBeenCalledWith('acme', 'inbox', undefined, true);
    await expect.element(page.getByText('Inbox cleared')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.poll(() => restore.mock.calls).toEqual([['acme', [MENTION]]]);
  });

  it('offers Undo on a notification marked done from its menu', async () => {
    const { mark, restore } = await renderInbox();
    await userEvent.click(page.getByRole('button', { name: 'More actions' }));
    await userEvent.click(page.getByRole('menuitem', { name: /Mark done/ }));
    expect(mark).toHaveBeenCalledWith('acme', [MENTION.id], { done: true });
    await expect.element(page.getByText('Marked done')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.poll(() => restore.mock.calls).toEqual([['acme', [MENTION]]]);
  });
});
