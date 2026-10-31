import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { DuplicatesScreen } from '../features/duplicates/DuplicatesScreen.tsx';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// An object's likely duplicates (spec 0049, AC-4907): `/w/$slug/objects/$object/duplicates`, from the view menu's
// Find duplicates, narrowed to one record's pairs by `?record=<id>` (the record banner's Review). The loader reads the
// object, its attributes and the members (for the merge dialog) through the data layer and makes the pairs' list; the page draws its loading, empty, failed and no
// access states from it. An archived object, or none, shows as missing.

/** The page's address: one record to narrow it to, by id. */
interface DuplicatesSearch {
  readonly record?: string;
}

export const Route = createFileRoute('/w/$slug/objects/$object_/duplicates')({
  validateSearch: (search: Record<string, unknown>): DuplicatesSearch =>
    typeof search.record === 'string' && search.record !== '' ? { record: search.record } : {},
  loaderDeps: ({ search }) => ({ record: search.record }),
  loader: async ({ context, params, deps }) => {
    const objects = await context.data.objects.list(params.slug).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined || object.isArchived) return { screen: undefined };
    const [attributes, members] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      context.data.members.list(params.slug),
    ]);
    const pairs = context.data.records.duplicates.pairs(params.slug, object.id, deps.record);
    return {
      screen: { object, pairs, attributes, members, ...(deps.record === undefined ? {} : { recordId: deps.record }) },
    };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: DuplicatesError,
  component: DuplicatesRoute,
});

function DuplicatesRoute() {
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (screen === undefined) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return <DuplicatesScreen slug={slug} {...screen} />;
}

function DuplicatesError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
