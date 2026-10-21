import { isDataError } from '@crm/data';
import { Card, LoadingNow, PageColumn, Skeleton, TileGrid, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { dayKeyOf } from '../features/bookings/week.ts';
import { dayRange } from '../features/home/agenda.ts';
import { attentionPlan } from '../features/home/attention.ts';
import { HomeScreen } from '../features/home/HomeScreen.tsx';
import { strings } from '../features/home/strings.ts';
import { failedPage, missingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings as workspace } from '../features/workspace/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Home (spec 0041): where a workspace opens, the sidebar's first row. The
// loader starts every read Home shows through the data layer: My tasks' open
// list, the day's bookings and events, and Needs attention's window on Deals
// (when the workspace has Deals with an Owner and a Stage), then waits at most
// OPEN_GRACE_MS for them, so a quick load arrives whole and a slow one draws
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
        data.members.list(slug),
        data.access.mine(slug).catch(() => undefined),
        data.tasks.mine(slug, 'assigned', 'open'),
      ]);
      const permissions = access?.permissions ?? [];
      const today = dayKeyOf(new Date());
      const day = dayRange(today);
      const deals = objects.find((object) => object.standardKey === 'deals');
      const [attention, invitations] = await Promise.all([
        deals === undefined
          ? undefined
          : data.attributes
              .list(slug, deals.id)
              .then(async (attributes) => {
                const plan = attentionPlan(objects, attributes, today);
                if (plan === undefined) return undefined;
                return { plan, view: await data.records.open(slug, plan.objectId, plan.query, [plan.stageId]) };
              })
              // Deals that can't be read leave Needs attention out, as a hidden object is absent.
              .catch(() => undefined),
        permissions.includes('members.invite') ? data.invitations.list(slug).catch(() => undefined) : undefined,
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all([tasks.ready(), attention?.view.ready(), data.bookings.calendar(slug, day.from, day.to).ready()]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, OPEN_GRACE_MS);
        }),
      ]);
      clearTimeout(timer);
      return { page: { objects, members, meId: access?.memberId, permissions, tasks, attention, invitations } };
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
