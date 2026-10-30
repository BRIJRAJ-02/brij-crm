import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { NotesScreen } from '../features/notes/NotesScreen.tsx';
import { strings } from '../features/notes/strings.ts';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings as workspace } from '../features/workspace/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// The workspace's Notes page (the flow pass of 30 Oct 2026): every note the
// person may see, last edited first. The loader starts the list (waiting at
// most OPEN_GRACE_MS for its first page, so a slow load draws the list
// loading in place) beside the objects (each row's record address) and the
// members (authors), all through the data layer; the screen holds the list,
// so it stays live.
/** How long the route waits for the first page before showing the list loading in place. */
const OPEN_GRACE_MS = 300;

export const Route = createFileRoute('/w/$slug/notes')({
  loader: async ({ context, params }) => {
    try {
      const [objects, members, list] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.members.list(params.slug),
        context.data.notes.forWorkspace(params.slug),
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        list.ready(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, OPEN_GRACE_MS);
        }),
      ]);
      clearTimeout(timer);
      return { page: { objects, members, list } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => <WorkspacePage currentPage="notes" page={pendingPage()} />,
  errorComponent: NotesError,
  component: NotesRoute,
});

function NotesRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (page === undefined) {
    return <WorkspacePage page={missingPage(workspace.pageMissingTitle, workspace.pageMissingText)} />;
  }
  return <NotesScreen slug={slug} {...page} />;
}

function NotesError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="notes"
      page={failedPage(strings.notes, () => void router.invalidate(), error, strings.loadFailedList)}
    />
  );
}
