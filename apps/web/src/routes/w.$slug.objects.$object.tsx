import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ArchivedObjectScreen } from '../features/workspace/ArchivedObjectScreen.tsx';
import { defaultSort, queryOf, readAttributeIds } from '../features/workspace/columns.ts';
import { failedPage, missingPage, objectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { navObjects } from '../features/workspace/objects.ts';
import { RecordsScreen } from '../features/workspace/RecordsScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Any live object's page, by its address (`people`, `projects`; spec 0012,
// AC-240): standard and custom objects share it. The loader warms the
// object's view (its count and first block, newest first, reading only the
// columns the table shows, waiting at most OPEN_GRACE_MS for its first rows,
// so a slow load draws the table loading in place) after its attributes and
// beside the workspace's members, all through the data layer; the table reads
// the view itself and loads with this route's component, so the grid stays
// out of the first load. An archived object's address says it is archived
// (AC-226).
/** How long the route waits for the first rows before showing the table loading in place. */
const OPEN_GRACE_MS = 300;

export const Route = createFileRoute('/w/$slug/objects/$object')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined) return { table: undefined, archived: undefined };
    if (object.isArchived) {
      const [firstLive] = navObjects(objects);
      return { table: undefined, archived: { object, firstLive } };
    }
    const membersLoading = context.data.members.list(params.slug);
    // The view reads only the columns the table shows, in its opening order (newest first, spec 0006).
    const attributes = await context.data.attributes.list(params.slug, object.id);
    const sort = defaultSort(attributes);
    const columns = readAttributeIds(object, attributes);
    const [members, view] = await Promise.all([
      membersLoading,
      // A quick load arrives with its rows; a slow one shows the table's own loading rows under its header.
      context.data.records.open(params.slug, object.id, queryOf(sort), columns, OPEN_GRACE_MS),
    ]);
    return { table: { object, attributes, members, view, sort }, archived: undefined };
  },
  pendingComponent: () => <WorkspacePage page={objectPendingPage()} />,
  errorComponent: ObjectError,
  component: ObjectRoute,
});

function ObjectRoute() {
  const { table, archived } = Route.useLoaderData();
  const params = Route.useParams();
  if (archived !== undefined) return <ArchivedObjectScreen slug={params.slug} {...archived} />;
  if (table === undefined) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return <RecordsScreen slug={params.slug} {...table} />;
}

function ObjectError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
