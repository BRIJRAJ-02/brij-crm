import { isDataError } from '@crm/data';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { runningQuery, savedQuery, toViewQuery } from '../features/views/query.ts';
import { ViewScreen } from '../features/views/ViewScreen.tsx';
import { ArchivedObjectScreen } from '../features/workspace/ArchivedObjectScreen.tsx';
import { readAttributeIds } from '../features/workspace/columns.ts';
import { failedPage, missingPage, objectPendingPage, viewNotFoundPage } from '../features/workspace/ObjectScreen.tsx';
import { navObjects } from '../features/workspace/objects.ts';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One view of an object (spec 0020): `/w/$slug/objects/$object/views/$viewId`,
// with the unsaved filter and sorts in `?draft=` (base64url of their
// canonical JSON, AC-466). The trailing underscore keeps it out of the
// object address's own route. The loader reads the view and the object's
// views, checks a link's draft (loading the schemas lazily), and warms the
// records the view runs (its count and first block, reading only the columns
// the table shows, waiting at most OPEN_GRACE_MS), all through the data
// layer; the screen reads them itself. A view the person can't see shows the
// not found state, never saying why (AC-463). Only the view's id reloads it:
// a draft changes on the screen, which keeps the rows it has until the next
// ones are in.
/** How long the route waits for the first rows before showing the table loading in place. */
const OPEN_GRACE_MS = 300;

/** The search the route takes: a draft, as text; checking it waits for the loader and the screen. */
interface ViewSearch {
  readonly draft?: string;
}

export const Route = createFileRoute('/w/$slug/objects/$object_/views/$viewId')({
  validateSearch: (search: Record<string, unknown>): ViewSearch =>
    typeof search.draft === 'string' && search.draft !== '' ? { draft: search.draft } : {},
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, params, location }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined) return { kind: 'missing' as const };
    if (object.isArchived) {
      const [firstLive] = navObjects(objects);
      return { kind: 'archived' as const, archived: { object, firstLive } };
    }
    const view = context.data.views.get(params.slug, params.viewId);
    const views = context.data.views.list(params.slug, object.id);
    const membersLoading = context.data.members.list(params.slug);
    const [attributes] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      view.ready(),
      views.ready(),
    ]);
    const body = view.getSnapshot();
    if (body.status === 'not-found' || body.view === undefined || body.view.objectId !== object.id) {
      if (body.status === 'error') throw body.error ?? new Error('The view did not load.');
      const list = views.getSnapshot();
      const defaultName = list.views.find((each) => each.id === list.defaultViewId)?.name;
      return { kind: 'not-found' as const, object, defaultName };
    }
    // A link's draft, checked; one that doesn't read is dropped with a toast (AC-467).
    const search = location.search as ViewSearch;
    const linked = search.draft === undefined ? undefined : await context.data.views.readDraft(search.draft);
    const query = linked ?? savedQuery(body.view);
    const effective = runningQuery(query, attributes);
    const running = effective.status === 'ready' ? effective : runningQuery(savedQuery(body.view), attributes);
    const [members, records] = await Promise.all([
      membersLoading,
      // A quick load arrives with its rows; a slow one shows the table's own loading rows under its header.
      context.data.records.open(
        params.slug,
        object.id,
        running.status === 'ready' ? toViewQuery(running) : {},
        readAttributeIds(object, attributes),
        OPEN_GRACE_MS,
      ),
    ]);
    return {
      kind: 'view' as const,
      screen: {
        object,
        attributes,
        members,
        view,
        views,
        records,
        opened: {
          query: linked,
          unreadable: search.draft !== undefined && linked === undefined,
          dropped: linked !== undefined && effective.status === 'ready' && effective.dropped,
        },
      },
    };
  },
  pendingComponent: () => <WorkspacePage page={objectPendingPage()} />,
  errorComponent: ViewError,
  component: ViewRoute,
});

function ViewRoute() {
  const loaded = Route.useLoaderData();
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  if (loaded.kind === 'archived') return <ArchivedObjectScreen slug={params.slug} {...loaded.archived} />;
  if (loaded.kind === 'missing') {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  if (loaded.kind === 'not-found') {
    return (
      <WorkspacePage
        currentObject={loaded.object.apiSlug}
        page={viewNotFoundPage(loaded.object, params.slug, loaded.defaultName)}
      />
    );
  }
  return (
    <ViewScreen
      // Another view is another screen: its draft, Popovers and dialogs start afresh.
      key={params.viewId}
      slug={params.slug}
      {...loaded.screen}
      param={search.draft}
      writeParam={(draft, replace) => {
        void navigate({
          to: '/w/$slug/objects/$object/views/$viewId',
          params: { slug: params.slug, object: params.object, viewId: params.viewId },
          search: draft === undefined ? {} : { draft },
          replace,
        });
      }}
    />
  );
}

function ViewError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
