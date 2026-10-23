import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { navStrings as strings } from '../features/admin/nav-strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { DEFAULT_PERIOD } from '../features/admin/figures.ts';
import { periodOf, periodSearch } from '../features/admin/search.ts';
import { UserBody, UserScreen } from '../features/admin/UserScreen.tsx';

// Settings › Super admin › Users › one user (spec 0047, AC-1630): their account, active days and each workspace's
// counts for a period. The loader warms the read on the way in; the screen holds it and loads a new period in place.
export const Route = createFileRoute('/w/$slug/settings/admin/users/$userId')({
  validateSearch: periodSearch,
  loader: async ({ context, params, location }) => {
    const search = periodSearch(location.search);
    // Warmed only: a refusal shows in the screen, which holds the same read.
    await context.data.operator.user(params.userId, periodOf(search)).ready();
  },
  pendingComponent: UserLoading,
  errorComponent: ConsoleError,
  component: UserRoute,
});

function UserLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <UserBody period={period ?? DEFAULT_PERIOD} detail={undefined} />
    </LoadingNow>
  );
}

function UserRoute() {
  const { data } = Route.useRouteContext();
  const params = Route.useParams();
  const { period } = Route.useSearch();
  return <UserScreen data={data} userId={params.userId} period={period ?? DEFAULT_PERIOD} />;
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
