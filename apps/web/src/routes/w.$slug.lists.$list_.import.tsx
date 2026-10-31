import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ImportScreen } from '../features/imports/ImportScreen.tsx';
import { strings as listStrings } from '../features/lists/strings.ts';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Importing a CSV into a list (spec 0048, AC-4833): `/w/$slug/lists/$list/import`, spec 0040's import page aimed at
// the list. The loader reads the list, its object, both sets of fields and the members through the data layer; the
// page and the CSV reader load with the route's own chunk, outside the first load. A list the member can't add to
// (unknown, archived, or read only) shows as missing, as the list page offers no Import then.
export const Route = createFileRoute('/w/$slug/lists/$list_/import')({
  loader: async ({ context, params }) => {
    const [lists, objects] = await Promise.all([
      context.data.lists.all(params.slug),
      context.data.objects.all(params.slug),
    ]).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [[], []] as const;
      throw error;
    });
    const list = lists.find((each) => each.apiSlug === params.list);
    const object = objects.find((each) => each.id === list?.objectId);
    if (list === undefined || object === undefined || list.isArchived || !list.canWrite) return { screen: undefined };
    const [attributes, fields, members, count] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      context.data.lists.fields(params.slug, list),
      context.data.members.list(params.slug),
      context.data.records.count(params.slug, object.id).catch(() => undefined),
    ]);
    return {
      screen: {
        object,
        attributes,
        members,
        objects,
        list: { list, fields },
        hasRecords: count === undefined ? undefined : count.count > 0,
      },
    };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: ListImportError,
  component: ListImportRoute,
});

function ListImportRoute() {
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (screen === undefined) {
    return <WorkspacePage page={missingPage(listStrings.notFoundTitle, listStrings.notFoundText)} />;
  }
  return <ImportScreen data={data} slug={slug} {...screen} />;
}

function ListImportError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
