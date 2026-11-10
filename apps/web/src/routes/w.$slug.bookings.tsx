import { useCalendar } from '@crm/data/react';
import { createFileRoute, Outlet, useLocation, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { BookingsModuleTabs, BookingsScope, viewHasTools } from '../features/bookings/BookingsTabs.tsx';
import { BookingsTopBar } from '../features/bookings/BookingsTopBar.tsx';
import { rosterIsShown } from '../features/booking/links.ts';
import { BOOKINGS_TABS, bookingsViewOf, tabOfView, type BookingsView } from '../features/bookings/tabs.ts';
import { useHostsChoice } from '../features/bookings/HostsSwitch.tsx';
import {
  BookingsActionSlot,
  BookingsCalendarSync,
  BookingsHosts,
  BookingsNewPage,
  BookingsToolbarSlot,
} from '../features/bookings/toolbarSlot.ts';
import { useBookingArrivals } from '../features/bookings/useBookingArrivals.ts';
import { useCan, useMyAccess, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Bookings, after Records in the sidebar: the frame and one header, the TopBar (the tile, Bookings, the tabs
// Meetings · Pages · Availability · Routing on its line, then whose bookings or hours show, New and the settings gear;
// the mock's shell, 9 November 2026: one header with one line under it), with the view's own route
// (`bookings.calendar`, `bookings.roster`, …) under it. A view's own WorkspacePage draws only its body inside this
// frame. The layout owns New, so it never moves or remounts as the tabs change. Bare `/bookings` (and
// `/bookings/meetings`) goes to the calendar, or the list for an old `?view=list` link (`bookings.index`). Calendars,
// Teams (round robin's groups) and Scheduling access are Bookings settings, behind the gear.
/** The tabs that put their own primary action where New meeting sits, rather than letting the TopBar keep it. */
const OWN_ACTION = new Set<string>(['availability', 'roster', 'pages']);

/** Whether an address is Bookings' own (a tab, or bare `/bookings`), not the page the router is leaving for. */
const isUnderBookings = (pathname: string) => /\/bookings(\/|$)/.test(pathname);

export const Route = createFileRoute('/w/$slug/bookings')({
  component: BookingsRoute,
});

function BookingsRoute() {
  const { slug } = Route.useParams();
  // A booking arriving while Bookings is open says so (the bookings critique, B-12).
  useBookingArrivals(slug);
  // The view the address names. While leaving Bookings the address is already another page's, which names no view:
  // the strip keeps the last one rather than flashing to Meetings (the bookings critique, C18).
  const named = useLocation({
    select: (location) => (isUnderBookings(location.pathname) ? bookingsViewOf(location.pathname) : undefined),
  });
  const [lastView, setLastView] = useState<BookingsView>(named ?? 'calendar');
  if (named !== undefined && named !== lastView) setLastView(named);
  const view = named ?? lastView;
  const tab = tabOfView(view);
  // New › Booking page, held here so the TopBar's menu, Pages' empty list and the Calendar's empty state open one dialog.
  // Which dialog it opens as: a page, the workspace link or a team link (Pages' Team links menu).
  const [addingPage, setAddingPage] = useState<'page' | 'workspace' | 'team-link' | undefined>(undefined);
  const addPage = useMemo(
    () =>
      (kind: 'page' | 'workspace' | 'team-link' = 'page') => {
        setAddingPage(kind);
      },
    [],
  );
  // A tab whose primary action is its own takes the TopBar's end in place of New meeting (one primary per
  // screen): Availability's New schedule, the Roster's Set usual hours, Round robin's New group, Calendars' Connect.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  // Pages' search and Routing's views, in the TopBar before whose bookings show: no second bar under the header.
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  const hasTools = viewHasTools(view);
  // Mine or Everyone (the owner's ask of 29 October 2026): an admin's choice, and anyone's whose scheduling reach
  // sees a colleague (spec 0037, AC-1262), kept here so Calendar and List share it; Meetings' People picker sets it.
  const access = useMyAccess();
  const seesOthers = access?.scheduling?.seesOthers === true;
  const isAdmin = useCan('booking.admin') || seesOthers;
  // The Roster only for someone who sees a colleague's scheduling, and Routing only for a holder of routing.manage
  // (spec 0037, AC-1447); either address falls back for everyone else.
  const canRoute = useCan('routing.manage');
  // Calendar sync off for the deployment with nothing connected (the bookings critique, A2): every Connect calendar
  // link hides, since it could only lead to "Calendar sync is off". Until the read answers, they show as before.
  const { data } = useRouteContext({ from: '__root__' });
  const calendar = useCalendar(data.calendar.view(slug));
  const canConnectCalendar = calendar.status !== 'ready' || calendar.enabled || calendar.connections.length > 0;
  // Calendars has no Connect with sync off, so New keeps the TopBar's end there rather than leaving it empty (A5).
  const ownsAction = OWN_ACTION.has(view);
  // Routing only for a holder of routing.manage (spec 0037, AC-1447).
  const tabs = useMemo(() => BOOKINGS_TABS.filter((each) => each !== 'routing' || canRoute), [canRoute]);
  // My hours · Roster only for someone who sees a colleague's scheduling (spec 0037, AC-1447).
  const hasRoster = access !== undefined && rosterIsShown(access);
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
                    tabs={<BookingsModuleTabs slug={slug} tab={tab} tabs={tabs} />}
                    scope={
                      <>
                        {hasTools && <div ref={setToolsSlot} />}
                        <BookingsScope slug={slug} tab={tab} view={view} hasRoster={hasRoster} />
                      </>
                    }
                    actionSlot={ownsAction ? setActionSlot : undefined}
                    addingPage={addingPage}
                    onAddPage={addPage}
                    onAddPageClose={() => {
                      setAddingPage(undefined);
                    }}
                  />
                ),
                body: (
                  <BookingsToolbarSlot value={hasTools ? toolsSlot : null}>
                    <Outlet />
                  </BookingsToolbarSlot>
                ),
              }}
            />
          </BookingsActionSlot>
        </BookingsHosts>
      </BookingsNewPage>
    </BookingsCalendarSync>
  );
}
