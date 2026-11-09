import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { BookingsSettingsFrameContext } from '../features/bookings/settings-frame.ts';
import {
  bookingsSettingsNav,
  bookingsSettingsPageOf,
  visibleBookingsSettingsNav,
} from '../features/bookings/settings-nav.ts';
import { SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { SettingsTopBarSlot } from '../features/settings/topBarSlot.ts';
import { useMyAccess, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Bookings settings (the mock's IA, 9 November 2026): the module's own settings behind the gear on Bookings' TopBar,
// beside the app's sidebar with Bookings current. Its navigation is grouped (Connections, People, Guests see), and
// each page is the settings screen the app's Settings showed before (Calendars, round robin's groups as Teams,
// Scheduling access, Brand), re-housed, not redrawn: the frame stays mounted while the person moves between them,
// and each page portals its own TopBar (Bookings › Settings › its name) into the frame's bar.
export const Route = createFileRoute('/w/$slug/bookings_/settings')({
  component: BookingsSettingsRoute,
  // An address here that names no page stays in Bookings settings, its navigation with it.
  notFoundComponent: BookingsSettingsNotFound,
});

function BookingsSettingsRoute() {
  return <BookingsSettingsFrame body={<Outlet />} />;
}

function BookingsSettingsNotFound() {
  return <BookingsSettingsFrame body={<SettingsMissing backTo="home" />} />;
}

/** Bookings settings' navigation for the page, and the place above the view where the page draws its TopBar. */
function BookingsSettingsFrame({ body }: { readonly body: ReactNode }) {
  const { slug } = Route.useParams();
  const current = useLocation({ select: (location) => bookingsSettingsPageOf(location.pathname) });
  const access = useMyAccess();
  const permissions = access?.permissions;
  const isGuest = access?.role === 'guest';
  const frame = useMemo(
    () => ({ slug, current, nav: visibleBookingsSettingsNav(bookingsSettingsNav(slug), permissions, isGuest) }),
    [slug, current, permissions, isGuest],
  );
  const [topBarSlot, setTopBarSlot] = useState<HTMLElement | null>(null);
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <div ref={setTopBarSlot} />,
        body: (
          <BookingsSettingsFrameContext value={frame}>
            <SettingsTopBarSlot value={topBarSlot}>{body}</SettingsTopBarSlot>
          </BookingsSettingsFrameContext>
        ),
      }}
    />
  );
}
