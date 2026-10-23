import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { navStrings as strings } from '../features/admin/nav-strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { DEFAULT_PERIOD } from '../features/admin/figures.ts';
import { periodOf, periodSearch } from '../features/admin/search.ts';
import { PageBody, PageScreen } from '../features/admin/PagesScreen.tsx';

// Settings › Super admin › Booking pages › one page, by its workspace and id (spec 0047, AC-1631): its figures against the period before and
// its days. The loader warms the read on the way in; the screen holds it and loads a new period in place.
export const Route = createFileRoute('/w/$slug/settings/admin/booking-pages/$workspaceId/$pageId')({
  validateSearch: periodSearch,
  loader: async ({ context, params, location }) => {
    const search = periodSearch(location.search);
    // Warmed only: a refusal shows in the screen, which holds the same read.
    await context.data.operator.page(params.workspaceId, params.pageId, periodOf(search)).ready();
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
  return (
    <PageScreen data={data} workspaceId={params.workspaceId} pageId={params.pageId} period={period ?? DEFAULT_PERIOD} />
  );
}

/** Anything unexpected while drawing the page: the frame stays, with Retry. */
function ConsoleError() {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.pages}
      heading={strings.failedTitle}
      text={strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
