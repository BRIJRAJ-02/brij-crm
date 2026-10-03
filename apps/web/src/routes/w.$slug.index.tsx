import { isDataError } from '@crm/data';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { navObjects } from '../features/workspace/objects.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// A workspace opens on People (spec 0005): the object with the `people`
// template key, by its address. The frame above says "not found" when the
// workspace is missing, so this route only waits for it then.
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
  component: () => <WorkspacePage page={missingPage(strings.noObjects, strings.pageMissingText)} />,
});

function IndexError() {
  const router = useRouter();
  return <WorkspacePage page={failedPage(strings.failedTitle, () => void router.invalidate())} />;
}
