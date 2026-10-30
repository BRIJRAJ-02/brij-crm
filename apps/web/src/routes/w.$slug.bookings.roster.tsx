import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { TeamWeekPending, TeamWeekScreen } from '../features/booking/TeamWeekScreen.tsx';
import { rosterIsShown, rosterSearch } from '../features/booking/links.ts';
import { memberZone } from '../features/booking/zone.ts';
import { strings } from '../features/booking/strings.ts';
import { teamWeekStrings } from '../features/booking/team-week-strings.ts';

// Bookings › Roster (spec 0037, job J6): the team's week, a tab of its own beside Availability since 31 October 2026
// (the owner's ask; it was Availability's Team view behind a Mine | Team switch, and an old `?view=team` link still
// lands here). `?week=` names a Monday, `?q=` a name. The week comes from the scheduling chunk's store, read again
// live, so another tab's change shows here.
export const Route = createFileRoute('/w/$slug/bookings/roster')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  validateSearch: rosterSearch,
  // The week alone reloads the route: a search is read by the screen's own held week (its rows show their loading in
  // place), so typing never swaps the page for its pending state and loses the field's focus. The first read takes
  // the address's `?q=`, so a shared link opens searched.
  loaderDeps: ({ search }) => ({ week: search.week }),
  loader: async ({ context, params, deps, location }) => {
    // Only someone who sees a colleague's scheduling has a roster (spec 0037, AC-1447); anyone else opens their own
    // hours, Availability, where a roster of one would have shown them.
    if (!rosterIsShown(await context.data.access.mine(params.slug))) {
      throw redirect({ to: '/w/$slug/bookings/availability', params: { slug: params.slug }, replace: true });
    }
    const zone = memberZone(context.data, params.slug);
    const q = rosterSearch(location.search).q ?? '';
    const team = await (await context.data.scheduling.open()).openTeamWeek(params.slug, deps.week, q, zone);
    return { zone, ...team };
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: RosterRoutePending,
  errorComponent: RosterError,
  component: RosterRoute,
});

function RosterRoutePending() {
  const { week } = Route.useSearch();
  return (
    <LoadingNow>
      <TeamWeekPending week={week} />
    </LoadingNow>
  );
}

function RosterRoute() {
  const loaded = Route.useLoaderData();
  const { q } = Route.useSearch();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return (
    <TeamWeekScreen
      data={data}
      slug={slug}
      week={loaded.week}
      search={q ?? ''}
      zone={loaded.zone}
      members={loaded.members}
    />
  );
}

function RosterError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    // Inside the Bookings frame, which already draws the TopBar and the tab strip: the tab's own panel says so.
    <PageColumn>
      <EmptyState tone="error" title={teamWeekStrings.failed} onRetry={() => void router.invalidate()}>
        {isDataError(error) ? error.message : strings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
