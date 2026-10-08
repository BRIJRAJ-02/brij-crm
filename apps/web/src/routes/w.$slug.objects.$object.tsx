import { isDataError } from '@crm/data';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { defaultSort, queryOf, shownAttributes } from '../features/workspace/columns.ts';
import { failedPage, missingPage, objectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { RecordsScreen } from '../features/workspace/RecordsScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One object's page, by its address (`people`). Object URLs are generic, so
// custom objects (#13) reuse this route. The loader warms the object's view
// (its count and first block, newest first, reading only the columns the
// table shows) after its attributes and beside the workspace's members, all
// through the data layer; the table reads the view itself and loads with this
// route's component, so the grid stays out of the first load.
export const Route = createFileRoute('/w/$slug/objects/$object')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.list(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined) return { table: undefined };
    const membersLoading = context.data.members.list(params.slug);
    // The view reads only the columns the table shows, in its opening order (newest first, spec 0006).
    const attributes = await context.data.attributes.list(params.slug, object.id);
    const sort = defaultSort(attributes);
    const columns = shownAttributes(attributes).map((attribute) => attribute.id);
    const [members, view] = await Promise.all([
      membersLoading,
      context.data.records.view(params.slug, object.id, queryOf(sort), columns),
    ]);
    return { table: { object, attributes, members, view, sort } };
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
