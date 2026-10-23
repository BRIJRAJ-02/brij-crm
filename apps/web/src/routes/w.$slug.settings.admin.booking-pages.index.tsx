import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { strings } from '../features/admin/strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { PagesBody, PagesScreen } from '../features/admin/PagesScreen.tsx';

// Settings › Super admin › Booking pages (spec 0047, AC-1631): every page together and each one, for a period. The
// loader warms the read on the way in; the screen holds it and loads a new period in place.
export const Route = createFileRoute('/w/$slug/settings/admin/booking-pages/')({
  validateSearch: periodSearch,
  loader: async ({ context, location }) => {
    const search = periodSearch(location.search);
    // Warmed only: a refusal shows in the screen, which holds the same read.
    await context.data.operator.pages(search.period ?? DEFAULT_PERIOD).ready();
  },
  pendingComponent: PagesLoading,
  errorComponent: ConsoleError,
  component: PagesRoute,
});

function PagesLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <PagesBody period={period ?? DEFAULT_PERIOD} pages={undefined} />
    </LoadingNow>
  );
}

function PagesRoute() {
  const { data } = Route.useRouteContext();
  const { period } = Route.useSearch();
  return <PagesScreen data={data} period={period ?? DEFAULT_PERIOD} />;
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
