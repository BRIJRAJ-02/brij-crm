import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { failedPage, noObjectsPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { landingTarget } from '../features/workspace/landing.ts';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// A workspace opens on the member's landing page (Settings › Account ›
// Preferences: Tasks or an object), else on Home (owner, 21 October 2026, as
// timefix does; it was the first live object, spec 0012, AC-226). The frame above says "not found" when the
// workspace is missing, so this route only waits for it then (and shows the
// frame's own page).
export const Route = createFileRoute('/w/$slug/')({
  loader: async ({ context, params }) => {
    const [objects, preferences, access] = await Promise.all([
      context.data.objects.list(params.slug).catch((error: unknown) => {
        if (isDataError(error) && error.code === 'NOT_FOUND') return undefined;
        throw error;
      }),
      // Read by the frame already; a failed read opens as before.
      context.data.preferences.load(params.slug).catch(() => undefined),
      context.data.access.mine(params.slug).catch(() => undefined),
    ]);
    // The frame shows "Workspace not found" for an unknown one.
    if (objects === undefined) return { isGuest: false };
    const isGuest = access?.role === 'guest';
    const target = landingTarget(preferences?.landing, objects, isGuest);
    // A guest with nothing shared stays here, on the page that says so.
    if (target.kind === 'nothing') return { isGuest };
    if (target.kind === 'tasks') throw redirect({ to: '/w/$slug/tasks', params: { slug: params.slug }, replace: true });
    if (target.kind === 'object') {
      throw redirect({
        to: '/w/$slug/objects/$object',
        params: { slug: params.slug, object: target.apiSlug },
        replace: true,
      });
    }
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
  const loaded = Route.useLoaderData();
  return <WorkspacePage page={noObjectsPage(useWorkspaceName() ?? strings.product, loaded.isGuest)} />;
}

function IndexError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
