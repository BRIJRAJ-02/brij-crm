import {
  isDataError,
  type BookingAvailability,
  type BookingPageView,
  type BookingsCalendarHeld,
  type CalendarConnectionView,
  type DataLayer,
  type ObjectSummary,
} from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { useMemo } from 'react';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsCalendarScreen, BookingsFailed } from '../features/bookings/BookingsScreen.tsx';
import { bookingsSearchOf, parseBookingsSearch, rawOf } from '../features/bookings/search.ts';
import { strings } from '../features/bookings/strings.ts';
import { hostActions } from '../features/bookings/hostActions.ts';
import { workingStartOf } from '../features/bookings/span.ts';
import { addDays, weekRange } from '../features/bookings/week.ts';
import { browserZone } from '../features/booking/zone.ts';

// Bookings › Calendar (spec 0025, AC-646): the week (`w`, its Monday; `d`, the day picked) with the reader's own
// calendar events beside the bookings, filtered by `link` (one booking page) and `conn` (the calendars shown). The
// loader waits for the week's first read through the data layer; the screen holds it, so it is read again whenever
// the person comes back to the page (bookings have no change event yet). The Bookings layout draws the frame, the
// TopBar and the tabs. Paging weeks changes only the search, never the loader's deps: the screen stays and holds the
// next week's read (primed on entry for the weeks either side), so the toolbar never gives way to the pending page.
export const Route = createFileRoute('/w/$slug/bookings/calendar')({
  validateSearch: parseBookingsSearch,
  loaderDeps: () => ({}),
  loader: async ({ context, params, location }) => {
    const { data } = context;
    const shown = bookingsSearchOf(parseBookingsSearch(location.search)).week;
    const week = heldWeek(shown, data, params.slug);
    // The weeks either side, read behind, so Previous and Next show at once.
    for (const step of [-7, 7])
      heldWeek(addDays(shown, step), data, params.slug)
        .ready()
        .catch(() => undefined);
    const calendar = data.calendar.view(params.slug);
    const [objects, pages, hours] = await Promise.all([
      data.objects.list(params.slug),
      // The Link filter's choices; a member without booking pages has none.
      data.bookingPages.held(params.slug).catch(() => []),
      // Where a day starts when time is drawn from the keyboard; without it, 9:00.
      data.bookings.hours(params.slug, browserZone()).catch(() => undefined),
      week.ready(),
      calendar.ready().catch(() => undefined),
    ]);
    const state = calendar.getSnapshot();
    const connections = state.status === 'ready' ? state.connections.filter((each) => each.status !== 'revoked') : [];
    return { objects, pages, connections, availability: hours?.availability };
  },
  pendingComponent: CalendarPending,
  errorComponent: CalendarError,
  component: CalendarRoute,
});

/** The data layer's held read of the week starting on `monday`: the same one for the same week, every time. */
function heldWeek(monday: string, data: DataLayer, slug: string): BookingsCalendarHeld {
  const range = weekRange(monday);
  return data.bookings.calendar(slug, range.from, range.to);
}

/** What the loader read beside the week. */
interface CalendarLoaded {
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
  readonly connections: readonly CalendarConnectionView[];
  readonly availability: BookingAvailability | undefined;
}

function CalendarRoute() {
  return <Calendar {...Route.useLoaderData()} />;
}

/**
 * While the page loads (shown only once the loading delay passed, so its skeleton shows at once): the screen
 * itself, its week loading under its own toolbar, so the page lands exactly where its skeleton stood.
 */
function CalendarPending() {
  return (
    <LoadingNow>
      <Calendar objects={[]} pages={[]} connections={[]} availability={undefined} />
    </LoadingNow>
  );
}

function Calendar({ objects, pages, connections, availability }: CalendarLoaded) {
  const { slug } = Route.useParams();
  const search = bookingsSearchOf(Route.useSearch());
  const navigate = useNavigate();
  const { data, toasts } = Route.useRouteContext();
  // One set of calls per workspace: a dialog holding them never reads again because the route drew again.
  const actions = useMemo(() => hostActions(data, toasts, slug), [data, toasts, slug]);
  const week = heldWeek(search.week, data, slug);
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
      onBlock={(draft, preview) => data.bookings.blocks.create(slug, draft, preview)}
      workingStart={(dayKey) => workingStartOf(availability, dayKey)}
      onBookAsHost={async (meeting) => {
        await data.bookings.bookAsHost(slug, { ...meeting, guests: [...meeting.guests] });
      }}
      newBookingKey={data.bookings.newKey}
      toasts={toasts}
      actions={actions}
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
