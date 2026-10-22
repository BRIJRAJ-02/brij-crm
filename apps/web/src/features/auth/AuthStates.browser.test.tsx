// The pages before the app in Chromium (design sweep, 22 October 2026): a failed
// check keeps the page's title as its one heading, says why in one sentence and
// offers Try again; the second step and join sit in the same split card as sign
// in; and join with nothing to ask makes its way on the page's one action.
import type { DataError, DataLayer, Joinable } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { EmailPreferencesError } from '../email/EmailPreferencesScreen.tsx';
import { JoinScreen } from '../join/JoinScreen.tsx';
import { AuthError } from './AuthStates.tsx';
import { TwoFactorScreen } from './TwoFactorScreen.tsx';

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The page's frame: the split screen carries `data-split` on its root. */
const isSplit = () => document.querySelector('[data-split]') !== null;

describe('AuthError', () => {
  it('keeps the page title as the only heading, says why once and retries the route', async () => {
    shown = await renderInApp(() => <AuthError title="Opening Timefix" isSplit />, { data: {}, pattern: '/', at: '/' });
    const invalidate = vi.spyOn(shown.router, 'invalidate').mockResolvedValue(undefined);
    await expect.element(page.getByRole('heading', { level: 1, name: 'Opening Timefix' })).toBeVisible();
    expect(document.querySelectorAll('h1, h2, h3')).toHaveLength(1);
    await expect.element(page.getByText('Can’t reach Timefix. Check your connection, then try again.')).toBeVisible();
    expect(isSplit()).toBe(true);
    await page.getByRole('button', { name: 'Try again' }).click();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('says the server’s sentence in place of the default one', async () => {
    shown = await renderInApp(() => <AuthError title="Join your team" text="Too many requests. Try again soon." />, {
      data: {},
      pattern: '/join',
      at: '/join',
    });
    await expect.element(page.getByText('Too many requests. Try again soon.')).toBeVisible();
    expect(document.body.textContent).not.toContain('Can’t reach Timefix');
  });
});

describe('TwoFactorScreen', () => {
  it('sits in the split screen, its backup code way full width under Continue, and offers no passkey', async () => {
    const data = {} as Partial<DataLayer>;
    shown = await renderInApp(() => <TwoFactorScreen data={data as DataLayer} redirect={undefined} />, {
      data,
      pattern: '/two-factor',
      at: '/two-factor',
    });
    await expect.element(page.getByRole('button', { name: 'Use a backup code' })).toBeVisible();
    expect(page.getByRole('button', { name: /passkey/i }).query()).toBeNull();
    expect(isSplit()).toBe(true);
    const submit = page.getByRole('button', { name: 'Continue' }).element();
    const backup = page.getByRole('button', { name: 'Use a backup code' }).element();
    expect(backup.getBoundingClientRect().width).toBe(submit.getBoundingClientRect().width);
  });
});

describe('JoinScreen', () => {
  const join = (joinable: readonly Joinable[], hasHome: boolean) =>
    renderInApp(
      () => <JoinScreen data={{} as DataLayer} email="ada@acme.com" joinable={joinable} hasHome={hasHome} />,
      { data: {}, pattern: '/join', at: '/join' },
    );

  it('with nothing to ask, makes Create a workspace the page’s one action, in the split card', async () => {
    shown = await join([], false);
    const create = page.getByRole('link', { name: 'Create a workspace' });
    await expect.element(create).toBeVisible();
    expect(document.querySelectorAll('a, button')).toHaveLength(1);
    expect(isSplit()).toBe(true);
  });

  it('with nothing to ask but a workspace already, goes to it', async () => {
    shown = await join([], true);
    await expect.element(page.getByRole('link', { name: 'Go to your workspaces' })).toHaveAttribute('href', '/');
  });

  it('with workspaces to ask, keeps the way on quiet in the footer', async () => {
    shown = await join([{ workspaceId: '0199a6f2-0000-7000-8000-00000000000b', name: 'Acme', state: 'none' }], false);
    await expect.element(page.getByRole('button', { name: 'Ask to join Acme' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Create a workspace' })).toBeVisible();
  });
});

describe('EmailPreferencesError', () => {
  it('says an expired link as the page title, with why under it and no second heading', async () => {
    const gone = { code: 'NOT_FOUND', message: 'Not found' } as unknown as DataError;
    shown = await renderInApp(() => <EmailPreferencesError error={gone} />, {
      data: {},
      pattern: '/email-preferences',
      at: '/email-preferences',
    });
    await expect.element(page.getByRole('heading', { level: 1, name: 'This link has expired' })).toBeVisible();
    expect(document.querySelectorAll('h1, h2, h3')).toHaveLength(1);
  });

  it('fails to load as the pages before the app do', async () => {
    shown = await renderInApp(() => <EmailPreferencesError error={undefined} />, {
      data: {},
      pattern: '/email-preferences',
      at: '/email-preferences',
    });
    await expect.element(page.getByRole('heading', { level: 1, name: 'Email preferences' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
