// Settings' old addresses (5 November 2026): each one still lands on the page it became, keeping its search where a
// provider's callback carries one. (Settings' own address, the phone's list, is WorkspaceFrame.browser.test.tsx's.)
import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { Route as BookingsSettingsIndex } from '../../routes/w.$slug.bookings_.settings.index.tsx';
import { Route as AccountCalendars } from '../../routes/w.$slug.settings.account.calendars.tsx';
import { Route as AccountIndex } from '../../routes/w.$slug.settings.account.index.tsx';
import { Route as AccountScheduling } from '../../routes/w.$slug.settings.account.scheduling.tsx';
import { Route as AccountSecurity } from '../../routes/w.$slug.settings.account.security.tsx';
import { Route as Automations } from '../../routes/w.$slug.settings.automations.tsx';
import { Route as Calendar } from '../../routes/w.$slug.settings.calendar.tsx';
import { Route as Developer } from '../../routes/w.$slug.settings.developer.tsx';
import { Route as HistorySignIns } from '../../routes/w.$slug.settings.history.sign-ins.tsx';
import { Route as SchedulingAccess } from '../../routes/w.$slug.settings.scheduling.access.tsx';
import { Route as SchedulingAvailability } from '../../routes/w.$slug.settings.scheduling.availability.tsx';
import { Route as SchedulingCalendars } from '../../routes/w.$slug.settings.scheduling.calendars.tsx';
import { Route as SchedulingRoundRobin } from '../../routes/w.$slug.settings.scheduling.round-robin.tsx';
import { Route as SchedulingRouting } from '../../routes/w.$slug.settings.scheduling.routing.tsx';
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

describe('Settings’ old addresses', () => {
  it('sends each to the page it became, replacing the address', () => {
    const cases = [
      [AccountIndex, '/w/$slug/settings/account/profile'],
      [AccountSecurity, '/w/$slug/settings/account/sign-in'],
      // Scheduling's settings, in Bookings settings since 9 November 2026.
      [AccountScheduling, '/w/$slug/bookings/settings/access'],
      [SchedulingAccess, '/w/$slug/bookings/settings/access'],
      [SchedulingRoundRobin, '/w/$slug/bookings/settings/teams'],
      [HistorySignIns, '/w/$slug/settings/account/sign-in'],
      [Rotations, '/w/$slug/bookings/settings/teams'],
      // Parked until each is built properly: where Settings opens.
      [Webhooks, '/w/$slug/settings/account/profile'],
      [Automations, '/w/$slug/settings/account/profile'],
      [Developer, '/w/$slug/settings/account/profile'],
    ] as const;
    for (const [route, to] of cases) {
      expect(redirectOf(route)).toMatchObject({ to, params: { slug: 'acme' }, replace: true });
    }
  });

  it('takes a calendar callback’s search on to Bookings settings › Calendars, the one place to connect one', () => {
    for (const route of [Calendar, SchedulingCalendars, AccountCalendars, BookingsSettingsIndex]) {
      expect(redirectOf(route, { calendar: 'connected' })).toMatchObject({
        to: '/w/$slug/bookings/settings/calendars',
        search: { calendar: 'connected' },
        replace: true,
      });
    }
  });

  it('opens the hours and routing in their Bookings tabs, keeping whose and which', () => {
    const member = '0199a6f2-0000-7000-8000-000000000001';
    expect(redirectOf(SchedulingAvailability, { member, schedule: 'default' })).toMatchObject({
      to: '/w/$slug/bookings/availability',
      search: { member, schedule: 'default' },
      replace: true,
    });
    expect(redirectOf(SchedulingRouting, { view: 'decisions' })).toMatchObject({
      to: '/w/$slug/bookings/routing',
      search: { view: 'decisions' },
      replace: true,
    });
  });
});
