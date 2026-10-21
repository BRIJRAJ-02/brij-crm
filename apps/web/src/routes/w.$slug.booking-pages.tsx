import { createFileRoute, Outlet } from '@tanstack/react-router';
import { CapturesLayout } from '../features/captures/CapturesLayout.tsx';

// Scheduling › Booking pages (spec 0034, AC-928; Captures › Links before, and `/captures/links` redirects here):
// the layout, in People's chrome. The frame, the TopBar (the scheduling tile, the count and New) and the bar under
// it holding the search, with the list (`booking-pages.index`) drawn below. The layout owns New and the search,
// so neither moves or remounts while the list loads. A page's editor sits outside it (`booking-pages_.$pageId`).
export const Route = createFileRoute('/w/$slug/booking-pages')({
  component: BookingPagesRoute,
});

function BookingPagesRoute() {
  const { slug } = Route.useParams();
  return (
    <CapturesLayout slug={slug} page="links">
      <Outlet />
    </CapturesLayout>
  );
}
