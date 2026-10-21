import { isDataError, type MemberView } from '@crm/data';
import { Card, LoadingNow, PageColumn, Skeleton, TileGrid, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { dayKeyOf } from '../features/bookings/week.ts';
import { dayRange } from '../features/home/agenda.ts';
import { weekStartOf } from '../features/home/metrics.ts';
import { HomeScreen } from '../features/home/HomeScreen.tsx';
import { strings } from '../features/home/strings.ts';
import { failedPage, missingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings as workspace } from '../features/workspace/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Home (spec 0041): where a workspace opens, the sidebar's first row. The
// loader starts every read Home shows through the data layer: My tasks' open
// list, the day's bookings and events, Team today and the metrics row, then waits at most OPEN_GRACE_MS for them, so a quick load arrives whole and a slow one draws
// its cards loading in place. The screen holds them, so they stay live.
/** How long the route waits for the first reads before showing the cards loading in place. */
const OPEN_GRACE_MS = 300;

export const Route = createFileRoute('/w/$slug/home')({
  loader: async ({ context, params }) => {
    const { data } = context;
    const slug = params.slug;
    try {
      const [objects, members, access, tasks] = await Promise.all([
        data.objects.list(slug),
        // A failed list draws its own card's failure rather than Home's: Tasks due offers Try again.
        data.members.list(slug).catch((): readonly MemberView[] => []),
        data.access.mine(slug).catch(() => undefined),
        data.tasks.mine(slug, 'assigned', 'open').catch(() => undefined),
      ]);
      const permissions = access?.permissions ?? [];
      const today = dayKeyOf(new Date());
      const day = dayRange(today);
      const invitations = permissions.includes('members.invite')
        ? await data.invitations.list(slug).catch(() => undefined)
        : undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all([
          tasks?.ready(),
          data.bookings.calendar(slug, day.from, day.to).ready(),
          // Team today and the metrics row, so a quick answer arrives with the first paint.
          members.length > 1 && permissions.includes('booking.manage')
            ? data.home.teamToday(slug, day.from, day.to).ready()
            : undefined,
          data.home.metrics(slug, weekStartOf(today)).ready(),
          // Finish setting up's reads, so the card is there at first paint rather than pushing the others down.
          data.calendar.view(slug).ready(),
          permissions.includes('booking.manage') ? data.bookingPages.view(slug).ready() : undefined,
          permissions.includes('forms.manage') ? data.forms.view(slug).ready() : undefined,
        ]).catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, OPEN_GRACE_MS);
        }),
      ]);
      clearTimeout(timer);
      return { page: { objects, members, meId: access?.memberId, permissions, tasks, invitations } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: HomePending,
  errorComponent: HomeError,
  component: HomeRoute,
});

function HomeRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (page === undefined) {
    return <WorkspacePage page={missingPage(workspace.pageMissingTitle, workspace.pageMissingText)} />;
  }
  return <HomeScreen slug={slug} {...page} />;
}

/** Home while its first reads load: its bar and two cards holding their places. */
function HomePending() {
  return (
    <LoadingNow>
      <WorkspacePage
        currentPage="home"
        page={{
          topBar: <TopBar title={strings.home} icon="house" />,
          body: (
            <PageColumn>
              <TileGrid>
                <Card title={strings.today} isBusy>
                  <Skeleton shape="block" />
                </Card>
                <Card title={strings.tasksDue} isBusy>
                  <Skeleton shape="block" />
                </Card>
              </TileGrid>
            </PageColumn>
          ),
        }}
      />
    </LoadingNow>
  );
}

function HomeError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <WorkspacePage currentPage="home" page={failedPage(strings.home, () => void router.invalidate(), error)} />;
}
