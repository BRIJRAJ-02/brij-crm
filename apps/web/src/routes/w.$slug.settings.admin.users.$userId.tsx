import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AdminFailed } from '../features/admin/AdminParts.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { strings } from '../features/admin/strings.ts';
import { UserMissing, UserPending, UserScreen } from '../features/admin/UserScreen.tsx';

// Settings › Super admin › Users › one person (spec 0047, AC-1630): their account, active days and each workspace's
// counts for a period, read through the data layer. An unknown id (or someone who isn't a super admin) is NOT_FOUND.
export const Route = createFileRoute('/w/$slug/settings/admin/users/$userId')({
  validateSearch: periodSearch,
  loaderDeps: ({ search }) => ({ period: search.period ?? DEFAULT_PERIOD }),
  loader: async ({ context, params, deps }) => {
    try {
      return { detail: await context.data.operator.user(params.userId, deps.period) };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'INPUT_INVALID')) {
        return { detail: undefined };
      }
      throw error;
    }
  },
  pendingComponent: UserLoading,
  errorComponent: UserError,
  component: UserRoute,
});

function UserRoute() {
  const { detail } = Route.useLoaderData();
  return detail === undefined ? <UserMissing /> : <UserScreen detail={detail} />;
}

function UserError({ error }: ErrorComponentProps) {
  return <AdminFailed title={strings.users} error={error} data={Route.useRouteContext().data} />;
}

function UserLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <UserPending period={period ?? DEFAULT_PERIOD} />
    </LoadingNow>
  );
}
