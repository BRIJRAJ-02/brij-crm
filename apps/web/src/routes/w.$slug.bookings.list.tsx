import {
  isDataError,
  type BookingPageView,
  type BookingsTab,
  type BookingsView,
  type DataLayer,
  type ObjectSummary,
} from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { useMemo } from 'react';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsFailed, BookingsListScreen } from '../features/bookings/BookingsScreen.tsx';
import { bookingsSearchOf, parseBookingsSearch, rawOf } from '../features/bookings/search.ts';
import { strings } from '../features/bookings/strings.ts';
import { hostActions } from '../features/bookings/hostActions.ts';

// Bookings › List (spec 0025, AC-646): Upcoming, Past (`tab=past`) or Canceled (`tab=cancelled`), a page of them
// (`page`, `per`), the sort (`sort`) and one booking page (`link`). The loader waits for the tab's first read
// through the data layer, and reads the other two behind it; the screen holds the three lists, so each is read again
// whenever the person comes back to the page. Upcoming, Past and Canceled change only the search, never the loader's
// deps, so switching between them keeps the screen rather than giving way to the pending page. The Bookings layout
// draws the frame, the TopBar and the tabs.
export const Route = createFileRoute('/w/$slug/bookings/list')({
  validateSearch: parseBookingsSearch,
  loaderDeps: () => ({}),
  loader: async ({ context, params, location }) => {
    const { data } = context;
    const lists = listsOf(data, params.slug);
    const shown = parseBookingsSearch(location.search).tab ?? 'upcoming';
    for (const tab of BOOKINGS_LISTS) if (tab !== shown) lists[tab].ready().catch(() => undefined);
    const [objects, pages] = await Promise.all([
      data.objects.list(params.slug),
      data.bookingPages.held(params.slug).catch(() => []),
      lists[shown].ready(),
    ]);
    return { objects, pages };
  },
  pendingComponent: ListPending,
  errorComponent: ListError,
  component: ListRoute,
});

/** The three lists the screen switches between. */
const BOOKINGS_LISTS: readonly BookingsTab[] = ['upcoming', 'past', 'cancelled'];

/** The data layer's held lists, one per tab: the same ones every time. */
function listsOf(data: DataLayer, slug: string): Readonly<Record<BookingsTab, BookingsView>> {
  return {
    upcoming: data.bookings.view(slug, 'upcoming'),
    past: data.bookings.view(slug, 'past'),
    cancelled: data.bookings.view(slug, 'cancelled'),
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
  const search = bookingsSearchOf(Route.useSearch());
  const navigate = useNavigate();
  const { data, toasts } = Route.useRouteContext();
  // One set of calls per workspace: a dialog holding them never reads again because the route drew again.
  const actions = useMemo(() => hostActions(data, toasts, slug), [data, toasts, slug]);
  return (
    <BookingsListScreen
      slug={slug}
      search={search}
      lists={listsOf(data, slug)}
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
