import { isDataError } from '@crm/data';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { failedPage, missingPage, objectPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One object's page, by its address (`people`). Object URLs are generic, so
// custom objects (#13) reuse this route. Milestone 1 shows the empty state;
// the People table arrives in milestone 2.
export const Route = createFileRoute('/w/$slug/objects/$object')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.list(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    return { object: objects.find((object) => object.apiSlug === params.object) };
  },
  pendingComponent: () => <WorkspacePage page={pendingPage()} />,
  errorComponent: ObjectError,
  component: ObjectRoute,
});

function ObjectRoute() {
  const { object } = Route.useLoaderData();
  const params = Route.useParams();
  if (object === undefined) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return <WorkspacePage page={objectPage(object)} currentObject={params.object} />;
}

function ObjectError() {
  const router = useRouter();
  return <WorkspacePage page={failedPage(strings.failedTitle, () => void router.invalidate())} />;
}
