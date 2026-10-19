import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingPagesPending, BookingPagesScreen } from '../features/booking/BookingPagesScreen.tsx';
import { strings } from '../features/booking/strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings › Booking pages (spec 0025, AC-645): the member's pages, everyone's with `booking.admin`, read through
// the data layer.
export const Route = createFileRoute('/w/$slug/settings/booking-pages/')({
  loader: async ({ context, params }) => {
    try {
      return { pages: await context.data.bookingPages.list(params.slug) };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { pages: undefined };
      throw error;
    }
  },
  pendingComponent: BookingPagesPending,
  errorComponent: BookingPagesError,
  component: BookingPagesRoute,
});

function BookingPagesRoute() {
  const { pages } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (pages === undefined) return <SettingsMissing current="booking-pages" />;
  return <BookingPagesScreen data={data} slug={slug} pages={pages} />;
}

function BookingPagesError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
      current="booking-pages"
    />
  );
}
