import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingPageBuilder } from '../features/booking/BookingPageBuilder.tsx';
import { BookingPagesPending } from '../features/booking/BookingPagesScreen.tsx';
import { strings } from '../features/booking/strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';

// One booking page's builder (spec 0025, AC-623, AC-624): the page read through the data layer; one that was
// deleted or isn't the reader's answers NOT_FOUND, said inside the settings frame.
export const Route = createFileRoute('/w/$slug/settings/booking-pages/$pageId')({
  loader: async ({ context, params }) => {
    try {
      return { page: await context.data.bookingPages.get(params.slug, params.pageId) };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: BookingPagesPending,
  errorComponent: BuilderError,
  component: BuilderRoute,
});

function BuilderRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  const router = useRouter();
  if (page === undefined) {
    return (
      <SettingsFailed
        title={strings.title}
        heading={strings.notFoundTitle}
        text={strings.notFoundText}
        onRetry={() => void router.invalidate()}
        current="booking-pages"
      />
    );
  }
  // A page of its own per id, so its draft starts afresh.
  return <BookingPageBuilder key={page.id} data={data} slug={slug} page={page} />;
}

function BuilderError({ error }: ErrorComponentProps) {
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
