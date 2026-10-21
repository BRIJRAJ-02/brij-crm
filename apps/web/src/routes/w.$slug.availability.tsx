import { isDataError } from '@crm/data';
import { EmptyState, PageColumn, TopBar, LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AvailabilityPending, AvailabilityScreen } from '../features/booking/AvailabilityScreen.tsx';
import { browserZone } from '../features/booking/hours.ts';
import { strings } from '../features/booking/strings.ts';
import { SCHEDULING_HUE } from '../features/scheduling.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Scheduling › Availability (spec 0025 experience; a page of its own since spec 0034, AC-928, and
// `/bookings/availability` redirects here): the member's own weekly hours and days off, read through the data layer
// (weekdays 09:00 to 17:00 in the browser's zone until set).
export const Route = createFileRoute('/w/$slug/availability')({
  loader: async ({ context, params }) => {
    const [{ availability }, listed, access] = await Promise.all([
      context.data.bookings.hours(params.slug, browserZone()),
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
      availability,
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
  const { availability, pages, pagesStatus } = Route.useLoaderData();
  const router = useRouter();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return (
    <AvailabilityScreen
      data={data}
      slug={slug}
      availability={availability}
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
      currentPage="availability"
      page={{
        topBar: <TopBar title={strings.availability} icon="clock" hue={SCHEDULING_HUE} />,
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
