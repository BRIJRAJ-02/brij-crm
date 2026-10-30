import { isDataError } from '@crm/data';
import { EmptyState, Link, LoadingNow, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ImportScreen } from '../features/imports/ImportScreen.tsx';
import { strings as importStrings } from '../features/imports/strings.ts';
import { objectHref } from '../features/workspace/objects.ts';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Importing a CSV into one object (spec 0040, AC-1111): `/w/$slug/objects/$object/import`.
// The loader reads the object, its attributes and the members (for member
// cells) and whether it holds records (no match key then warns of
// duplicates) through the data layer; the page and the CSV reader load with
// the route's own chunk, outside the first load. An object the person may
// only read says so, with a way to its records; an archived one, or none,
// shows as missing, as the menu offers no import for them.
export const Route = createFileRoute('/w/$slug/objects/$object_/import')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined || object.isArchived) return { screen: undefined, readOnly: undefined };
    if (object.access !== 'write') return { screen: undefined, readOnly: object };
    const [attributes, members, count] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      context.data.members.list(params.slug),
      context.data.records.count(params.slug, object.id).catch(() => undefined),
    ]);
    return {
      screen: { object, attributes, members, objects, hasRecords: count === undefined ? undefined : count.count > 0 },
      readOnly: undefined,
    };
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
  const { screen, readOnly } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (readOnly !== undefined) {
    // A member who can only read the object: why there's nothing to do here, and the way to what they can see.
    return (
      <WorkspacePage
        currentObject={readOnly.apiSlug}
        page={{
          topBar: <TopBar title={importStrings.title(readOnly.pluralName)} icon={readOnly.icon} hue={readOnly.hue} />,
          body: (
            <EmptyState
              icon="lock"
              title={importStrings.noAccess(readOnly.pluralName)}
              actions={<Link href={objectHref(slug, readOnly)}>{importStrings.viewPlural(readOnly.pluralName)}</Link>}
            >
              {importStrings.noAccessText}
            </EmptyState>
          ),
        }}
      />
    );
  }
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
