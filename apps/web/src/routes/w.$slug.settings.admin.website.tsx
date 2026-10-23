import { LoadingNow } from '@crm/ui';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AdminFailed } from '../features/admin/AdminParts.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { SitePending, SiteScreen } from '../features/admin/SiteScreen.tsx';
import { strings } from '../features/admin/strings.ts';

// Settings › Super admin › Website (spec 0047, AC-1632): the marketing site's visits for a period, from its own
// beacon, read fresh through the data layer.
export const Route = createFileRoute('/w/$slug/settings/admin/website')({
  validateSearch: periodSearch,
  loaderDeps: ({ search }) => ({ period: search.period ?? DEFAULT_PERIOD }),
  loader: async ({ context, deps }) => ({ site: await context.data.operator.site(deps.period) }),
  pendingComponent: SiteLoading,
  errorComponent: SiteError,
  component: SiteRoute,
});

function SiteError({ error }: ErrorComponentProps) {
  return <AdminFailed title={strings.website} error={error} data={Route.useRouteContext().data} />;
}

function SiteLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <SitePending period={period ?? DEFAULT_PERIOD} />
    </LoadingNow>
  );
}

function SiteRoute() {
  return <SiteScreen site={Route.useLoaderData().site} />;
}
