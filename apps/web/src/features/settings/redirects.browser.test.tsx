// Settings' old addresses (5 November 2026): each one still lands on the page it became, keeping its search where a
// provider's callback carries one, and Settings itself opens on Profile (on a wide screen; a phone's is the list).
import { isRedirect } from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { Route as AccountIndex } from '../../routes/w.$slug.settings.account.index.tsx';
import { Route as AccountScheduling } from '../../routes/w.$slug.settings.account.scheduling.tsx';
import { Route as AccountSecurity } from '../../routes/w.$slug.settings.account.security.tsx';
import { Route as Automations } from '../../routes/w.$slug.settings.automations.tsx';
import { Route as Calendar } from '../../routes/w.$slug.settings.calendar.tsx';
import { Route as Developer } from '../../routes/w.$slug.settings.developer.tsx';
import { Route as HistorySignIns } from '../../routes/w.$slug.settings.history.sign-ins.tsx';
import { Route as SettingsIndex } from '../../routes/w.$slug.settings.index.tsx';
import { Route as SchedulingCalendars } from '../../routes/w.$slug.settings.scheduling.calendars.tsx';
import { Route as Rotations } from '../../routes/w.$slug.settings.scheduling.rotations.tsx';
import { Route as Webhooks } from '../../routes/w.$slug.settings.webhooks.tsx';

/** What a route's `beforeLoad` threw for `/w/acme/…` with `search`, or undefined when it let the page load. */
function redirectOf(route: { readonly options: { readonly beforeLoad?: unknown } }, search: object = {}) {
  const beforeLoad = route.options.beforeLoad as (input: unknown) => unknown;
  try {
    beforeLoad({ params: { slug: 'acme' }, search });
  } catch (error) {
    return isRedirect(error) ? error.options : undefined;
  }
  return undefined;
}

afterEach(async () => {
  await page.viewport(1280, 800);
});

describe('Settings’ old addresses', () => {
  it('sends each to the page it became, replacing the address', () => {
    const cases = [
      [AccountIndex, '/w/$slug/settings/account/profile'],
      [AccountSecurity, '/w/$slug/settings/account/sign-in'],
      [AccountScheduling, '/w/$slug/settings/scheduling/access'],
      [HistorySignIns, '/w/$slug/settings/account/sign-in'],
      [Rotations, '/w/$slug/settings/scheduling/round-robin'],
      // Parked until each is built properly: where Settings opens.
      [Webhooks, '/w/$slug/settings/account/profile'],
      [Automations, '/w/$slug/settings/account/profile'],
      [Developer, '/w/$slug/settings/account/profile'],
    ] as const;
    for (const [route, to] of cases) {
      expect(redirectOf(route)).toMatchObject({ to, params: { slug: 'acme' }, replace: true });
    }
  });

  it('takes a calendar callback’s search on to Account › Calendars, the one place to connect one', () => {
    for (const route of [Calendar, SchedulingCalendars]) {
      expect(redirectOf(route, { calendar: 'connected' })).toMatchObject({
        to: '/w/$slug/settings/account/calendars',
        search: { calendar: 'connected' },
        replace: true,
      });
    }
  });

  it('opens Settings on Profile on a wide screen, and stays on the list on a phone', async () => {
    expect(redirectOf(SettingsIndex)).toMatchObject({ to: '/w/$slug/settings/account/profile', replace: true });
    await page.viewport(390, 844);
    expect(redirectOf(SettingsIndex)).toBeUndefined();
  });
});
