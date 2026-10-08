import { isDataError } from '@crm/data';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { failedPage, missingPage, objectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { RecordsScreen } from '../features/workspace/RecordsScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One object's page, by its address (`people`). Object URLs are generic, so
// custom objects (#13) reuse this route. The loader warms the object's view
// (its count and first block) beside its attributes and the workspace's
// members, all through the data layer; the table reads the view itself and
// loads with this route's component, so the grid stays out of the first load.
export const Route = createFileRoute('/w/$slug/objects/$object')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.list(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined) return { table: undefined };
    const [attributes, members, view] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      context.data.members.list(params.slug),
      context.data.records.view(params.slug, object.id),
    ]);
    return { table: { object, attributes, members, view } };
  },
  pendingComponent: () => <WorkspacePage page={objectPendingPage()} />,
  errorComponent: ObjectError,
  component: ObjectRoute,
});

function ObjectRoute() {
  const { table } = Route.useLoaderData();
  const params = Route.useParams();
  if (table === undefined) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return <RecordsScreen slug={params.slug} {...table} />;
}

function ObjectError() {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate())} />;
}
