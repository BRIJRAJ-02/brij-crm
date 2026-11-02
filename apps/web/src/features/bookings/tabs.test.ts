// Bookings' four areas and the two gates that moved from the tab strip onto a tab's views (2 November 2026). The
// strip used to hide the Roster and Routing tabs outright; now every member sees all four tabs, and the gate is on
// the view. So what used to be "is this tab in the list" is now "does this address resolve to the gated view", and
// that is what these check: a reader without the reach must never resolve to Team or to Rules.
import { describe, expect, it } from 'vitest';
import { hoursSearch, rosterIsShown } from '../booking/links.ts';
import { BOOKINGS_TABS, bookingsTabHref, bookingsTabOf, isBookingsPageTab } from './tabs.ts';

/** An access read, with only what the two gates look at. */
const access = (permissions: readonly string[], seesOthers = false) => ({
  permissions,
  scheduling: { seesOthers },
});

describe('Bookings’ tabs', () => {
  it('is four areas, one job each, in their order', () => {
    expect(BOOKINGS_TABS).toEqual(['meetings', 'hours', 'hosts', 'calendars']);
  });

  it('reads the tab out of an address, and falls back to Meetings', () => {
    expect(bookingsTabOf('/w/acme/bookings/hours')).toBe('hours');
    expect(bookingsTabOf('/w/acme/bookings/hosts/')).toBe('hosts');
    // An address from before the cut, and anything unknown, opens the first area rather than nothing.
    expect(bookingsTabOf('/w/acme/bookings/round-robin')).toBe('meetings');
    expect(bookingsTabOf('/w/acme/bookings')).toBe('meetings');
    expect(isBookingsPageTab('roster')).toBe(false);
  });

  it('builds a tab’s address', () => {
    expect(bookingsTabHref('acme', 'hours')).toBe('/w/acme/bookings/hours');
  });
});

describe('Hours’ address', () => {
  it('asks for the team week only on ?v=team, and carries that view’s own search', () => {
    expect(hoursSearch({ v: 'team', week: '2026-11-02', q: 'ada' })).toEqual({
      v: 'team',
      week: '2026-11-02',
      q: 'ada',
    });
    // Mine's keys never leak into the team view, and the team's never into Mine.
    expect(hoursSearch({ v: 'team', schedule: '00000000-0000-4000-8000-000000000000' })).toEqual({ v: 'team' });
    expect(hoursSearch({ week: '2026-11-02', q: 'ada' })).toEqual({});
  });

  it('keeps Mine’s member and schedule, and drops anything malformed', () => {
    expect(
      hoursSearch({ member: '00000000-0000-4000-8000-00000000000A', schedule: 'not-a-uuid', week: 'nope' }),
    ).toEqual({ member: '00000000-0000-4000-8000-00000000000a' });
  });
});

describe('the gate on Hours › Team', () => {
  it('opens for an admin and for anyone whose scheduling reach sees a colleague', () => {
    expect(rosterIsShown(access(['booking.admin']))).toBe(true);
    expect(rosterIsShown(access([], true))).toBe(true);
  });

  it('stays shut for a plain member, who has only their own hours', () => {
    expect(rosterIsShown(access(['booking.manage']))).toBe(false);
    expect(rosterIsShown(access([]))).toBe(false);
  });
});
