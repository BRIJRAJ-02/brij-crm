// The stopped calendar banner in Chromium (spec 0024, AC-619, AC-620; foolproof audit top 8): Reconnect goes to the
// stopped calendar's own provider, so a stopped Outlook calendar is never sent to Google, and the banner always has
// one action, even where it can't reconnect.
import type { CalendarConnectionView, CalendarProvider, CalendarState, CalendarView, DataLayer } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { CalendarBanner } from './CalendarBanner.tsx';

const stopped = (provider: CalendarProvider): CalendarConnectionView => ({
  id: '0190f0f0-0000-7000-8000-0000000000b1',
  provider,
  accountEmail: 'ada@acme.dev',
  status: 'expired',
  sharing: 'shared',
  isDefault: true,
  createdAt: '2026-10-20T09:00:00Z',
});

const viewOf = (state: CalendarState): CalendarView => ({
  subscribe: () => () => undefined,
  getSnapshot: () => state,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
});

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The banner over one stopped connection; `connectUrl` answers a hash, so pressing Reconnect stays on the page. */
async function renderBanner(state: CalendarState) {
  const connectUrl = vi.fn(() => '#connect');
  const data = { calendar: { view: () => viewOf(state), connectUrl } } as unknown as DataLayer;
  shown = await renderInApp(() => <CalendarBanner data={data} slug="acme" />, {
    data,
    pattern: '/w/$slug/home',
    at: '/w/acme/home',
  });
  return { connectUrl };
}

describe('the stopped calendar banner', () => {
  it('reconnects a stopped Outlook calendar through Microsoft, never Google', async () => {
    const { connectUrl } = await renderBanner({
      status: 'ready',
      enabled: true,
      providers: ['google', 'microsoft'],
      max: 6,
      connections: [stopped('microsoft')],
    });
    await expect.element(page.getByText('Your Outlook calendar needs reconnecting.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Reconnect' }));
    expect(connectUrl).toHaveBeenCalledWith('acme', 'settings', 'microsoft');
  });

  it('reconnects a stopped Google calendar through Google', async () => {
    const { connectUrl } = await renderBanner({
      status: 'ready',
      enabled: true,
      providers: ['google'],
      max: 6,
      connections: [stopped('google')],
    });
    await userEvent.click(page.getByRole('button', { name: 'Reconnect' }));
    expect(connectUrl).toHaveBeenCalledWith('acme', 'settings', 'google');
  });

  it('offers Open calendars where it can’t reconnect: sync off, or the provider not offered here', async () => {
    await renderBanner({ status: 'ready', enabled: false, providers: [], max: 6, connections: [stopped('google')] });
    await expect
      .element(page.getByRole('link', { name: 'Open calendars' }))
      .toHaveAttribute('href', '/w/acme/bookings/settings/calendars');
    expect(page.getByRole('button', { name: 'Reconnect' }).elements()).toEqual([]);
    shown?.unmount();
    await renderBanner({
      status: 'ready',
      enabled: true,
      providers: ['google'],
      max: 6,
      connections: [stopped('microsoft')],
    });
    await expect.element(page.getByRole('link', { name: 'Open calendars' })).toBeVisible();
  });
});
