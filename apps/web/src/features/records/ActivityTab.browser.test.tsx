// The Activity tab's Log activity in Chromium (the foolproof pass, 5 November 2026): beside the filter for whoever
// may change the record, opening the Log activity dialog through the page; absent for a reader.
import type { ActivityFeed, ActivityState } from '@crm/data';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ActivityTab } from './ActivityTab.tsx';

/** A timeline with nothing in it yet, ready. One snapshot, the same each read, as a store's must be. */
const EMPTY: ActivityState = {
  status: 'ready',
  entries: [],
  source: { count: 0, getItem: () => undefined, getKey: (entry) => entry.id },
  hasMore: false,
};
const feed: ActivityFeed = {
  subscribe: () => () => undefined,
  getSnapshot: () => EMPTY,
  retry: () => undefined,
  ready: () => Promise.resolve(),
  retain: () => () => undefined,
};

let app: InApp | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

const show = async (onLogActivity?: () => void) => {
  app = await renderInApp(
    () => (
      <ActivityTab
        feed={feed}
        feedFor={() => Promise.resolve(feed)}
        link={() => undefined}
        {...(onLogActivity === undefined ? {} : { onLogActivity })}
      />
    ),
    { data: {}, pattern: '/w/$slug/activity', at: '/w/acme/activity' },
  );
};

describe('ActivityTab', () => {
  it('logs a call or meeting from beside the filter', async () => {
    let opened = 0;
    await show(() => {
      opened += 1;
    });
    const log = page.getByRole('button', { name: 'Log activity' });
    await expect.element(log).toBeVisible();
    await userEvent.click(log);
    expect(opened).toBe(1);
  });

  it('offers no Log activity to someone who may only read the record', async () => {
    await show();
    await expect.element(page.getByRole('button', { name: /Filter/ })).toBeVisible();
    expect(page.getByRole('button', { name: 'Log activity' }).elements()).toHaveLength(0);
  });
});
