import { LoadingNow } from '@crm/ui';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AdminFailed } from '../features/admin/AdminParts.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { PagesPending, PagesScreen } from '../features/admin/PagesScreen.tsx';
import { strings } from '../features/admin/strings.ts';

// Settings › Super admin › Booking pages (spec 0047, AC-1631): every page together and each one, for a period, read
// fresh through the data layer.
export const Route = createFileRoute('/w/$slug/settings/admin/booking-pages/')({
  validateSearch: periodSearch,
  loaderDeps: ({ search }) => ({ period: search.period ?? DEFAULT_PERIOD }),
  loader: async ({ context, deps }) => ({ pages: await context.data.operator.pages(deps.period) }),
  pendingComponent: PagesLoading,
  errorComponent: PagesError,
  component: PagesRoute,
});

function PagesError({ error }: ErrorComponentProps) {
  return <AdminFailed title={strings.pages} error={error} data={Route.useRouteContext().data} />;
}

function PagesLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <PagesPending period={period ?? DEFAULT_PERIOD} />
    </LoadingNow>
  );
}

function PagesRoute() {
  return <PagesScreen pages={Route.useLoaderData().pages} />;
}
