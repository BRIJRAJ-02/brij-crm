import type { OperatorUserPage } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AdminFailed } from '../features/admin/AdminParts.tsx';
import { DEFAULT_PERIOD, USERS_STEP, usersSearch } from '../features/admin/figures.ts';
import { strings } from '../features/admin/strings.ts';
import { UsersPending, UsersScreen } from '../features/admin/UsersScreen.tsx';

// Settings › Super admin › Users (spec 0047, AC-1630): every account, newest first, 50 at a time. The address keeps
// the period, the search (`?q=`) and how many rows show (`?shown=`, after Show more), so a reload or Back shows the
// same list; the loader reads the pages up to it through the data layer.
export const Route = createFileRoute('/w/$slug/settings/admin/users/')({
  validateSearch: usersSearch,
  loaderDeps: ({ search }) => ({
    period: search.period ?? DEFAULT_PERIOD,
    q: search.q ?? '',
    shown: search.shown ?? USERS_STEP,
  }),
  loader: async ({ context, deps }) => {
    const first = await context.data.operator.users({ period: deps.period, q: deps.q });
    let page: OperatorUserPage = first;
    let users = first.users;
    while (users.length < deps.shown && page.next !== undefined) {
      page = await context.data.operator.users({ period: deps.period, q: deps.q, after: page.next });
      users = [...users, ...page.users];
    }
    return { page: { ...page, total: first.total, users }, q: deps.q, shown: deps.shown };
  },
  pendingComponent: UsersLoading,
  errorComponent: UsersError,
  component: UsersRoute,
});

function UsersRoute() {
  const { page, q, shown } = Route.useLoaderData();
  return <UsersScreen page={page} q={q} shown={shown} />;
}

function UsersError({ error }: ErrorComponentProps) {
  return <AdminFailed title={strings.users} error={error} data={Route.useRouteContext().data} />;
}

function UsersLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <UsersPending period={period ?? DEFAULT_PERIOD} />
    </LoadingNow>
  );
}
