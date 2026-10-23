import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AdminFailed } from '../features/admin/AdminParts.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { PageMissing, PagePending, PageScreen } from '../features/admin/PagesScreen.tsx';
import { strings } from '../features/admin/strings.ts';

// Settings › Super admin › Booking pages › one page (spec 0047, AC-1631): its figures against the period before and
// its days, read through the data layer. An unknown or deleted page (or someone who isn't a super admin) is NOT_FOUND.
export const Route = createFileRoute('/w/$slug/settings/admin/booking-pages/$pageId')({
  validateSearch: periodSearch,
  loaderDeps: ({ search }) => ({ period: search.period ?? DEFAULT_PERIOD }),
  loader: async ({ context, params, deps }) => {
    try {
      return { detail: await context.data.operator.page(params.pageId, deps.period) };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'INPUT_INVALID')) {
        return { detail: undefined };
      }
      throw error;
    }
  },
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: PageRoute,
});

function PageRoute() {
  const { detail } = Route.useLoaderData();
  return detail === undefined ? <PageMissing /> : <PageScreen detail={detail} />;
}

function PageError({ error }: ErrorComponentProps) {
  return <AdminFailed title={strings.pages} error={error} data={Route.useRouteContext().data} />;
}

function PageLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <PagePending period={period ?? DEFAULT_PERIOD} />
    </LoadingNow>
  );
}
