import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn, TopBar } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AvailabilityPending, AvailabilityScreen } from '../features/booking/AvailabilityScreen.tsx';
import { memberZone } from '../features/booking/zone.ts';
import { availabilitySearch } from '../features/booking/links.ts';
import { scheduleStrings } from '../features/booking/schedule-strings.ts';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Bookings › Availability (spec 0035, AC-969, AC-970): the tab is the open schedule's editor, the Calendly way (22
// October 2026): the default opens first, `?schedule=` names another. The schedules come from the data layer's held
// list (the virtual default, weekdays 09:00 to 17:00 in the browser's zone, until they save any), read again live,
// so another tab's save shows here.
export const Route = createFileRoute('/w/$slug/bookings/availability')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  // `?member=`: an admin viewing a colleague's schedules (AC-971); anyone else sees their own. `?schedule=`: which.
  validateSearch: availabilitySearch,
  // An old link to the Team week (`?view=team`, before the Roster had a tab of its own) goes on to Bookings › Roster,
  // keeping its week and search.
  beforeLoad: ({ params, search }) => {
    if (search.view !== 'team') return;
    throw redirect({
      to: '/w/$slug/bookings/roster',
      params: { slug: params.slug },
      search: {
        ...(search.week === undefined ? {} : { week: search.week }),
        ...(search.q === undefined ? {} : { q: search.q }),
      },
      replace: true,
    });
  },
  loaderDeps: ({ search }) => ({ member: search.member }),
  loader: async ({ context, params, deps }) => {
    // Whose schedules the reader may see comes from the server's reach (`members.visible`, spec 0037, AC-1268): a
    // colleague outside it opens the reader's own. The workspace's members name whoever changed a schedule last.
    const [access, members, people] = await Promise.all([
      context.data.access.mine(params.slug),
      context.data.scheduling.open().then((scheduling) => scheduling.visible(params.slug)),
      context.data.members.list(params.slug),
    ]);
    const member =
      deps.member !== undefined && deps.member !== access.memberId && members.some((each) => each.id === deps.member)
        ? deps.member
        : undefined;
    await Promise.all([
      context.data.schedules.view(params.slug, member, memberZone(context.data, params.slug)).ready(),
      // Time off (spec 0037, AC-1286), from the store `scheduling.open()` loaded above; a failure shows in its card.
      context.data.scheduling
        .loaded()
        ?.timeOff.held(params.slug, member)
        .ready()
        .catch(() => undefined),
      // Meeting limits (spec 0037, AC-1299), the same way.
      context.data.scheduling
        .loaded()
        ?.limits.held(params.slug, member)
        .ready()
        .catch(() => undefined),
    ]);
    return {
      member,
      members,
      me: access.memberId,
      ownHours: access.permissions.includes('availability.own'),
      people,
    };
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: AvailabilityRoutePending,
  errorComponent: AvailabilityError,
  component: AvailabilityRoute,
});

function AvailabilityRoutePending() {
  return (
    <LoadingNow>
      <AvailabilityPending />
    </LoadingNow>
  );
}

function AvailabilityRoute() {
  const loaded = Route.useLoaderData();
  const { schedule } = Route.useSearch();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  const { member, members, me, ownHours, people } = loaded;
  return (
    <AvailabilityScreen
      data={data}
      slug={slug}
      scheduleId={schedule}
      member={member}
      members={members}
      me={me}
      ownHours={ownHours}
      nameOf={(id) => people.find((person) => person.id === id)?.name}
      people={people}
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
            <EmptyState tone="error" title={scheduleStrings.schedulesFailed} onRetry={() => void router.invalidate()}>
              {isDataError(error) ? error.message : strings.failedText}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}
