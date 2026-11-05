// Recent activity in Chromium (spec 0033, AC-898; Q51, SA25, SA35): the section reads its first page through use()
// without React's "use() to suspend in a previous render" error, across the first page, a failed read and its
// retry, and a new first page after a change (which keeps the rows shown, busy, until it arrives); five events
// first, then Show more; and another page can give it its own heading.
import type { ActivityPage, DataLayer, SecurityActivity } from '@crm/data';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { RecentActivityPending, RecentActivitySection } from './RecentActivitySection.tsx';

const event = (id: string, kind: SecurityActivity['kind']): SecurityActivity => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  at: '2026-10-08T14:00:00Z',
  kind,
  ...(kind === 'sign_in' ? { method: 'email_code' as const } : {}),
  deviceLabel: 'Chrome on macOS',
});

const FIRST: ActivityPage = { items: [event('1', 'sign_in')] };
const AFTER: ActivityPage = { items: [event('2', 'two_factor_on'), event('1', 'sign_in')] };

/** A promise and the hand that settles it. */
function later<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

let shown: InApp | undefined;
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  errors.mockRestore();
});

/** Every console error React logged about use(). */
const useErrors = () =>
  errors.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('use() to suspend'));

/** The section with a first page the test swaps, as the route's loader would on a retry or after a change. */
async function render(initial: Promise<ActivityPage | undefined>, extra: { title?: string } = {}) {
  let swap: (next: Promise<ActivityPage | undefined>) => void = () => undefined;
  let retries = 0;
  const retried = later<undefined>();
  function Harness() {
    const [first, setFirst] = useState(initial);
    useEffect(() => {
      swap = setFirst;
    }, []);
    return (
      <RecentActivitySection
        data={{} as DataLayer}
        first={first}
        onRetry={() => {
          retries += 1;
          retried.settle(undefined);
        }}
        {...extra}
      />
    );
  }
  shown = await renderInApp(() => <Harness />, {
    data: {},
    pattern: '/w/$slug/settings/account/sign-in',
    at: '/w/acme/settings/account/sign-in',
  });
  return {
    swap: (next: Promise<ActivityPage | undefined>) => swap(next),
    retried: retried.promise,
    retries: () => retries,
  };
}

describe('Recent activity', () => {
  it('shows its loading rows, then the first page, with no use() error', async () => {
    const first = later<ActivityPage | undefined>();
    await render(first.promise);
    await expect.element(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    first.settle(FIRST);
    await expect.element(page.getByText('Signed in with an email code')).toBeVisible();
    expect(useErrors()).toEqual([]);
  });

  it('retries a failed read, and a new first page keeps the rows until it arrives', async () => {
    const harness = await render(Promise.resolve(undefined));
    await page.getByRole('button', { name: 'Try again' }).click();
    await harness.retried;
    expect(harness.retries()).toBe(1);

    const retry = later<ActivityPage | undefined>();
    harness.swap(retry.promise);
    // While it reads again, the failure's place says it is loading, not that it failed.
    await expect.element(page.getByRole('status')).toHaveTextContent('Loading recent activity');
    await expect.element(page.getByText('Couldn’t load your recent activity')).not.toBeInTheDocument();
    retry.settle(FIRST);
    await expect.element(page.getByText('Signed in with an email code')).toBeVisible();

    // A change on the page reads the first page again: the rows stay, busy, then the new one shows.
    const after = later<ActivityPage | undefined>();
    harness.swap(after.promise);
    const busy = () => page.getByText('Signed in with an email code').element().closest('[aria-busy="true"]');
    await vi.waitFor(() => {
      expect(busy()).not.toBeNull();
    });
    after.settle(AFTER);
    await expect.element(page.getByText('Turned on two factor sign in')).toBeVisible();
    expect(busy()).toBeNull();
    expect(useErrors()).toEqual([]);
  });

  it('takes another heading, with no line under either', async () => {
    await render(Promise.resolve(FIRST), { title: 'Your sign ins' });
    await expect.element(page.getByRole('heading', { name: 'Your sign ins' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Recent activity' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Last 90 days.');
  });

  // Critic A #12 (5 November 2026): a long list of one Mac's sign ins. Five first, then Show more shows the rest read.
  it('shows five events, then the rest of the page on Show more', async () => {
    const many: ActivityPage = { items: ['1', '2', '3', '4', '5', '6', '7'].map((id) => event(id, 'sign_in')) };
    await render(Promise.resolve(many));
    await vi.waitFor(() => {
      expect(page.getByText('Signed in with an email code').elements()).toHaveLength(5);
    });
    await page.getByRole('button', { name: 'Show more' }).click();
    await vi.waitFor(() => {
      expect(page.getByText('Signed in with an email code').elements()).toHaveLength(7);
    });
    // Everything read, and no older page to read: Show more goes.
    await expect.element(page.getByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('has a pending screen with the loaded section’s heading and loading rows', async () => {
    shown = await renderInApp(() => <RecentActivityPending />, {
      data: {},
      pattern: '/w/$slug/settings/account/sign-in',
      at: '/w/acme/settings/account/sign-in',
    });
    await expect.element(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });
});
