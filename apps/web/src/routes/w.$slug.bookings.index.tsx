import { createFileRoute } from '@tanstack/react-router';
import { BookingsScreen } from '../features/bookings/BookingsScreen.tsx';

// The workspace's upcoming bookings, after Records in the sidebar. A
// placeholder until the booking lane brings the list: "Nothing coming up",
// with the way to Captures › Links.
export const Route = createFileRoute('/w/$slug/bookings/')({
  component: BookingsRoute,
});

function BookingsRoute() {
  const { slug } = Route.useParams();
  return <BookingsScreen slug={slug} />;
}
