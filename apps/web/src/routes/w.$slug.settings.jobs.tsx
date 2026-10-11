import { isDataError } from '@crm/data';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { EmptyState, TopBar } from '@crm/ui';
import { failedPage, missingPage } from '../features/workspace/ObjectScreen.tsx';
import { JobsScreen } from '../features/settings/JobsScreen.tsx';
import { strings as settings } from '../features/settings/strings.ts';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Settings, Background jobs (spec 0008, AC-118): every job for owners and
// admins (`jobs.manage`), the person's own for everyone else. The loader
// warms the view's first page and the members (for "Started by") through the
// data layer; the screen holds the view, so it updates live.
export const Route = createFileRoute('/w/$slug/settings/jobs')({
  loader: async ({ context, params }) => {
    try {
      const [access, members] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.members.list(params.slug),
      ]);
      const isAll = access.permissions.includes('jobs.manage');
      const view = context.data.jobs.view(params.slug, isAll ? 'all' : 'mine');
      await view.ready();
      return { page: { view, isAll, members, canManage: isAll } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  // The page's own title while it loads, so the heading and the tab's name don't change when it arrives.
  pendingComponent: () => (
    <WorkspacePage
      currentPage="jobs"
      page={{
        topBar: <TopBar title={settings.title} icon="list-checks" />,
        body: <EmptyState title={settings.title} isLoading />,
      }}
    />
  ),
  errorComponent: JobsError,
  component: JobsRoute,
});

function JobsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (page === undefined) {
    return <WorkspacePage currentPage="jobs" page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return (
    <JobsScreen
      data={data}
      slug={slug}
      view={page.view}
      isAll={page.isAll}
      members={page.members}
      // The test job runs only locally and in previews (AC-123); production answers NOT_FOUND for it anyway.
      canRunTest={page.canManage && import.meta.env.APP_ENVIRONMENT !== 'production'}
    />
  );
}

function JobsError() {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage currentPage="jobs" page={failedPage(workspaceName, () => void router.invalidate())} />;
}
