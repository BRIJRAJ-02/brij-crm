import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { strings } from '../features/admin/strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { OverviewBody, OverviewScreen } from '../features/admin/OverviewScreen.tsx';

// Settings › Super admin › Overview (spec 0047, AC-1629): the whole app's numbers for a period (`?period=`). The
// loader warms the period's read in the data layer on the way in; the screen holds it, so a new period loads in place.
export const Route = createFileRoute('/w/$slug/settings/admin/')({
  validateSearch: periodSearch,
  loader: async ({ context, location }) => {
    const search = periodSearch(location.search);
    // Warmed only: a refusal shows in the screen, which holds the same read.
    await context.data.operator.overview(search.period ?? DEFAULT_PERIOD).ready();
  },
  pendingComponent: OverviewLoading,
  errorComponent: ConsoleError,
  component: OverviewRoute,
});

function OverviewLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <OverviewBody period={period ?? DEFAULT_PERIOD} overview={undefined} />
    </LoadingNow>
  );
}

function OverviewRoute() {
  const { data } = Route.useRouteContext();
  const { period } = Route.useSearch();
  return <OverviewScreen data={data} period={period ?? DEFAULT_PERIOD} />;
}

/** Anything unexpected while drawing the page: the frame stays, with Retry. */
function ConsoleError() {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.overview}
      heading={strings.failedTitle}
      text={strings.failedTitle}
      onRetry={() => void router.invalidate()}
    />
  );
}
