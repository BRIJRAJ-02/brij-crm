import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AvailabilityPending, AvailabilityScreen } from '../features/booking/AvailabilityScreen.tsx';
import { TeamWeekScreen } from '../features/booking/TeamWeekScreen.tsx';
import { hoursSearch, rosterIsShown } from '../features/booking/links.ts';
import { memberZone } from '../features/booking/zone.ts';
import { strings } from '../features/booking/strings.ts';
import { scheduleStrings } from '../features/booking/schedule-strings.ts';
import { teamWeekStrings } from '../features/booking/team-week-strings.ts';

// Bookings › Hours (2 November 2026): when we are free, in two views the address holds as `v` — Mine (the
// member's own schedules, spec 0035, AC-969/970) and Team (the team's bookable week, spec 0037 job J6). They were
// two tabs, Availability and Roster, two words for the same subject; before 31 October the Team week was already
// Availability's Team view behind a Mine | Team switch, so this puts the two scopes of one subject back in one
// place with the switch on the tools' row.
// Team is only for whoever sees a colleague's scheduling (`rosterIsShown`): a roster of one is just your own hours,
// so for everybody else the switch is not drawn at all and `?v=team` falls back to Mine.
// Mine: `?member=` (an admin reading a colleague's, AC-971) and `?schedule=` (which one).
// Team: `?week=` (a Monday) and `?q=` (a name).
export const Route = createFileRoute('/w/$slug/bookings/hours')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  validateSearch: hoursSearch,
  // The team week alone reloads the route; a name typed into its search is read by the screen's own held week, so
  // typing never swaps the page for its pending state and loses the field's focus.
  loaderDeps: ({ search }) =>
    // Each view's own deps only, so a `member` typed into a team address never re-reads the team week.
    search.v === 'team' ? { view: 'team' as const, week: search.week } : { view: undefined, member: search.member },
  loader: async ({ context, params, deps, location }) => {
    const access = await context.data.access.mine(params.slug);
    const zone = memberZone(context.data, params.slug);
    // The Team view is only for someone who sees a colleague's scheduling (spec 0037, AC-1447). Asking for it
    // without that reach lands on Mine, exactly as `/bookings/roster` used to redirect to Availability.
    if (deps.view === 'team') {
      if (!rosterIsShown(access)) {
        throw redirect({ to: '/w/$slug/bookings/hours', params: { slug: params.slug }, replace: true });
      }
      const q = hoursSearch(location.search).q ?? '';
      const [team, teams] = await Promise.all([
        context.data.scheduling.open().then((store) => store.openTeamWeek(params.slug, deps.week, q, zone)),
        // The team filter (AC-1289): the cached list, read again on a live team change; none when it fails.
        context.data.teams.list(params.slug).catch(() => []),
      ]);
      return { view: 'team' as const, zone, teams, ...team };
    }
    // Whose schedules the reader may see comes from the server's reach (`members.visible`, spec 0037, AC-1268): a
    // colleague outside it opens the reader's own. The workspace's members name whoever changed a schedule last.
    const [members, people] = await Promise.all([
      context.data.scheduling.open().then((scheduling) => scheduling.visible(params.slug)),
      context.data.members.list(params.slug),
    ]);
    const member =
      deps.member !== undefined && deps.member !== access.memberId && members.some((each) => each.id === deps.member)
        ? deps.member
        : undefined;
    await Promise.all([
      context.data.schedules.view(params.slug, member, zone).ready(),
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
      view: 'mine' as const,
      member,
      members,
      me: access.memberId,
      ownHours: access.permissions.includes('availability.own'),
      people,
      // The switch itself: drawn only for a reader whose scheduling reach sees a colleague.
      hasTeam: rosterIsShown(access),
    };
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: HoursPending,
  errorComponent: HoursError,
  component: HoursRoute,
});

/**
 * The skeleton while the loader runs. It never reads `?v=team`: a reader without the reach is about to be sent to
 * their own hours, and a team-week skeleton would name a view they may not have before the access read comes back.
 * Mine's skeleton is the one everybody may see.
 */
function HoursPending() {
  return (
    <LoadingNow>
      <AvailabilityPending />
    </LoadingNow>
  );
}

function HoursRoute() {
  const loaded = Route.useLoaderData();
  return loaded.view === 'team' ? <HoursTeam /> : <HoursMine />;
}

/** Hours › Team: the team's bookable week (spec 0037, job J6). */
function HoursTeam() {
  const loaded = Route.useLoaderData();
  const { q } = Route.useSearch();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (loaded.view !== 'team') return undefined;
  return (
    <TeamWeekScreen
      data={data}
      slug={slug}
      week={loaded.week}
      search={q ?? ''}
      zone={loaded.zone}
      members={loaded.members}
      teams={loaded.teams}
      hasMineSwitch
    />
  );
}

/** Hours › Mine: the member's own schedules, the open one in its editor (spec 0035). */
function HoursMine() {
  const loaded = Route.useLoaderData();
  const { schedule } = Route.useSearch();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (loaded.view !== 'mine') return undefined;
  const { member, members, me, ownHours, people, hasTeam } = loaded;
  return (
    <AvailabilityScreen
      data={data}
      slug={slug}
      scheduleId={schedule}
      member={member}
      members={members}
      me={me}
      ownHours={ownHours}
      hasTeamSwitch={hasTeam}
      nameOf={(id) => people.find((person) => person.id === id)?.name}
      // Who may cover time off: never a guest, who takes no bookings (spec 0031, slice 9). Names still read from all.
      people={people.filter((person) => person.role !== 'guest')}
    />
  );
}

function HoursError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const { v } = Route.useSearch();
  return (
    // Inside the Bookings frame, which already draws the TopBar and the tab strip: the tab's own panel says so.
    <PageColumn>
      <EmptyState
        tone="error"
        title={v === 'team' ? teamWeekStrings.failed : scheduleStrings.schedulesFailed}
        onRetry={() => void router.invalidate()}
      >
        {isDataError(error) ? error.message : strings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
