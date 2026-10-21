import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { BookingsTabs } from '../features/bookings/BookingsTabs.tsx';
import { BookingsTopBar } from '../features/bookings/BookingsTopBar.tsx';
import { bookingsTabOf } from '../features/bookings/tabs.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Bookings, first under Scheduling in the sidebar (spec 0034), laid out as People is: the frame, the TopBar (the
// tile, the upcoming count and New) and the tab strip (Calendar · List) in the row People's ViewBar takes, with the
// tab's own route (`bookings.calendar`, `bookings.list`) drawn in the chosen panel. A tab's own WorkspacePage draws
// only its body inside this frame. The layout owns New, so it never moves or remounts as the tabs change. Bare
// `/bookings` goes to Calendar, or List for an old `?view=list` link (`bookings.index`). Availability is a page of
// its own (`/availability`), and `/bookings/availability` redirects there (AC-929).
export const Route = createFileRoute('/w/$slug/bookings')({
  component: BookingsRoute,
});

function BookingsRoute() {
  const { slug } = Route.useParams();
  const tab = useLocation({ select: (location) => bookingsTabOf(location.pathname) });
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <BookingsTopBar slug={slug} />,
        body: (
          <BookingsTabs slug={slug} tab={tab}>
            <Outlet />
          </BookingsTabs>
        ),
      }}
    />
  );
}
