import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ArchivedObjectScreen } from '../features/workspace/ArchivedObjectScreen.tsx';
import { NoViewsScreen } from '../features/views/NoViewsScreen.tsx';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { navObjects } from '../features/workspace/objects.ts';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { createView, landingView } from '../features/views/query.ts';
import { strings as commandStrings } from '../features/command/strings.ts';

// Any live object's address (`people`, `projects`; spec 0012, AC-240) opens
// one of its views (spec 0020, AC-462): the address is replaced with the
// last view the person opened there, else its default view, else the first in
// switcher order. An object with no view for this person says so, with
// Create view. An archived object's address says it is archived (AC-226). The
// views come through the data layer; the screens load with this route's
// component, outside the first load.
export const Route = createFileRoute('/w/$slug/objects/$object')({
  loader: async ({ context, params, location }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = object_(objects, params.object);
    if (object === undefined) {
      return { missing: true as const, archived: undefined, object: undefined, attributes: [] };
    }
    if (object.isArchived) {
      const [firstLive] = navObjects(objects);
      return { missing: false as const, archived: { object, firstLive }, object: undefined, attributes: [] };
    }
    const views = context.data.views.list(params.slug, object.id);
    await views.ready();
    const list = views.getSnapshot();
    if (list.status === 'error') throw list.error ?? new Error('The views did not load.');
    // The command menu's Create a <object> (spec 0039, AC-1086) rides along as `new`, so the view opens its dialog:
    // on a table, since a board has none.
    const asked = location.search as { readonly new?: unknown; readonly name?: unknown };
    const isNew = asked.new !== undefined;
    // The command menu's Create <object> named …: the name rides along to the dialog.
    const name = isNew && typeof asked.name === 'string' && asked.name.trim() !== '' ? asked.name : undefined;
    const table = isNew && list.status === 'ready' ? createView(list) : undefined;
    // Only boards here: they have no new record dialog, so the menu's request says so rather than doing nothing.
    if (isNew && table === undefined) {
      context.toasts.toast({ tone: 'info', message: commandStrings.openTableToCreate(object.singularName) });
    }
    const viewId = list.status !== 'ready' ? undefined : (table ?? landingView(list));
    if (viewId !== undefined) {
      throw redirect({
        to: '/w/$slug/objects/$object/views/$viewId',
        params: { slug: params.slug, object: params.object, viewId },
        // A link that drafts a filter (Settings' "N records are empty") keeps it on the view it lands on.
        search: {
          ...(table === undefined ? {} : { new: true, ...(name === undefined ? {} : { name }) }),
          ...(typeof (location.search as { readonly draft?: unknown }).draft === 'string'
            ? { draft: (location.search as { readonly draft: string }).draft }
            : {}),
        },
        replace: true,
      });
    }
    // No view for this person: Create view starts from the object's attributes.
    const attributes = await context.data.attributes.list(params.slug, object.id);
    return { missing: false as const, archived: undefined, object, attributes };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: ObjectError,
  component: ObjectRoute,
});

/** The object at an address, by its API name. */
function object_<T extends { readonly apiSlug: string }>(objects: readonly T[], apiSlug: string): T | undefined {
  return objects.find((each) => each.apiSlug === apiSlug);
}

function ObjectRoute() {
  const { archived, object, attributes } = Route.useLoaderData();
  const params = Route.useParams();
  if (archived !== undefined) return <ArchivedObjectScreen slug={params.slug} {...archived} />;
  if (object === undefined) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return <NoViewsScreen slug={params.slug} object={object} attributes={attributes} />;
}

function ObjectError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
