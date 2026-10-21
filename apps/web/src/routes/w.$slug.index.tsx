import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { failedPage, noObjectsPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// A workspace opens on Home (owner, 21 October 2026, as timefix does; it was
// the first live object, spec 0012, AC-226).
// The frame above says "not found" when the workspace is missing, so this
// route only waits for it then (and shows the frame's own page).
export const Route = createFileRoute('/w/$slug/')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.list(params.slug).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return undefined;
      throw error;
    });
    // The frame shows "Workspace not found" for an unknown one.
    if (objects === undefined) return;
    throw redirect({ to: '/w/$slug/home', params: { slug: params.slug }, replace: true });
  },
  pendingComponent: () => (
    <LoadingNow>
      <WorkspacePage page={pendingPage()} />
    </LoadingNow>
  ),
  errorComponent: IndexError,
  component: NoObjects,
});

function NoObjects() {
  return <WorkspacePage page={noObjectsPage(useWorkspaceName() ?? strings.product)} />;
}

function IndexError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
