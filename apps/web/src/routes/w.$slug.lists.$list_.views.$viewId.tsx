import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ArchivedList } from '../features/lists/ArchivedList.tsx';
import { ListScreen } from '../features/lists/ListScreen.tsx';
import { strings } from '../features/lists/strings.ts';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One view of a list (spec 0048, AC-4806): `/w/$slug/lists/$list/views/$viewId`. The loader reads the list, its
// object, the list's own fields and the object's, the members, the view and the list's views, and the entries
// layer, all through the data layer; the screen opens the rows itself. A list or view the member can't see shows
// the not found page, never saying why (AC-4835).
export const Route = createFileRoute('/w/$slug/lists/$list_/views/$viewId')({
  loaderDeps: () => ({}),
  shouldReload: ({ cause }) => cause === 'enter',
  loader: async ({ context, params }) => {
    const [lists, objects] = await Promise.all([
      context.data.lists.all(params.slug),
      context.data.objects.list(params.slug),
    ]).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [[], []] as const;
      throw error;
    });
    const list = lists.find((each) => each.apiSlug === params.list);
    const object = list === undefined ? undefined : objects.find((each) => each.id === list.objectId);
    if (list?.isArchived === true) return { kind: 'archived' as const, list };
    if (list === undefined || object === undefined) return { kind: 'missing' as const };
    const view = context.data.views.get(params.slug, params.viewId);
    const views = context.data.views.list(params.slug, list.objectId, list.id);
    const [fields, attributes, members, entries] = await Promise.all([
      context.data.lists.fields(params.slug, list),
      context.data.attributes.list(params.slug, object.id),
      context.data.members.list(params.slug),
      context.data.lists.entries(),
      view.ready(),
      views.ready(),
    ]);
    const body = view.getSnapshot();
    if (body.view === undefined || body.view.listId !== list.id) {
      if (body.status === 'error') throw body.error ?? new Error('The view did not load.');
      return { kind: 'missing' as const };
    }
    context.data.views.markOpened(params.slug, params.viewId);
    return {
      kind: 'view' as const,
      screen: {
        list,
        object,
        fields,
        attributes,
        members,
        entries,
        view: body.view,
        viewSource: view,
        viewsSource: views,
      },
    };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: ListViewError,
  component: ListViewRoute,
});

function ListViewRoute() {
  const loaded = Route.useLoaderData();
  const params = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (loaded.kind === 'archived') {
    return <ArchivedList data={data} toasts={toasts} slug={params.slug} list={loaded.list} />;
  }
  if (loaded.kind === 'missing') {
    return <WorkspacePage page={missingPage(strings.notFoundTitle, strings.notFoundText)} />;
  }
  return <ListScreen key={params.viewId} data={data} toasts={toasts} slug={params.slug} {...loaded.screen} />;
}

function ListViewError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
