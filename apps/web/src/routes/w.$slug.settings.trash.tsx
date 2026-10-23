import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/trash/strings.ts';
import { TrashPending, TrashScreen } from '../features/trash/TrashScreen.tsx';

// Settings › Workspace › Trash (spec 0022, AC-533; inside Settings since 23 October 2026, A120): every trashed
// record the person may see, newest first, narrowed to one object by `?object=<id>`. The loader warms the trash's
// view (its count and first block, waiting at most OPEN_GRACE_MS for its rows, so a slow load draws the grid
// loading in place) beside every object (archived ones too, for the filter and the Object column) and the members
// (Deleted by), all through the data layer; the screen holds the view, so it settles live as records are deleted,
// restored or purged anywhere. The old `/w/$slug/trash` sends here.
/** How long the route waits for the first rows before showing the grid loading in place. */
const OPEN_GRACE_MS = 300;

/** The trash's address: an object to narrow it to, by id. */
interface TrashSearch {
  readonly object?: string;
}

export const Route = createFileRoute('/w/$slug/settings/trash')({
  validateSearch: (search: Record<string, unknown>): TrashSearch =>
    typeof search.object === 'string' && search.object !== '' ? { object: search.object } : {},
  loaderDeps: ({ search }) => ({ object: search.object }),
  loader: async ({ context, params, deps }) => {
    try {
      const [objects, members, view] = await Promise.all([
        context.data.objects.all(params.slug),
        context.data.members.list(params.slug),
        context.data.trash.view(params.slug, deps.object),
      ]);
      // An object filter naming nothing the person may see shows every object instead.
      const objectId = objects.some((object) => object.id === deps.object) ? deps.object : undefined;
      const shown = objectId === deps.object ? view : await context.data.trash.view(params.slug);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        shown.ready(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, OPEN_GRACE_MS);
        }),
      ]);
      clearTimeout(timer);
      return { page: { objects, members, view: shown, objectId } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  // The page's bar, its filter row and the grid's rows in their places, so nothing moves when it arrives.
  pendingComponent: () => (
    <LoadingNow>
      <TrashPending />
    </LoadingNow>
  ),
  errorComponent: TrashError,
  component: TrashRoute,
});

function TrashRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (page === undefined) {
    return <SettingsMissing backTo="home" />;
  }
  return <TrashScreen slug={slug} {...page} />;
}

function TrashError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.somethingWrong}
      onRetry={() => void router.invalidate()}
    />
  );
}
