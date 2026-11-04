import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinksPending, LinksScreen } from '../features/booking/LinksScreen.tsx';
import { strings } from '../features/booking/strings.ts';
import { BookingsPagesScope } from '../features/bookings/BookingsPagesScope.tsx';

// Bookings › Pages (the bookings critique, B-02): the booking pages, first in Bookings, as Calendly's Scheduling
// opens on its event types. The same screen and held list as Captures › Links (`bookingPages.view`), so a change in
// either shows in both; Captures › Links stays where it was. The list's search portals into Bookings' strip and its
// empty state's New opens the TopBar's New booking page (`BookingsPagesScope`).
export const Route = createFileRoute('/w/$slug/bookings/pages')({
  loader: async ({ context, params }) => {
    // The reader's calendars, read behind: a page's editor opened from here knows its calendar note at once.
    context.data.calendar
      .view(params.slug)
      .ready()
      .catch(() => undefined);
    try {
      await context.data.bookingPages.view(params.slug).ready();
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return;
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <BookingsPagesScope>
        <LinksPending />
      </BookingsPagesScope>
    </LoadingNow>
  ),
  errorComponent: PagesError,
  component: PagesRoute,
});

function PagesRoute() {
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return (
    <BookingsPagesScope>
      <LinksScreen data={data} slug={slug} />
    </BookingsPagesScope>
  );
}

function PagesError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <PageColumn>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
        {isDataError(error) ? error.message : strings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
