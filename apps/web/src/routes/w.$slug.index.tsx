import { isDataError } from '@crm/data';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { failedPage, noObjectsPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { navObjects } from '../features/workspace/objects.ts';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// A workspace opens on People (spec 0005): the object with the `people`
// template key, by its address. The frame above says "not found" when the
// workspace is missing, so this route only waits for it then. A workspace
// with no objects to list says so plainly, with nowhere to loop back to.
export const Route = createFileRoute('/w/$slug/')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.list(params.slug).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const [first] = navObjects(objects);
    if (first !== undefined) {
      throw redirect({
        to: '/w/$slug/objects/$object',
        params: { slug: params.slug, object: first.apiSlug },
        replace: true,
      });
    }
  },
  pendingComponent: () => <WorkspacePage page={pendingPage()} />,
  errorComponent: IndexError,
  component: NoObjects,
});

function NoObjects() {
  return <WorkspacePage page={noObjectsPage(useWorkspaceName() ?? strings.product)} />;
}

function IndexError() {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate())} />;
}
