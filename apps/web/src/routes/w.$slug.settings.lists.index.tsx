import { isDataError } from '@crm/data';
import { LoadingNow, sharedStrings } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { strings as listStrings } from '../features/lists/strings.ts';
import { ListsPending, ListsScreen } from '../features/settings/ListsScreen.tsx';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';

// Settings, Lists (spec 0048, AC-4828): every list the person may read, archived ones too, with the objects (for
// their names and the New list dialog) and the members (for who made each). Owners and admins are sent the entry
// count; nobody else is. The screen loads with this route's component, outside the first load.
export const Route = createFileRoute('/w/$slug/settings/lists/')({
  loader: async ({ context, params }) => {
    const [lists, objects, members] = await Promise.all([
      context.data.lists.all(params.slug),
      context.data.objects.all(params.slug),
      context.data.members.list(params.slug).catch(() => []),
    ]).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [undefined, undefined, undefined] as const;
      throw error;
    });
    return { lists, objects, members };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ListsPending />
    </LoadingNow>
  ),
  errorComponent: ListsError,
  component: ListsRoute,
});

function ListsRoute() {
  const { lists, objects, members } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (lists === undefined || objects === undefined || members === undefined) return null;
  return <ListsScreen data={data} toasts={toasts} slug={slug} lists={lists} objects={objects} members={members} />;
}

function ListsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={listStrings.settingsTitle}
      heading={listStrings.failed}
      text={isDataError(error) ? error.message : sharedStrings.couldntDoThat}
      onRetry={() => void router.invalidate()}
    />
  );
}
