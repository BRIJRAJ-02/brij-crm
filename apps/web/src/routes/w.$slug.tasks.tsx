import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { isTaskParam } from '../features/tasks/entries.ts';
import { MyTasksScreen } from '../features/tasks/MyTasksScreen.tsx';
import { strings } from '../features/tasks/strings.ts';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings as workspace } from '../features/workspace/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// My tasks (spec 0019, AC-436): `?filter=` (`assigned`, the default,
// `created` or `all`), `?status=` (`open`, the default, or `done`) and
// `?task=` (the task dialog). The loader starts the list the address names
// (waiting at most OPEN_GRACE_MS for its first page, so a slow load draws the
// list loading in place) beside the objects (the record picker and chips),
// the members (assignees) and the person's member id, all through the data
// layer; the screen holds the list, so it stays live.
/** How long the route waits for the first page before showing the list loading in place. */
const OPEN_GRACE_MS = 300;

/** My tasks' address. Anything else is dropped. */
interface MyTasksSearch {
  readonly filter?: 'created' | 'all';
  readonly status?: 'done';
  readonly task?: string;
}

/** Reads the address: only the values it knows, the defaults left out. */
function myTasksSearch(search: Record<string, unknown>): MyTasksSearch {
  return {
    ...(search.filter === 'created' || search.filter === 'all' ? { filter: search.filter } : {}),
    ...(search.status === 'done' ? { status: 'done' as const } : {}),
    ...(isTaskParam(search.task) ? { task: search.task } : {}),
  };
}

export const Route = createFileRoute('/w/$slug/tasks')({
  validateSearch: myTasksSearch,
  loaderDeps: ({ search }) => ({
    filter: search.filter ?? ('assigned' as const),
    status: search.status ?? ('open' as const),
  }),
  loader: async ({ context, params, deps, cause }) => {
    try {
      const [objects, members, access, list] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.members.list(params.slug),
        context.data.access.mine(params.slug).catch(() => undefined),
        context.data.tasks.mine(params.slug, deps.filter, deps.status),
      ]);
      // Entering the page waits a moment for the first page. A switch of filter or status on the page draws
      // the new list loading in place at once, so the page never steps through its pending frame and the
      // person's focus stays on the switch they're using.
      if (cause !== 'enter') return { page: { objects, members, meId: access?.memberId, list, ...deps } };
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        list.ready(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, OPEN_GRACE_MS);
        }),
      ]);
      clearTimeout(timer);
      return { page: { objects, members, meId: access?.memberId, list, ...deps } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => <WorkspacePage currentPage="tasks" page={pendingPage()} />,
  errorComponent: MyTasksError,
  component: MyTasksRoute,
});

function MyTasksRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { task } = Route.useSearch();
  if (page === undefined) {
    return <WorkspacePage page={missingPage(workspace.pageMissingTitle, workspace.pageMissingText)} />;
  }
  return <MyTasksScreen slug={slug} {...page} {...(task === undefined ? {} : { task })} />;
}

function MyTasksError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="tasks"
      page={failedPage(strings.myTasks, () => void router.invalidate(), error, strings.failedTitle)}
    />
  );
}
