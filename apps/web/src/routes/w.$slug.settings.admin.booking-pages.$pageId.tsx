import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { strings } from '../features/admin/strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { PageBody, PageScreen } from '../features/admin/PagesScreen.tsx';

// Settings › Super admin › Booking pages › one page (spec 0047, AC-1631): its figures against the period before and
// its days. The loader warms the read on the way in; the screen holds it and loads a new period in place.
export const Route = createFileRoute('/w/$slug/settings/admin/booking-pages/$pageId')({
  validateSearch: periodSearch,
  loader: async ({ context, params, location }) => {
    const search = periodSearch(location.search);
    // Warmed only: a refusal shows in the screen, which holds the same read.
    await context.data.operator.page(params.pageId, search.period ?? DEFAULT_PERIOD).ready();
  },
  pendingComponent: PageLoading,
  errorComponent: ConsoleError,
  component: PageRoute,
});

function PageLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <PageBody period={period ?? DEFAULT_PERIOD} detail={undefined} />
    </LoadingNow>
  );
}

function PageRoute() {
  const { data } = Route.useRouteContext();
  const params = Route.useParams();
  const { period } = Route.useSearch();
  return <PageScreen data={data} pageId={params.pageId} period={period ?? DEFAULT_PERIOD} />;
}

/** Anything unexpected while drawing the page: the frame stays, with Retry. */
function ConsoleError() {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.pages}
      heading={strings.failedTitle}
      text={strings.failedTitle}
      onRetry={() => void router.invalidate()}
    />
  );
}
