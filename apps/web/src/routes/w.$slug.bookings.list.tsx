import { isDataError, type BookingsTab } from '@crm/data';
import { useMemo } from 'react';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsFailed, BookingsListScreen, BookingsPending } from '../features/bookings/BookingsScreen.tsx';
import { bookingsSearchOf, parseBookingsSearch, rawOf } from '../features/bookings/search.ts';
import { strings } from '../features/bookings/strings.ts';
import { hostActions } from '../features/bookings/hostActions.ts';

// Bookings › List (spec 0025, AC-646): Upcoming, Past (`tab=past`) or Canceled (`tab=cancelled`), a page of them
// (`page`, `per`), the sort (`sort`) and one booking page (`link`). The loader waits for the tab's first read
// through the data layer; the screen holds the three lists, so each is read again whenever the person comes back to
// the page. The Bookings layout draws the frame, the TopBar and the tabs.
export const Route = createFileRoute('/w/$slug/bookings/list')({
  validateSearch: parseBookingsSearch,
  loaderDeps: ({ search }): { readonly tab: BookingsTab } => ({ tab: search.tab ?? 'upcoming' }),
  loader: async ({ context, params, deps }) => {
    const { data } = context;
    const lists = {
      upcoming: data.bookings.view(params.slug, 'upcoming'),
      past: data.bookings.view(params.slug, 'past'),
      cancelled: data.bookings.view(params.slug, 'cancelled'),
    };
    const [objects, pages] = await Promise.all([
      data.objects.list(params.slug),
      data.bookingPages.list(params.slug).catch(() => []),
      lists[deps.tab].ready(),
    ]);
    return { lists, objects, pages };
  },
  pendingComponent: BookingsPending,
  errorComponent: ListError,
  component: ListRoute,
});

function ListRoute() {
  const { lists, objects, pages } = Route.useLoaderData();
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
      lists={lists}
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
