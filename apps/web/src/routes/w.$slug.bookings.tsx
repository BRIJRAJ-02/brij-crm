import { useCalendar } from '@crm/data/react';
import { createFileRoute, Outlet, useLocation, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { BookingsTabs } from '../features/bookings/BookingsTabs.tsx';
import { BookingsTopBar } from '../features/bookings/BookingsTopBar.tsx';
import { rosterIsShown } from '../features/booking/links.ts';
import { BOOKINGS_TABS, bookingsTabOf, type BookingsPageTab } from '../features/bookings/tabs.ts';
import { useHostsChoice } from '../features/bookings/HostsSwitch.tsx';
import {
  BookingsActionSlot,
  BookingsCalendarSync,
  BookingsHosts,
  BookingsNewPage,
} from '../features/bookings/toolbarSlot.ts';
import { useBookingArrivals } from '../features/bookings/useBookingArrivals.ts';
import { useCan, useMyAccess, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Bookings, after Records in the sidebar, laid out as Captures is: the frame, the TopBar (the tile, the upcoming
// count and New, as People's) and the tab strip (Pages · Calendar · List · Roster · Availability · Round robin · Routing · Calendars)
// in the row People's ViewBar takes, with the tab's own route (`bookings.calendar`, `bookings.roster`, …) drawn in the
// chosen panel. A tab's own WorkspacePage draws only its body inside this frame. The layout owns New, so it never
// moves or remounts as the tabs change. Bare `/bookings` goes to Calendar, or List for an old `?view=list` link
// (`bookings.index`).
/** The tabs that read bookings, where an admin's Mine · Everyone shows. */
const READS_BOOKINGS = new Set<string>(['calendar', 'list']);
/** The tabs that put their own primary action where New meeting sits, rather than letting the TopBar keep it. */
const OWN_ACTION = new Set<string>(['availability', 'roster', 'round-robin', 'calendars']);

/** Whether an address is Bookings' own (a tab, or bare `/bookings`), not the page the router is leaving for. */
const isUnderBookings = (pathname: string) => /\/bookings(\/|$)/.test(pathname);

export const Route = createFileRoute('/w/$slug/bookings')({
  component: BookingsRoute,
});

function BookingsRoute() {
  const { slug } = Route.useParams();
  // A booking arriving while Bookings is open says so (the bookings critique, B-12).
  useBookingArrivals(slug);
  // The tab the address names. While leaving Bookings the address is already another page's, which names no tab:
  // the strip keeps the last one rather than flashing to Calendar (the bookings critique, C18).
  const named = useLocation({
    select: (location) => (isUnderBookings(location.pathname) ? bookingsTabOf(location.pathname) : undefined),
  });
  const [lastTab, setLastTab] = useState<BookingsPageTab>(named ?? 'calendar');
  if (named !== undefined && named !== lastTab) setLastTab(named);
  const tab = named ?? lastTab;
  // New › Booking page, held here so the TopBar's menu, Pages' empty list and the Calendar's empty state open one dialog.
  const [isAddingPage, setAddingPage] = useState(false);
  const addPage = useMemo(
    () => () => {
      setAddingPage(true);
    },
    [],
  );
  // The Team day (spec 0030) shows everyone the reader may see, whatever Mine or Everyone says: the switch steps aside.
  const isTeamDay = useLocation({ select: (location) => tab === 'calendar' && location.search.v === 'team' });
  // A tab whose primary action is its own takes the TopBar's end in place of New meeting (one primary per
  // screen): Availability's New schedule, the Roster's Set usual hours, Round robin's New group, Calendars' Connect.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const ownsAction = OWN_ACTION.has(tab);
  // Mine or Everyone (the owner's ask of 29 October 2026): an admin's choice, and anyone's whose scheduling reach
  // sees a colleague (spec 0037, AC-1262), kept here so Calendar and List share it and its switch stands still on
  // the strip as they swap.
  const access = useMyAccess();
  const seesOthers = access?.scheduling?.seesOthers === true;
  const isAdmin = useCan('booking.admin') || seesOthers;
  // The Roster only for someone who sees a colleague's scheduling, and Routing only for a holder of routing.manage
  // (spec 0037, AC-1447); either address falls back for everyone else.
  const canRoute = useCan('routing.manage');
  // Calendar sync off for the deployment with nothing connected (the bookings critique, A2): the Calendars tab and
  // every Connect calendar link hide, since they could only lead to "Calendar sync is off". Until the read answers,
  // they show as before.
  const { data } = useRouteContext({ from: '__root__' });
  const calendar = useCalendar(data.calendar.view(slug));
  const canConnectCalendar = calendar.status !== 'ready' || calendar.enabled || calendar.connections.length > 0;
  const tabs = useMemo(
    () =>
      BOOKINGS_TABS.filter(
        (each) =>
          (each !== 'roster' || (access !== undefined && rosterIsShown(access))) &&
          (each !== 'routing' || canRoute) &&
          (each !== 'calendars' || canConnectCalendar || tab === 'calendars'),
      ),
    [access, canRoute, canConnectCalendar, tab],
  );
  const { hosts: value, choose } = useHostsChoice(slug, isAdmin);
  const hosts = useMemo(() => (isAdmin ? { value, onChange: choose } : undefined), [isAdmin, value, choose]);
  return (
    <BookingsCalendarSync value={canConnectCalendar}>
      <BookingsNewPage value={addPage}>
        <BookingsHosts value={hosts}>
          <BookingsActionSlot value={ownsAction ? actionSlot : null}>
            <WorkspacePage
              currentPage="bookings"
              page={{
                topBar: (
                  <BookingsTopBar
                    slug={slug}
                    actionSlot={ownsAction ? setActionSlot : undefined}
                    isAddingPage={isAddingPage}
                    onAddPage={addPage}
                    onAddPageClose={() => {
                      setAddingPage(false);
                    }}
                  />
                ),
                body: (
                  <BookingsTabs
                    slug={slug}
                    tab={tab}
                    tabs={tabs}
                    hosts={READS_BOOKINGS.has(tab) && !isTeamDay ? hosts : undefined}
                  >
                    <Outlet />
                  </BookingsTabs>
                ),
              }}
            />
          </BookingsActionSlot>
        </BookingsHosts>
      </BookingsNewPage>
    </BookingsCalendarSync>
  );
}
