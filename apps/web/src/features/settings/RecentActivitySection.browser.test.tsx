// Recent activity in Chromium (spec 0033, AC-898; Q51, SA25, SA35): the section reads its first page through use()
// without React's "use() to suspend in a previous render" error, across the first page, a failed read and its
// retry, and a new first page after a change (which keeps the rows shown, busy, until it arrives); and another page
// can give it its own heading and line (History's "Your sign ins").
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
async function render(
  initial: Promise<ActivityPage | undefined>,
  extra: { title?: string; description?: string } = {},
) {
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

  it('takes another heading and line', async () => {
    await render(Promise.resolve(FIRST), { title: 'Your sign ins', description: 'Where and when you signed in.' });
    await expect.element(page.getByRole('heading', { name: 'Your sign ins' })).toBeVisible();
    await expect.element(page.getByText('Where and when you signed in.')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Recent activity' })).not.toBeInTheDocument();
  });

  it('has a pending screen with the loaded section’s heading, line and loading rows', async () => {
    shown = await renderInApp(() => <RecentActivityPending />, {
      data: {},
      pattern: '/w/$slug/settings/account/sign-in',
      at: '/w/acme/settings/account/sign-in',
    });
    await expect.element(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expect
      .element(page.getByText('Sign ins and changes to how you sign in, from the last 90 days.'))
      .toBeVisible();
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    shown.unmount();
    shown = await renderInApp(() => <RecentActivityPending title="Your sign ins" />, {
      data: {},
      pattern: '/w/$slug/settings/account/sign-in',
      at: '/w/acme/settings/account/sign-in',
    });
    await expect.element(page.getByRole('heading', { name: 'Your sign ins' })).toBeVisible();
    await expect
      .element(page.getByText('Sign ins and changes to how you sign in, from the last 90 days.'))
      .toBeVisible();
  });
});
