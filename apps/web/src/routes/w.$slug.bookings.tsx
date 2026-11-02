import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { BookingsTabs } from '../features/bookings/BookingsTabs.tsx';
import { BookingsTopBar } from '../features/bookings/BookingsTopBar.tsx';
import { bookingsTabOf } from '../features/bookings/tabs.ts';
import { useHostsChoice } from '../features/bookings/HostsSwitch.tsx';
import { BookingsActionSlot, BookingsHosts } from '../features/bookings/toolbarSlot.ts';
import { useCan, useMyAccess, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Bookings, after Records in the sidebar, laid out as Captures is: the frame, the TopBar (the tile, the upcoming
// count and New, as People's) and the tab strip (Meetings · Hours · Hosts · Calendars) in the row People's ViewBar
// takes, with the tab's own route (`bookings.meetings`, `bookings.hours`, …) drawn in the chosen panel. A tab's own
// WorkspacePage draws only its body inside this frame. The layout owns New, so it never moves or remounts as the
// tabs change. Bare `/bookings` goes to Meetings (`bookings.index`).
// Four tabs since 2 November 2026 (the owner: "the whole bookings is now confusing", "too much going on"). What
// used to be a tab is now a view inside one, and every gate moved with it: Hours › Team still needs
// `rosterIsShown` and Hosts › Rules still needs `routing.manage`, both checked by their own route's loader, which
// sends a reader without the reach to the tab's other view rather than to an empty page. Mine · Everyone moved off
// this strip and onto Meetings' own tools' row, so the strip holds tabs and nothing else.
/** The tabs that put their own primary action where New meeting sits, rather than letting the TopBar keep it. */
const OWN_ACTION = new Set<string>(['hours', 'hosts', 'calendars']);

export const Route = createFileRoute('/w/$slug/bookings')({
  component: BookingsRoute,
});

function BookingsRoute() {
  const { slug } = Route.useParams();
  const tab = useLocation({ select: (location) => bookingsTabOf(location.pathname) });
  // The Team day (spec 0030) shows everyone the reader may see, whatever Mine or Everyone says: the switch steps aside.
  const isTeamDay = useLocation({ select: (location) => tab === 'meetings' && location.search.v === 'team' });
  // A tab whose primary action is its own takes the TopBar's end in place of New meeting (one primary per
  // screen): Hours' New schedule or Set usual hours, Hosts' New group, Calendars' Connect.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const ownsAction = OWN_ACTION.has(tab);
  // Mine or Everyone (the owner's ask of 29 October 2026): an admin's choice, and anyone's whose scheduling reach
  // sees a colleague (spec 0037, AC-1262), kept here so Calendar and List share it and its switch stands still on
  // the strip as they swap.
  const access = useMyAccess();
  const seesOthers = access?.scheduling?.seesOthers === true;
  const isAdmin = useCan('booking.admin') || seesOthers;
  // Every member has all four tabs: what one of them may not see is a view inside a tab, never the tab, so no tab
  // is ever a dead end and nothing is hidden that was not hidden before.
  const { hosts: value, choose } = useHostsChoice(slug, isAdmin);
  // Mine or Everyone, read by Meetings' two reads; on the Team day the switch steps aside.
  const hosts = useMemo(
    () => (isAdmin && !isTeamDay ? { value, onChange: choose } : undefined),
    [isAdmin, isTeamDay, value, choose],
  );
  return (
    <BookingsHosts value={hosts}>
      <BookingsActionSlot value={ownsAction ? actionSlot : null}>
        <WorkspacePage
          currentPage="bookings"
          page={{
            topBar: <BookingsTopBar slug={slug} actionSlot={ownsAction ? setActionSlot : undefined} />,
            body: (
              <BookingsTabs slug={slug} tab={tab}>
                <Outlet />
              </BookingsTabs>
            ),
          }}
        />
      </BookingsActionSlot>
    </BookingsHosts>
  );
}
