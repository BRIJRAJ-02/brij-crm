import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { strings } from '../features/admin/strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { DEFAULT_PERIOD, usersSearch } from '../features/admin/figures.ts';
import { UsersScreen } from '../features/admin/UsersScreen.tsx';

// Settings › Super admin › Users (spec 0047, AC-1630): every user, newest first, 50 at a time. The address keeps the
// period and the search (`?q=`); the loader warms that list in the data layer on the way in, and the screen holds it,
// so a new search, a new period or Show more loads in place with the field keeping its focus.
export const Route = createFileRoute('/w/$slug/settings/admin/users/')({
  validateSearch: usersSearch,
  loader: async ({ context, location }) => {
    const search = usersSearch(location.search);
    // Warmed only: a refusal shows in the screen, which holds the same read.
    await context.data.operator.users(search.period ?? DEFAULT_PERIOD, search.q ?? '').ready();
  },
  pendingComponent: UsersLoading,
  errorComponent: ConsoleError,
  component: UsersRoute,
});

function UsersLoading() {
  const { data } = Route.useRouteContext();
  const search = Route.useSearch();
  return (
    <LoadingNow>
      <UsersScreen data={data} period={search.period ?? DEFAULT_PERIOD} q={search.q ?? ''} />
    </LoadingNow>
  );
}

function UsersRoute() {
  const { data } = Route.useRouteContext();
  const search = Route.useSearch();
  return <UsersScreen data={data} period={search.period ?? DEFAULT_PERIOD} q={search.q ?? ''} />;
}

/** Anything unexpected while drawing the page: the frame stays, with Retry. */
function ConsoleError() {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.users}
      heading={strings.failedTitle}
      text={strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
