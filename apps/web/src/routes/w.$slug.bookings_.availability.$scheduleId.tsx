import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { browserZone } from '../features/booking/hours.ts';
import { memberSearch } from '../features/booking/links.ts';
import { ScheduleEditor, ScheduleEditorPending } from '../features/booking/ScheduleEditor.tsx';
import { scheduleStrings } from '../features/booking/schedule-strings.ts';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One availability schedule's editor (spec 0035, AC-970), outside the Bookings layout (`bookings_`) as a page's editor
// sits outside Captures: it has its own TopBar, with the trail back to Availability. `default` opens whichever
// schedule is the default, the virtual one included. The schedules come from the data layer's held list, so a save
// in another tab shows here while nothing is being edited.
export const Route = createFileRoute('/w/$slug/bookings_/availability/$scheduleId')({
  // `?member=`: an admin editing a colleague's schedule (AC-971); anyone else edits their own.
  validateSearch: memberSearch,
  loaderDeps: ({ search }) => ({ member: search.member }),
  loader: async ({ context, params, deps }) => {
    const access = await context.data.access.mine(params.slug);
    const member =
      deps.member !== undefined && deps.member !== access.memberId && access.permissions.includes('booking.admin')
        ? deps.member
        : undefined;
    const [members] = await Promise.all([
      member === undefined ? Promise.resolve([]) : context.data.schedules.members(params.slug),
      context.data.schedules.view(params.slug, member, browserZone()).ready(),
    ]);
    return { member, memberName: members.find((each) => each.id === member)?.name };
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: () => (
    <LoadingNow>
      <ScheduleEditorPending />
    </LoadingNow>
  ),
  errorComponent: ScheduleError,
  component: ScheduleRoute,
});

function ScheduleRoute() {
  const { member, memberName } = Route.useLoaderData();
  const { slug, scheduleId } = Route.useParams();
  const { data } = Route.useRouteContext();
  return <ScheduleEditor data={data} slug={slug} scheduleId={scheduleId} member={member} memberName={memberName} />;
}

function ScheduleError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={scheduleStrings.schedule} icon="clock" />,
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
