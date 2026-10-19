import { isDataError } from '@crm/data';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsCalendarScreen, BookingsFailed, BookingsPending } from '../features/bookings/BookingsScreen.tsx';
import { bookingsSearchOf, parseBookingsSearch, rawOf } from '../features/bookings/search.ts';
import { strings } from '../features/bookings/strings.ts';
import { dayKeyOf, weekOf, weekRange } from '../features/bookings/week.ts';

// Bookings › Calendar (spec 0025, AC-646): the week (`w`, its Monday; `d`, the day picked) with the reader's own
// calendar events beside the bookings, filtered by `link` (one booking page) and `conn` (the calendars shown). The
// loader waits for the week's first read through the data layer; the screen holds it, so it is read again whenever
// the person comes back to the page (bookings have no change event yet). The Bookings layout draws the frame, the
// TopBar and the tabs.
export const Route = createFileRoute('/w/$slug/bookings/calendar')({
  validateSearch: parseBookingsSearch,
  loaderDeps: ({ search }) => ({ week: search.w ?? weekOf(search.d ?? dayKeyOf(new Date())) }),
  loader: async ({ context, params, deps }) => {
    const { data } = context;
    const range = weekRange(deps.week);
    const week = data.bookings.calendar(params.slug, range.from, range.to);
    const calendar = data.calendar.view(params.slug);
    const [objects, pages] = await Promise.all([
      data.objects.list(params.slug),
      // The Link filter's choices; a member without booking pages has none.
      data.bookingPages.list(params.slug).catch(() => []),
      week.ready(),
      calendar.ready().catch(() => undefined),
    ]);
    const state = calendar.getSnapshot();
    const connections = state.status === 'ready' ? state.connections.filter((each) => each.status !== 'revoked') : [];
    return { week, objects, pages, connections };
  },
  pendingComponent: BookingsPending,
  errorComponent: CalendarError,
  component: CalendarRoute,
});

function CalendarRoute() {
  const { week, objects, pages, connections } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = bookingsSearchOf(Route.useSearch());
  const navigate = useNavigate();
  const { data } = Route.useRouteContext();
  return (
    <BookingsCalendarScreen
      slug={slug}
      search={search}
      week={week}
      objects={objects}
      pages={pages}
      connections={connections}
      locale={navigator.languages[0] ?? 'en-GB'}
      onRemoveBlock={(blockId) => data.bookings.blocks.remove(slug, blockId)}
      onSearch={(next) =>
        void navigate({
          to: '/w/$slug/bookings/calendar',
          params: { slug },
          replace: true,
          search: rawOf('calendar', { ...search, ...next }),
        })
      }
    />
  );
}

function CalendarError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <BookingsFailed
      message={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
