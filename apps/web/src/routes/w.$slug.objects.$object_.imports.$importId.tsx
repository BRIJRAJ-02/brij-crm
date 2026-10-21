import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ImportSummary } from '../features/imports/ImportSummary.tsx';
import { strings as importStrings } from '../features/imports/strings.ts';
import { failedPage, missingPage, ObjectPendingPage } from '../features/workspace/ObjectScreen.tsx';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One import's summary (spec 0040, AC-1127): `/w/$slug/objects/$object/imports/$importId`,
// kept for its undo window. The loader reads the import (following its jobs,
// so the page shows their progress live) and its first page of refused rows
// through the data layer. One the person may not see, or that doesn't exist,
// shows the same not found page (AC-1137).
export const Route = createFileRoute('/w/$slug/objects/$object_/imports/$importId')({
  // Coming back reads the import afresh: its job may have ended since, changing its counts and its undo.
  shouldReload: ({ cause }) => cause === 'enter',
  loader: async ({ context, params }) => {
    try {
      const objects = await context.data.objects.all(params.slug);
      const object = objects.find((each) => each.apiSlug === params.object);
      if (object === undefined) return { screen: undefined };
      const [initial, page] = await Promise.all([
        context.data.imports.get(params.slug, params.importId),
        context.data.imports.rows(params.slug, params.importId),
      ]);
      if (initial.objectId !== object.id) return { screen: undefined };
      return { screen: { object, initial, refused: page.rows, nextCursor: page.nextCursor } };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { screen: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: SummaryError,
  component: SummaryRoute,
});

function SummaryRoute() {
  const { screen } = Route.useLoaderData();
  const { slug, importId } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (screen === undefined) {
    return <WorkspacePage page={missingPage(importStrings.missingTitle, importStrings.missingText)} />;
  }
  return <ImportSummary key={importId} data={data} slug={slug} {...screen} />;
}

function SummaryError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return (
    <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error, importStrings.failedTitle)} />
  );
}
