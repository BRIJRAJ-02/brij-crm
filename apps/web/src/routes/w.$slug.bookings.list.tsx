import { isDataError, type BookingPageView, type MeetingsQuery, type ObjectSummary } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { useMemo } from 'react';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsFailed, BookingsListScreen } from '../features/bookings/BookingsScreen.tsx';
import { bookingsSearchOf, parseBookingsSearch, rawOf, type BookingsSearch } from '../features/bookings/search.ts';
import { strings } from '../features/bookings/strings.ts';
import { hostActions } from '../features/bookings/hostActions.ts';
import { useFirstDay } from '../features/workspace/first-day.ts';

// Bookings › List (spec 0025, AC-646; every meeting, the owner's ask of 21 October 2026): Upcoming, Past (`tab=past`)
// or Canceled (`tab=cancelled`), All, Bookings or Calendar (`src`), one booking page (`link`) and the calendars the
// panel picks (`cal`), a page at a time (More). The loader waits for the list's first page through the data layer;
// the screen holds it, so it is read again whenever the person comes back to the page. Changing the tab or the source
// changes only the search, never the loader's deps, so the screen stays. The Bookings layout draws the frame, the
// TopBar and the tabs.
export const Route = createFileRoute('/w/$slug/bookings/list')({
  validateSearch: parseBookingsSearch,
  loaderDeps: () => ({}),
  loader: async ({ context, params, location }) => {
    const { data } = context;
    const search = bookingsSearchOf(parseBookingsSearch(location.search));
    const [objects, pages] = await Promise.all([
      data.objects.list(params.slug),
      data.bookingPages.held(params.slug).catch(() => []),
      data.bookings.meetings(params.slug, queryOf(search)).ready(),
    ]);
    return { objects, pages };
  },
  pendingComponent: ListPending,
  errorComponent: ListError,
  component: ListRoute,
});

/** The list's question from the address: the tab, the source and the calendars picked. */
function queryOf(search: BookingsSearch): MeetingsQuery {
  return {
    when: search.tab,
    source: search.source,
    ...(search.cal === undefined ? {} : { calendarIds: search.cal }),
  };
}

/** What the loader read beside the lists. */
interface ListLoaded {
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
}

function ListRoute() {
  return <List {...Route.useLoaderData()} />;
}

/**
 * While the page loads (shown only once the loading delay passed, so its skeleton shows at once): the screen
 * itself, its list loading under its own bar, so the page lands exactly where its skeleton stood.
 */
function ListPending() {
  return (
    <LoadingNow>
      <List objects={[]} pages={[]} />
    </LoadingNow>
  );
}

function List({ objects, pages }: ListLoaded) {
  const { slug } = Route.useParams();
  const search = bookingsSearchOf(Route.useSearch(), new Date(), useFirstDay());
  const navigate = useNavigate();
  const { data, toasts } = Route.useRouteContext();
  // One set of calls per workspace: a dialog holding them never reads again because the route drew again.
  const actions = useMemo(() => hostActions(data, toasts, slug), [data, toasts, slug]);
  return (
    <BookingsListScreen
      slug={slug}
      search={search}
      meetings={(query) => data.bookings.meetings(slug, query)}
      calendars={data.calendar.calendars(slug)}
      onMakeDefault={(calendarId) => void data.calendar.setDestination(slug, calendarId)}
      onDismissNotice={() => void data.calendar.dismissCalendarNotice(slug)}
      objects={objects}
      pages={pages}
      locale={navigator.languages[0] ?? 'en-GB'}
      actions={actions}
      onSearch={(next) =>
        void navigate({
          to: '/w/$slug/bookings/list',
          params: { slug },
          replace: true,
          search: rawOf('list', { ...search, ...next }),
        })
      }
    />
  );
}

function ListError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <BookingsFailed
      message={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
