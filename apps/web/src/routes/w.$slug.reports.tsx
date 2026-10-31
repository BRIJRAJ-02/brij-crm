import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ReportsScreen } from '../features/reports/ReportsScreen.tsx';
import { reportsSearch } from '../features/reports/search.ts';
import { strings } from '../features/reports/strings.ts';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings as workspace } from '../features/workspace/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Reports (the reports lane, spec 0050 reserved): `?r=` names the report open. The loader starts the saved reports
// (a held list, read again when the page is shown after a while away), the objects, the members (who a member
// group names) and every object's attributes, all through the data layer. It imports no chart: the chart loads
// with the screen's own chunk, never the first load.
export const Route = createFileRoute('/w/$slug/reports')({
  validateSearch: reportsSearch,
  loader: async ({ context, params }) => {
    try {
      const [objects, members, access] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.members.list(params.slug),
        context.data.access.mine(params.slug).catch(() => undefined),
        context.data.reports.view(params.slug).ready(),
      ]);
      const lists = await Promise.all(
        objects.map(async (object) => [object.id, await context.data.attributes.list(params.slug, object.id)] as const),
      );
      return { page: { objects, members, access, attributes: Object.fromEntries(lists) } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => <WorkspacePage page={pendingPage()} />,
  errorComponent: ReportsError,
  component: ReportsRoute,
});

function ReportsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  if (page === undefined) {
    return <WorkspacePage page={missingPage(workspace.pageMissingTitle, workspace.pageMissingText)} />;
  }
  return (
    <ReportsScreen
      slug={slug}
      search={search}
      objects={page.objects}
      members={page.members}
      permissions={page.access?.permissions ?? []}
      meId={page.access?.memberId}
      attributes={page.attributes}
    />
  );
}

function ReportsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage page={failedPage(strings.reports, () => void router.invalidate(), error, strings.failedTitle)} />
  );
}
