import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AvailabilityPending, AvailabilityScreen } from '../features/booking/AvailabilityScreen.tsx';
import { browserZone } from '../features/booking/zone.ts';
import { memberSearch } from '../features/booking/links.ts';
import { scheduleStrings } from '../features/booking/schedule-strings.ts';
import { strings } from '../features/booking/strings.ts';
import { SCHEDULING_HUE } from '../features/scheduling.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Scheduling › Availability (spec 0035, AC-969; a page of its own since spec 0034, AC-928, and
// `/bookings/availability` redirects here): the member's schedules, from the data layer's held list (the virtual
// default, weekdays 09:00 to 17:00 in the browser's zone, until they save any), read again live, so another tab's
// save shows here. Each opens in its editor (`availability_.$scheduleId`).
export const Route = createFileRoute('/w/$slug/availability')({
  // `?member=`: an admin viewing a colleague's schedules (AC-971); anyone else sees their own.
  validateSearch: memberSearch,
  loaderDeps: ({ search }) => ({ member: search.member }),
  loader: async ({ context, params, deps }) => {
    // Whose schedules the reader may view comes from the server's reach (`canActFor`, spec 0037): a colleague
    // outside it opens the reader's own.
    const [access, members] = await Promise.all([
      context.data.access.mine(params.slug),
      context.data.schedules.members(params.slug),
    ]);
    const member =
      deps.member !== undefined && deps.member !== access.memberId && members.some((each) => each.id === deps.member)
        ? deps.member
        : undefined;
    await context.data.schedules.view(params.slug, member, browserZone()).ready();
    return { member, members, me: access.memberId };
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
  const { member, members, me } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return (
    <AvailabilityScreen
      data={data}
      slug={slug}
      locale={navigator.languages[0] ?? 'en-US'}
      member={member}
      members={members}
      me={me}
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
            <EmptyState tone="error" title={scheduleStrings.schedulesFailed} onRetry={() => void router.invalidate()}>
              {isDataError(error) ? error.message : strings.failedText}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}
