import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ImportScreen } from '../features/imports/ImportScreen.tsx';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Importing a CSV into one object (spec 0040, AC-1111): `/w/$slug/objects/$object/import`.
// The loader reads the object, its attributes and the members (for member
// cells) through the data layer; the page and the CSV reader load with the
// route's own chunk, outside the first load. An object the person may only
// read, an archived one, or none shows as missing, as the menu offers no
// import for them.
export const Route = createFileRoute('/w/$slug/objects/$object_/import')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined || object.isArchived || object.access !== 'write') return { screen: undefined };
    const [attributes, members] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      context.data.members.list(params.slug),
    ]);
    return { screen: { object, attributes, members, objects } };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: ImportError,
  component: ImportRoute,
});

function ImportRoute() {
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (screen === undefined) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return <ImportScreen data={data} slug={slug} {...screen} />;
}

function ImportError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
