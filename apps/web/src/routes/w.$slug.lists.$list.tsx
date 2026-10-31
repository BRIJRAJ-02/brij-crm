import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ArchivedList } from '../features/lists/ArchivedList.tsx';
import { strings } from '../features/lists/strings.ts';

// A list's address (spec 0048, decision 14): `/w/$slug/lists/$list` by its API name opens the member's last opened
// view of it, else its default view (AC-4806). A list the member can't read, an archived one, or an unknown name
// shows the not found page with the same words (AC-4835). Everything comes through the data layer.
export const Route = createFileRoute('/w/$slug/lists/$list')({
  loader: async ({ context, params }) => {
    const lists = await context.data.lists.all(params.slug).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const list = lists.find((each) => each.apiSlug === params.list);
    if (list === undefined) return { missing: true as const };
    // An archived list says so, and its managers can restore it (AC-4831).
    if (list.isArchived) {
      // Its object archived too (AC-4832): the page names the object, read with archived ones.
      const objects = list.isObjectArchived === true ? await context.data.objects.all(params.slug).catch(() => []) : [];
      return { archived: list, objectName: objects.find((each) => each.id === list.objectId)?.pluralName };
    }
    const views = context.data.views.list(params.slug, list.objectId, list.id);
    await views.ready();
    const held = views.getSnapshot();
    if (held.status === 'error') throw held.error ?? new Error('The views did not load.');
    const viewId = held.lastOpenedViewId ?? held.defaultViewId ?? held.views[0]?.id ?? list.defaultViewId;
    if (viewId === undefined) return { missing: true as const };
    throw redirect({
      to: '/w/$slug/lists/$list/views/$viewId',
      params: { slug: params.slug, list: params.list, viewId },
      replace: true,
    });
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: ListError,
  component: ListMissing,
});

function ListMissing() {
  const loaded = Route.useLoaderData();
  const params = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  const archived = loaded.archived;
  if (archived !== undefined) {
    return (
      <ArchivedList data={data} toasts={toasts} slug={params.slug} list={archived} objectName={loaded.objectName} />
    );
  }
  return <WorkspacePage page={missingPage(strings.notFoundTitle, strings.notFoundText)} />;
}

function ListError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
