import { isDataError } from '@crm/data';
import { EmptyState, PageColumn, TopBar, LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AvailabilityPending, AvailabilityScreen } from '../features/booking/AvailabilityScreen.tsx';
import { browserZone } from '../features/booking/hours.ts';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Bookings › Availability (spec 0025 experience; spec 0035): the member's default schedule, its weekly hours and days
// off, from the data layer's held list of their schedules (weekdays 09:00 to 17:00 in the browser's zone until they
// save any), so a save in another tab shows here. Their pages load beside it, each with the schedule it books by.
export const Route = createFileRoute('/w/$slug/bookings/availability')({
  loader: async ({ context, params }) => {
    const [, listed, access] = await Promise.all([
      context.data.schedules.view(params.slug, undefined, browserZone()).ready(),
      // The pages beside the week. A member who may not list them sees no list; any other failure says so there.
      context.data.bookingPages.held(params.slug).then(
        (pages) => ({ status: 'ready' as const, pages }),
        (error: unknown) =>
          isDataError(error) && error.code === 'FORBIDDEN'
            ? { status: 'ready' as const, pages: [] }
            : { status: 'error' as const, pages: [] },
      ),
      context.data.access.mine(params.slug),
    ]);
    return {
      pagesStatus: listed.status,
      pages: listed.pages.filter((page) => page.ownerMemberId === access.memberId),
    };
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: () => (
    <LoadingNow>
      <AvailabilityPending />
    </LoadingNow>
  ),
  errorComponent: AvailabilityError,
  component: AvailabilityRoute,
});

function AvailabilityRoute() {
  const { pages, pagesStatus } = Route.useLoaderData();
  const router = useRouter();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return (
    <AvailabilityScreen
      data={data}
      slug={slug}
      pages={pages}
      pagesStatus={pagesStatus}
      onRetryPages={() => void router.invalidate()}
      locale={navigator.languages[0] ?? 'en-US'}
    />
  );
}

function AvailabilityError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.availability} icon="clock" />,
        body: (
          <PageColumn>
            <EmptyState tone="error" title={strings.availabilityFailed} onRetry={() => void router.invalidate()}>
              {isDataError(error) ? error.message : strings.failedText}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}
