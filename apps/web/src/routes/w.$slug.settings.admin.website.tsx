import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { strings } from '../features/admin/strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { DEFAULT_PERIOD, periodSearch } from '../features/admin/figures.ts';
import { SiteBody, SiteScreen } from '../features/admin/SiteScreen.tsx';

// Settings › Super admin › Website (spec 0047, AC-1632): the marketing site's visits for a period. The loader warms
// the read on the way in; the screen holds it and loads a new period in place.
export const Route = createFileRoute('/w/$slug/settings/admin/website')({
  validateSearch: periodSearch,
  loader: async ({ context, location }) => {
    const search = periodSearch(location.search);
    // Warmed only: a refusal shows in the screen, which holds the same read.
    await context.data.operator.site(search.period ?? DEFAULT_PERIOD).ready();
  },
  pendingComponent: SiteLoading,
  errorComponent: ConsoleError,
  component: SiteRoute,
});

function SiteLoading() {
  const { period } = Route.useSearch();
  return (
    <LoadingNow>
      <SiteBody period={period ?? DEFAULT_PERIOD} site={undefined} />
    </LoadingNow>
  );
}

function SiteRoute() {
  const { data } = Route.useRouteContext();
  const { period } = Route.useSearch();
  return <SiteScreen data={data} period={period ?? DEFAULT_PERIOD} />;
}

/** Anything unexpected while drawing the page: the frame stays, with Retry. */
function ConsoleError() {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.website}
      heading={strings.failedTitle}
      text={strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
