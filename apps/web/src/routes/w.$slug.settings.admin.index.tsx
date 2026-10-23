import { LoadingNow } from '@crm/ui';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AdminFailed } from '../features/admin/AdminParts.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { OverviewPending, OverviewScreen } from '../features/admin/OverviewScreen.tsx';
import { strings } from '../features/admin/strings.ts';

// Settings › Super admin › Overview (spec 0047, AC-1629): the whole app's numbers for a period (`?period=`), read
// fresh through the data layer each time; the api refuses anyone who isn't a super admin.
export const Route = createFileRoute('/w/$slug/settings/admin/')({
  validateSearch: periodSearch,
  loaderDeps: ({ search }) => ({ period: search.period ?? DEFAULT_PERIOD }),
  loader: async ({ context, deps }) => ({ overview: await context.data.operator.overview(deps.period) }),
  pendingComponent: OverviewLoading,
  errorComponent: OverviewError,
  component: OverviewRoute,
});

function OverviewError({ error }: ErrorComponentProps) {
  return <AdminFailed title={strings.overview} error={error} data={Route.useRouteContext().data} />;
}

function OverviewLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <OverviewPending period={period ?? DEFAULT_PERIOD} />
    </LoadingNow>
  );
}

function OverviewRoute() {
  return <OverviewScreen overview={Route.useLoaderData().overview} />;
}
