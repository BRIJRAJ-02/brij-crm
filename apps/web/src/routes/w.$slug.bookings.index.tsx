import { isDataError, type BookingsTab } from '@crm/data';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsFailed, BookingsPending, BookingsScreen } from '../features/bookings/BookingsScreen.tsx';
import { strings } from '../features/bookings/strings.ts';

// Bookings (spec 0025, AC-646): every booking the member may see, Upcoming, Past (`?tab=past`) or Canceled
// (`?tab=cancelled`), under day bands. The loader waits for the tab's first read through the data layer; the screen
// holds the lists, so each is read again whenever the person comes back to the page (bookings have no change event
// yet).
interface BookingsSearch {
  readonly tab?: 'past' | 'cancelled';
}

export const Route = createFileRoute('/w/$slug/bookings/')({
  validateSearch: (search: Record<string, unknown>): BookingsSearch =>
    search.tab === 'past' || search.tab === 'cancelled' ? { tab: search.tab } : {},
  loaderDeps: ({ search }): { readonly tab: BookingsTab } => ({ tab: search.tab ?? 'upcoming' }),
  loader: async ({ context, params, deps }) => {
    const views = {
      upcoming: context.data.bookings.view(params.slug, 'upcoming'),
      past: context.data.bookings.view(params.slug, 'past'),
      cancelled: context.data.bookings.view(params.slug, 'cancelled'),
    };
    const [objects] = await Promise.all([context.data.objects.list(params.slug), views[deps.tab].ready()]);
    return { views, objects };
  },
  pendingComponent: BookingsPending,
  errorComponent: BookingsError,
  component: BookingsRoute,
});

function BookingsRoute() {
  const { views, objects } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <BookingsScreen
      slug={slug}
      tab={tab ?? 'upcoming'}
      views={views}
      objects={objects}
      onTab={(next) =>
        void navigate({ to: '/w/$slug/bookings', params: { slug }, search: next === 'upcoming' ? {} : { tab: next } })
      }
    />
  );
}

function BookingsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <BookingsFailed
      message={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
