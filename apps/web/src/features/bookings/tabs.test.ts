// Bookings' four tabs and the views under them (the IA brief, 5 November 2026): every old address keeps opening,
// under the tab it now belongs to, and each tab opens on its first view.
import { describe, expect, it } from 'vitest';
import { Route as CalendarsRoute } from '../../routes/w.$slug.bookings.calendars.tsx';
import { Route as IndexRoute } from '../../routes/w.$slug.bookings.index.tsx';
import { Route as MeetingsRoute } from '../../routes/w.$slug.bookings.meetings.tsx';
import { Route as RoundRobinRoute } from '../../routes/w.$slug.bookings.round-robin.tsx';
import { BOOKINGS_TABS, BOOKINGS_VIEWS, bookingsTabHref, bookingsTabOf, bookingsViewOf } from './tabs.ts';

describe('Bookings tabs', () => {
  it('are Meetings, Pages, Availability and Routing, as Calendly and Cal.com', () => {
    expect(BOOKINGS_TABS).toEqual(['meetings', 'pages', 'availability', 'routing']);
  });

  it('put every old address under its tab', () => {
    const tabOf = (view: string) => bookingsTabOf(`/w/acme/bookings/${view}`);
    expect(tabOf('calendar')).toBe('meetings');
    expect(tabOf('list')).toBe('meetings');
    expect(tabOf('pages')).toBe('pages');
    expect(tabOf('availability')).toBe('availability');
    expect(tabOf('roster')).toBe('availability');
    expect(tabOf('routing')).toBe('routing');
    // Bare Bookings, and anything else, is Meetings.
    expect(bookingsTabOf('/w/acme/bookings')).toBe('meetings');
    expect(bookingsTabOf('/w/acme/bookings/')).toBe('meetings');
  });

  it('keep a view of its own for each old address', () => {
    for (const view of BOOKINGS_VIEWS) expect(bookingsViewOf(`/w/acme/bookings/${view}/`)).toBe(view);
  });

  it('open each tab on its first view, and a view on itself', () => {
    expect(bookingsTabHref('acme', 'meetings')).toBe('/w/acme/bookings/calendar');
    expect(bookingsTabHref('acme', 'pages')).toBe('/w/acme/bookings/pages');
    expect(bookingsTabHref('acme', 'availability')).toBe('/w/acme/bookings/availability');
    expect(bookingsTabHref('acme', 'routing')).toBe('/w/acme/bookings/routing');
    expect(bookingsTabHref('acme', 'list')).toBe('/w/acme/bookings/list');
    expect(bookingsTabHref('acme', 'roster')).toBe('/w/acme/bookings/roster');
  });
});

/** Where a route's `beforeLoad` sends an address: the redirect it throws. */
function redirectOf(
  route: { readonly options: { readonly beforeLoad?: unknown } },
  search: Record<string, unknown>,
): { readonly to?: string; readonly search?: unknown; readonly replace?: boolean } {
  const beforeLoad = route.options.beforeLoad as (input: unknown) => unknown;
  try {
    beforeLoad({ params: { slug: 'acme' }, search });
  } catch (thrown) {
    const options = (thrown as { readonly options?: Record<string, unknown> }).options ?? {};
    return options;
  }
  throw new Error('no redirect');
}

describe('Bookings redirects', () => {
  it('open /bookings/meetings on the calendar, keeping the week', () => {
    const to = redirectOf(MeetingsRoute, { w: '2026-11-02' });
    expect(to.to).toBe('/w/$slug/bookings/calendar');
    expect(to.search).toEqual({ w: '2026-11-02' });
    expect(to.replace).toBe(true);
  });

  it('open an old ?view=list link on the list, from /bookings and /bookings/meetings', () => {
    expect(redirectOf(MeetingsRoute, { view: 'list' }).to).toBe('/w/$slug/bookings/list');
    expect(redirectOf(IndexRoute, { view: 'list' }).to).toBe('/w/$slug/bookings/list');
    expect(redirectOf(IndexRoute, {}).to).toBe('/w/$slug/bookings/calendar');
  });

  it('send the old Calendars and Round robin addresses to their one home in Settings', () => {
    const calendars = redirectOf(CalendarsRoute, { calendar: 'connected' });
    expect(calendars.to).toBe('/w/$slug/settings/account/calendars');
    expect(calendars.search).toEqual({ calendar: 'connected' });
    expect(redirectOf(RoundRobinRoute, {}).to).toBe('/w/$slug/settings/scheduling/round-robin');
  });
});
