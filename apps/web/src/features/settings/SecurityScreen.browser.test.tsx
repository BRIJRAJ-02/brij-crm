// Sign in and devices in Chromium (spec 0033, AC-896; SA20): signing a device out when this session isn't
// fresh first only emails a code, so the confirm's button says "Email me a code", then "Sign out" once the code's
// field shows. Signing out every other device does the same.
import type { AccountSecurityState, AccountSession, AccountSessionsState, DataLayer } from '@crm/data';
import { isSessionFresh } from '@crm/data';
import { createToasts } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SecurityScreen } from './SecurityScreen.tsx';

/** Two factor off and this session not checked lately: a sign out asks for an emailed code first. */
const STALE: AccountSecurityState = {
  status: 'ready',
  twoFactor: { on: false },
  session: { withSecondFactor: false },
  requiredBy: [],
};

const session = (id: string, deviceLabel: string, current: boolean): AccountSession => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  deviceLabel,
  lastActiveAt: '2026-10-08T12:00:00.000Z',
  signedInAt: '2026-10-01T12:00:00.000Z',
  current,
});

const SESSIONS: AccountSessionsState = {
  status: 'ready',
  items: [session('1', 'Chrome on macOS', true), session('2', 'Firefox on Windows', false)],
  loadingMore: false,
};

/** One snapshot, the same each read, as a store's must be. */
const held = <State,>(state: State) => ({
  subscribe: () => () => undefined,
  getSnapshot: () => state,
  retain: () => () => undefined,
  reload: () => Promise.resolve(),
  loadMore: () => undefined,
});

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

function layer() {
  const calls: string[] = [];
  const sessions = held(SESSIONS);
  const security = held(STALE);
  const data = {
    account: {
      sessions: () => sessions,
      security: () => security,
      isFresh: isSessionFresh,
      stepUp: {
        sendCode: () => {
          calls.push('send');
          return Promise.resolve({ ok: true });
        },
        verify: () => {
          calls.push('verify');
          return Promise.resolve({ ok: true });
        },
      },
      signOut: (id: string) => {
        calls.push(`signOut ${id}`);
        return Promise.resolve(true);
      },
      signOutOthers: () => {
        calls.push('signOutOthers');
        return Promise.resolve({ ok: true, count: 1 });
      },
    },
  } as unknown as Partial<DataLayer>;
  return { data, calls };
}

async function render(data: Partial<DataLayer>) {
  const toasts = createToasts();
  shown = await renderInApp(() => <SecurityScreen data={data as DataLayer} slug="acme" toasts={toasts} />, {
    data,
    pattern: '/w/$slug/settings/account/sign-in',
    at: '/w/acme/settings/account/sign-in',
    toasts,
  });
}

describe('signing a device out, with a step up', () => {
  it('says Email me a code, then Sign out once the code field shows', async () => {
    const { data, calls } = layer();
    await render(data);
    await page.getByRole('button', { name: 'Sign out Firefox on Windows' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Sign out Firefox on Windows?' });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Sign out', exact: true })).not.toBeInTheDocument();
    await dialog.getByRole('button', { name: 'Email me a code' }).click();
    await expect.element(dialog.getByText('Code sent. Check your email.')).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Email me a code' })).not.toBeInTheDocument();
    await userEvent.keyboard('123456');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(page.getByText('Signed out Firefox on Windows.')).toBeVisible();
    expect(calls).toEqual(['send', 'verify', 'signOut 00000000-0000-4000-8000-000000000002']);
  });

  it('does the same for every other device', async () => {
    const { data, calls } = layer();
    await render(data);
    await page.getByRole('button', { name: 'Sign out of all other devices' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Sign out of all other devices?' });
    await dialog.getByRole('button', { name: 'Email me a code' }).click();
    await expect.element(dialog.getByRole('button', { name: 'Sign out of all other devices' })).toBeVisible();
    await userEvent.keyboard('123456');
    await expect.element(dialog).not.toBeInTheDocument();
    expect(calls).toEqual(['send', 'verify', 'signOutOthers']);
  });
});
